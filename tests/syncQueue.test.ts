/**
 * اختبار طابور المزامنة (بند 40/42/81):
 * أوفلاين → بيع → refresh → العملية remain PENDING → عودة الاتصال → sync → SYNCED
 * وإعادة التشغيل لا تكرر العملية (dedupe بoperation_id).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { executeOperation, drainQueue, refreshCounts, discardOp, registerOpType, useSyncStore } from '@/services/sync/syncEngine'
import type { PendingOp } from '@/types'

let serverProcessed: string[] = []

/** التحكم بحالة الاتصال — الكود يقرأ navigator.onLine مباشرة */
function setOnline(v: boolean): void {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
}

beforeEach(async () => {
  await db.pending_ops.clear()
  serverProcessed = []
  setOnline(true)
  useSyncStore.setState({ online: true, syncing: false, pendingCount: 0, failedCount: 0 })
  registerOpType('SALE_TEST', async (p) => {
    // محاكاة خادم idempotent: نفس operation_id لا يكرر
    const op = p.operation_id as string
    if (serverProcessed.includes(op)) return { duplicate: true }
    serverProcessed.push(op)
    return { id: 'sale-1', doc_number: 'SAL-2026-000001' }
  })
})

afterEach(() => {
  setOnline(true)
})

async function countBy(status: PendingOp['status']): Promise<number> {
  return db.pending_ops.filter((o) => o.status === status).count()
}

describe('offline queue', () => {
  it('أوفلاين: العملية تُحفظ PENDING ولا تضيع', async () => {
    setOnline(false)
    const res = await executeOperation('SALE_TEST', 'بيع تجريبي', { operation_id: 'op-1', total: 125 })
    expect(res.offline).toBe(true)
    expect(await countBy('PENDING')).toBe(1)
  })

  it('نفس operation_id لا يُدرج مرتين في الطابور (dedupe)', async () => {
    setOnline(false)
    await executeOperation('SALE_TEST', 'بيع', { operation_id: 'op-1' })
    await executeOperation('SALE_TEST', 'بيع', { operation_id: 'op-1' })
    expect(await db.pending_ops.count()).toBe(1)
  })

  it('عودة الاتصال: drainQueue يزامن → SYNCED ولا يكرر على الخادم', async () => {
    setOnline(false)
    await executeOperation('SALE_TEST', 'بيع', { operation_id: 'op-1' })
    setOnline(true)
    await drainQueue()
    expect(await countBy('PENDING')).toBe(0)
    expect(await countBy('SYNCED')).toBe(1)
    expect(serverProcessed).toHaveLength(1)

    // refresh ومحاولة ثانية بنفس operation_id → الخادم idempotent
    await drainQueue()
    expect(serverProcessed).toHaveLength(1)
  })

  it('خطأ عمل (مخزون غير كافٍ) يُرمى مباشرة ولا يُدرج في الطابور', async () => {
    registerOpType('FAIL_TEST', async () => {
      throw new Error('الكمية المطلوبة أكبر من الرصيد المتاح. المتاح: 20')
    })
    await expect(
      executeOperation('FAIL_TEST', 'بيع فاشل', { operation_id: 'op-2' }),
    ).rejects.toThrow('الكمية المطلوبة أكبر من الرصيد المتاح')
    expect(await db.pending_ops.count()).toBe(0)
  })

  it('refreshCounts يعكس العدادات', async () => {
    setOnline(false)
    await executeOperation('SALE_TEST', 'أ', { operation_id: 'op-a' })
    await executeOperation('SALE_TEST', 'ب', { operation_id: 'op-b' })
    await refreshCounts()
    expect(useSyncStore.getState().pendingCount).toBe(2)
    await discardOp((await db.pending_ops.toArray())[0]!.id!)
    await refreshCounts()
    expect(useSyncStore.getState().pendingCount).toBe(1)
  })
})
