/**
 * اختبارات محرك التنفيذ المحلي (بند 40/108 — الوضع المحلي الكامل):
 * - التنفيذ فوري على قاعدة الجهاز، أونلاين أو أوفلاين (لا خادم)
 * - أخطاء العمل تُرمى للمستخدم ولا تُصمت
 * - الطابور (pending_ops) طبقة توافق للبيانات القديمة: drainQueue ينجزها
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  executeOperation, registerOpType, refreshCounts, drainQueue, useSyncStore,
} from '@/services/sync/syncEngine'
import { db } from '@/db/db'

async function countBy(status: string): Promise<number> {
  const ops = await db.pending_ops.toArray()
  return ops.filter((o) => o.status === status).length
}

beforeEach(async () => {
  await db.pending_ops.clear()
  useSyncStore.getState().setOnline(true)
})

describe('التنفيذ المحلي المباشر', () => {
  it('ينفذ فوراً ويعيد البيانات حتى دون اتصال (الوضع المحلي)', async () => {
    registerOpType('LOCAL_TEST', async (p) => ({ id: 'x1', echo: p.value }))
    useSyncStore.getState().setOnline(false) // لا يؤثر — المحلي دائماً متاح
    const res = await executeOperation<{ id: string; echo: string }>('LOCAL_TEST', 'وصف', { value: 'abc' })
    expect(res.ok).toBe(true)
    expect(res.offline).toBe(false)
    expect(res.data?.id).toBe('x1')
    expect(res.data?.echo).toBe('abc')
  })

  it('خطأ العمل يُرمى برسالته العربية ولا يُصمت', async () => {
    registerOpType('FAIL_TEST', async () => {
      throw new Error('الكمية المطلوبة أكبر من الرصيد المتاح. المتاح: 5')
    })
    await expect(executeOperation('FAIL_TEST', 'وصف', {}))
      .rejects.toThrow('الكمية المطلوبة أكبر من الرصيد المتاح. المتاح: 5')
  })

  it('عملية غير مسجلة ترفض بوضوح', async () => {
    await expect(executeOperation('NOPE', 'وصف', {})).rejects.toThrow('عملية غير مسجلة')
  })
})

describe('توافق الطابور القديم (pending_ops)', () => {
  it('refreshCounts يعكس العدادات', async () => {
    await db.pending_ops.bulkAdd([
      { operation_id: 'op-1', type: 'A', payload: {}, status: 'PENDING', attempts: 0, last_error: null, created_at: new Date().toISOString(), synced_at: null, summary: 'س1' },
      { operation_id: 'op-2', type: 'A', payload: {}, status: 'FAILED', attempts: 1, last_error: 'خطأ', created_at: new Date().toISOString(), synced_at: null, summary: 'س2' },
    ])
    await refreshCounts()
    expect(useSyncStore.getState().pendingCount).toBe(1)
    expect(useSyncStore.getState().failedCount).toBe(1)
  })

  it('drainQueue ينفذ المعلقات بنجاح → SYNCED', async () => {
    let calls = 0
    registerOpType('DRAIN_TEST', async () => { calls += 1; return { id: 'ok' } })
    await db.pending_ops.bulkAdd([
      { operation_id: 'op-d1', type: 'DRAIN_TEST', payload: {}, status: 'PENDING', attempts: 0, last_error: null, created_at: new Date().toISOString(), synced_at: null, summary: 'معلقة' },
    ])
    await drainQueue()
    expect(calls).toBe(1)
    expect(await countBy('SYNCED')).toBe(1)
  })
})
