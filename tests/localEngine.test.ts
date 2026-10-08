/**
 * اختبار السيناريو الكامل للوضع المحلي — من التهيئة حتى التقارير:
 * تهيئة مالك → منتجات → شراء (متوسط مرجح) → بيع → مخزون/صندوق → إلغاء
 * → تكرار عملية (idempotency) → إنتاج → توزيع (تحميل/بيع/مرتجع/تسوية) → لوحة
 * يطابق سيناريوهات المواصفة 76-82 على القاعدة المحلية (IndexedDB).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { adapter } from '@/lib/local/adapter'
import { callRpc, supportedRpcs } from '@/lib/local/rpc'
import { db } from '@/db/db'
import { getCtx, restoreContext, stockQty } from '@/lib/local/context'

const BID = () => getCtx().businessId as string

async function newProduct(p: Partial<Record<string, unknown>>): Promise<string> {
  const id = crypto.randomUUID()
  await db.products.put({
    id, business_id: BID(), code: p.code ?? ('P-' + id.slice(0, 4)), name: p.name ?? 'صنف',
    item_type: p.item_type ?? 'RAW_MATERIAL', base_unit_id: p.base_unit_id, sales_unit_id: p.base_unit_id,
    sale_price: (p.sale_price as number) ?? 0, default_cost: 0, avg_cost: 0, min_stock: 0,
    active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...p,
  } as never)
  return id
}

async function newSupplier(): Promise<string> {
  const id = crypto.randomUUID()
  await db.suppliers.put({
    id, business_id: BID(), code: 'S-' + id.slice(0, 4), name: 'مورد', active: true,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } as never)
  return id
}

beforeEach(async () => {
  // قاعدة نظيفة + تسجيل دخول مالك جديد (نمط الجهاز الشخصي الواحد)
  const tables = db.tables
  for (const t of tables) await t.clear()
  const res = await adapter.auth.signInWithPassword({ email: 'owner@local', password: 'secret123' })
  expect(res.error).toBeNull()
})

describe('رحلة النظام المحلي الكاملة', () => {
  it('تهيئة النشاط تنشئ الوحدات والمستودعات والصندوق والفئات', async () => {
    const out = await callRpc('bootstrap_business', {
      p_setup_code: 'ANY', p_business_name: 'مخبز الجنة', p_full_name: 'المالك', p_phone: '0500',
    }) as { business_id: string }
    expect(out.business_id).toBeTruthy()
    expect(getCtx().role).toBe('OWNER')

    expect((await db.units.toArray()).length).toBe(9)
    expect((await db.unit_conversions.toArray()).length).toBe(4)
    expect((await db.warehouses.toArray()).length).toBe(2)
    expect((await db.cash_accounts.toArray()).length).toBe(1)
    expect((await db.expense_categories.toArray()).length).toBe(9)
    expect((await db.product_categories.toArray()).length).toBe(5)
  })

  it('شراء نقدي: مخزون + صندوق + متوسط مرجح (بند 95/96)', async () => {
    await callRpc('bootstrap_business', { p_setup_code: 'X', p_business_name: 'مخبز', p_full_name: 'م' })
    const { units, warehouses } = { units: await db.units.toArray(), warehouses: await db.warehouses.toArray() }
    const kg = units.find((u) => u.symbol === 'كغ')!
    const bag = units.find((u) => u.symbol === 'كيس')!
    const finishedWh = warehouses.find((w) => w.kind === 'FINISHED')!

    const flour = await newProduct({ code: 'FL1', name: 'طحين', base_unit_id: String(kg.id) })
    const supplierId = await newSupplier()
    // شراء 2 كيس (50 كغ/كيس) بسعر 600 للكيس → 1200 → avg = 1200/100 = 12
    const pur = await callRpc('create_purchase', {
      p_payload: {
        operation_id: crypto.randomUUID(), supplier_id: supplierId, warehouse_id: finishedWh.id,
        payment_type: 'CASH', items: [{ product_id: flour, quantity: 2, unit_id: bag.id, unit_price: 600 }],
      },
    }) as { id: string; doc_number: string; duplicate: boolean }
    expect(pur.duplicate).toBe(false)
    expect(pur.doc_number).toMatch(/^PUR-/)

    const p1 = await db.products.get(flour)
    expect(p1?.avg_cost).toBe(12)
    expect(await stockQty(flour, String(finishedWh.id))).toBe(100)

    const cash = await db.cash_transactions.toArray()
    expect(cash).toHaveLength(1)
    expect(cash[0].direction).toBe('OUT')
    expect(cash[0].amount).toBe(1200)

    // شراء ثانٍ بسعر مختلف → سلوك SQL الحرفي: (other_in - out) = 0 → المتوسط = سعر الشراء الأخير (18)
    // (خلط المتوسط المرجح يحدث فقط مع تدفقات غير شرائية كالإنتاج والمرتجعات — انظر 0002_functions.sql)
    await callRpc('create_purchase', {
      p_payload: {
        operation_id: crypto.randomUUID(), supplier_id: supplierId, warehouse_id: finishedWh.id, payment_type: 'CREDIT',
        items: [{ product_id: flour, quantity: 100, unit_id: kg.id, unit_price: 18 }],
      },
    })
    const p2 = await db.products.get(flour)
    expect(p2?.avg_cost).toBe(18)
    expect(p2?.last_purchase_cost).toBe(18)
  })

  it('بيع نقدي يخصم المخزون ويدخل الصندوق + التكرار idempotent (بند 39)', async () => {
    await callRpc('bootstrap_business', { p_setup_code: 'X', p_business_name: 'مخبز', p_full_name: 'م' })
    const units = await db.units.toArray()
    const warehouses = await db.warehouses.toArray()
    const kg = units.find((u) => u.symbol === 'كغ')!
    const wh = warehouses.find((w) => w.kind === 'FINISHED')!

    const flour = await newProduct({ code: 'FL', name: 'طحين', base_unit_id: String(kg.id) })

    await callRpc('create_purchase', {
      p_payload: { operation_id: crypto.randomUUID(), supplier_id: await newSupplier(), warehouse_id: wh.id, payment_type: 'CASH',
        items: [{ product_id: flour, quantity: 50, unit_id: kg.id, unit_price: 10 }] },
    })

    const opId = crypto.randomUUID()
    const sale = await callRpc('create_sale', {
      p_payload: { operation_id: opId, warehouse_id: wh.id, payment_type: 'CASH', discount: 0,
        items: [{ product_id: flour, quantity: 10, unit_id: kg.id, unit_price: 15 }] },
    }) as { id: string; doc_number: string; duplicate: boolean }
    expect(sale.doc_number).toMatch(/^SAL-/)
    expect(await stockQty(flour, String(wh.id))).toBe(40)

    // نفس operation_id → duplicate بدون أثر مضاعف
    const dup = await callRpc('create_sale', {
      p_payload: { operation_id: opId, warehouse_id: wh.id, payment_type: 'CASH',
        items: [{ product_id: flour, quantity: 10, unit_id: kg.id, unit_price: 15 }] },
    }) as { duplicate: boolean; doc_number: string }
    expect(dup.duplicate).toBe(true)
    expect(dup.doc_number).toBe(sale.doc_number)
    expect(await stockQty(flour, String(wh.id))).toBe(40)

    const cash = await db.cash_transactions.toArray()
    const net = cash.reduce((a, t) => a + (t.direction === 'IN' ? Number(t.amount) : -Number(t.amount)), 0)
    expect(net).toBe(-500 + 150) // شراء 500 OUT + بيع 150 IN

    // بيع بكمية أكبر من المتاح → رسالة SQL الحرفية
    await expect(callRpc('create_sale', {
      p_payload: { operation_id: crypto.randomUUID(), warehouse_id: wh.id, payment_type: 'CASH',
        items: [{ product_id: flour, quantity: 1000, unit_id: kg.id, unit_price: 15 }] },
    })).rejects.toThrow('الكمية المطلوبة أكبر من الرصيد المتاح.')

    // إلغاء البيع → الرصيد يعود 50 + CASH OUT
    await callRpc('void_sale', { p_sale_id: sale.id, p_reason: 'خطأ في الإدخال' })
    expect(await stockQty(flour, String(wh.id))).toBe(50)
  })

  it('إنتاج: استهلاك مواد وإدخال منتج نهائي بتكلفة المواد (بند 23/24)', async () => {
    await callRpc('bootstrap_business', { p_setup_code: 'X', p_business_name: 'مخبز', p_full_name: 'م' })
    const units = await db.units.toArray()
    const warehouses = await db.warehouses.toArray()
    const kg = units.find((u) => u.symbol === 'كغ')!
    const piece = units.find((u) => u.symbol === 'قطعة')!
    const wh = warehouses.find((w) => w.kind === 'FINISHED')!

    const flour = await newProduct({ code: 'F', name: 'طحين', base_unit_id: String(kg.id) })
    const bread = await newProduct({ code: 'B', name: 'خبز', item_type: 'FINISHED_PRODUCT', base_unit_id: String(piece.id), sale_price: 2 })

    await db.products.update(flour, { avg_cost: 10 })
    await callRpc('create_purchase', {
      p_payload: { operation_id: crypto.randomUUID(), supplier_id: await newSupplier(), warehouse_id: wh.id, payment_type: 'CASH',
        items: [{ product_id: flour, quantity: 700, unit_id: kg.id, unit_price: 10 }] },
    })
    // نعيد avg إلى 10 (الشراء جعله 10 أصلاً)

    const recipeId = crypto.randomUUID()
    const verId = crypto.randomUUID()
    await db.recipes.put({ id: recipeId, business_id: BID(), product_id: bread, name: 'وصفة الخبز', created_at: new Date().toISOString() } as never)
    await db.recipe_versions.put({ id: verId, business_id: BID(), recipe_id: recipeId, version_no: 1, output_quantity: 1000, output_unit_id: piece.id, created_at: new Date().toISOString() } as never)
    await db.recipe_items.put({ id: crypto.randomUUID(), recipe_version_id: verId, material_id: flour, quantity: 700, unit_id: kg.id } as never)

    const prod = await callRpc('create_production_batch', {
      p_payload: { operation_id: crypto.randomUUID(), product_id: bread, warehouse_id: wh.id,
        recipe_version_id: verId, quantity: 1000, unit_id: piece.id },
    }) as { material_cost: number; doc_number: string }
    expect(prod.doc_number).toMatch(/^PRO-/)
    expect(prod.material_cost).toBe(7000)
    expect(await stockQty(flour, String(wh.id))).toBe(0)   // استُهلك كله
    expect(await stockQty(bread, String(wh.id))).toBe(1000) // منتج نهائي
  })

  it('توزيع: تحميل → بيع → مرتجع → تسوية بفرق موثق (بند 29-31)', async () => {
    await callRpc('bootstrap_business', { p_setup_code: 'X', p_business_name: 'مخبز', p_full_name: 'م' })
    const units = await db.units.toArray()
    const warehouses = await db.warehouses.toArray()
    const piece = units.find((u) => u.symbol === 'قطعة')!
    const wh = warehouses.find((w) => w.kind === 'FINISHED')!

    const bread = await newProduct({ code: 'B2', name: 'خبز توزيع', item_type: 'FINISHED_PRODUCT', base_unit_id: String(piece.id), sale_price: 2 })
    await db.products.update(bread, { avg_cost: 1 })
    await callRpc('create_purchase', {
      p_payload: { operation_id: crypto.randomUUID(), supplier_id: await newSupplier(), warehouse_id: wh.id, payment_type: 'CASH',
        items: [{ product_id: bread, quantity: 2000, unit_id: piece.id, unit_price: 1 }] },
    })

    const vehicleId = crypto.randomUUID()
    await db.vehicles.put({ id: vehicleId, business_id: BID(), code: 'V1', name: 'سيارة 1', active: true } as never)
    const customerId = crypto.randomUUID()
    await db.customers.put({ id: customerId, business_id: BID(), code: 'C1', name: 'عميل التوزيع', active: true, credit_limit: 0, payment_terms_days: 0 } as never)

    const load = await callRpc('create_distribution_load', {
      p_payload: { operation_id: crypto.randomUUID(), vehicle_id: vehicleId, warehouse_id: wh.id,
        items: [{ product_id: bread, quantity: 2000, unit_id: piece.id }] },
    }) as { id: string; doc_number: string }
    expect(load.doc_number).toMatch(/^LOD-/)
    expect(await stockQty(bread, String(wh.id))).toBe(0) // خرجت مع السيارة

    // بيع 1800 (3600 نقدي) + مرتجع 150 → الفرق 50
    await callRpc('record_distribution_delivery', {
      p_payload: { operation_id: crypto.randomUUID(), load_id: load.id, customer_id: customerId,
        product_id: bread, quantity: 1800, unit_id: piece.id, unit_price: 2, payment_type: 'CASH' },
    })
    await callRpc('record_distribution_return', {
      p_payload: { operation_id: crypto.randomUUID(), load_id: load.id, product_id: bread,
        quantity: 150, unit_id: piece.id, reason: 'باقي اليوم' },
    })

    // تسوية بدون سبب للفرق → ترفض برسالة SQL
    await expect(callRpc('settle_distribution_load', { p_load_id: load.id, p_cash_collected: 3600 }))
      .rejects.toThrow(/فرق كمية غير مبرر/)

    const stl = await callRpc('settle_distribution_load', {
      p_load_id: load.id, p_cash_collected: 3600, p_variance_note: 'فرق موثق بالمعاينة',
    }) as { doc_number: string; unaccounted: number }
    expect(stl.doc_number).toMatch(/^STL-/)
    expect(stl.unaccounted).toBe(50)
    expect(await stockQty(bread, String(wh.id))).toBe(150) // المرتجع رجع للمستودع

    const loadRow = await db.distribution_loads.get(load.id)
    expect(loadRow?.status).toBe('SETTLED')
  })

  it('لوحة القيادة والتقارير تعمل محلياً', async () => {
    await callRpc('bootstrap_business', { p_setup_code: 'X', p_business_name: 'مخبز', p_full_name: 'م' })
    const dash = await callRpc('get_dashboard_summary', {}) as Record<string, unknown>
    expect(dash.customers_count).toBe(0)
    expect(dash.cash_balance).toBe(0)

    const units = await db.units.toArray()
    const warehouses = await db.warehouses.toArray()
    const kg = units.find((u) => u.symbol === 'كغ')!
    const wh = warehouses.find((w) => w.kind === 'FINISHED')!
    const flour = await newProduct({ code: 'F3', name: 'طحين', base_unit_id: String(kg.id) })
    await callRpc('create_purchase', {
      p_payload: { operation_id: crypto.randomUUID(), supplier_id: await newSupplier(), warehouse_id: wh.id, payment_type: 'CASH',
        items: [{ product_id: flour, quantity: 10, unit_id: kg.id, unit_price: 5 }] },
    })
    const from = '2020-01-01'
    const to = '2099-12-31'
    const salesRep = await callRpc('get_sales_report', { p_from: from, p_to: to }) as unknown[]
    const purRep = await callRpc('get_purchases_report', { p_from: from, p_to: to }) as unknown[]
    const invRep = await callRpc('get_inventory_report', {}) as unknown[]
    expect(Array.isArray(salesRep)).toBe(true)
    expect((purRep as unknown[]).length).toBeGreaterThanOrEqual(1)
    expect(invRep.length).toBeGreaterThanOrEqual(1)
    // استعلامات adapter المباشرة تعمل أيضاً (نمط المكونات)
    const v = await adapter.from('v_stock').select('*')
    expect(v.error).toBeNull()
  })

  it('كل الدوال المتوقعة مسجلة في الموزع', () => {
    const s = supportedRpcs()
    for (const fn of ['create_sale', 'void_sale', 'create_purchase', 'void_purchase',
      'create_customer_payment', 'create_supplier_payment', 'create_production_batch',
      'create_expense', 'create_inventory_adjustment', 'create_waste', 'create_transfer',
      'create_distribution_load', 'record_distribution_delivery', 'record_distribution_return',
      'settle_distribution_load', 'bootstrap_business', 'update_business', 'assign_user_role',
      'get_dashboard_summary', 'get_sales_report', 'get_audit_logs']) {
      expect(s).toContain(fn)
    }
  })

  it('استعادة الجلسة بعد الإغلاق تعمل (بند الجلسة المحلية)', async () => {
    await callRpc('bootstrap_business', { p_setup_code: 'X', p_business_name: 'مخبز', p_full_name: 'م' })
    expect(await restoreContext()).toBe(true)
    expect(getCtx().role).toBe('OWNER')
    expect(getCtx().businessId).toBeTruthy()
  })
})
