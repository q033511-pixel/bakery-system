/**
 * السياق المحلي + الدوال المساعدة — النسخة المحلية المطابقة لمنطق SQL
 * (0002_functions.sql): الهوية، الترقيم، الوحدات، المخزون، الصندوق، التدقيق.
 * كل دالة هنا انعكاس حرفي لدالة Postgres بنفس الاسم.
 */
import { db, getMeta, setMeta, deleteMeta, type LocalRow } from '@/db/db'
import { can, type Permission } from '@/lib/permissions'

// ---------- أخطاء بقواعد SQL ----------
export class LocalDbError extends Error {
  code: string
  constructor(message: string, code = 'P0001') {
    super(message)
    this.name = 'LocalDbError'
    this.code = code
  }
}

/** raise exception '...' → LocalDbError برسالة عربية كما في SQL */
export function raise(message: string): never {
  throw new LocalDbError(message)
}

// ---------- معرفات ووقت ----------
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // بديل نادر: بناء v4 يدوياً
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** business_today() — تاريخ اليوم المحلي بصيغة YYYY-MM-DD */
export function businessToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** round(x, n) كما في SQL */
export function roundN(x: number, n: number): number {
  const f = 10 ** n
  return Math.round((x + Number.EPSILON) * f) / f
}

// ---------- السياق: المستخدم والنشاط (بديل auth.uid / get_my_business_id) ----------
export interface LocalContext {
  userId: string | null
  email: string | null
  businessId: string | null
  role: string
  fullName: string
}

let ctx: LocalContext = { userId: null, email: null, businessId: null, role: 'PENDING', fullName: '' }

export function getCtx(): LocalContext {
  return ctx
}

export function setCtx(next: LocalContext): void {
  ctx = next
}

export async function clearSession(): Promise<void> {
  await deleteMeta('local_session')
  ctx = { userId: null, email: null, businessId: null, role: 'PENDING', fullName: '' }
}

/** تحميل السياق من الجلسة المحلية المخزنة — يعيد true إذا وُجد مستخدم مسجل */
export async function restoreContext(): Promise<boolean> {
  const session = await getMeta<{ userId: string }>('local_session')
  if (!session?.userId) return false
  const profile = await db.profiles.get(session.userId)
  if (!profile) {
    await clearSession()
    return false
  }
  ctx = {
    userId: String(profile.id),
    email: (profile.email as string) ?? null,
    businessId: (profile.business_id as string) ?? null,
    role: (profile.role as string) ?? 'PENDING',
    fullName: (profile.full_name as string) ?? '',
  }
  return true
}

export async function saveSession(userId: string): Promise<void> {
  await setMeta('local_session', { userId })
}

// ---------- assert_business / assert_perm ----------
export async function requireBusinessId(): Promise<string> {
  if (!ctx.businessId) raise('لا يوجد نشاط تجاري مرتبط بحسابك.')
  const biz = await db.businesses.get(ctx.businessId)
  if (!biz) raise('النشاط التجاري غير موجود.')
  return ctx.businessId
}

export async function assertPerm(perm: Permission | string): Promise<void> {
  // الوضع المحلي: مالك واحد — المالك يملك كل الصلاحيات (role_has_perm: OWNER → true)
  if (ctx.role === 'OWNER' || ctx.role === 'ADMIN') return
  const allowed = can(ctx.role as never, perm as Permission)
  if (!allowed) raise('ليس لديك صلاحية لتنفيذ هذه العملية.')
}

// ---------- register_op (idempotency بند 39) ----------
/** true = جديدة (سُجلت الآن)، false = مكررة */
export async function registerOp(operationId: string | null, type: string): Promise<boolean> {
  if (!operationId) raise('operation_id مطلوب لكل عملية (منع التكرار).')
  const existing = await db.processed_operations.get(operationId)
  if (existing) return false
  const row: LocalRow = {
    id: operationId,
    operation_id: operationId,
    operation_type: type,
    business_id: ctx.businessId ?? '',
    processed_by: ctx.userId,
    processed_at: nowIso(),
  }
  await db.processed_operations.put(row)
  return true
}

/** البحث عن مستند سابق بنفس operation_id (للإرجاع عند التكرار) */
export async function findDuplicateByOp(table: string, operationId: string): Promise<LocalRow | null> {
  const rows = (await db.table(table).toArray()) as LocalRow[]
  return rows.find((r) => r.operation_id === operationId) ?? null
}

// ---------- next_doc_number ----------
export async function nextDocNumber(prefix: string): Promise<string> {
  const bid = await requireBusinessId()
  const year = new Date().getFullYear()
  const key = `${bid}|${prefix}|${year}`
  const existing = (await db.doc_sequences.toArray()).find(
    (r) => r.key === key || (r.business_id === bid && r.prefix === prefix && r.seq_year === year),
  )
  let lastNo: number
  if (existing) {
    lastNo = Number(existing.last_no ?? 0) + 1
    // المفتاح الأساسي مركب [business_id+prefix+seq_year] — التحديث بالمفتاح المركب إلزامي
    await db.doc_sequences.update([bid, prefix, year], { last_no: lastNo })
  } else {
    lastNo = 1
    await db.doc_sequences.put({ id: uuid(), key, business_id: bid, prefix, seq_year: year, last_no: lastNo })
  }
  return `${prefix}-${year}-${String(lastNo).padStart(6, '0')}`
}

// ---------- convert_qty_to_base ----------
export async function convertQtyToBase(productId: string, unitId: string, qty: number): Promise<number> {
  const product = await db.products.get(productId)
  if (!product) raise('الصنف غير موجود.')
  const baseUnitId = product.base_unit_id as string
  if (!baseUnitId) raise('الصنف بدون وحدة أساسية.')
  if (unitId === baseUnitId) return roundN(qty, 3)
  const conversions = (await db.unit_conversions.where('business_id').equals(String(product.business_id)).toArray()) as LocalRow[]
  const conv = conversions.find((c) => c.from_unit_id === unitId && c.to_unit_id === baseUnitId)
  if (!conv || conv.factor == null) {
    raise('لا يوجد تحويل من الوحدة المختارة إلى الوحدة الأساسية للصنف. أضف تحويل الوحدة أولاً.')
  }
  return roundN(qty * Number(conv.factor), 3)
}

// ---------- stock_qty / assert_stock_available ----------
const IN_TYPES = ['PURCHASE_IN', 'PRODUCTION_IN', 'SALE_RETURN_IN', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'DISTRIBUTION_RETURN_IN']

export async function stockQty(productId: string, warehouseId: string): Promise<number> {
  const bid = await requireBusinessId()
  const movs = (await db.inventory_movements
    .where('business_id').equals(bid)
    .toArray()) as LocalRow[]
  let sum = 0
  for (const m of movs) {
    if (m.item_id !== productId || m.warehouse_id !== warehouseId) continue
    sum += IN_TYPES.includes(String(m.movement_type)) ? Number(m.quantity) : -Number(m.quantity)
  }
  return sum
}

export async function assertStockAvailable(productId: string, warehouseId: string, baseQty: number): Promise<void> {
  const bid = await requireBusinessId()
  const biz = await db.businesses.get(bid)
  if (biz && biz.allow_negative_stock === true) return
  const avail = await stockQty(productId, warehouseId)
  if (avail < baseQty) {
    raise(`الكمية المطلوبة أكبر من الرصيد المتاح. المتاح: ${avail}`)
  }
}

// ---------- get_default_cash_account ----------
export async function getDefaultCashAccount(): Promise<string | null> {
  const bid = await requireBusinessId()
  const accounts = (await db.cash_accounts.where('business_id').equals(bid).toArray()) as LocalRow[]
  const active = accounts
    .filter((a) => a.active !== false)
    .sort((a, b) => Number(b.is_default === true) - Number(a.is_default === true))
  const first = active[0]
  return first ? String(first.id) : null
}

// ---------- audit ----------
export async function writeAudit(
  operation: string, entity: string, entityId: string | null, action: string,
  beforeData?: unknown, afterData?: unknown,
): Promise<void> {
  const bid = await requireBusinessId()
  await db.audit_logs.add({
    id: uuid(),
    business_id: bid,
    user_id: ctx.userId,
    user_email: ctx.email,
    operation,
    entity,
    entity_id: entityId,
    action,
    before_data: beforeData ?? null,
    after_data: afterData ?? null,
    created_at: nowIso(),
  } as LocalRow)
}

// ---------- أدوات مشتركة للعمليات ----------
export async function mustExist(table: string, id: unknown, message: string): Promise<LocalRow> {
  const row = await db.table(table).get(String(id))
  if (!row) raise(message)
  return row as LocalRow
}

export async function insertRow(table: string, row: LocalRow): Promise<LocalRow> {
  await db.table(table).put(row)
  return row
}

/** حركة مخزون — مطابقة لـ insert into inventory_movements في كل دالة */
export async function insertMovement(p: {
  productId: string; itemType: string; warehouseId: string; movementType: string
  baseQty: number; inputQty: number; inputUnitId: string | null
  unitCost: number; totalCost: number; referenceType: string; referenceId: string
  operationId: string | null
}): Promise<void> {
  const bid = await requireBusinessId()
  await db.inventory_movements.add({
    id: uuid(),
    business_id: bid,
    item_id: p.productId,
    item_type: p.itemType,
    warehouse_id: p.warehouseId,
    movement_type: p.movementType,
    quantity: p.baseQty,
    input_quantity: p.inputQty,
    input_unit_id: p.inputUnitId,
    unit_cost: p.unitCost,
    total_cost: p.totalCost,
    reference_type: p.referenceType,
    reference_id: p.referenceId,
    operation_id: p.operationId,
    created_by: ctx.userId,
    created_at: nowIso(),
  } as LocalRow)
}

/** حركة صندوق — مطابقة لـ insert into cash_transactions */
export async function insertCashTx(p: {
  cashAccountId: string; direction: 'IN' | 'OUT'; amount: number
  referenceType: string; referenceId: string; operationId: string | null
  description: string
}): Promise<void> {
  const bid = await requireBusinessId()
  await db.cash_transactions.add({
    id: uuid(),
    business_id: bid,
    cash_account_id: p.cashAccountId,
    direction: p.direction,
    amount: p.amount,
    reference_type: p.referenceType,
    reference_id: p.referenceId,
    operation_id: p.operationId,
    description: p.description,
    created_by: ctx.userId,
    created_at: nowIso(),
  } as LocalRow)
}
