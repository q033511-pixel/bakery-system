/**
 * Sync Engine (بند 42/43/133):
 * - كل عملية تشغيلية تحمل operation_id ثابتاً
 * - أوفلاين؟ تُحفظ في IndexedDB بحالة PENDING ولا تفقد أبداً
 * - عند عودة الاتصال: إرسال بالترتيب، الخادم idempotent فلا تكرار
 * - تعارض المخزون: الخادم هو المرجع — يرفض ويظهر الخطأ (لا تجاوز صامت)
 */
import { db } from '@/db/db'
import type { PendingOp } from '@/types'
import { create } from 'zustand'

type OpFn = (payload: Record<string, unknown>) => Promise<unknown>

/** سجل العمليات: type → دالة التنفيذ (تُستخدم للمحاولة الأولى ولإعادة المحاولة) */
const opRegistry = new Map<string, OpFn>()

export function registerOpType(type: string, fn: OpFn): void {
  opRegistry.set(type, fn)
}

interface SyncState {
  online: boolean
  syncing: boolean
  pendingCount: number
  failedCount: number
  lastSyncAt: string | null
  setOnline: (v: boolean) => void
  setSyncing: (v: boolean) => void
  setCounts: (p: number, f: number) => void
  markSynced: () => void
}

export const useSyncStore = create<SyncState>((set) => ({
  online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  syncing: false,
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
  setOnline: (v) => set({ online: v }),
  setSyncing: (v) => set({ syncing: v }),
  setCounts: (p, f) => set({ pendingCount: p, failedCount: f }),
  markSynced: () => set({ lastSyncAt: new Date().toISOString() }),
}))

/** هل الخطأ ناتج عن الشبكة (يُعاد المحاولة) أم عن بيانات/صلاحيات (لا يُعاد)؟ */
export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return (
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('load failed') ||
    msg.includes('err_internet') ||
    msg.includes('err_network') ||
    err instanceof TypeError
  )
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) return String((err as { message: unknown }).message)
  return 'حدث خطأ غير معروف أثناء المزامنة.'
}

export interface ExecuteResult<T> {
  ok: boolean
  offline: boolean
  data?: T
  duplicate?: boolean
}

/**
 * تنفيذ عملية تشغيلية مع دعم أوفلاين:
 * - متصل: تنفيذ فوري عبر RPC؛ خطأ شبكة → enqueue؛ خطأ عمل → رمي للعرض
 * - غير متصل: enqueue فوراً بحالة PENDING
 */
export async function executeOperation<T = unknown>(
  type: string,
  summary: string,
  payload: Record<string, unknown>,
): Promise<ExecuteResult<T>> {
  const fn = opRegistry.get(type)
  if (!fn) throw new Error(`عملية غير مسجلة: ${type}`)

  const online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true

  if (!online) {
    await enqueueOp(type, summary, payload)
    return { ok: true, offline: true }
  }

  try {
    const data = (await fn(payload)) as T
    useSyncStore.getState().markSynced()
    return { ok: true, offline: false, data }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueOp(type, summary, payload)
      useSyncStore.getState().setOnline(false)
      return { ok: true, offline: true }
    }
    throw new Error(extractErrorMessage(err))
  }
}

async function enqueueOp(type: string, summary: string, payload: Record<string, unknown>): Promise<void> {
  const operationId = payload.operation_id
  if (typeof operationId !== 'string' || !operationId) {
    throw new Error('عملية بدون operation_id — مرفوضة (منع التكرار).')
  }
  const existing = await db.pending_ops.where('operation_id').equals(operationId).first()
  if (existing) return // مُدرجة بالفعل — لا تكرار في الطابور
  const op: PendingOp = {
    operation_id: operationId,
    type,
    payload,
    status: 'PENDING',
    attempts: 0,
    last_error: null,
    created_at: new Date().toISOString(),
    synced_at: null,
    summary,
  }
  await db.pending_ops.add(op).then((id) => {
    // Dexie auto-increment: نحفظ المفتاح على الكائن حتى تعمل التحديثات لاحقاً
    op.id = id
  })
  await refreshCounts()
}

/** تحديث عدادات الحالة في المتجر */
export async function refreshCounts(): Promise<void> {
  const ops = await db.pending_ops.toArray()
  useSyncStore.getState().setCounts(
    ops.filter((o) => o.status === 'PENDING').length,
    ops.filter((o) => o.status === 'FAILED').length,
  )
}

let draining = false

/** تفريغ الطابور بالترتيب — يدار بترتيب الإنشاء (FIFO) */
export async function drainQueue(): Promise<void> {
  if (draining) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  draining = true
  const store = useSyncStore.getState()
  store.setSyncing(true)
  try {
    const ops = await db.pending_ops.where('status').equals('PENDING').sortBy('created_at')
    for (const op of ops) {
      const fn = opRegistry.get(op.type)
      if (!fn) {
        await db.pending_ops.update(op.id as number, { status: 'FAILED', last_error: `عملية غير مسجلة: ${op.type}` })
        continue
      }
      try {
        await fn(op.payload)
        await db.pending_ops.update(op.id as number, { status: 'SYNCED', synced_at: new Date().toISOString() })
        store.markSynced()
      } catch (err) {
        if (isNetworkError(err)) {
          // الشبكة تقطعت أثناء التفريغ — أوقف ولا تفشل العملية
          useSyncStore.getState().setOnline(false)
          break
        }
        const msg = extractErrorMessage(err)
        // خطأ عمل (مخزون، صلاحيات، بيانات) → FAILED واضح للمستخدم (بند 43)
        await db.pending_ops.update(op.id as number, {
          status: 'FAILED',
          attempts: op.attempts + 1,
          last_error: msg,
        })
      }
    }
  } finally {
    draining = false
    useSyncStore.getState().setSyncing(false)
    await refreshCounts()
  }
}

export async function retryOp(id: number): Promise<void> {
  const op = await db.pending_ops.get(id)
  if (!op) return
  const fn = opRegistry.get(op.type)
  if (!fn) return
  try {
    await fn(op.payload)
    await db.pending_ops.update(id, { status: 'SYNCED', synced_at: new Date().toISOString(), last_error: null })
    useSyncStore.getState().markSynced()
  } catch (err) {
    if (isNetworkError(err)) {
      await db.pending_ops.update(id, { status: 'PENDING' })
    } else {
      await db.pending_ops.update(id, {
        status: 'FAILED',
        attempts: op.attempts + 1,
        last_error: extractErrorMessage(err),
      })
    }
  }
  await refreshCounts()
}

export async function retryAllFailed(): Promise<void> {
  const failed = await db.pending_ops.where('status').equals('FAILED').toArray()
  for (const op of failed) {
    await db.pending_ops.update(op.id as number, { status: 'PENDING' })
  }
  await refreshCounts()
  await drainQueue()
}

export async function discardOp(id: number): Promise<void> {
  await db.pending_ops.delete(id)
  await refreshCounts()
}

let initialized = false

/** تهيئة المستمعين — تُستدعى مرة واحدة عند تحميل التطبيق */
export function initSyncEngine(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const goOnline = () => {
    useSyncStore.getState().setOnline(true)
    void drainQueue()
  }
  const goOffline = () => useSyncStore.getState().setOnline(false)

  window.addEventListener('online', goOnline)
  window.addEventListener('offline', goOffline)

  // مزامنة دورية خفيفة كل 45 ثانية عند وجود معلقات
  window.setInterval(() => {
    void db.pending_ops.where('status').equals('PENDING').count().then((c) => {
      if (c > 0) void drainQueue()
    })
  }, 45_000)

  if (navigator.onLine) void drainQueue()
}
