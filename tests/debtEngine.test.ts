/**
 * اختبارات محرك الذمم والإقفال على القاعدة المحلية (fake-indexeddb):
 * - الرصيد الافتتاحي المعتمد يدخل الأرصدة وكشف الحساب (وأثر غير المعتمد = صفر)
 * - حد الائتمان: رفض تجاوز بلا تأكيد + سماح مع allow_over_credit + توثيق تدقيق
 * - أعمار الديون من دالة الخادم get_receivables_aging
 * - إقفال الصندوق: المتوقع = بداية+داخل−خارج، الفرق سببه إلزامي، فريد لكل يوم
 * - أسعار العملاء: upsert/delete من دالة الخادم
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { adapter } from '@/lib/local/adapter'
import { callRpc } from '@/lib/local/rpc'
import { db } from '@/db/db'
import { getCtx } from '@/lib/local/context'

const BID = () => getCtx().businessId as string
const OP = () => crypto.randomUUID()

async function newProduct(over: Partial<Record<string, unknown>>): Promise<string> {
  const units = await db.units.toArray()
  const kg = units.find((u) => u.symbol === 'كغ')!
  const id = crypto.randomUUID()
  await db.products.put({
    id, business_id: BID(), code: over.code ?? ('P-' + id.slice(0, 4)), name: over.name ?? 'خبز طازج',
    item_type: 'FINISHED_PRODUCT', base_unit_id: kg.id, sales_unit_id: kg.id,
    sale_price: (over.sale_price as number) ?? 4.0, default_cost: 0, avg_cost: 0, min_stock: 0,
    active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  } as never)
  return id
}

async function newCustomer(over: Partial<Record<string, unknown>>): Promise<string> {
  const id = crypto.randomUUID()
  await db.customers.put({
    id, business_id: BID(), code: 'CU-' + id.slice(0, 4), name: over.name ?? 'عميل',
    phone: null, area: null, salesperson: null, credit_limit: 0, payment_terms_days: 0,
    opening_balance: 0, opening_balance_date: null, opening_balance_approved: false, opening_import_id: null,
    notes: null, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  } as never)
  return id
}

async function giveStock(productId: string, qty: number, price: number): Promise<void> {
  const warehouses = await db.warehouses.toArray()
  const wh = warehouses.find((w) => w.kind === 'FINISHED')!
  const supplierId = crypto.randomUUID()
  await db.suppliers.put({
    id: supplierId, business_id: BID(), code: 'SU-1', name: 'مورد', phone: null, address: null,
    notes: null, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } as never)
  await callRpc('create_purchase', {
    p_payload: { operation_id: OP(), supplier_id: supplierId, warehouse_id: wh.id, payment_type: 'CASH', items: [{ product_id: productId, quantity: qty, unit_id: (await db.products.get(productId))!.base_unit_id, unit_price: price }] },
  })
}

beforeEach(async () => {
  for (const t of db.tables) await t.clear()
  const res = await adapter.auth.signInWithPassword({ email: 'owner@local', password: 'x' })
  expect(res.error).toBeNull()
  await callRpc('bootstrap_business', { p_setup_code: 'X', p_business_name: 'مخبز الذمم', p_full_name: 'المالك' })
})

describe('الرصيد الافتتاحي المعتمد', () => {
  it('apply_opening_balance يكتب الافتتاحي ويدخل الرصيد والكشف — وغير المعتمد لا يدخل', async () => {
    const productId = await newProduct({})
    const cid = await newCustomer({ name: 'ساهر', credit_limit: 0 })

    // افتتاحي غير معتمد (حقل فقط) — لا يدخل الرصيد
    await db.customers.update(cid, { opening_balance: 2280, opening_balance_approved: false })
    let bal = (await callRpc('get_receivables_aging', {}) as { customer_id: string; balance: number }[]).find((r) => r.customer_id === cid)
    expect(bal?.balance ?? 0).toBe(0)

    // الاعتماد عبر دالة المستورد
    await callRpc('apply_opening_balance', { p_customer: cid, p_amount: 2280, p_date: '2026-01-10', p_import_id: 'imp-1' })
    bal = (await callRpc('get_receivables_aging', {}) as { customer_id: string; balance: number }[]).find((r) => r.customer_id === cid)
    expect(bal!.balance).toBe(2280)

    // الكشف يبدأ بسطر الافتتاحي
    const stmt = await callRpc('get_customer_statement', { p_customer: cid, p_from: null, p_to: null }) as { type: string; balance: number }[]
    expect(stmt[0].type).toBe('رصيد افتتاحي')
    expect(stmt[0].balance).toBe(2280)

    // بيع آجل فوق الافتتاحي يتراكم
    await giveStock(productId, 2000, 3.8)
    await callRpc('create_sale', { p_payload: { operation_id: OP(), customer_id: cid, warehouse_id: (await db.warehouses.toArray()).find((w) => w.kind === 'FINISHED')!.id, sale_date: '2026-01-17', items: [{ product_id: productId, quantity: 600, unit_id: (await db.products.get(productId))!.base_unit_id, unit_price: 3.8 }], discount: 0, payment_type: 'CREDIT', payment_method: null } })
    const stmt2 = await callRpc('get_customer_statement', { p_customer: cid, p_from: null, p_to: null }) as { type: string; balance: number }[]
    expect(stmt2[stmt2.length - 1].balance).toBeCloseTo(2280 + 2280, 2)

    // التراجع عن الاستيراد يعيد الافتتاحي لصفر (بلا مساس بالفاتورة)
    await callRpc('undo_opening_balance', { p_import_id: 'imp-1' })
    const stmt3 = await callRpc('get_customer_statement', { p_customer: cid, p_from: null, p_to: null }) as { type: string; balance: number }[]
    expect(stmt3.some((e) => e.type === 'رصيد افتتاحي')).toBe(false)
    expect(stmt3[stmt3.length - 1].balance).toBeCloseTo(2280, 2)
  })

  it('سعر خاص مقترح من المستورد يُحفظ كقاعدة عميل', async () => {
    const productId = await newProduct({ name: 'خبز طازج', sale_price: 4.0 })
    const cid = await newCustomer({ name: 'فادي' })
    await callRpc('apply_opening_balance', { p_customer: cid, p_amount: 3675, p_date: '2026-01-17', p_import_id: 'imp-2', p_suggested_price: 3.5, p_product_id: productId })
    const prices = await callRpc('get_customer_prices', { p_customer: cid }) as { product_id: string; price: number }[]
    expect(prices).toHaveLength(1)
    expect(prices[0].price).toBe(3.5)
    expect(prices[0].product_id).toBe(productId)
  })
})

describe('حد الائتمان — رفض مسبب وتجاوز موثق', () => {
  it('يرفض البيع الآجل الذي يكسر الحد برسالة عربية واضحة', async () => {
    const productId = await newProduct({})
    await giveStock(productId, 2000, 4)
    const cid = await newCustomer({ name: 'قصي', credit_limit: 1000 })
    const wh = (await db.warehouses.toArray()).find((w) => w.kind === 'FINISHED')!.id
    await expect(callRpc('create_sale', {
      p_payload: { operation_id: OP(), customer_id: cid, warehouse_id: wh, sale_date: '2026-01-17', items: [{ product_id: productId, quantity: 300, unit_id: (await db.products.get(productId))!.base_unit_id, unit_price: 4 }], discount: 0, payment_type: 'CREDIT', payment_method: null },
    })).rejects.toThrow('تجاوز حد الائتمان')
  })

  it('البيع داخل الحد يمر، والتجاوز مع allow_over_credit يمر ويوثق بالتدقيق', async () => {
    const productId = await newProduct({})
    await giveStock(productId, 3000, 4)
    const cid = await newCustomer({ name: 'ساهر', credit_limit: 2500 })
    const wh = (await db.warehouses.toArray()).find((w) => w.kind === 'FINISHED')!.id
    const unit = (await db.products.get(productId))!.base_unit_id

    // 600×3.8 = 2280 داخل حد 2500
    await callRpc('create_sale', { p_payload: { operation_id: OP(), customer_id: cid, warehouse_id: wh, sale_date: '2026-01-17', items: [{ product_id: productId, quantity: 600, unit_id: unit, unit_price: 3.8 }], discount: 0, payment_type: 'CREDIT', payment_method: null } })

    // 300×4 = 1200 يكسر الحد → رفض
    await expect(callRpc('create_sale', { p_payload: { operation_id: OP(), customer_id: cid, warehouse_id: wh, sale_date: '2026-01-17', items: [{ product_id: productId, quantity: 300, unit_id: unit, unit_price: 4 }], discount: 0, payment_type: 'CREDIT', payment_method: null } })).rejects.toThrow('تجاوز حد الائتمان')

    // مع التأكيد → يمر + تدقيق التجاوز
    await callRpc('create_sale', { p_payload: { operation_id: OP(), customer_id: cid, warehouse_id: wh, sale_date: '2026-01-17', items: [{ product_id: productId, quantity: 300, unit_id: unit, unit_price: 4 }], discount: 0, payment_type: 'CREDIT', payment_method: null, allow_over_credit: true } })
    const audits = await db.audit_logs.toArray()
    expect(audits.some((a) => JSON.stringify(a.after_data ?? {}).includes('credit_limit_override'))).toBe(true)
  })

  it('لا حد = لا قيد (credit_limit صفر يعني بلا حد)', async () => {
    const productId = await newProduct({})
    await giveStock(productId, 5000, 4)
    const cid = await newCustomer({ name: 'عميل بلا حد', credit_limit: 0 })
    const wh = (await db.warehouses.toArray()).find((w) => w.kind === 'FINISHED')!.id
    const unit = (await db.products.get(productId))!.base_unit_id
    await callRpc('create_sale', { p_payload: { operation_id: OP(), customer_id: cid, warehouse_id: wh, sale_date: '2026-01-17', items: [{ product_id: productId, quantity: 2000, unit_id: unit, unit_price: 4 }], discount: 0, payment_type: 'CREDIT', payment_method: null } })
    const bal = (await callRpc('get_receivables_aging', {}) as { customer_id: string; balance: number }[]).find((r) => r.customer_id === cid)
    expect(bal!.balance).toBe(8000)
  })
})

describe('أعمار الديون من دالة الخادم', () => {
  it('توزع الرصيد على الفئات بحسب الاستحقاق وتعلّم تجاوز الحد', async () => {
    const productId = await newProduct({})
    await giveStock(productId, 5000, 4)
    const cid = await newCustomer({ name: 'فادي', credit_limit: 1000, payment_terms_days: 30 })
    const wh = (await db.warehouses.toArray()).find((w) => w.kind === 'FINISHED')!.id
    const unit = (await db.products.get(productId))!.base_unit_id

    // فاتورة قديمة بتاريخ مستحق بعيد (استحقاق 2025-09-01 → +90)
    await callRpc('create_sale', { p_payload: { operation_id: OP(), customer_id: cid, warehouse_id: wh, sale_date: '2025-08-02', due_date: '2025-09-01', items: [{ product_id: productId, quantity: 200, unit_id: unit, unit_price: 4 }], discount: 0, payment_type: 'CREDIT', payment_method: null } })
    // فاتورة اليوم (استحقاق +30 يوم → current) — مع تأكيد تجاوز الحد لأن الاختبار للأعمار لا للحدود
    await callRpc('create_sale', { p_payload: { operation_id: OP(), customer_id: cid, warehouse_id: wh, sale_date: '2026-01-17', items: [{ product_id: productId, quantity: 100, unit_id: unit, unit_price: 4 }], discount: 0, payment_type: 'CREDIT', payment_method: null, allow_over_credit: true } })

    const rows = await callRpc('get_receivables_aging', { p_as_of: '2026-01-17' }) as { customer_id: string; balance: number; current: number; over_90: number; over_limit: boolean }[]
    const r = rows.find((x) => x.customer_id === cid)!
    expect(r.balance).toBe(1200)
    expect(r.over_90).toBe(800)
    expect(r.current).toBe(400)
    expect(r.over_limit).toBe(true)
  })
})

describe('إقفال الصندوق اليومي', () => {
  it('المتوقع = بداية + داخل − خارج، ومطابق المعدود يمر بلا سبب', async () => {
    const accounts = await db.cash_accounts.toArray()
    const acc = accounts[0].id
    // حركة داخل 100 من بيع نقدي
    const productId = await newProduct({})
    await giveStock(productId, 100, 4)
    const wh = (await db.warehouses.toArray()).find((w) => w.kind === 'FINISHED')!.id
    const unit = (await db.products.get(productId))!.base_unit_id
    await callRpc('create_sale', { p_payload: { operation_id: OP(), customer_id: null, warehouse_id: wh, sale_date: '2026-01-17', items: [{ product_id: productId, quantity: 25, unit_id: unit, unit_price: 4 }], discount: 0, payment_type: 'CASH', payment_method: 'CASH' } })
    // إقفال اليوم: بداية 0 + داخل 100 − خارج (شراء نقدي 400 من giveStock!) — نقرأ المتوقع من الدالة نفسها عبر معدود خاطئ ثم صحيح

    const closing = await callRpc('create_cash_closing', {
      p_payload: { operation_id: OP(), cash_account_id: acc, closing_date: '2026-01-17', counted_balance: -300 },
    }) as { expected_balance: number; variance: number }
    // شراء نقدي 400 خارج + بيع 100 داخل، بداية 0 → متوقع -300
    expect(closing.expected_balance).toBe(-300)
    expect(closing.variance).toBe(0)
  })

  it('فرق بلا سبب → رفض؛ مع سبب → يُخزن؛ تكرار نفس اليوم → رفض', async () => {
    const accounts = await db.cash_accounts.toArray()
    const acc = accounts[0].id
    // فرق 50 معدود مقابل متوقع 0
    await expect(callRpc('create_cash_closing', { p_payload: { operation_id: OP(), cash_account_id: acc, closing_date: '2026-01-16', counted_balance: 50 } }))
      .rejects.toThrow('سبب الفرق')
    const ok = await callRpc('create_cash_closing', { p_payload: { operation_id: OP(), cash_account_id: acc, closing_date: '2026-01-16', counted_balance: 50, notes: 'فكة مع الزبائن' } }) as { variance: number; doc_number: string }
    expect(ok.variance).toBe(50)
    expect(ok.doc_number).toMatch(/^CLS-/)
    await expect(callRpc('create_cash_closing', { p_payload: { operation_id: OP(), cash_account_id: acc, closing_date: '2026-01-16', counted_balance: 50 } }))
      .rejects.toThrow('مُقفل مسبقاً')
    const list = await callRpc('get_cash_closings', {}) as unknown[]
    expect(list).toHaveLength(1)
  })

  it('idempotency: نفس operation_id لا يكرر الإقفال', async () => {
    const accounts = await db.cash_accounts.toArray()
    const acc = accounts[0].id
    const op = OP()
    const a = await callRpc('create_cash_closing', { p_payload: { operation_id: op, cash_account_id: acc, closing_date: '2026-01-15', counted_balance: 0 } }) as { duplicate: boolean }
    const b = await callRpc('create_cash_closing', { p_payload: { operation_id: op, cash_account_id: acc, closing_date: '2026-01-15', counted_balance: 0 } }) as { duplicate: boolean }
    expect(a.duplicate).toBe(false)
    expect(b.duplicate).toBe(true)
  })
})

describe('إدارة أسعار العملاء من الخادم', () => {
  it('upsert ينشئ ثم يحدّث نفس القاعدة (تفرد عميل+صنف+وحدة) والحذف يعيد للافتراضي', async () => {
    const productId = await newProduct({ name: 'خبز طازج', sale_price: 4.0 })
    const cid = await newCustomer({ name: 'قصي' })
    await callRpc('upsert_customer_price', { p_customer: cid, p_product: productId, p_unit: null, p_price: 4.0 })
    await callRpc('upsert_customer_price', { p_customer: cid, p_product: productId, p_unit: null, p_price: 4.0 })
    let prices = await callRpc('get_customer_prices', { p_customer: cid }) as { price: number }[]
    expect(prices).toHaveLength(1)
    expect(prices[0].price).toBe(4.0)

    const ruleId = (prices[0] as unknown as { id: string }).id
    await callRpc('delete_customer_price', { p_id: ruleId })
    prices = await callRpc('get_customer_prices', { p_customer: cid }) as { price: number }[]
    expect(prices).toHaveLength(0)
  })

  it('يرفض تاريخ نهاية قبل بداية وسعراً سالباً', async () => {
    const productId = await newProduct({})
    const cid = await newCustomer({})
    await expect(callRpc('upsert_customer_price', { p_customer: cid, p_product: productId, p_unit: null, p_price: 3.5, p_start_date: '2026-02-01', p_end_date: '2026-01-01' })).rejects.toThrow('تاريخ النهاية')
    await expect(callRpc('upsert_customer_price', { p_customer: cid, p_product: productId, p_unit: null, p_price: -1 })).rejects.toThrow('السعر غير صحيح')
  })
})
