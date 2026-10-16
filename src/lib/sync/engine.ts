/* ============================================================================
 * محرك المزامنة — العقل المدبر للتجربة (الخطة B)
 * ---------------------------------------------------------------------------
 * الحالات السبع المعتمدة (تُعرض كما هي في الواجهة):
 *   LOCAL_ONLY → PENDING_SYNC → SYNCING → SYNCED
 *                                     ↘ FAILED (قابل لإعادة المحاولة آلياً)
 *                                     ↘ REJECTED (رفض عمل مسبب من الخادم — رجوع محلي)
 *                                     ↘ CONFLICT (تسوية يدوية — لا دمج آلي للمال)
 * المبادئ:
 *   1) الرفع بترتيب التبعيات (عميل قبل فاتورته، صنف قبل سعره) ثم FIFO.
 *   2) لا last-write-wins على المال — الخادم يعتمد أو يرفض، والرفض مسبب.
 *   3) الطابور دائم (OpStore) — يبقى بعد إغلاق قسري وإعادة تشغيل.
 *   4) المحرك لا يعرف طبقة النقل ولا التخزين — يُحقَنان من الخارج.
 * ========================================================================== */

export type SyncState =
  | 'LOCAL_ONLY' | 'PENDING_SYNC' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'REJECTED' | 'CONFLICT'

export interface PendingOp {
  operation_id: string
  op_type: string
  payload: unknown
  state: SyncState
  created_at: string
  attempts: number
  last_error?: string
  rejection_reason?: string
  device_id?: string
  schema_version: number
}

export interface ServerOp {
  seq: number
  operation_id: string
  op_type: string
  payload: unknown
  status: 'APPROVED' | 'REJECTED' | 'CONFLICT'
  rejection_reason?: string
}

export interface SubmitResult {
  status: 'APPROVED' | 'REJECTED' | 'DUPLICATE' | 'CONFLICT'
  result?: unknown
  rejection_reason?: string
}

export interface SyncTransport {
  submit(op: PendingOp): Promise<SubmitResult>
  pull(sinceSeq: number, limit?: number): Promise<ServerOp[]>
}

/** تخزين دائم لقائمة العمليات المعلقة (Dexie في التطبيق / ملف في الأدوات) */
export interface OpStore {
  load(): Promise<PendingOp[]>
  save(ops: PendingOp[]): Promise<void>
}

/* ---------- ترتيب التبعيات: الوالد قبل الابن، ثم FIFO داخل الرتبة ---------- */
const DEPENDENCY_RANK: Record<string, number> = {
  PRODUCT_UPSERT: 1,
  SUPPLIER_UPSERT: 2, CUSTOMER_UPSERT: 2,
  CUSTOMER_PRICE_UPSERT: 3,
  PURCHASE: 4,
  SALE: 5, CUSTOMER_PAYMENT: 5, SUPPLIER_PAYMENT: 5, EXPENSE: 5,
  PRODUCTION_BATCH: 5, INVENTORY_ADJUSTMENT: 5, WASTE: 5, TRANSFER: 5,
  SALE_VOID: 6, PURCHASE_VOID: 6,
}

export function orderForUpload(ops: PendingOp[]): PendingOp[] {
  return [...ops].sort((a, b) => {
    const ra = DEPENDENCY_RANK[a.op_type] ?? 5
    const rb = DEPENDENCY_RANK[b.op_type] ?? 5
    if (ra !== rb) return ra - rb
    return a.created_at.localeCompare(b.created_at)
  })
}

/* ---------- العمليات المالية: لا دمج آلي أبداً — اعتماد أو رفض فقط ---------- */
const FINANCIAL_OPS = new Set([
  'SALE', 'SALE_VOID', 'PURCHASE', 'PURCHASE_VOID',
  'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE',
  'PRODUCTION_BATCH', 'INVENTORY_ADJUSTMENT', 'WASTE', 'TRANSFER',
])

export function isFinancialOp(opType: string): boolean {
  return FINANCIAL_OPS.has(opType)
}

export interface UploadSummary {
  synced: string[]
  rejected: { operation_id: string; reason: string }[]
  failed: { operation_id: string; error: string }[]
  ops: PendingOp[]
}

/**
 * رفع العمليات المعلقة بترتيب التبعيات. يعيد العمليات محدثة الحالة (نسخ جديدة —
 * لا تحوير للمصفوفة المدخلة) + ملخص. أخطاء الشبكة = FAILED (يُعاد لاحقاً)؛
 * رفض الخادم = REJECTED مع السبب (النداء يقرر التعويض المحلي)؛
 * حالة CONFLICT لا تُحدد آلياً من المحرك — تضعها سياسة الأعمال يدوياً.
 */
export async function uploadPending(
  ops: PendingOp[],
  transport: SyncTransport,
  opts: { onRejected?: (op: PendingOp, reason: string) => Promise<void> } = {},
): Promise<UploadSummary> {
  const out = new Map(ops.map((o) => [o.operation_id, { ...o }]))
  const summary: UploadSummary = { synced: [], rejected: [], failed: [], ops: [] }

  for (const op of orderForUpload(ops.filter((o) => o.state === 'LOCAL_ONLY' || o.state === 'PENDING_SYNC' || o.state === 'FAILED'))) {
    const cur = out.get(op.operation_id)!
    cur.state = 'SYNCING'
    try {
      const res = await transport.submit(cur)
      if (res.status === 'APPROVED' || res.status === 'DUPLICATE') {
        // DUPLICATE = الخادم اعتمدها سابقاً — بلا أثر مالي مضاعف (سلوك مقصود)
        cur.state = 'SYNCED'
        cur.last_error = undefined
        cur.rejection_reason = undefined
        summary.synced.push(cur.operation_id)
      } else if (res.status === 'CONFLICT') {
        cur.state = 'CONFLICT'
        cur.rejection_reason = res.rejection_reason ?? 'تعارض يتطلب تسوية يدوية'
        summary.rejected.push({ operation_id: cur.operation_id, reason: cur.rejection_reason })
        await opts.onRejected?.(cur, cur.rejection_reason)
      } else {
        // رفض عمل مسبب — يُسجل السبب ويُترك للتعويض المحلي (لا يُحذف من الطابور)
        cur.state = 'REJECTED'
        cur.rejection_reason = res.rejection_reason ?? 'رفض من الخادم.'
        summary.rejected.push({ operation_id: cur.operation_id, reason: cur.rejection_reason })
        await opts.onRejected?.(cur, cur.rejection_reason)
      }
    } catch (e) {
      // خطأ شبكة/بنية — قابل لإعادة المحاولة، العملية تبقى محفوظة دائماً
      cur.state = 'FAILED'
      cur.attempts += 1
      cur.last_error = e instanceof Error ? e.message : String(e)
      summary.failed.push({ operation_id: cur.operation_id, error: cur.last_error })
    }
  }
  summary.ops = [...out.values()]
  return summary
}

/**
 * تطبيق ما سُحب من الخادم (عمليات أجهزة أخرى + مصائر عمليات هذا الجهاز).
 * applyServerOp يطبق محلياً بشكل idempotent (operation_id يمنع التكرار محلياً).
 */
export async function applyPulled(
  serverOps: ServerOp[],
  applyServerOp: (op: ServerOp) => Promise<void>,
): Promise<{ applied: number; skipped: number }> {
  let applied = 0
  let skipped = 0
  for (const row of serverOps) {
    try {
      await applyServerOp(row)
      applied += 1
    } catch {
      // صف مرفوض معروف المصير أو صف مطبق مسبقاً — يُتخطى ولا يفسد ما بعده
      skipped += 1
    }
  }
  return { applied, skipped }
}

/* ---------- تخزين دائم بسيط (ذاكرة) — للاختبارات وكأساس لأي OpStore ---------- */
export function createMemoryStore(initial: PendingOp[] = []): OpStore {
  let data: PendingOp[] = [...initial]
  return {
    async load() { return [...data] },
    async save(ops) { data = [...ops] },
  }
}

/** دورة مزامنة كاملة: رفع ثم سحب — تعيد الحالة الجديدة للطابور وآخر seq */
export async function syncOnce(
  store: OpStore,
  transport: SyncTransport,
  lastSeq: number,
  applyServerOp: (op: ServerOp) => Promise<void>,
  opts: { onRejected?: (op: PendingOp, reason: string) => Promise<void> } = {},
): Promise<{ ops: PendingOp[]; lastSeq: number; summary: UploadSummary; applied: number }> {
  const pending = await store.load()
  const summary = await uploadPending(pending, transport, opts)
  await store.save(summary.ops)
  const pulled = await transport.pull(lastSeq, 500)
  const { applied } = await applyPulled(pulled, applyServerOp)
  const last = pulled.length ? pulled[pulled.length - 1] : undefined
  const newSeq = last ? last.seq : lastSeq
  return { ops: summary.ops, lastSeq: newSeq, summary, applied }
}
