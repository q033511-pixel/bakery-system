/* ============================================================================
 * اختبارات خدمة المزامنة المركزية — ربط المحرك بالتطبيق (تجربة الخطة B)
 * ---------------------------------------------------------------------------
 * تغطي عقود الدمج الحقيقية على IndexedDB حقيقي (fake-indexeddb):
 *   1) البوابة المعطلة افتراضياً: صفر إدراج قبل تفعيل صريح
 *   2) الإدراج بعد نجاح محلي → PENDING_SYNC (لا SYNCED إلا بإقرار الخادم)
 *   3) الطابور الدائم عبر DexieOpStore — يبقى بعد «إعادة تشغيل» كاملة
 *   4) تطبيق ما سُحب: upsert كيان بضخ business_id + عمليات مالية idempotent
 *   5) التعويض المحلي عند الرفض: إبطال موجّه للفاتورة
 * ملاحظة أمنية: الوضع هنا = خادم اختبار فقط، بلا أي مفاتيح حقيقية.
 * ========================================================================== */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { adapter } from '@/lib/local/adapter'
import { callRpc } from '@/lib/local/rpc'
import { db } from '@/db/db'
import { getCtx } from '@/lib/local/context'
import {
  isSyncEnabled, enqueueAfterLocalOp, enqueueVoidAfterLocalOp,
  enqueueUpsertAfterLocalSave, syncOpStore, applyServerOpForTests,
  compensateForTests,
} from '@/services/sync/central'

/* ---------- شيم localStorage لبيئة node (كافٍ لعقود الدمج) ---------- */
const mem = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
}

const BID = () => getCtx().businessId as string

async function newSupplier(): Promise<string> {
  const id = crypto.randomUUID()
  await db.suppliers.put({
    id, business_id: BID(), code: 'S-' + id.slice(0, 4), name: 'مطحنة الاختبار',
    active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } as never)
  return id
}

async function setupWorld() {
  const tables = db.tables
  for (const t of tables) await t.clear()
  mem.clear()
  const res = await adapter.auth.signInWithPassword({ email: 'owner@local', password: 'secret123' })
  expect(res.error).toBeNull()
  await callRpc('bootstrap_business', {
    p_setup_code: 'ANY', p_business_name: 'مخبز اختبار الدمج', p_full_name: 'المالك', p_phone: null,
  })
}

async function newProduct(p: Partial<Record<string, unknown>> = {}): Promise<string> {
  const id = crypto.randomUUID()
  const units = await db.units.where('business_id').equals(BID()).toArray()
  const baseUnit = (p.base_unit_id as string) ?? units.find((u) => u.symbol === 'كغ')!.id as string
  await db.products.put({
    id, business_id: BID(), code: p.code ?? ('P-' + id.slice(0, 4)), name: p.name ?? 'خبز صمون',
    item_type: p.item_type ?? 'FINISHED_PRODUCT', base_unit_id: baseUnit, sales_unit_id: baseUnit,
    sale_price: (p.sale_price as number) ?? 2.0, default_cost: 0, avg_cost: 0, min_stock: 0,
    active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } as never)
  return id
}

async function unitAndWarehouse(): Promise<{ unit: string; wh: string; cash: string }> {
  const units = await db.units.where('business_id').equals(BID()).toArray()
  const unit = units.find((u) => u.symbol === 'كغ')!.id as string
  const whs = await db.warehouses.where('business_id').equals(BID()).toArray()
  const wh = whs.find((w) => w.is_default && w.kind === 'FINISHED')!.id as string
  const cash = (await db.cash_accounts.where('business_id').equals(BID()).toArray()).find((c) => c.is_default)!.id as string
  return { unit, wh, cash }
}

const ENABLED_STATE = () => ({
  'bakery.sync_config': { url: 'http://127.0.0.1:5434', anonKey: 'test-anon', mode: 'rig' },
  'bakery.sync_jwt': { access_token: 'test-jwt', userId: 'u1', email: 't@l', obtained_at: new Date().toISOString() },
  'bakery.sync_device': { deviceId: 'd1', deviceToken: 'tok', name: 'جهاز الاختبار', platform: 'WEB' },
  'bakery.sync_enabled': '1',
})

function enableSync() {
  for (const [k, v] of Object.entries(ENABLED_STATE())) {
    ;(globalThis.localStorage as Storage).setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
  }
}

beforeEach(async () => { await setupWorld() })

describe('البوابة المعطلة افتراضياً', () => {
  it('بلا تفعيل صريح: isSyncEnabled false والإدراج لا يكتب شيئاً في الطابور', async () => {
    expect(isSyncEnabled()).toBe(false)
    await enqueueAfterLocalOp('SALE', { operation_id: crypto.randomUUID() }, null)
    await enqueueUpsertAfterLocalSave('CUSTOMER_UPSERT', { id: crypto.randomUUID() })
    expect(await db.sync_ops.count()).toBe(0)
  })

  it('بلا operation_id في الـpayload: لا إدراج حتى مع التفعيل (حماية من الازدواج)', async () => {
    enableSync()
    expect(isSyncEnabled()).toBe(true)
    await enqueueAfterLocalOp('SALE', { x: 1 }, null)
    expect(await db.sync_ops.count()).toBe(0)
  })

  it('أنواع غير قابلة للمزامنة (التوزيع) لا تُدرج — موثقة صراحة', async () => {
    enableSync()
    await enqueueAfterLocalOp('DISTRIBUTION_DELIVERY', { operation_id: crypto.randomUUID() }, null)
    expect(await db.sync_ops.count()).toBe(0)
  })
})

describe('الإدراج بعد نجاح محلي مؤكد', () => {
  it('عملية مالية → PENDING_SYNC وليس SYNCED — الإقرار للخادم فقط', async () => {
    enableSync()
    const opId = crypto.randomUUID()
    await enqueueAfterLocalOp('SALE', { operation_id: opId, items: [] }, 'sale-1')
    const rows = await db.sync_ops.toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].operation_id).toBe(opId)
    expect(rows[0].state).toBe('PENDING_SYNC')
    expect(rows[0].op_type).toBe('SALE')
    expect(rows[0].local_result_id).toBe('sale-1')
  })

  it('PRODUCTION يُحوَّل لـPRODUCTION_BATCH وADJUSTMENT لـINVENTORY_ADJUSTMENT', async () => {
    enableSync()
    await enqueueAfterLocalOp('PRODUCTION', { operation_id: crypto.randomUUID() }, null)
    await enqueueAfterLocalOp('ADJUSTMENT', { operation_id: crypto.randomUUID() }, null)
    const types = (await db.sync_ops.toArray()).map((r) => r.op_type).sort()
    expect(types).toEqual(['INVENTORY_ADJUSTMENT', 'PRODUCTION_BATCH'])
  })

  it('upsert كيان: مفتاح الطابور = معرف الكيان (آخر upsert يفوز)', async () => {
    enableSync()
    const id = crypto.randomUUID()
    await enqueueUpsertAfterLocalSave('CUSTOMER_UPSERT', { id, name: 'عميل أول' })
    await enqueueUpsertAfterLocalSave('CUSTOMER_UPSERT', { id, name: 'عميل محدّث' })
    const rows = await db.sync_ops.toArray()
    expect(rows.length).toBe(1)
    expect((rows[0].payload as { name: string }).name).toBe('عميل محدّث')
  })
})

describe('الطابور الدائم (DexieOpStore)', () => {
  it('load/save يحفظان الحالات ويبقيان الطابور بعد إعادة تشغيل كاملة', async () => {
    enableSync()
    const opId = crypto.randomUUID()
    await enqueueAfterLocalOp('SALE', { operation_id: opId }, 's1')
    // محاكاة انهيار وإعادة تشغيل: نسخ جديد من المخزن يقرأ نفس الجدول
    const loaded = await syncOpStore.load()
    expect(loaded.length).toBe(1)
    expect(loaded[0].operation_id).toBe(opId)
    // تحديث حالة (كما يفعل المحرك بعد محاولة فاشلة) ثم الحفظ والقراءة مجدداً
    const updated = loaded.map((o) => ({ ...o, state: 'FAILED' as const, attempts: 2, last_error: 'fetch failed' }))
    await syncOpStore.save(updated)
    const again = await syncOpStore.load()
    expect(again[0].state).toBe('FAILED')
    expect(again[0].attempts).toBe(2)
  })
})

describe('تطبيق ما سُحب من الخادم (أجهزة أخرى)', () => {
  it('CUSTOMER_UPSERT: الصف يهبط في Dexie بـbusiness_id مضخوخ من الجلسة المحلية', async () => {
    const cid = crypto.randomUUID()
    await applyServerOpForTests({
      seq: 1, operation_id: crypto.randomUUID(), op_type: 'CUSTOMER_UPSERT',
      payload: { id: cid, code: 'CU-1', name: 'عميل من الجهاز الآخر', phone: null, credit_limit: 0, payment_terms_days: 0, active: true },
      status: 'APPROVED',
    })
    const row = await db.customers.get(cid)
    expect(row).toBeTruthy()
    expect((row as Record<string, unknown>).business_id).toBe(BID())
    expect((row as Record<string, unknown>).name).toBe('عميل من الجهاز الآخر')
  })

  it('SALE من جهاز آخر: يطبق محلياً idempotent — نفس operation_id مرتين = فاتورة واحدة', async () => {
    const { unit, wh } = await unitAndWarehouse()
    const pid = await newProduct({ sale_price: 3.0 })
    await callRpc('create_purchase', { p_payload: {
      operation_id: crypto.randomUUID(), warehouse_id: wh, purchase_date: '2026-10-17',
      supplier_id: await newSupplier(), items: [{ product_id: pid, quantity: 10, unit_id: unit, unit_price: 2 }], discount: 0,
    }})
    const opId = crypto.randomUUID()
    const salePayload = {
      operation_id: opId, customer_id: null, warehouse_id: wh, sale_date: '2026-10-17',
      items: [{ product_id: pid, quantity: 2, unit_id: unit, unit_price: 3 }], discount: 0,
      payment_type: 'CASH', payment_method: 'CASH', allow_over_credit: false,
    }
    await applyServerOpForTests({
      seq: 2, operation_id: opId, op_type: 'SALE', payload: salePayload, status: 'APPROVED',
    })
    const sales1 = await db.sales.where('business_id').equals(BID()).toArray()
    expect(sales1.length).toBe(1)
    // إعادة سحب نفس العملية (نفس operation_id) — idempotency يمنع الازدواج
    await applyServerOpForTests({
      seq: 2, operation_id: opId, op_type: 'SALE', payload: salePayload, status: 'APPROVED',
    })
    const sales2 = await db.sales.where('business_id').equals(BID()).toArray()
    expect(sales2.length).toBe(1)
    // المخزون خصم مرة واحدة: 10 − 2 = 8
    const moves = await db.inventory_movements.where('business_id').equals(BID()).toArray()
    const bal = moves
      .filter((m) => m.item_id === pid && m.warehouse_id === wh)
      .reduce((s, m) => s + (String(m.movement_type).endsWith('_IN') ? Number(m.quantity) : -Number(m.quantity)), 0)
    expect(bal).toBeCloseTo(8, 3)
  })
})

describe('التعويض المحلي عند رفض الخادم', () => {
  it('SALE مرفوضة → إبطال محلي موجّه → الفاتورة VOIDED والصندوق عاد', async () => {
    const { unit, wh, cash } = await unitAndWarehouse()
    const pid = await newProduct({ sale_price: 3.0 })
    await callRpc('create_purchase', { p_payload: {
      operation_id: crypto.randomUUID(), warehouse_id: wh, purchase_date: '2026-10-17',
      supplier_id: await newSupplier(), items: [{ product_id: pid, quantity: 10, unit_id: unit, unit_price: 2 }], discount: 0,
    }})
    // بيع محلي ناجح (كما لو نُفذ أوفلاين)
    const local = await callRpc('create_sale', { p_payload: {
      operation_id: crypto.randomUUID(), customer_id: null, warehouse_id: wh, sale_date: '2026-10-17',
      items: [{ product_id: pid, quantity: 3, unit_id: unit, unit_price: 3 }], discount: 0,
      payment_type: 'CASH', payment_method: 'CASH', allow_over_credit: false,
    }}) as { id: string }
    // إشارة الصندوق بالاتجاه (direction) والمبلغ موجب دائماً
    const cashSum = (rows: Record<string, unknown>[]) =>
      rows.filter((t) => t.cash_account_id === cash)
        .reduce((s, t) => s + (t.direction === 'IN' ? 1 : -1) * Number(t.amount), 0)
    const before = await db.cash_transactions.where('business_id').equals(BID()).toArray()
    const cashBefore = cashSum(before)
    // الخادم يرفض (كسر مخزون مثلاً) — التعويض يبطل الفاتورة المحلية
    await compensateForTests(
      { operation_id: crypto.randomUUID(), op_type: 'SALE', payload: {}, state: 'REJECTED', created_at: new Date().toISOString(), attempts: 1, schema_version: 1, local_result_id: local.id } as never,
      'الرصيد المتاح غير كافٍ — جهاز آخر باع أولاً',
    )
    const saleAfter = await db.sales.get(local.id)
    expect(saleAfter?.status).toBe('VOIDED')
    const after = await db.cash_transactions.where('business_id').equals(BID()).toArray()
    const cashAfter = cashSum(after)
    expect(cashAfter).toBeCloseTo(cashBefore - 9, 3) // 3×3 خرجت مع الإبطال
  })

  it('دفعات (لا تملك إبطالاً) → CONFLICT مع السبب — تسوية يدوية إلزامية', async () => {
    const opId = crypto.randomUUID()
    await compensateForTests(
      { operation_id: opId, op_type: 'CUSTOMER_PAYMENT', payload: {}, state: 'REJECTED', created_at: new Date().toISOString(), attempts: 1, schema_version: 1, local_result_id: 'p1' } as never,
      'العميل غير موجود على الخادم',
    )
    const row = await db.sync_ops.get(opId)
    expect(row?.state).toBe('CONFLICT')
    expect(row?.rejection_reason).toContain('غير موجود')
  })

  it('إبطال فاتورة من جهاز آخر (SALE_VOID) يطبق محلياً بالسبب', async () => {
    const { unit, wh } = await unitAndWarehouse()
    const pid = await newProduct({ sale_price: 3.0 })
    await callRpc('create_purchase', { p_payload: {
      operation_id: crypto.randomUUID(), warehouse_id: wh, purchase_date: '2026-10-17',
      supplier_id: await newSupplier(), items: [{ product_id: pid, quantity: 10, unit_id: unit, unit_price: 2 }], discount: 0,
    }})
    const local = await callRpc('create_sale', { p_payload: {
      operation_id: crypto.randomUUID(), customer_id: null, warehouse_id: wh, sale_date: '2026-10-17',
      items: [{ product_id: pid, quantity: 1, unit_id: unit, unit_price: 3 }], discount: 0,
      payment_type: 'CASH', payment_method: 'CASH', allow_over_credit: false,
    }}) as { id: string }
    await applyServerOpForTests({
      seq: 3, operation_id: crypto.randomUUID(), op_type: 'SALE_VOID',
      payload: { sale_id: local.id, reason: 'خطأ إدخال من جهاز آخر' }, status: 'APPROVED',
    })
    const sale = await db.sales.get(local.id)
    expect(sale?.status).toBe('VOIDED')
  })

  it('إدراج إبطال بعد نجاحه محلياً → SALE_VOID في الطابور', async () => {
    enableSync()
    const saleId = crypto.randomUUID()
    await enqueueVoidAfterLocalOp('SALE_VOID', saleId, 'سبب الاختبار')
    const rows = await db.sync_ops.toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].op_type).toBe('SALE_VOID')
    expect((rows[0].payload as { sale_id: string }).sale_id).toBe(saleId)
    expect((rows[0].payload as { reason: string }).reason).toBe('سبب الاختبار')
  })
})

beforeAll(() => { /* عالم نظيف عبر beforeEach */ })
