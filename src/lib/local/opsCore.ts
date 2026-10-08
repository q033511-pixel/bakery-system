/**
 * opsCore — التنفيذ المحلي الحرفي لدوال Postgres المعاملية (0002_functions.sql سطر 239–818):
 * bootstrap_business, create_sale, void_sale, create_purchase, void_purchase,
 * create_customer_payment, create_supplier_payment, create_production_batch, create_expense.
 *
 * القاعدة الذهبية: نفس منطق SQL حرفياً — نفس التحققات، نفس رسائل الأخطاء العربية،
 * نفس الترتيب، نفس الحسابات والتقريب (round 2/3/4).
 *
 * قرارات محلية موثقة (لا تغيّر سلوك SQL):
 * - bootstrap_business: فحص system_setup/رمز التهيئة مُسقَط عمداً (وضع محلي بلا احتكاك)،
 *   وحدّثنا سياق الجلسة (setCtx) بعد ترقية المالك حتى يعمل writeAudit والعمليات التالية.
 * - create_purchase: v_factor في SQL يُحسب ولا يُستخدم أبداً في صيغة المتوسط — أُسقط.
 *   وتحديث products.avg_cost يضبط updated_at (مكافئ تريغر touch_updated_at).
 * - لا Dexie transaction صريح: كل الدوال المساعدة في context.ts تكتب مباشرة عبر db
 *   (جهاز واحد/مستخدم واحد) وidempotency عبر operation_id يعوّض أي انقطاع.
 */
import { db, type LocalRow } from '@/db/db'
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
  mustExist,
  nextDocNumber,
  nowIso,
  raise,
  registerOp,
  requireBusinessId,
  roundN,
  setCtx,
  uuid,
  writeAudit,
} from './context'
import type { RpcHandler } from './rpc'

type Rec = Record<string, unknown>

// ---------- تحليل JSONB (مكافئ عمليات ->> و -> و jsonb_to_recordset) ----------

/** p_payload كسجل — مثل p_payload::jsonb */
function payloadOf(params: Record<string, unknown>): Rec {
  return (params.p_payload ?? {}) as Rec
}

/** nullif(x::text, '') — السلسلة الفارغة تصبح null */
function strVal(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s === '' ? null : s
}

/** ::numeric — يعيد null إن غابت القيمة (التحقق لاحقاً بنفس رسائل SQL) */
function numVal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** jsonb_to_recordset(p_payload->'items') — بنفس أعمدة السجل x(product_id, quantity, unit_id, unit_price) */
interface PayloadItem {
  product_id: string | null
  quantity: number | null
  unit_id: string | null
  unit_price: number | null
}

function itemsOf(payload: Rec): PayloadItem[] {
  const raw = payload.items
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x))
    .map((it) => ({
      product_id: strVal(it.product_id),
      quantity: numVal(it.quantity),
      unit_id: strVal(it.unit_id),
      unit_price: numVal(it.unit_price),
    }))
}

/** coalesce(avg_cost, 0) من صف المنتج */
function avgOf(product: LocalRow | undefined): number {
  const v = product?.avg_cost
  return v === null || v === undefined ? 0 : Number(v)
}

/** رسالة التكرار: select id, doc_number ... where operation_id = v_op */
function dupResult(dup: LocalRow | null): Rec {
  return {
    id: dup ? String(dup.id) : null,
    doc_number: dup ? ((dup.doc_number as string) ?? null) : null,
    duplicate: true,
  }
}

/** p_reason is null or length(trim(p_reason)) < 3 */
function checkVoidReason(params: Record<string, unknown>): string {
  const raw = params.p_reason
  if (raw === null || raw === undefined) raise('اكتب سبب الإلغاء.')
  const s = String(raw)
  if (s.trim().length < 3) raise('اكتب سبب الإلغاء.')
  return s
}

/** وحدة مفقودة من الخريطة — لا يحدث عملياً (أُدرجت قبلها بأسطر) */
function mustSymbol(map: Map<string, string>, sym: string): string {
  const id = map.get(sym)
  if (!id) raise('وحدة افتراضية مفقودة.')
  return id
}

/**
 * صيغة المتوسط المرجح في create_purchase (بند 95/96) — حرفياً:
 * sum(case when movement_type in (IN_TYPES) then quantity else -quantity end)
 *   ... where business_id = v_bid and item_id = r.product_id and movement_type <> 'PURCHASE_IN'
 * ثم v_cur_qty := v_cur_qty - v_base_qty (استبعاد حركات هذه الفاتورة).
 */
async function curQtyExcludingPurchases(bid: string, productId: string): Promise<number> {
  const IN_TYPES = [
    'PURCHASE_IN', 'PRODUCTION_IN', 'SALE_RETURN_IN',
    'ADJUSTMENT_IN', 'TRANSFER_IN', 'DISTRIBUTION_RETURN_IN',
  ]
  const movs = (await db.inventory_movements.where('business_id').equals(bid).toArray()) as LocalRow[]
  let sum = 0
  for (const m of movs) {
    if (m.item_id !== productId) continue
    if (m.movement_type === 'PURCHASE_IN') continue
    sum += IN_TYPES.includes(String(m.movement_type)) ? Number(m.quantity) : -Number(m.quantity)
  }
  return sum
}

// ============================================================================
// BOOTSTRAP — تهيئة النظام وأول مالك (بند 68) — بلا فحص system_setup (محلي)
// ============================================================================
async function bootstrap_business(params: Record<string, unknown>): Promise<unknown> {
  const vUid = getCtx().userId
  if (!vUid) raise('يجب تسجيل الدخول أولاً.')
  const me = await db.profiles.get(vUid)
  if (me && me.business_id != null) raise('حسابك مرتبط بنشاط تجاري بالفعل.')
  const profiles = await db.profiles.toArray()
  // الوضع المحلي: الدخول الأول ينشئ المالك تلقائياً — نستثني المستخدم الحالي من فحص التهيئة المسبقة
  if (profiles.some((p) => p.role === 'OWNER' && String(p.id) !== String(vUid))) {
    raise('النظام مهيأ مسبقاً. اتصل بمدير النظام لإضافة مستخدمين.')
  }
  // ملاحظة: فحص system_setup/رمز التهيئة مُسقَط عمداً — وضع محلي بلا احتكاك.

  const businessName = strVal(params.p_business_name) ?? ''
  const fullName = strVal(params.p_full_name)
  const phone = strVal(params.p_phone)

  // insert into businesses(name) — القيم الافتراضية كما في 0001_schema.sql
  const vBid = uuid()
  await insertRow('businesses', {
    id: vBid,
    name: businessName,
    currency: 'ILS',
    currency_symbol: '₪',
    timezone: 'Asia/Jerusalem',
    allow_negative_stock: false,
    invoice_prefix: 'INV',
    created_at: nowIso(),
  })

  // insert into app_settings(business_id, setup_code_used) values (v_bid, true)
  await insertRow('app_settings', {
    id: uuid(),
    business_id: vBid,
    settings: {},
    setup_code: null,
    setup_code_used: true,
    updated_at: nowIso(),
  })

  // وحدات افتراضية (9)
  const unitDefs: Array<[name: string, symbol: string, isBase: boolean]> = [
    ['كيلوغرام', 'كغ', true], ['غرام', 'غ', false],
    ['لتر', 'ل', true], ['مليلتر', 'مل', false],
    ['قطعة', 'قطعة', true], ['ربطة', 'ربطة', false],
    ['كيس', 'كيس', false], ['كرتونة', 'كرتونة', false],
    ['صندوق', 'صندوق', false],
  ]
  const symbolToId = new Map<string, string>()
  for (const [name, symbol, isBase] of unitDefs) {
    const id = uuid()
    symbolToId.set(symbol, id)
    await insertRow('units', { id, business_id: vBid, name, symbol, is_base: isBase, created_at: nowIso() })
  }

  // تحويلات افتراضية (4) — ربط بالرموز كما في join SQL
  const convDefs: Array<[fromSym: string, toSym: string, factor: number]> = [
    ['كيس', 'كغ', 50], ['غ', 'كغ', 0.001], ['مل', 'ل', 0.001], ['ربطة', 'قطعة', 10],
  ]
  for (const [fromSym, toSym, factor] of convDefs) {
    await insertRow('unit_conversions', {
      id: uuid(),
      business_id: vBid,
      from_unit_id: mustSymbol(symbolToId, fromSym),
      to_unit_id: mustSymbol(symbolToId, toSym),
      factor,
      created_at: nowIso(),
    })
  }

  // مستودعات: RAW ثم FINISHED الافتراضي
  await insertRow('warehouses', {
    id: uuid(), business_id: vBid, name: 'مخزن المواد الخام', kind: 'RAW',
    is_default: false, active: true, created_at: nowIso(),
  })
  await insertRow('warehouses', {
    id: uuid(), business_id: vBid, name: 'مخزن المنتجات الجاهزة', kind: 'FINISHED',
    is_default: true, active: true, created_at: nowIso(),
  })

  // صندوق رئيسي افتراضي
  await insertRow('cash_accounts', {
    id: uuid(), business_id: vBid, name: 'الصندوق الرئيسي', kind: 'CASH',
    is_default: true, active: true, created_at: nowIso(),
  })

  // فئات المصروفات (9)
  for (const name of ['كهرباء', 'ماء', 'ديزل ووقود', 'رواتب', 'صيانة', 'إيجار', 'نقل', 'مواد تغليف', 'أخرى']) {
    await insertRow('expense_categories', { id: uuid(), business_id: vBid, name, created_at: nowIso() })
  }

  // فئات المنتجات (5)
  for (const name of ['خبز', 'معجنات', 'كعك', 'مواد خام', 'تغليف']) {
    await insertRow('product_categories', { id: uuid(), business_id: vBid, name, created_at: nowIso() })
  }

  // update profiles set business_id, role='OWNER', full_name=coalesce(...), phone=coalesce(...)
  await db.profiles.update(vUid, {
    business_id: vBid,
    role: 'OWNER',
    full_name: fullName ?? ((me?.full_name as string | undefined) ?? null),
    phone: phone ?? ((me?.phone as string | undefined) ?? null),
  })

  // تحديث سياق الجلسة المحلية (بديل إعادة تحميل profile) — يشغّل writeAudit وما بعده
  setCtx({
    userId: vUid,
    email: getCtx().email,
    businessId: vBid,
    role: 'OWNER',
    fullName: fullName ?? String((me?.full_name as string | undefined) ?? ''),
  })

  await writeAudit('BOOTSTRAP', 'business', vBid, 'CREATE', null, { name: businessName })

  return { business_id: vBid }
}

// ============================================================================
// SALES (بند 16/51)
// ============================================================================
async function create_sale(params: Record<string, unknown>): Promise<unknown> {
  const vBid = await requireBusinessId()
  await assertPerm('sales.manage')
  const payload = payloadOf(params)

  const vOp = strVal(payload.operation_id) ?? raise('operation_id مطلوب لكل عملية (منع التكرار).')
  if (!(await registerOp(vOp, 'SALE'))) {
    return dupResult(await findDuplicateByOp('sales', vOp))
  }

  const biz = await db.businesses.get(vBid)
  const vAllowNeg = biz?.allow_negative_stock === true
  const vCustomer = strVal(payload.customer_id)
  const vWarehouse = strVal(payload.warehouse_id)
  const vSaleDate = strVal(payload.sale_date) ?? businessToday()
  const vDiscount = numVal(payload.discount) ?? 0
  const vPayType = strVal(payload.payment_type) ?? 'CASH'
  const vPayMethod = strVal(payload.payment_method)

  if (vWarehouse === null) raise('اختر المستودع.')
  const wh = await db.warehouses.get(vWarehouse)
  if (!wh || wh.business_id !== vBid) raise('المستودع غير صحيح.')
  if (vCustomer !== null) {
    const c = await db.customers.get(vCustomer)
    if (!c || c.business_id !== vBid || c.active !== true) raise('العميل غير موجود أو غير مفعّل.')
  }

  const items = itemsOf(payload)
  if (items.length === 0) raise('أضف صنفاً واحداً على الأقل.')

  // التحقق من الأصناف والمخزون (بند 17)
  let vSubtotal = 0
  let vCost = 0
  for (const item of items) {
    const qty = item.quantity
    if (qty === null || qty <= 0) raise('الكمية يجب أن تكون أكبر من صفر.')
    const price = item.unit_price
    if (price === null || price < 0) raise('السعر غير صحيح.')
    const product = item.product_id === null ? undefined : await db.products.get(item.product_id)
    if (!product || product.business_id !== vBid || product.active !== true) {
      raise('صنف غير موجود أو غير مفعّل في الفاتورة.')
    }
    const vLine = roundN(qty * price, 2)
    vSubtotal += vLine
    const vBaseQty = await convertQtyToBase(product.id, item.unit_id as string, qty)
    const vAvg = avgOf(product)
    vCost += roundN(vBaseQty * vAvg, 2)
    if (!vAllowNeg) {
      await assertStockAvailable(product.id, vWarehouse, vBaseQty)
    }
  }

  if (vDiscount > vSubtotal) raise('الخصم أكبر من إجمالي الفاتورة.')
  const vTotal = vSubtotal - vDiscount
  const vDoc = await nextDocNumber('SAL')

  const vSaleId = uuid()
  await insertRow('sales', {
    id: vSaleId,
    operation_id: vOp,
    doc_number: vDoc,
    business_id: vBid,
    customer_id: vCustomer,
    warehouse_id: vWarehouse,
    sale_date: vSaleDate,
    subtotal: vSubtotal,
    discount: vDiscount,
    total: vTotal,
    cost_total: vCost,
    payment_type: vPayType,
    payment_method: vPayMethod,
    status: 'CONFIRMED',
    channel: 'DIRECT',
    created_at: nowIso(),
  })

  for (const item of items) {
    const qty = item.quantity as number
    const price = item.unit_price as number
    await insertRow('sale_items', {
      id: uuid(),
      sale_id: vSaleId,
      product_id: item.product_id,
      quantity: qty,
      unit_id: item.unit_id,
      unit_price: price,
      total: roundN(qty * price, 2),
      created_at: nowIso(),
    })
    const product = item.product_id === null ? undefined : await db.products.get(item.product_id)
    const vBaseQty = await convertQtyToBase(product?.id ?? '', item.unit_id as string, qty)
    const vAvg = avgOf(product)
    await insertMovement({
      productId: product?.id ?? '',
      itemType: String(product?.item_type ?? ''),
      warehouseId: vWarehouse,
      movementType: 'SALE_OUT',
      baseQty: vBaseQty,
      inputQty: qty,
      inputUnitId: item.unit_id,
      unitCost: vAvg,
      totalCost: roundN(vBaseQty * vAvg, 2),
      referenceType: 'SALE',
      referenceId: vSaleId,
      operationId: vOp,
    })
  }

  if (vPayType === 'CASH') {
    const vCashAcc = strVal(payload.cash_account_id) ?? (await getDefaultCashAccount())
    if (vCashAcc !== null) {
      await insertCashTx({
        cashAccountId: vCashAcc,
        direction: 'IN',
        amount: vTotal,
        referenceType: 'SALE',
        referenceId: vSaleId,
        operationId: vOp,
        description: 'بيع نقدي ' + vDoc,
      })
    }
  }

  await writeAudit('CREATE_SALE', 'sale', vSaleId, 'CREATE', null, {
    doc_number: vDoc, total: vTotal, payment_type: vPayType,
  })

  return { id: vSaleId, doc_number: vDoc, duplicate: false }
}

// إلغاء بيع (بند 38: VOID بدل الحذف)
async function void_sale(params: Record<string, unknown>): Promise<unknown> {
  const vBid = await requireBusinessId()
  await assertPerm('sales.void')
  const pReason = checkVoidReason(params)

  const vSale = await mustExist('sales', params.p_sale_id, 'الفاتورة غير موجودة.')
  if (vSale.business_id !== vBid) raise('الفاتورة غير موجودة.')
  if (vSale.status !== 'CONFIRMED') raise('لا يمكن إلغاء فاتورة بحالة غير مؤكدة.')
  if (vSale.channel === 'DISTRIBUTION') {
    raise('فواتير التوزيع تُعالج عبر تسوية الحمولة وليس الإلغاء المباشر.')
  }

  await db.sales.update(String(vSale.id), { status: 'VOIDED' })

  const saleItems = (await db.sale_items.where('sale_id').equals(String(vSale.id)).toArray()) as LocalRow[]
  for (const r of saleItems) {
    const qty = Number(r.quantity)
    const vBaseQty = await convertQtyToBase(String(r.product_id), (r.unit_id as string) ?? '', qty)
    const product = await db.products.get(String(r.product_id))
    const vAvg = avgOf(product)
    await insertMovement({
      productId: String(r.product_id),
      itemType: String(product?.item_type ?? ''),
      warehouseId: String(vSale.warehouse_id),
      movementType: 'SALE_RETURN_IN',
      baseQty: vBaseQty,
      inputQty: qty,
      inputUnitId: (r.unit_id as string) ?? null,
      unitCost: vAvg,
      totalCost: roundN(vBaseQty * vAvg, 2),
      referenceType: 'VOID_SALE',
      referenceId: String(vSale.id),
      operationId: (vSale.operation_id as string) ?? null,
    })
  }

  if (vSale.payment_type === 'CASH') {
    const vCashAcc = await getDefaultCashAccount()
    if (vCashAcc !== null) {
      await insertCashTx({
        cashAccountId: vCashAcc,
        direction: 'OUT',
        amount: Number(vSale.total),
        referenceType: 'VOID_SALE',
        referenceId: String(vSale.id),
        operationId: (vSale.operation_id as string) ?? null,
        description: 'إرجاع نقدي لإلغاء بيع ' + String(vSale.doc_number),
      })
    }
  }

  await writeAudit('VOID_SALE', 'sale', String(vSale.id), 'VOID',
    { status: 'CONFIRMED', total: vSale.total },
    { status: 'VOIDED', reason: pReason })

  return { id: String(vSale.id), doc_number: String(vSale.doc_number) }
}

// ============================================================================
// PURCHASES (بند 14) + التكلفة المرجحة (بند 95/96)
// ============================================================================
async function create_purchase(params: Record<string, unknown>): Promise<unknown> {
  const vBid = await requireBusinessId()
  await assertPerm('purchases.manage')
  const payload = payloadOf(params)

  const vOp = strVal(payload.operation_id) ?? raise('operation_id مطلوب لكل عملية (منع التكرار).')
  if (!(await registerOp(vOp, 'PURCHASE'))) {
    return dupResult(await findDuplicateByOp('purchases', vOp))
  }

  const vSupplier = strVal(payload.supplier_id)
  const vWarehouse = strVal(payload.warehouse_id)
  const vDate = strVal(payload.purchase_date) ?? businessToday()
  const vInvoice = strVal(payload.invoice_number)
  const vDiscount = numVal(payload.discount) ?? 0
  const vPayType = strVal(payload.payment_type) ?? 'CREDIT'
  const vPayMethod = strVal(payload.payment_method)

  if (vSupplier === null) raise('اختر مورداً صحيحاً.')
  const sup = await db.suppliers.get(vSupplier)
  if (!sup || sup.business_id !== vBid) raise('اختر مورداً صحيحاً.')
  if (vWarehouse === null) raise('اختر مستودعاً صحيحاً.')
  const wh = await db.warehouses.get(vWarehouse)
  if (!wh || wh.business_id !== vBid) raise('اختر مستودعاً صحيحاً.')

  const items = itemsOf(payload)
  if (items.length === 0) raise('أضف صنفاً واحداً على الأقل.')

  let vSubtotal = 0
  for (const item of items) {
    const qty = item.quantity
    if (qty === null || qty <= 0) raise('الكمية يجب أن تكون أكبر من صفر.')
    const price = item.unit_price
    if (price === null || price < 0) raise('سعر الشراء غير صحيح.')
    const product = item.product_id === null ? undefined : await db.products.get(item.product_id)
    if (!product || product.business_id !== vBid) raise('صنف غير موجود في الفاتورة.')
    vSubtotal += roundN(qty * price, 2)
  }

  if (vDiscount > vSubtotal) raise('الخصم أكبر من الإجمالي.')
  const vTotal = vSubtotal - vDiscount
  const vDoc = await nextDocNumber('PUR')

  const vPurId = uuid()
  await insertRow('purchases', {
    id: vPurId,
    operation_id: vOp,
    doc_number: vDoc,
    business_id: vBid,
    supplier_id: vSupplier,
    warehouse_id: vWarehouse,
    purchase_date: vDate,
    invoice_number: vInvoice,
    payment_type: vPayType,
    payment_method: vPayMethod,
    subtotal: vSubtotal,
    discount: vDiscount,
    total: vTotal,
    status: 'CONFIRMED',
    created_at: nowIso(),
  })

  for (const item of items) {
    const qty = item.quantity as number
    const price = item.unit_price as number
    await insertRow('purchase_items', {
      id: uuid(),
      purchase_id: vPurId,
      product_id: item.product_id,
      quantity: qty,
      unit_id: item.unit_id,
      unit_price: price,
      total: roundN(qty * price, 2),
      created_at: nowIso(),
    })

    const product = item.product_id === null ? undefined : await db.products.get(item.product_id)
    const vBaseQty = await convertQtyToBase(product?.id ?? '', item.unit_id as string, qty)
    const vLineCost = roundN(qty * price, 2)
    const vPriceBase = vBaseQty > 0 ? roundN(vLineCost / vBaseQty, 4) : 0

    await insertMovement({
      productId: product?.id ?? '',
      itemType: String(product?.item_type ?? ''),
      warehouseId: vWarehouse,
      movementType: 'PURCHASE_IN',
      baseQty: vBaseQty,
      inputQty: qty,
      inputUnitId: item.unit_id,
      unitCost: vPriceBase,
      totalCost: vLineCost,
      referenceType: 'PURCHASE',
      referenceId: vPurId,
      operationId: vOp,
    })

    // تحديث المتوسط المرجح للتكلفة على مستوى النشاط كله — الصيغة الحسابية نفسها في SQL
    const vCurQty = (await curQtyExcludingPurchases(vBid, product?.id ?? '')) - vBaseQty
    const vCurAvg = avgOf(product)
    const vNewAvg = (vCurQty + vBaseQty) > 0
      ? roundN(((vCurQty * vCurAvg) + (vBaseQty * vPriceBase)) / (vCurQty + vBaseQty), 4)
      : vPriceBase
    await db.products.update(product?.id ?? '', {
      avg_cost: vNewAvg,
      last_purchase_cost: vPriceBase,
      updated_at: nowIso(),
    })
  }

  if (vPayType === 'CASH') {
    const vCashAcc = strVal(payload.cash_account_id) ?? (await getDefaultCashAccount())
    if (vCashAcc !== null) {
      await insertCashTx({
        cashAccountId: vCashAcc,
        direction: 'OUT',
        amount: vTotal,
        referenceType: 'PURCHASE',
        referenceId: vPurId,
        operationId: vOp,
        description: 'شراء نقدي ' + vDoc,
      })
    }
  }

  await writeAudit('CREATE_PURCHASE', 'purchase', vPurId, 'CREATE', null, {
    doc_number: vDoc, total: vTotal, supplier_id: vSupplier,
  })

  return { id: vPurId, doc_number: vDoc, duplicate: false }
}

// إلغاء شراء
async function void_purchase(params: Record<string, unknown>): Promise<unknown> {
  const vBid = await requireBusinessId()
  await assertPerm('purchases.void')
  const pReason = checkVoidReason(params)

  const vPur = await mustExist('purchases', params.p_purchase_id, 'فاتورة الشراء غير موجودة.')
  if (vPur.business_id !== vBid) raise('فاتورة الشراء غير موجودة.')
  if (vPur.status !== 'CONFIRMED') raise('لا يمكن إلغاء فاتورة بحالة غير مؤكدة.')

  await db.purchases.update(String(vPur.id), { status: 'VOIDED' })

  const purchaseItems = (await db.purchase_items.where('purchase_id').equals(String(vPur.id)).toArray()) as LocalRow[]
  for (const r of purchaseItems) {
    const qty = Number(r.quantity)
    const price = Number(r.unit_price)
    const vBaseQty = await convertQtyToBase(String(r.product_id), (r.unit_id as string) ?? '', qty)
    const vCost = roundN(qty * price, 2)
    const product = await db.products.get(String(r.product_id))
    await insertMovement({
      productId: String(r.product_id),
      itemType: String(product?.item_type ?? ''),
      warehouseId: String(vPur.warehouse_id),
      movementType: 'PURCHASE_RETURN_OUT',
      baseQty: vBaseQty,
      inputQty: qty,
      inputUnitId: (r.unit_id as string) ?? null,
      unitCost: vBaseQty > 0 ? roundN(vCost / vBaseQty, 4) : 0,
      totalCost: vCost,
      referenceType: 'VOID_PURCHASE',
      referenceId: String(vPur.id),
      operationId: (vPur.operation_id as string) ?? null,
    })
  }

  if (vPur.payment_type === 'CASH') {
    const vCashAcc = await getDefaultCashAccount()
    if (vCashAcc !== null) {
      await insertCashTx({
        cashAccountId: vCashAcc,
        direction: 'IN',
        amount: Number(vPur.total),
        referenceType: 'VOID_PURCHASE',
        referenceId: String(vPur.id),
        operationId: (vPur.operation_id as string) ?? null,
        description: 'استرداد نقدي لإلغاء شراء ' + String(vPur.doc_number),
      })
    }
  }

  await writeAudit('VOID_PURCHASE', 'purchase', String(vPur.id), 'VOID',
    { status: 'CONFIRMED', total: vPur.total },
    { status: 'VOIDED', reason: pReason })

  return { id: String(vPur.id), doc_number: String(vPur.doc_number) }
}

// ============================================================================
// PAYMENTS (بند 20/22)
// ============================================================================
async function create_customer_payment(params: Record<string, unknown>): Promise<unknown> {
  const vBid = await requireBusinessId()
  await assertPerm('payments.manage')
  const payload = payloadOf(params)

  const vOp = strVal(payload.operation_id) ?? raise('operation_id مطلوب لكل عملية (منع التكرار).')
  if (!(await registerOp(vOp, 'CUSTOMER_PAYMENT'))) {
    return dupResult(await findDuplicateByOp('customer_payments', vOp))
  }

  const vCustomer = strVal(payload.party_id)
  const vAmount = numVal(payload.amount)
  if (vCustomer === null) raise('العميل غير موجود.')
  const c = await db.customers.get(vCustomer)
  if (!c || c.business_id !== vBid) raise('العميل غير موجود.')
  if (vAmount === null || vAmount <= 0) raise('المبلغ يجب أن يكون أكبر من صفر.')

  const vDoc = await nextDocNumber('PAY')
  const vCashAcc = strVal(payload.cash_account_id) ?? (await getDefaultCashAccount())

  const vId = uuid()
  await insertRow('customer_payments', {
    id: vId,
    operation_id: vOp,
    doc_number: vDoc,
    business_id: vBid,
    customer_id: vCustomer,
    payment_date: strVal(payload.payment_date) ?? businessToday(),
    amount: vAmount,
    payment_method: strVal(payload.payment_method) ?? 'CASH',
    cash_account_id: vCashAcc,
    reference: strVal(payload.reference),
    notes: strVal(payload.notes),
    created_by: getCtx().userId,
    created_at: nowIso(),
  })

  if (vCashAcc !== null) {
    await insertCashTx({
      cashAccountId: vCashAcc,
      direction: 'IN',
      amount: vAmount,
      referenceType: 'CUSTOMER_PAYMENT',
      referenceId: vId,
      operationId: vOp,
      description: 'تحصيل من عميل ' + vDoc,
    })
  }

  await writeAudit('CUSTOMER_PAYMENT', 'customer_payment', vId, 'PAYMENT', null, {
    amount: vAmount, customer_id: vCustomer,
  })

  return { id: vId, doc_number: vDoc, duplicate: false }
}

async function create_supplier_payment(params: Record<string, unknown>): Promise<unknown> {
  const vBid = await requireBusinessId()
  await assertPerm('payments.manage')
  const payload = payloadOf(params)

  const vOp = strVal(payload.operation_id) ?? raise('operation_id مطلوب لكل عملية (منع التكرار).')
  if (!(await registerOp(vOp, 'SUPPLIER_PAYMENT'))) {
    return dupResult(await findDuplicateByOp('supplier_payments', vOp))
  }

  const vSupplier = strVal(payload.party_id)
  const vAmount = numVal(payload.amount)
  if (vSupplier === null) raise('المورد غير موجود.')
  const s = await db.suppliers.get(vSupplier)
  if (!s || s.business_id !== vBid) raise('المورد غير موجود.')
  if (vAmount === null || vAmount <= 0) raise('المبلغ يجب أن يكون أكبر من صفر.')

  const vDoc = await nextDocNumber('SPAY')
  const vCashAcc = strVal(payload.cash_account_id) ?? (await getDefaultCashAccount())

  const vId = uuid()
  await insertRow('supplier_payments', {
    id: vId,
    operation_id: vOp,
    doc_number: vDoc,
    business_id: vBid,
    supplier_id: vSupplier,
    payment_date: strVal(payload.payment_date) ?? businessToday(),
    amount: vAmount,
    payment_method: strVal(payload.payment_method) ?? 'CASH',
    cash_account_id: vCashAcc,
    reference: strVal(payload.reference),
    notes: strVal(payload.notes),
    created_by: getCtx().userId,
    created_at: nowIso(),
  })

  if (vCashAcc !== null) {
    await insertCashTx({
      cashAccountId: vCashAcc,
      direction: 'OUT',
      amount: vAmount,
      referenceType: 'SUPPLIER_PAYMENT',
      referenceId: vId,
      operationId: vOp,
      description: 'دفعة لمورد ' + vDoc,
    })
  }

  await writeAudit('SUPPLIER_PAYMENT', 'supplier_payment', vId, 'PAYMENT', null, {
    amount: vAmount, supplier_id: vSupplier,
  })

  return { id: vId, doc_number: vDoc, duplicate: false }
}

// ============================================================================
// PRODUCTION (بند 23/24/25)
// ============================================================================
async function create_production_batch(params: Record<string, unknown>): Promise<unknown> {
  const vBid = await requireBusinessId()
  await assertPerm('production.manage')
  const payload = payloadOf(params)

  const vOp = strVal(payload.operation_id) ?? raise('operation_id مطلوب لكل عملية (منع التكرار).')
  if (!(await registerOp(vOp, 'PRODUCTION'))) {
    return dupResult(await findDuplicateByOp('production_batches', vOp))
  }

  const vProduct = strVal(payload.product_id)
  const vWarehouse = strVal(payload.warehouse_id)
  const vRecipe = strVal(payload.recipe_version_id)
  const vQty = numVal(payload.quantity)
  const vUnit = strVal(payload.unit_id)
  const vDate = strVal(payload.batch_date) ?? businessToday()
  const vShift = strVal(payload.shift)

  const prod = vProduct === null ? undefined : await db.products.get(vProduct)
  if (!prod || prod.business_id !== vBid || prod.item_type !== 'FINISHED_PRODUCT') {
    raise('اختر منتجاً نهائياً صحيحاً.')
  }
  if (vRecipe === null) raise('اختر وصفة الإنتاج.')
  if (vQty === null || vQty <= 0) raise('الكمية المنتجة يجب أن تكون أكبر من صفر.')

  // exists(recipe_versions rv join recipes rec ...) — الوصفة تتبع المنتج
  const rv = await db.recipe_versions.get(vRecipe)
  const rec = rv ? await db.recipes.get(String(rv.recipe_id)) : undefined
  if (!rv || !rec || rec.product_id !== vProduct || rv.business_id !== vBid) {
    raise('الوصفة المختارة لا تنتمي لهذا المنتج.')
  }

  const vOutputQty = Number(rv.output_quantity)
  const vBaseQty = await convertQtyToBase(prod.id, vUnit as string, vQty)
  const vFactor = vBaseQty / vOutputQty

  // join recipe_items مع المواد (inner join — المواد المفقودة تُسقط كما في SQL)
  const recipeItems = (await db.recipe_items.where('recipe_version_id').equals(vRecipe).toArray()) as LocalRow[]
  const mats: Array<{ ri: LocalRow; mat: LocalRow; matAvg: number }> = []
  for (const ri of recipeItems) {
    const mat = await db.products.get(String(ri.material_id))
    if (!mat) continue // inner join
    mats.push({ ri, mat, matAvg: avgOf(mat) })
  }

  // حساب الاستهلاك والتحقق من توفر المواد
  let vTotalCost = 0
  for (const m of mats) {
    const vMatBase = roundN(Number(m.ri.quantity) * vFactor, 3)
    if (m.mat.business_id !== vBid || m.mat.active !== true) raise('مادة خام في الوصفة غير مفعّلة.')
    await assertStockAvailable(m.mat.id, vWarehouse as string, vMatBase)
    vTotalCost += roundN(vMatBase * m.matAvg, 2)
  }

  const vDoc = await nextDocNumber('PRO')
  const vId = uuid()
  await insertRow('production_batches', {
    id: vId,
    operation_id: vOp,
    doc_number: vDoc,
    business_id: vBid,
    product_id: vProduct,
    warehouse_id: vWarehouse,
    recipe_version_id: vRecipe,
    quantity: vQty,
    unit_id: vUnit,
    batch_date: vDate,
    shift: vShift,
    material_cost: vTotalCost,
    status: 'CONFIRMED',
    notes: strVal(payload.notes),
    created_by: getCtx().userId,
    created_at: nowIso(),
  })

  // حركات الاستهلاك
  for (const m of mats) {
    const vMatBase = roundN(Number(m.ri.quantity) * vFactor, 3)
    const vMatCost = roundN(vMatBase * m.matAvg, 2)
    await insertRow('production_consumption', {
      id: uuid(),
      batch_id: vId,
      material_id: m.ri.material_id,
      quantity: vMatBase,
      unit_id: m.ri.unit_id,
      unit_cost: m.matAvg,
      total_cost: vMatCost,
      created_at: nowIso(),
    })
    await insertMovement({
      productId: m.mat.id,
      itemType: 'RAW_MATERIAL',
      warehouseId: vWarehouse as string,
      movementType: 'PRODUCTION_CONSUMPTION_OUT',
      baseQty: vMatBase,
      inputQty: vMatBase,
      inputUnitId: (m.ri.unit_id as string) ?? null,
      unitCost: m.matAvg,
      totalCost: vMatCost,
      referenceType: 'PRODUCTION',
      referenceId: vId,
      operationId: vOp,
    })
  }

  // إدخال المنتج النهائي
  const vAvg = vBaseQty > 0 ? roundN(vTotalCost / vBaseQty, 4) : 0
  await insertMovement({
    productId: prod.id,
    itemType: 'FINISHED_PRODUCT',
    warehouseId: vWarehouse as string,
    movementType: 'PRODUCTION_IN',
    baseQty: vBaseQty,
    inputQty: vQty as number,
    inputUnitId: vUnit,
    unitCost: vAvg,
    totalCost: vTotalCost,
    referenceType: 'PRODUCTION',
    referenceId: vId,
    operationId: vOp,
  })

  await writeAudit('CREATE_PRODUCTION', 'production_batch', vId, 'PRODUCTION', null, {
    doc_number: vDoc, quantity: vQty, material_cost: vTotalCost, recipe_version: vRecipe,
  })

  return { id: vId, doc_number: vDoc, duplicate: false, material_cost: vTotalCost }
}

// ============================================================================
// EXPENSES (بند 32)
// ============================================================================
async function create_expense(params: Record<string, unknown>): Promise<unknown> {
  const vBid = await requireBusinessId()
  await assertPerm('expenses.manage')
  const payload = payloadOf(params)

  const vOp = strVal(payload.operation_id) ?? raise('operation_id مطلوب لكل عملية (منع التكرار).')
  if (!(await registerOp(vOp, 'EXPENSE'))) {
    return dupResult(await findDuplicateByOp('expenses', vOp))
  }

  const vAmount = numVal(payload.amount)
  if (vAmount === null || vAmount <= 0) raise('المبلغ يجب أن يكون أكبر من صفر.')
  const vCategory = strVal(payload.category_id)
  const cat = vCategory === null ? undefined : await db.expense_categories.get(vCategory)
  if (!cat || cat.business_id !== vBid) raise('اختر تصنيف مصروف صحيحاً.')

  const vDoc = await nextDocNumber('EXP')
  // حرفياً: v_cash_acc := nullif(p_payload->>'cash_account_id','')::uuid — بدون fallback للصندوق الافتراضي
  const vCashAcc = strVal(payload.cash_account_id)

  const vId = uuid()
  await insertRow('expenses', {
    id: vId,
    operation_id: vOp,
    doc_number: vDoc,
    business_id: vBid,
    category_id: vCategory,
    amount: vAmount,
    expense_date: strVal(payload.expense_date) ?? businessToday(),
    payment_method: strVal(payload.payment_method) ?? 'CASH',
    cash_account_id: vCashAcc,
    description: strVal(payload.description),
    notes: strVal(payload.notes),
    created_by: getCtx().userId,
    created_at: nowIso(),
  })

  if (vCashAcc !== null) {
    await insertCashTx({
      cashAccountId: vCashAcc,
      direction: 'OUT',
      amount: vAmount,
      referenceType: 'EXPENSE',
      referenceId: vId,
      operationId: vOp,
      description: 'مصروف ' + vDoc,
    })
  }

  await writeAudit('CREATE_EXPENSE', 'expense', vId, 'CREATE', null, {
    amount: vAmount, category_id: payload.category_id ?? null,
  })

  return { id: vId, doc_number: vDoc, duplicate: false }
}

// ============================================================================
// التصدير — نفس أسماء دوال SQL
// ============================================================================
export const opsCore: Record<string, RpcHandler> = {
  bootstrap_business,
  create_sale,
  void_sale,
  create_purchase,
  void_purchase,
  create_customer_payment,
  create_supplier_payment,
  create_production_batch,
  create_expense,
}
