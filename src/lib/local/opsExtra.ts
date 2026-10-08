/**
 * opsExtra — العمليات المحلية: المخزون/التوزيع/الإعدادات + لوحة القيادة + كل التقارير
 * انعكاس حرفي لدوال Postgres من:
 *   - 0002_functions.sql: من create_inventory_adjustment حتى نهاية الملف
 *     (تسوية/هالك/مناقلة/توزيع×4/تسوية حمولة/assign_user_role/update_business/get_dashboard_summary)
 *   - 0004_views.sql: كامل الملف (كل دوال التقارير + كشوف الحسابات + get_audit_logs + update_my_profile)
 * القاعدة الذهبية: نفس التحققات، نفس رسائل الأخطاء العربية حرفياً، نفس الحسابات والتقريب.
 * كل عملية مالية داخل db.transaction ذرية (بند 44) + operation_id idempotent (بند 39).
 */
import { db, type LocalRow } from '@/db/db'
import type { RpcHandler } from './rpc'
import {
  assertPerm,
  assertStockAvailable,
  businessToday,
  convertQtyToBase,
  findDuplicateByOp,
  getDefaultCashAccount,
  getCtx,
  insertCashTx,
  insertMovement,
  insertRow,
  nextDocNumber,
  nowIso,
  raise,
  registerOp,
  requireBusinessId,
  roundN,
  uuid,
  writeAudit,
} from './context'

// ---------- أنواع ----------
type Row = Record<string, unknown>

// ---------- مساعدات تحويل القيم (مطابقة لدلالات SQL) ----------

/** nullif(x::text, '') — نص الحمولة: فارغ/مفقود → null */
function ns(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s === '' ? null : s
}

/** معامل مباشر (ليس jsonb): null/undefined → null وإلا نصه كما هو */
function ptext(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v)
}

/** ::numeric — قيمة غير رقمية → null ثم ترفضها فحوص SQL (الكمية/المبلغ) */
function nn(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** coalesce(p_payload->'items', '[]') */
function itemsOf(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : []
}

/** coalesce((patch->'allow_negative_stock')::boolean, old) */
function coalesceBool(fallback: unknown, v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback === true
}

/** (p_to + 1) — اليوم التالي بصيغة YYYY-MM-DD */
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** p_from::timestamptz — بداية اليوم بالتوقيت المحلي (مللي ثانية) */
function dayStartMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getTime()
}

/** coalesce(x, 0) على عمود رقمي في صف */
function num(v: unknown): number {
  return nn(v) ?? 0
}

// ---------- ترتيب (مطابق لـ order by SQL على نصوص) ----------
function cmpDesc(a: unknown, b: unknown): number {
  const x = a === null || a === undefined ? '' : String(a)
  const y = b === null || b === undefined ? '' : String(b)
  return x < y ? 1 : x > y ? -1 : 0
}

function cmpAsc(a: unknown, b: unknown): number {
  const x = a === null || a === undefined ? '' : String(a)
  const y = b === null || b === undefined ? '' : String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

// ---------- تجميع ----------
function sumBy(rows: LocalRow[], pick: (r: LocalRow) => number): number {
  let total = 0
  for (const r of rows) total += pick(r)
  return total
}

/** أنواع الإدخال في المخزون — كما في كل استعلامات SQL */
const IN_TYPES = new Set([
  'PURCHASE_IN', 'PRODUCTION_IN', 'SALE_RETURN_IN', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'DISTRIBUTION_RETURN_IN',
])

function signedQty(m: LocalRow): number {
  const sign = IN_TYPES.has(String(m.movement_type ?? '')) ? 1 : -1
  return sign * num(m.quantity)
}

// ---------- معاملة ذرية (بند 44) ----------
const TX_TABLES = [
  'businesses', 'profiles', 'warehouses', 'units', 'unit_conversions', 'products',
  'customers', 'suppliers', 'employees', 'vehicles', 'drivers',
  'inventory_movements', 'inventory_adjustments', 'waste_records', 'transfers', 'transfer_items',
  'sales', 'sale_items', 'customer_payments', 'supplier_payments',
  'production_batches', 'production_consumption', 'expenses', 'expense_categories',
  'cash_accounts', 'cash_transactions',
  'distribution_loads', 'distribution_items', 'distribution_deliveries', 'distribution_returns',
  'distribution_settlements', 'audit_logs', 'doc_sequences', 'processed_operations',
]

function inTx<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', TX_TABLES, fn)
}

// ============================================================================
// INVENTORY: تسوية + هالك + مناقلة (بند 27/94/99)
// ============================================================================
const create_inventory_adjustment: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('inventory.adjust')
    const payload = (params.p_payload ?? {}) as Row
    const opId = ns(payload.operation_id)
    if (!(await registerOp(opId, 'ADJUSTMENT'))) {
      const dup = await findDuplicateByOp('inventory_adjustments', String(opId))
      return { id: dup?.id ?? null, doc_number: dup?.doc_number ?? null, duplicate: true }
    }
    const qty = nn(payload.quantity)
    if (qty === null || qty <= 0) raise('الكمية يجب أن تكون أكبر من صفر.')
    if (ns(payload.reason) === null) raise('اكتب سبب التسوية.')
    const productId = String(payload.product_id ?? '')
    const unitId = String(payload.unit_id ?? '')
    const warehouseId = String(payload.warehouse_id ?? '')
    const direction = ns(payload.direction)
    const base = await convertQtyToBase(productId, unitId, qty)
    if (direction === 'OUT') await assertStockAvailable(productId, warehouseId, base)
    const product = await db.products.get(productId)
    const avg = product ? num(product.avg_cost) : 0
    const doc = await nextDocNumber('ADJ')
    const id = uuid()
    await insertRow('inventory_adjustments', {
      id, operation_id: opId, doc_number: doc, business_id: bid,
      product_id: productId, warehouse_id: warehouseId,
      direction: direction ?? 'IN', quantity: qty, reason: String(payload.reason ?? ''),
      adjusted_at: ns(payload.adjusted_at) ?? businessToday(),
      notes: ns(payload.notes), created_by: getCtx().userId, created_at: nowIso(),
    })
    await insertMovement({
      productId,
      itemType: product ? String(product.item_type ?? '') : '',
      warehouseId,
      movementType: direction === 'OUT' ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN',
      baseQty: base, inputQty: qty, inputUnitId: unitId,
      unitCost: avg, totalCost: roundN(base * avg, 2),
      referenceType: 'ADJUSTMENT', referenceId: id, operationId: opId,
    })
    await writeAudit('INVENTORY_ADJUSTMENT', 'inventory_adjustment', id, 'ADJUSTMENT', null, {
      direction: payload.direction ?? null, qty, reason: payload.reason ?? null,
    })
    return { id, doc_number: doc, duplicate: false }
  })
}

const create_waste: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('inventory.waste')
    const payload = (params.p_payload ?? {}) as Row
    const opId = ns(payload.operation_id)
    if (!(await registerOp(opId, 'WASTE'))) {
      const dup = await findDuplicateByOp('waste_records', String(opId))
      return { id: dup?.id ?? null, doc_number: dup?.doc_number ?? null, duplicate: true }
    }
    const qty = nn(payload.quantity)
    if (qty === null || qty <= 0) raise('الكمية يجب أن تكون أكبر من صفر.')
    if (ns(payload.reason) === null) raise('اكتب سبب الهالك.')
    const productId = String(payload.product_id ?? '')
    const unitId = String(payload.unit_id ?? '')
    const warehouseId = String(payload.warehouse_id ?? '')
    const base = await convertQtyToBase(productId, unitId, qty)
    await assertStockAvailable(productId, warehouseId, base)
    const product = await db.products.get(productId)
    const avg = product ? num(product.avg_cost) : 0
    const doc = await nextDocNumber('WST')
    const id = uuid()
    await insertRow('waste_records', {
      id, operation_id: opId, doc_number: doc, business_id: bid,
      product_id: productId, warehouse_id: warehouseId,
      quantity: qty, reason: String(payload.reason ?? ''),
      wasted_at: ns(payload.wasted_at) ?? businessToday(),
      notes: ns(payload.notes), created_by: getCtx().userId, created_at: nowIso(),
    })
    await insertMovement({
      productId,
      itemType: product ? String(product.item_type ?? '') : '',
      warehouseId,
      movementType: 'WASTE_OUT',
      baseQty: base, inputQty: qty, inputUnitId: unitId,
      unitCost: avg, totalCost: roundN(base * avg, 2),
      referenceType: 'WASTE', referenceId: id, operationId: opId,
    })
    await writeAudit('CREATE_WASTE', 'waste', id, 'WASTE', null, {
      qty, reason: payload.reason ?? null,
    })
    return { id, doc_number: doc, duplicate: false }
  })
}

// ============================================================================
// TRANSFERS (بند 99)
// ============================================================================
const create_transfer: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('inventory.transfer')
    const payload = (params.p_payload ?? {}) as Row
    const opId = ns(payload.operation_id)
    if (!(await registerOp(opId, 'TRANSFER'))) {
      const dup = await findDuplicateByOp('transfers', String(opId))
      return { id: dup?.id ?? null, doc_number: dup?.doc_number ?? null, duplicate: true }
    }
    const fromId = ns(payload.from_warehouse_id)
    const toId = ns(payload.to_warehouse_id)
    if (fromId === null || toId === null || fromId === toId) {
      raise('اختر مستودعين مختلفين للمناقلة.')
    }
    const items = itemsOf(payload.items)
    if (items.length === 0) raise('أضف صنفاً واحداً على الأقل.')

    for (const it of items) {
      const q = nn(it.quantity)
      if (q === null || q <= 0) raise('الكمية يجب أن تكون أكبر من صفر.')
      const productId = String(it.product_id ?? '')
      const base = await convertQtyToBase(productId, String(it.unit_id ?? ''), q)
      await assertStockAvailable(productId, fromId, base)
    }

    const doc = await nextDocNumber('TRF')
    const id = uuid()
    await insertRow('transfers', {
      id, operation_id: opId, doc_number: doc, business_id: bid,
      from_warehouse_id: fromId, to_warehouse_id: toId,
      transfer_date: ns(payload.transfer_date) ?? businessToday(),
      status: 'CONFIRMED', notes: ns(payload.notes),
      created_by: getCtx().userId, created_at: nowIso(),
    })

    for (const it of items) {
      const productId = String(it.product_id ?? '')
      const unitId = String(it.unit_id ?? '')
      const q = num(it.quantity)
      await insertRow('transfer_items', {
        id: uuid(), transfer_id: id, product_id: productId, quantity: q, unit_id: unitId,
        created_at: nowIso(), created_by: getCtx().userId,
      })
      const base = await convertQtyToBase(productId, unitId, q)
      const product = await db.products.get(productId)
      const avg = product ? num(product.avg_cost) : 0
      const itemType = product ? String(product.item_type ?? '') : ''
      await insertMovement({
        productId, itemType, warehouseId: fromId, movementType: 'TRANSFER_OUT',
        baseQty: base, inputQty: q, inputUnitId: unitId,
        unitCost: avg, totalCost: roundN(base * avg, 2),
        referenceType: 'TRANSFER', referenceId: id, operationId: opId,
      })
      await insertMovement({
        productId, itemType, warehouseId: toId, movementType: 'TRANSFER_IN',
        baseQty: base, inputQty: q, inputUnitId: unitId,
        unitCost: avg, totalCost: roundN(base * avg, 2),
        referenceType: 'TRANSFER', referenceId: id, operationId: opId,
      })
    }

    await writeAudit('CREATE_TRANSFER', 'transfer', id, 'TRANSFER', null, {
      doc_number: doc, from: fromId, to: toId,
    })
    return { id, doc_number: doc, duplicate: false }
  })
}

// ============================================================================
// DISTRIBUTION (بند 29-31)
// ============================================================================
const create_distribution_load: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('distribution.manage')
    const payload = (params.p_payload ?? {}) as Row
    const opId = ns(payload.operation_id)
    if (!(await registerOp(opId, 'DISTRIBUTION_LOAD'))) {
      const dup = await findDuplicateByOp('distribution_loads', String(opId))
      return { id: dup?.id ?? null, doc_number: dup?.doc_number ?? null, duplicate: true }
    }
    const warehouseId = String(payload.warehouse_id ?? '')
    const vehicleId = ns(payload.vehicle_id)
    let vehicleOk = false
    if (vehicleId !== null) {
      const vehicle = await db.vehicles.get(vehicleId)
      vehicleOk = Boolean(vehicle && vehicle.business_id === bid && vehicle.active !== false)
    }
    if (!vehicleOk) raise('اختر سيارة صحيحة.')
    const items = itemsOf(payload.items)
    if (items.length === 0) raise('أضف أصنافاً للتحميل.')

    for (const it of items) {
      const q = nn(it.quantity)
      if (q === null || q <= 0) raise('الكمية يجب أن تكون أكبر من صفر.')
      const productId = String(it.product_id ?? '')
      const base = await convertQtyToBase(productId, String(it.unit_id ?? ''), q)
      await assertStockAvailable(productId, warehouseId, base)
    }

    const doc = await nextDocNumber('LOD')
    const id = uuid()
    await insertRow('distribution_loads', {
      id, operation_id: opId, doc_number: doc, business_id: bid,
      vehicle_id: vehicleId, driver_id: ns(payload.driver_id),
      distributor_id: ns(payload.distributor_id), warehouse_id: warehouseId,
      load_date: ns(payload.load_date) ?? businessToday(),
      status: 'OPEN', notes: ns(payload.notes),
      created_by: getCtx().userId, created_at: nowIso(),
    })

    for (const it of items) {
      const productId = String(it.product_id ?? '')
      const unitId = String(it.unit_id ?? '')
      const q = num(it.quantity)
      await insertRow('distribution_items', {
        id: uuid(), load_id: id, product_id: productId, quantity: q, unit_id: unitId,
        created_at: nowIso(), created_by: getCtx().userId,
      })
      const base = await convertQtyToBase(productId, unitId, q)
      const product = await db.products.get(productId)
      const avg = product ? num(product.avg_cost) : 0
      await insertMovement({
        productId,
        itemType: product ? String(product.item_type ?? '') : '',
        warehouseId,
        movementType: 'DISTRIBUTION_LOAD_OUT',
        baseQty: base, inputQty: q, inputUnitId: unitId,
        unitCost: avg, totalCost: roundN(base * avg, 2),
        referenceType: 'DISTRIBUTION_LOAD', referenceId: id, operationId: opId,
      })
    }

    await writeAudit('CREATE_DISTRIBUTION_LOAD', 'distribution_load', id, 'CREATE', null, {
      doc_number: doc, vehicle_id: payload.vehicle_id ?? null,
    })
    return { id, doc_number: doc, duplicate: false }
  })
}

// بيع أثناء التوزيع: يُنشئ sale (channel=DISTRIBUTION) مرتبطة بالحمولة — بلا حركة مخزون
// لأن البضاعة خرجت فعلاً مع تحميل السيارة.
const record_distribution_delivery: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('distribution.manage')
    const payload = (params.p_payload ?? {}) as Row
    const opId = ns(payload.operation_id)
    if (!(await registerOp(opId, 'DISTRIBUTION_DELIVERY'))) {
      const dup = await findDuplicateByOp('distribution_deliveries', String(opId))
      return { id: dup?.id ?? null, duplicate: true }
    }

    const loadId = String(payload.load_id ?? '')
    const customerId = String(payload.customer_id ?? '')
    const productId = String(payload.product_id ?? '')
    const qty = nn(payload.quantity)
    const unitId = String(payload.unit_id ?? '')
    const product = await db.products.get(productId)
    const price = nn(payload.unit_price) ?? (product ? nn(product.sale_price) : null)
    const payType = ns(payload.payment_type) ?? 'CASH'
    const date = ns(payload.delivery_date) ?? businessToday()

    const load = await db.distribution_loads.get(loadId)
    if (!load || load.business_id !== bid || !['OPEN', 'IN_PROGRESS'].includes(String(load.status ?? ''))) {
      raise('الحمولة غير موجودة أو مُسوّاة مسبقاً.')
    }
    const customer = await db.customers.get(customerId)
    if (!customer || customer.business_id !== bid || customer.active === false) {
      raise('اختر عميلاً صحيحاً.')
    }
    if (qty === null || qty <= 0) raise('الكمية يجب أن تكون أكبر من صفر.')

    // يجب أن يكون الصنف من محمولات الحمولة، والكمية ضمن الرصيد المتبقي على السيارة
    const loadItems = (await db.distribution_items.where('load_id').equals(loadId).toArray()) as LocalRow[]
    if (!loadItems.some((li) => String(li.product_id ?? '') === productId)) {
      raise('هذا الصنف ليس ضمن محمولات الحمولة.')
    }
    const base = await convertQtyToBase(productId, unitId, qty)
    let loaded = 0
    for (const li of loadItems) {
      if (String(li.product_id ?? '') !== productId) continue
      loaded += await convertQtyToBase(productId, String(li.unit_id ?? ''), num(li.quantity))
    }
    const deliveries = (await db.distribution_deliveries.where('load_id').equals(loadId).toArray()) as LocalRow[]
    const returns = (await db.distribution_returns.where('load_id').equals(loadId).toArray()) as LocalRow[]
    let out = 0
    for (const d of deliveries) {
      if (String(d.product_id ?? '') !== productId) continue
      out += await convertQtyToBase(productId, String(d.unit_id ?? ''), num(d.quantity))
    }
    for (const r of returns) {
      if (String(r.product_id ?? '') !== productId) continue
      out += await convertQtyToBase(productId, String(r.unit_id ?? ''), num(r.quantity))
    }
    const remaining = roundN(loaded - out, 3)
    if (remaining < base) {
      raise(`الكمية المبيعة أكبر من الرصيد المتبقي على السيارة. المتبقي: ${remaining}`)
    }

    const doc = await nextDocNumber('SAL')
    const saleId = uuid()
    const total = roundN(qty * (price ?? 0), 2)
    const costTotal = roundN(base * (product ? num(product.avg_cost) : 0), 2)
    await insertRow('sales', {
      id: saleId, operation_id: opId, doc_number: doc, business_id: bid,
      customer_id: customerId, warehouse_id: String(load.warehouse_id ?? ''),
      sale_date: date, subtotal: total, discount: 0, total,
      cost_total: costTotal, payment_type: payType, payment_method: null,
      status: 'CONFIRMED', channel: 'DISTRIBUTION', load_id: loadId,
      notes: null, created_by: getCtx().userId, created_at: nowIso(),
    })

    await insertRow('sale_items', {
      id: uuid(), sale_id: saleId, product_id: productId, quantity: qty,
      unit_id: unitId, unit_price: price ?? 0, total,
      created_at: nowIso(), created_by: getCtx().userId,
    })

    const delId = uuid()
    await insertRow('distribution_deliveries', {
      id: delId, operation_id: opId, load_id: loadId, business_id: bid,
      customer_id: customerId, product_id: productId, quantity: qty,
      unit_id: unitId, unit_price: price ?? 0, total, payment_type: payType,
      delivery_date: date, sale_id: saleId,
      created_by: getCtx().userId, created_at: nowIso(),
    })

    if (String(load.status ?? '') === 'OPEN') {
      await db.distribution_loads.update(loadId, { status: 'IN_PROGRESS' })
    }

    await writeAudit('DISTRIBUTION_DELIVERY', 'distribution_delivery', delId, 'CREATE', null, {
      load_id: loadId, qty,
    })
    return { sale_id: saleId, doc_number: doc, duplicate: false }
  })
}

// مرتجع توزيع: يعيد البضاعة للمستودع
const record_distribution_return: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('distribution.manage')
    const payload = (params.p_payload ?? {}) as Row
    const opId = ns(payload.operation_id)
    if (!(await registerOp(opId, 'DISTRIBUTION_RETURN'))) {
      const dup = await findDuplicateByOp('distribution_returns', String(opId))
      return { id: dup?.id ?? null, duplicate: true }
    }

    const loadId = String(payload.load_id ?? '')
    const productId = String(payload.product_id ?? '')
    const qty = nn(payload.quantity)
    const unitId = String(payload.unit_id ?? '')

    const load = await db.distribution_loads.get(loadId)
    if (!load || load.business_id !== bid) raise('الحمولة غير موجودة.')
    const warehouseId = String(load.warehouse_id ?? '')
    if (!['OPEN', 'IN_PROGRESS'].includes(String(load.status ?? ''))) {
      raise('الحمولة مُسوّاة مسبقاً — لا يمكن إضافة مرتجع.')
    }
    const loadItems = (await db.distribution_items.where('load_id').equals(loadId).toArray()) as LocalRow[]
    if (!loadItems.some((li) => String(li.product_id ?? '') === productId)) {
      raise('هذا الصنف ليس ضمن محمولات الحمولة.')
    }
    if (qty === null || qty <= 0) raise('الكمية يجب أن تكون أكبر من صفر.')

    const base = await convertQtyToBase(productId, unitId, qty)
    let loaded = 0
    for (const li of loadItems) {
      if (String(li.product_id ?? '') !== productId) continue
      loaded += await convertQtyToBase(productId, String(li.unit_id ?? ''), num(li.quantity))
    }
    const deliveries = (await db.distribution_deliveries.where('load_id').equals(loadId).toArray()) as LocalRow[]
    const returns = (await db.distribution_returns.where('load_id').equals(loadId).toArray()) as LocalRow[]
    let out = 0
    for (const d of deliveries) {
      if (String(d.product_id ?? '') !== productId) continue
      out += await convertQtyToBase(productId, String(d.unit_id ?? ''), num(d.quantity))
    }
    for (const r of returns) {
      if (String(r.product_id ?? '') !== productId) continue
      out += await convertQtyToBase(productId, String(r.unit_id ?? ''), num(r.quantity))
    }
    const remaining = roundN(loaded - out, 3)
    if (remaining < base) {
      raise(`الكمية المرتجعة أكبر من الرصيد المتبقي على السيارة. المتبقي: ${remaining}`)
    }

    const id = uuid()
    await insertRow('distribution_returns', {
      id, operation_id: opId, load_id: loadId, business_id: bid,
      product_id: productId, quantity: qty, unit_id: unitId,
      reason: ns(payload.reason),
      return_date: ns(payload.return_date) ?? businessToday(),
      created_by: getCtx().userId, created_at: nowIso(),
    })

    const product = await db.products.get(productId)
    const avg = product ? num(product.avg_cost) : 0
    await insertMovement({
      productId,
      itemType: product ? String(product.item_type ?? '') : '',
      warehouseId,
      movementType: 'DISTRIBUTION_RETURN_IN',
      baseQty: base, inputQty: qty, inputUnitId: unitId,
      unitCost: avg, totalCost: roundN(base * avg, 2),
      referenceType: 'DISTRIBUTION_RETURN', referenceId: id, operationId: opId,
    })

    await writeAudit('DISTRIBUTION_RETURN', 'distribution_return', id, 'RETURN', null, {
      load_id: loadId, qty, reason: payload.reason ?? null,
    })
    return { id, duplicate: false }
  })
}

// تسوية الحمولة (بند 31): Loaded = Sold + Returned + Unaccounted
// لا إغلاق دون معالجة الفروق أو تسجيل سبب.
const settle_distribution_load: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('distribution.settle')
    const loadId = String(params.p_load_id ?? '')
    const cashCollected = nn(params.p_cash_collected) ?? 0
    const varianceNote = ptext(params.p_variance_note)

    const load = await db.distribution_loads.get(loadId)
    if (!load || load.business_id !== bid) raise('الحمولة غير موجودة.')
    if (String(load.status ?? '') === 'SETTLED') raise('الحمولة مُسوّاة مسبقاً.')

    const opId = uuid()
    const doc = await nextDocNumber('STL')

    const loadItems = (await db.distribution_items.where('load_id').equals(loadId).toArray()) as LocalRow[]
    const deliveries = (await db.distribution_deliveries.where('load_id').equals(loadId).toArray()) as LocalRow[]
    const returns = (await db.distribution_returns.where('load_id').equals(loadId).toArray()) as LocalRow[]

    const productIds = [...new Set(loadItems.map((li) => String(li.product_id ?? '')))]
    let loaded = 0
    let sold = 0
    let returned = 0
    const breakdown: Row[] = []
    for (const productId of productIds) {
      let prodLoaded = 0
      let prodSold = 0
      let prodReturned = 0
      for (const li of loadItems) {
        if (String(li.product_id ?? '') !== productId) continue
        prodLoaded += await convertQtyToBase(productId, String(li.unit_id ?? ''), num(li.quantity))
      }
      for (const d of deliveries) {
        if (String(d.product_id ?? '') !== productId) continue
        prodSold += await convertQtyToBase(productId, String(d.unit_id ?? ''), num(d.quantity))
      }
      for (const r of returns) {
        if (String(r.product_id ?? '') !== productId) continue
        prodReturned += await convertQtyToBase(productId, String(r.unit_id ?? ''), num(r.quantity))
      }
      prodLoaded = roundN(prodLoaded, 3)
      prodSold = roundN(prodSold, 3)
      prodReturned = roundN(prodReturned, 3)
      loaded += prodLoaded
      sold += prodSold
      returned += prodReturned
      breakdown.push({
        product_id: productId,
        loaded: prodLoaded, sold: prodSold, returned: prodReturned,
        unaccounted: roundN(prodLoaded - prodSold - prodReturned, 3),
      })
    }
    loaded = roundN(loaded, 3)
    sold = roundN(sold, 3)
    returned = roundN(returned, 3)

    const unaccounted = roundN(loaded - sold - returned, 3)
    const cashExpected = roundN(
      sumBy(deliveries.filter((d) => String(d.payment_type ?? '') === 'CASH'), (d) => num(d.total)), 2,
    )
    const creditTotal = roundN(
      sumBy(deliveries.filter((d) => String(d.payment_type ?? '') === 'CREDIT'), (d) => num(d.total)), 2,
    )
    const cashVariance = roundN(cashExpected - cashCollected, 2)

    if (unaccounted !== 0 && (varianceNote === null || varianceNote.trim().length < 3)) {
      raise(`يوجد فرق كمية غير مبرر (${unaccounted}). سجل سبب الفرق قبل التسوية.`)
    }
    if (cashVariance !== 0 && (varianceNote === null || varianceNote.trim().length < 3)) {
      raise(`يوجد فرق نقدي (${cashVariance}). سجل سبب الفرق قبل التسوية.`)
    }

    const id = uuid()
    await insertRow('distribution_settlements', {
      id, operation_id: opId, doc_number: doc, load_id: loadId, business_id: bid,
      settlement_date: businessToday(),
      loaded_qty: loaded, sold_qty: sold, returned_qty: returned, waste_qty: 0,
      unaccounted_qty: unaccounted, cash_collected: cashCollected, credit_total: creditTotal,
      cash_expected: cashExpected, cash_variance: cashVariance,
      variance_note: varianceNote, product_breakdown: breakdown,
      created_by: getCtx().userId, created_at: nowIso(),
    })

    if (cashCollected > 0) {
      const cashAcc = await getDefaultCashAccount()
      if (cashAcc !== null) {
        await insertCashTx({
          cashAccountId: cashAcc, direction: 'IN', amount: cashCollected,
          referenceType: 'DISTRIBUTION_SETTLEMENT', referenceId: id, operationId: opId,
          description: `تحصيل تسوية حمولة ${doc}`,
        })
      }
    }

    await db.distribution_loads.update(loadId, { status: 'SETTLED' })

    await writeAudit('SETTLE_DISTRIBUTION', 'distribution_settlement', id, 'SETTLEMENT', null, {
      doc_number: doc, loaded, sold, returned, unaccounted, cash_collected: cashCollected,
    })
    return { id, doc_number: doc, unaccounted, cash_variance: cashVariance, duplicate: false }
  })
}

// ============================================================================
// USERS / SETTINGS (بند 34/68/69) — المالك المحلي مسموح دائماً عبر assertPerm
// ============================================================================
const assign_user_role: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('users.manage')
    const userId = String(params.p_user_id ?? '')
    const role = String(params.p_role ?? '')
    const target = await db.profiles.get(userId)
    if (!target) raise('المستخدم غير موجود.')
    if (target.business_id !== null && target.business_id !== undefined && String(target.business_id) !== bid) {
      raise('المستخدم ينتمي لنشاط تجاري آخر.')
    }
    if (String(target.role ?? '') === 'OWNER' && getCtx().role !== 'OWNER') {
      raise('لا يمكن تعديل حساب المالك إلا بواسطة المالك.')
    }
    if (String(target.role ?? '') === 'OWNER' && role !== 'OWNER') {
      const owners = ((await db.profiles.where('business_id').equals(bid).toArray()) as LocalRow[])
        .filter((p) => String(p.role ?? '') === 'OWNER' && p.active !== false).length
      if (owners <= 1) raise('لا يمكن إزالة آخر مالك للنظام.')
    }
    await db.profiles.update(userId, { business_id: bid, role, updated_at: nowIso() })
    await writeAudit('ASSIGN_ROLE', 'profile', userId, 'UPDATE',
      { role: target.role ?? null }, { role })
    return { ok: true }
  })
}

const update_business: RpcHandler = async (params) => {
  return inTx(async () => {
    const bid = await requireBusinessId()
    await assertPerm('settings.manage')
    const patch = (params.p_patch ?? {}) as Row
    const old = ((await db.businesses.get(bid)) ?? {}) as LocalRow
    const updates: Row = {
      name: ns(patch.name) ?? old.name ?? null,
      currency: ns(patch.currency) ?? old.currency ?? null,
      currency_symbol: ns(patch.currency_symbol) ?? old.currency_symbol ?? null,
      timezone: ns(patch.timezone) ?? old.timezone ?? null,
      allow_negative_stock: coalesceBool(old.allow_negative_stock, patch.allow_negative_stock),
    }
    await db.businesses.update(bid, updates)
    await writeAudit('UPDATE_BUSINESS', 'business', bid, 'UPDATE', old, { ...old, ...updates })
    return { ok: true }
  })
}

// تحديث ملفي الشخصي (الاسم والهاتف فقط — لا يمكن للمستخدم تغيير دوره بنفسه)
const update_my_profile: RpcHandler = async (params) => {
  return inTx(async () => {
    const uid = getCtx().userId
    if (uid === null) raise('يجب تسجيل الدخول.')
    const fullName = ptext(params.p_full_name)
    const phone = ptext(params.p_phone)
    const updates: Row = { updated_at: nowIso() }
    if (fullName !== null) updates['full_name'] = fullName
    if (phone !== null) updates['phone'] = phone
    const profile = await db.profiles.get(uid)
    if (profile) await db.profiles.update(uid, updates)
    return { ok: true }
  })
}

// ============================================================================
// DASHBOARD (بند 46/86/87): كل الحقول الحسابية بنفس معادلات SQL — بلا N+1
// ============================================================================
const get_dashboard_summary: RpcHandler = async () => {
  const bid = getCtx().businessId
  if (bid === null) return { error: 'no_business' }
  const today = businessToday()

  const sales = (await db.sales.where('business_id').equals(bid).toArray()) as LocalRow[]
  const payments = (await db.customer_payments.where('business_id').equals(bid).toArray()) as LocalRow[]
  const purchases = (await db.purchases.where('business_id').equals(bid).toArray()) as LocalRow[]
  const batches = (await db.production_batches.where('business_id').equals(bid).toArray()) as LocalRow[]
  const expenses = (await db.expenses.where('business_id').equals(bid).toArray()) as LocalRow[]
  const supplierPayments = (await db.supplier_payments.where('business_id').equals(bid).toArray()) as LocalRow[]
  const movements = (await db.inventory_movements.where('business_id').equals(bid).toArray()) as LocalRow[]
  const loads = (await db.distribution_loads.where('business_id').equals(bid).toArray()) as LocalRow[]
  const customers = (await db.customers.where('business_id').equals(bid).toArray()) as LocalRow[]
  const productsBiz = (await db.products.where('business_id').equals(bid).toArray()) as LocalRow[]
  const cashTx = (await db.cash_transactions.where('business_id').equals(bid).toArray()) as LocalRow[]
  // الانضمام للمنتجات في SQL بلا فلتر نشاط (join على id فقط)
  const allProducts = (await db.products.toArray()) as LocalRow[]
  const productById = new Map(allProducts.map((p) => [String(p.id), p]))

  const confirmedSales = sales.filter((s) => String(s.status ?? '') === 'CONFIRMED')
  const salesToday = confirmedSales.filter((s) => String(s.sale_date ?? '') === today)
  const salesTodayTotal = sumBy(salesToday, (s) => num(s.total))
  const salesTodayCount = salesToday.length
  const collectionsToday = sumBy(
    payments.filter((p) => String(p.payment_date ?? '') === today), (p) => num(p.amount),
  )
  const purchasesToday = sumBy(
    purchases.filter((p) => String(p.status ?? '') === 'CONFIRMED' && String(p.purchase_date ?? '') === today),
    (p) => num(p.total),
  )
  const productionToday = sumBy(
    batches.filter((b) => String(b.status ?? '') === 'CONFIRMED' && String(b.batch_date ?? '') === today),
    (b) => num(b.material_cost),
  )
  const expensesToday = sumBy(
    expenses.filter((e) => String(e.expense_date ?? '') === today), (e) => num(e.amount),
  )

  // customer_receivables: coalesce((sum مبيعات آجلة) - (sum تحصيلات), 0) — NULL ينتشر كما في SQL
  const creditSales = confirmedSales.filter((s) => String(s.payment_type ?? '') === 'CREDIT')
  const creditSum = creditSales.length > 0 ? sumBy(creditSales, (s) => num(s.total)) : null
  const paySum = payments.length > 0 ? sumBy(payments, (p) => num(p.amount)) : null
  const customerReceivables = creditSum !== null && paySum !== null ? creditSum - paySum : 0

  // supplier_payables: نفس نمط NULL propagation
  const creditPurchases = purchases.filter(
    (p) => String(p.payment_type ?? '') === 'CREDIT' && String(p.status ?? '') === 'CONFIRMED',
  )
  const creditPurSum = creditPurchases.length > 0 ? sumBy(creditPurchases, (p) => num(p.total)) : null
  const supPaySum = supplierPayments.length > 0 ? sumBy(supplierPayments, (p) => num(p.amount)) : null
  const supplierPayables = creditPurSum !== null && supPaySum !== null ? creditPurSum - supPaySum : 0

  // inventory_value: مجموع (الكمية × متوسط التكلفة) لكل (صنف، مستودع) بكمية > 0
  const stockGroups = new Map<string, number>()
  for (const m of movements) {
    const key = `${String(m.item_id ?? '')}|${String(m.warehouse_id ?? '')}`
    stockGroups.set(key, (stockGroups.get(key) ?? 0) + signedQty(m))
  }
  let inventoryValue = 0
  for (const [key, qty] of stockGroups) {
    if (!(qty > 0)) continue
    const product = productById.get(key.slice(0, key.indexOf('|')))
    if (!product) continue
    inventoryValue += qty * num(product.avg_cost)
  }

  // low_stock_count: الأصناف النشطة (رصيد إجمالي < الحد الأدنى > 0)
  const qtyByItem = new Map<string, number>()
  for (const m of movements) {
    const itemId = String(m.item_id ?? '')
    qtyByItem.set(itemId, (qtyByItem.get(itemId) ?? 0) + signedQty(m))
  }
  let lowStockCount = 0
  for (const [itemId, qty] of qtyByItem) {
    const product = productById.get(itemId)
    if (!product || product.active === false) continue
    const minStock = num(product.min_stock)
    if (minStock > 0 && qty < minStock) lowStockCount++
  }

  const distributionOpenLoads = loads.filter((l) =>
    ['OPEN', 'IN_PROGRESS'].includes(String(l.status ?? ''))).length
  const customersCount = customers.filter((c) => c.active !== false).length
  const productsCount = productsBiz.filter((p) => p.active !== false).length
  const cashBalance = cashTx.length > 0
    ? sumBy(cashTx, (t) => (String(t.direction ?? '') === 'IN' ? num(t.amount) : -num(t.amount)))
    : 0

  return {
    sales_today: salesTodayTotal,
    sales_today_count: salesTodayCount,
    collections_today: collectionsToday,
    purchases_today: purchasesToday,
    production_today: productionToday,
    expenses_today: expensesToday,
    customer_receivables: customerReceivables,
    supplier_payables: supplierPayables,
    inventory_value: inventoryValue,
    low_stock_count: lowStockCount,
    distribution_open_loads: distributionOpenLoads,
    customers_count: customersCount,
    products_count: productsCount,
    cash_balance: cashBalance,
    date: today,
  }
}

// ============================================================================
// تقارير — RPCs (0004_views.sql) — كل دالة بنفس المعاملات وأعمدة النتائج
// ============================================================================

const get_sales_report: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  const customer = ptext(params.p_customer)
  if (from === null || to === null) return []
  const customers = (await db.customers.toArray()) as LocalRow[]
  const customerById = new Map(customers.map((c) => [String(c.id), c]))
  const rows = (await db.sales.where('business_id').equals(bid).toArray()) as LocalRow[]
  const filtered = rows.filter((s) => {
    const d = String(s.sale_date ?? '')
    if (d < from || d > to) return false
    if (customer !== null && String(s.customer_id ?? '') !== customer) return false
    return true
  })
  filtered.sort((a, b) => cmpDesc(a.sale_date, b.sale_date) || cmpDesc(a.created_at, b.created_at))
  return filtered.map((s) => {
    const c = s.customer_id != null ? customerById.get(String(s.customer_id)) : undefined
    return {
      id: String(s.id),
      doc_number: s.doc_number ?? null,
      sale_date: String(s.sale_date ?? ''),
      customer_name: c && c.name !== null && c.name !== undefined ? String(c.name) : 'عميل نقدي',
      total: num(s.total),
      cost_total: num(s.cost_total),
      payment_type: s.payment_type ?? null,
      status: s.status ?? null,
      channel: s.channel ?? null,
    }
  })
}

const get_sales_daily_summary: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  if (from === null || to === null) return []
  const rows = (await db.sales.where('business_id').equals(bid).toArray()) as LocalRow[]
  const groups = new Map<string, { invoices: number; total: number; cash: number; credit: number; cost: number }>()
  for (const s of rows) {
    if (String(s.status ?? '') !== 'CONFIRMED') continue
    const day = String(s.sale_date ?? '')
    if (day < from || day > to) continue
    const g = groups.get(day) ?? { invoices: 0, total: 0, cash: 0, credit: 0, cost: 0 }
    g.invoices += 1
    g.total += num(s.total)
    if (String(s.payment_type ?? '') === 'CASH') g.cash += num(s.total)
    if (String(s.payment_type ?? '') === 'CREDIT') g.credit += num(s.total)
    g.cost += num(s.cost_total)
    groups.set(day, g)
  }
  return [...groups.entries()]
    .sort((a, b) => cmpDesc(a[0], b[0]))
    .map(([day, g]) => ({
      day,
      invoices: g.invoices,
      total: g.total,
      cash_total: g.cash,
      credit_total: g.credit,
      cost: g.cost,
    }))
}

const get_purchases_report: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  if (from === null || to === null) return []
  const suppliers = (await db.suppliers.toArray()) as LocalRow[]
  const supplierById = new Map(suppliers.map((s) => [String(s.id), s]))
  const rows = (await db.purchases.where('business_id').equals(bid).toArray()) as LocalRow[]
  const filtered = rows.filter((p) => {
    const d = String(p.purchase_date ?? '')
    return d >= from && d <= to
  })
  filtered.sort((a, b) => cmpDesc(a.purchase_date, b.purchase_date) || cmpDesc(a.created_at, b.created_at))
  const out: Row[] = []
  for (const p of filtered) {
    const supplier = p.supplier_id != null ? supplierById.get(String(p.supplier_id)) : undefined
    if (!supplier) continue // join داخلي مع الموردين كما في SQL
    out.push({
      id: String(p.id),
      doc_number: p.doc_number ?? null,
      purchase_date: String(p.purchase_date ?? ''),
      supplier_name: supplier.name ?? null,
      invoice_number: p.invoice_number ?? null,
      total: num(p.total),
      payment_type: p.payment_type ?? null,
      status: p.status ?? null,
    })
  }
  return out
}

const get_inventory_report: RpcHandler = async () => {
  const bid = getCtx().businessId
  if (bid === null) return []
  // v_stock محسوبة inline: تجميع الحركات لكل (صنف، مستودع) + بيانات الصنف
  const products = (await db.products.toArray()) as LocalRow[]
  const productById = new Map(products.map((p) => [String(p.id), p]))
  const warehouses = (await db.warehouses.toArray()) as LocalRow[]
  const warehouseById = new Map(warehouses.map((w) => [String(w.id), w]))
  const movements = (await db.inventory_movements.where('business_id').equals(bid).toArray()) as LocalRow[]
  const groups = new Map<string, number>()
  for (const m of movements) {
    const key = `${String(m.item_id ?? '')}|${String(m.warehouse_id ?? '')}`
    groups.set(key, (groups.get(key) ?? 0) + signedQty(m))
  }
  const out: Row[] = []
  for (const [key, qty] of groups) {
    const sep = key.indexOf('|')
    const productId = key.slice(0, sep)
    const warehouseId = key.slice(sep + 1)
    const product = productById.get(productId)
    const warehouse = warehouseById.get(warehouseId)
    if (!product) continue // join مع المنتجات كما في v_stock
    const avgCost = num(product.avg_cost)
    const minStock = num(product.min_stock)
    out.push({
      product_id: productId,
      code: product.code ?? null,
      name: product.name ?? null,
      item_type: product.item_type ?? null,
      warehouse_name: warehouse ? warehouse.name ?? null : null,
      qty,
      avg_cost: avgCost,
      stock_value: roundN(qty * avgCost, 2),
      min_stock: minStock,
      low: minStock > 0 && qty < minStock,
    })
  }
  out.sort((a, b) => cmpAsc(a.name, b.name) || cmpAsc(a.warehouse_name, b.warehouse_name))
  return out
}

// خريطة نوع المرجع → جدول رقم المستند (لـ get_movements_report)
const DOC_REF_TABLES: Record<string, string> = {
  SALE: 'sales',
  PURCHASE: 'purchases',
  PRODUCTION: 'production_batches',
  ADJUSTMENT: 'inventory_adjustments',
  WASTE: 'waste_records',
  TRANSFER: 'transfers',
  DISTRIBUTION_LOAD: 'distribution_loads',
  DISTRIBUTION_RETURN: 'distribution_loads',
}

const get_movements_report: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  const movement = ptext(params.p_movement)
  if (from === null || to === null) return []
  const fromMs = dayStartMs(from)
  const toMs = dayStartMs(nextDay(to))
  const rows = (await db.inventory_movements.where('business_id').equals(bid).toArray()) as LocalRow[]
  const filtered = rows.filter((m) => {
    const t = Date.parse(String(m.created_at ?? ''))
    if (!Number.isFinite(t) || t < fromMs || t >= toMs) return false
    if (movement !== null && String(m.movement_type ?? '') !== movement) return false
    return true
  })
  filtered.sort((a, b) => cmpDesc(a.created_at, b.created_at))

  // أرقام المستندات المرجعية (coalesce عبر الجداول حسب reference_type)
  const docNums = new Map<string, string | null>()
  for (const [refType, table] of Object.entries(DOC_REF_TABLES)) {
    const ids = [...new Set(filtered
      .filter((m) => String(m.reference_type ?? '') === refType && m.reference_id !== null && m.reference_id !== undefined)
      .map((m) => String(m.reference_id)))]
    if (ids.length === 0) continue
    const found = await db.table(table).bulkGet(ids)
    found.forEach((r, i) => {
      const row = r as LocalRow | undefined
      docNums.set(`${refType}:${ids[i]}`, row && row.doc_number !== null && row.doc_number !== undefined
        ? String(row.doc_number)
        : null)
    })
  }

  const products = (await db.products.toArray()) as LocalRow[]
  const productById = new Map(products.map((p) => [String(p.id), p]))
  const warehouses = (await db.warehouses.toArray()) as LocalRow[]
  const warehouseById = new Map(warehouses.map((w) => [String(w.id), w]))

  const out: Row[] = []
  for (const m of filtered) {
    const product = m.item_id != null ? productById.get(String(m.item_id)) : undefined
    const warehouse = m.warehouse_id != null ? warehouseById.get(String(m.warehouse_id)) : undefined
    if (!product || !warehouse) continue // joins داخلية كما في SQL
    const refType = String(m.reference_type ?? '')
    out.push({
      id: String(m.id),
      created_at: m.created_at ?? null,
      item_name: product.name ?? null,
      warehouse_name: warehouse.name ?? null,
      movement_type: m.movement_type ?? null,
      quantity: num(m.quantity),
      unit_cost: num(m.unit_cost),
      total_cost: num(m.total_cost),
      reference_type: m.reference_type ?? null,
      doc_number: docNums.get(`${refType}:${String(m.reference_id ?? '')}`) ?? null,
    })
  }
  return out
}

const get_production_report: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  if (from === null || to === null) return []
  const products = (await db.products.toArray()) as LocalRow[]
  const productById = new Map(products.map((p) => [String(p.id), p]))
  const units = (await db.units.toArray()) as LocalRow[]
  const unitById = new Map(units.map((u) => [String(u.id), u]))
  const recipeVersions = (await db.recipe_versions.toArray()) as LocalRow[]
  const rvById = new Map(recipeVersions.map((rv) => [String(rv.id), rv]))
  const rows = (await db.production_batches.where('business_id').equals(bid).toArray()) as LocalRow[]
  const filtered = rows.filter((b) => {
    if (String(b.status ?? '') !== 'CONFIRMED') return false
    const d = String(b.batch_date ?? '')
    return d >= from && d <= to
  })
  filtered.sort((a, b) => cmpDesc(a.batch_date, b.batch_date) || cmpDesc(a.created_at, b.created_at))
  const out: Row[] = []
  for (const b of filtered) {
    const product = b.product_id != null ? productById.get(String(b.product_id)) : undefined
    const unit = b.unit_id != null ? unitById.get(String(b.unit_id)) : undefined
    if (!product || !unit) continue // joins داخلية كما في SQL
    const rv = b.recipe_version_id != null ? rvById.get(String(b.recipe_version_id)) : undefined
    out.push({
      id: String(b.id),
      doc_number: b.doc_number ?? null,
      batch_date: String(b.batch_date ?? ''),
      product_name: product.name ?? null,
      quantity: num(b.quantity),
      unit_symbol: unit.symbol ?? null,
      material_cost: num(b.material_cost),
      shift: b.shift ?? null,
      recipe_version_no: rv && rv.version_no !== null && rv.version_no !== undefined ? Number(rv.version_no) : null,
    })
  }
  return out
}

const get_expenses_report: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  if (from === null || to === null) return []
  const categories = (await db.expense_categories.toArray()) as LocalRow[]
  const categoryById = new Map(categories.map((c) => [String(c.id), c]))
  const rows = (await db.expenses.where('business_id').equals(bid).toArray()) as LocalRow[]
  const groups = new Map<string, { total: number; cnt: number }>()
  for (const e of rows) {
    const d = String(e.expense_date ?? '')
    if (d < from || d > to) continue
    const category = e.category_id != null ? categoryById.get(String(e.category_id)) : undefined
    if (!category) continue // join داخلي كما في SQL
    const name = String(category.name ?? '')
    const g = groups.get(name) ?? { total: 0, cnt: 0 }
    g.total += num(e.amount)
    g.cnt += 1
    groups.set(name, g)
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([categoryName, g]) => ({ category_name: categoryName, total: g.total, cnt: g.cnt }))
}

const get_cash_report: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  if (from === null || to === null) return []
  const fromMs = dayStartMs(from)
  const toMs = dayStartMs(nextDay(to))
  const accounts = (await db.cash_accounts.toArray()) as LocalRow[]
  const accountById = new Map(accounts.map((a) => [String(a.id), a]))
  const rows = (await db.cash_transactions.where('business_id').equals(bid).toArray()) as LocalRow[]
  const filtered = rows.filter((t) => {
    const ts = Date.parse(String(t.created_at ?? ''))
    return Number.isFinite(ts) && ts >= fromMs && ts < toMs
  })
  filtered.sort((a, b) => cmpDesc(a.created_at, b.created_at))
  const out: Row[] = []
  for (const t of filtered) {
    const account = t.cash_account_id != null ? accountById.get(String(t.cash_account_id)) : undefined
    if (!account) continue // join داخلي كما في SQL
    out.push({
      id: String(t.id),
      created_at: t.created_at ?? null,
      account_name: account.name ?? null,
      direction: t.direction ?? null,
      amount: num(t.amount),
      description: t.description ?? null,
      reference_type: t.reference_type ?? null,
    })
  }
  return out
}

const get_distribution_report: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  if (from === null || to === null) return []
  const vehicles = (await db.vehicles.toArray()) as LocalRow[]
  const vehicleById = new Map(vehicles.map((v) => [String(v.id), v]))
  const drivers = (await db.drivers.toArray()) as LocalRow[]
  const driverById = new Map(drivers.map((d) => [String(d.id), d]))
  const settlements = (await db.distribution_settlements.where('business_id').equals(bid).toArray()) as LocalRow[]
  const settlementByLoad = new Map(settlements.map((st) => [String(st.load_id ?? ''), st]))
  const rows = (await db.distribution_loads.where('business_id').equals(bid).toArray()) as LocalRow[]
  const filtered = rows.filter((l) => {
    const d = String(l.load_date ?? '')
    return d >= from && d <= to
  })
  filtered.sort((a, b) => cmpDesc(a.load_date, b.load_date) || cmpDesc(a.created_at, b.created_at))
  const out: Row[] = []
  for (const l of filtered) {
    const vehicle = l.vehicle_id != null ? vehicleById.get(String(l.vehicle_id)) : undefined
    if (!vehicle) continue // join داخلي كما في SQL
    const driver = l.driver_id != null ? driverById.get(String(l.driver_id)) : undefined
    const st = settlementByLoad.get(String(l.id))
    out.push({
      id: String(l.id),
      doc_number: l.doc_number ?? null,
      load_date: String(l.load_date ?? ''),
      vehicle_name: vehicle.name ?? null,
      driver_name: driver ? driver.name ?? null : null,
      status: l.status ?? null,
      loaded_qty: st ? num(st.loaded_qty) : 0,
      sold_qty: st ? num(st.sold_qty) : 0,
      returned_qty: st ? num(st.returned_qty) : 0,
      unaccounted_qty: st ? num(st.unaccounted_qty) : 0,
      cash_collected: st ? num(st.cash_collected) : 0,
      cash_variance: st ? num(st.cash_variance) : 0,
    })
  }
  return out
}

// v_customer_balances محسوبة inline: مبيعات آجلة مؤكدة - كل التحصيلات لكل عميل
const get_customers_report: RpcHandler = async () => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const customers = (await db.customers.where('business_id').equals(bid).toArray()) as LocalRow[]
  // المجموعات في view تتم على كل المبيعات بلا فلتر نشاط (status غير مفهرس → مسح كامل في الذاكرة)
  const sales = (await db.sales.toArray()) as LocalRow[]
  const creditByCustomer = new Map<string, number>()
  for (const s of sales) {
    if (String(s.status ?? '') !== 'CONFIRMED') continue
    if (String(s.payment_type ?? '') !== 'CREDIT') continue
    const cid = String(s.customer_id ?? '')
    creditByCustomer.set(cid, (creditByCustomer.get(cid) ?? 0) + num(s.total))
  }
  const payments = (await db.customer_payments.toArray()) as LocalRow[]
  const paidByCustomer = new Map<string, number>()
  for (const p of payments) {
    const cid = String(p.customer_id ?? '')
    paidByCustomer.set(cid, (paidByCustomer.get(cid) ?? 0) + num(p.amount))
  }
  const out = customers.map((c) => {
    const totalSales = creditByCustomer.get(String(c.id)) ?? 0
    const balance = totalSales - (paidByCustomer.get(String(c.id)) ?? 0)
    return {
      customer_id: String(c.id),
      code: c.code ?? null,
      name: c.name ?? null,
      phone: c.phone ?? null,
      total_sales: totalSales,
      balance: roundN(balance, 2),
    }
  })
  out.sort((a, b) => b.balance - a.balance)
  return out
}

// v_supplier_balances محسوبة inline: مشتريات آجلة مؤكدة - كل الدفعات لكل مورد
const get_suppliers_report: RpcHandler = async () => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const suppliers = (await db.suppliers.where('business_id').equals(bid).toArray()) as LocalRow[]
  // المجموعات في view تتم على كل المشتريات بلا فلتر نشاط (status غير مفهرس → مسح كامل في الذاكرة)
  const purchases = (await db.purchases.toArray()) as LocalRow[]
  const creditBySupplier = new Map<string, number>()
  for (const p of purchases) {
    if (String(p.status ?? '') !== 'CONFIRMED') continue
    if (String(p.payment_type ?? '') !== 'CREDIT') continue
    const sid = String(p.supplier_id ?? '')
    creditBySupplier.set(sid, (creditBySupplier.get(sid) ?? 0) + num(p.total))
  }
  const payments = (await db.supplier_payments.toArray()) as LocalRow[]
  const paidBySupplier = new Map<string, number>()
  for (const p of payments) {
    const sid = String(p.supplier_id ?? '')
    paidBySupplier.set(sid, (paidBySupplier.get(sid) ?? 0) + num(p.amount))
  }
  const out = suppliers.map((s) => {
    const totalPurchases = creditBySupplier.get(String(s.id)) ?? 0
    const balance = totalPurchases - (paidBySupplier.get(String(s.id)) ?? 0)
    return {
      supplier_id: String(s.id),
      code: s.code ?? null,
      name: s.name ?? null,
      phone: s.phone ?? null,
      total_purchases: totalPurchases,
      balance: roundN(balance, 2),
    }
  })
  out.sort((a, b) => b.balance - a.balance)
  return out
}

// الربحية التقديرية (بند 113): إيراد - تكلفة مواد - مصاريف = نتيجة تقديرية
const get_profit_report: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return { error: 'no_business' }
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  if (from === null || to === null) {
    return {
      revenue: 0, material_cost: 0, expenses: 0, estimated_result: 0,
      disclaimer: 'الأرباح تقديرية وتعتمد على اكتمال ودقة البيانات المدخلة — ليست نتيجة محاسبية نهائية.',
    }
  }
  const sales = (await db.sales.where('business_id').equals(bid).toArray()) as LocalRow[]
  const inRange = sales.filter((s) => {
    if (String(s.status ?? '') !== 'CONFIRMED') return false
    const d = String(s.sale_date ?? '')
    return d >= from && d <= to
  })
  const revenue = sumBy(inRange, (s) => num(s.total))
  const materialCost = sumBy(inRange, (s) => num(s.cost_total))
  const expenses = (await db.expenses.where('business_id').equals(bid).toArray()) as LocalRow[]
  const expensesTotal = sumBy(
    expenses.filter((e) => {
      const d = String(e.expense_date ?? '')
      return d >= from && d <= to
    }),
    (e) => num(e.amount),
  )
  const estimatedResult = roundN(revenue - materialCost - expensesTotal, 2)
  return {
    revenue: roundN(revenue, 2),
    material_cost: roundN(materialCost, 2),
    expenses: roundN(expensesTotal, 2),
    estimated_result: estimatedResult,
    disclaimer: 'الأرباح تقديرية وتعتمد على اكتمال ودقة البيانات المدخلة — ليست نتيجة محاسبية نهائية.',
  }
}

// ============================================================================
// كشوف الحسابات (بند 15/19): Date | Type | Reference | Debit | Credit | Balance
// ============================================================================

const get_customer_statement: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const customerId = String(params.p_customer ?? '')
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  const sales = (await db.sales.where('business_id').equals(bid).toArray()) as LocalRow[]
  const payments = (await db.customer_payments.where('business_id').equals(bid).toArray()) as LocalRow[]
  type Entry = { date: string; type: string; reference: string; debit: number; credit: number; notes: string | null }
  const entries: Entry[] = []
  for (const s of sales) {
    if (String(s.customer_id ?? '') !== customerId) continue
    if (String(s.status ?? '') !== 'CONFIRMED') continue
    if (String(s.payment_type ?? '') !== 'CREDIT') continue
    const d = String(s.sale_date ?? '')
    if (from !== null && d < from) continue
    if (to !== null && d > to) continue
    entries.push({
      date: String(s.created_at ?? ''), type: 'بيع آجل', reference: String(s.doc_number ?? ''),
      debit: num(s.total), credit: 0, notes: (s.notes ?? null) as string | null,
    })
  }
  for (const cp of payments) {
    if (String(cp.customer_id ?? '') !== customerId) continue
    const d = String(cp.payment_date ?? '')
    if (from !== null && d < from) continue
    if (to !== null && d > to) continue
    entries.push({
      date: String(cp.created_at ?? ''), type: 'تحصيل', reference: String(cp.doc_number ?? ''),
      debit: 0, credit: num(cp.amount), notes: (cp.notes ?? null) as string | null,
    })
  }
  entries.sort((a, b) => cmpAsc(a.date, b.date) || cmpAsc(a.reference, b.reference))
  let balance = 0
  return entries.map((e) => {
    balance += e.debit - e.credit
    return { date: e.date, type: e.type, reference: e.reference, debit: e.debit, credit: e.credit, balance, notes: e.notes }
  })
}

const get_supplier_statement: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const supplierId = String(params.p_supplier ?? '')
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  const purchases = (await db.purchases.where('business_id').equals(bid).toArray()) as LocalRow[]
  const payments = (await db.supplier_payments.where('business_id').equals(bid).toArray()) as LocalRow[]
  type Entry = { date: string; type: string; reference: string; debit: number; credit: number; notes: string | null }
  const entries: Entry[] = []
  for (const p of purchases) {
    if (String(p.supplier_id ?? '') !== supplierId) continue
    if (String(p.status ?? '') !== 'CONFIRMED') continue
    if (String(p.payment_type ?? '') !== 'CREDIT') continue
    const d = String(p.purchase_date ?? '')
    if (from !== null && d < from) continue
    if (to !== null && d > to) continue
    entries.push({
      date: String(p.created_at ?? ''), type: 'شراء آجل', reference: String(p.doc_number ?? ''),
      debit: num(p.total), credit: 0, notes: (p.notes ?? null) as string | null,
    })
  }
  for (const sp of payments) {
    if (String(sp.supplier_id ?? '') !== supplierId) continue
    const d = String(sp.payment_date ?? '')
    if (from !== null && d < from) continue
    if (to !== null && d > to) continue
    entries.push({
      date: String(sp.created_at ?? ''), type: 'دفعة', reference: String(sp.doc_number ?? ''),
      debit: 0, credit: num(sp.amount), notes: (sp.notes ?? null) as string | null,
    })
  }
  entries.sort((a, b) => cmpAsc(a.date, b.date) || cmpAsc(a.reference, b.reference))
  let balance = 0
  return entries.map((e) => {
    balance += e.debit - e.credit
    return { date: e.date, type: e.type, reference: e.reference, debit: e.debit, credit: e.credit, balance, notes: e.notes }
  })
}

// سجل التدقيق (بند 37)
const get_audit_logs: RpcHandler = async (params) => {
  const bid = getCtx().businessId
  if (bid === null) return []
  const from = ptext(params.p_from)
  const to = ptext(params.p_to)
  const limit = Math.min(nn(params.p_limit) ?? 200, 1000)
  const rows = (await db.audit_logs.where('business_id').equals(bid).toArray()) as LocalRow[]
  const filtered = rows.filter((a) => {
    const ts = Date.parse(String(a.created_at ?? ''))
    if (!Number.isFinite(ts)) return false
    if (from !== null && ts < dayStartMs(from)) return false
    if (to !== null && ts >= dayStartMs(nextDay(to))) return false
    return true
  })
  filtered.sort((a, b) => cmpDesc(a.created_at, b.created_at))
  return filtered.slice(0, limit).map((a) => ({
    id: String(a.id),
    created_at: a.created_at ?? null,
    user_email: a.user_email ?? null,
    operation: a.operation ?? null,
    entity: a.entity ?? null,
    action: a.action ?? null,
    entity_id: a.entity_id ?? null,
  }))
}

// ============================================================================
// التصدير — نفس أسماء الدوال في SQL
// ============================================================================
export const opsExtra: Record<string, RpcHandler> = {
  // عمليات المخزون
  create_inventory_adjustment,
  create_waste,
  create_transfer,
  // التوزيع
  create_distribution_load,
  record_distribution_delivery,
  record_distribution_return,
  settle_distribution_load,
  // الإعدادات والمستخدمون
  assign_user_role,
  update_business,
  update_my_profile,
  // لوحة القيادة
  get_dashboard_summary,
  // التقارير
  get_sales_report,
  get_sales_daily_summary,
  get_purchases_report,
  get_inventory_report,
  get_movements_report,
  get_production_report,
  get_expenses_report,
  get_cash_report,
  get_distribution_report,
  get_customers_report,
  get_suppliers_report,
  get_profit_report,
  get_customer_statement,
  get_supplier_statement,
  get_audit_logs,
}
