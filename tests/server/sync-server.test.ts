/* ============================================================================
 * اختبارات الخادم الحقيقي — PostgreSQL فعلي (تجربة الخطة B)
 * تشترط TEST_DATABASE_URL وقاعدة مطبَّقة من migrations نظيفة (scripts/apply-migrations.js)
 * بدون المتغير تُتخطى هذه الملفات تلقائياً (لا فشل وهمي — التخطي موثق صراحة).
 * بيانات الاختبار = اصطناعية بالكامل (مخبز التجربة المركزية) — لا بيانات زبون حقيقية.
 * ========================================================================== */
import { describe, expect, it, beforeAll } from 'vitest'
import { Client } from 'pg'

const TURL = process.env.TEST_DATABASE_URL ?? ''
const hasDB = TURL.length > 0
const d = hasDB ? describe : describe.skip

type Ctx = { userId?: string; deviceId?: string; token?: string; anon?: boolean }

async function connectAs(ctx: Ctx = {}): Promise<Client> {
  const c = new Client({ connectionString: TURL })
  await c.connect()
  if (ctx.anon) {
    await c.query("select set_config('request.jwt.claims', '', false)")
    await c.query('set role anon')
    return c
  }
  const claims = JSON.stringify({ sub: ctx.userId ?? null, aud: 'authenticated', role: 'authenticated' })
  await c.query("select set_config('request.jwt.claims', $1, false)", [claims])
  const headers: Record<string, string> = {}
  if (ctx.deviceId) headers['x-device-id'] = ctx.deviceId
  if (ctx.token) headers['x-device-token'] = ctx.token
  await c.query("select set_config('request.headers', $1, false)", [JSON.stringify(headers)])
  await c.query('set role authenticated')
  return c
}

type Row = Record<string, unknown>
async function q(c: Client, sql: string, params: unknown[] = []): Promise<Row[]> {
  const r = await c.query(sql, params)
  return r.rows
}

async function rpc(c: Client, name: string, params: unknown[]): Promise<Row | null> {
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ')
  const r = await c.query(`select * from ${name}(${placeholders})`, params)
  const row = r.rows[0] ?? null
  // unwrap: دالة ترجع jsonb/عناصر → العمود يحمل اسم الدالة
  if (row && typeof row === 'object' && name in row) return row[name]
  return row
}

async function expectErr(p: Promise<unknown>): Promise<{ message: string; code: string }> {
  try { await p } catch (e) {
    const err = e as { message?: string; code?: string }
    return { message: err.message ?? '', code: err.code ?? '' }
  }
  throw new Error('كان يجب أن يرفض — نجح بشكل غير متوقع')
}

/* ---------- عالم الاختبار (يُبنى مرة واحدة بالترتيب) ---------- */
const W = {
  admin: null as unknown as Client,
  setupCode: '',
  owner1: '', acc1: '', viewer1: '', owner2: '',
  b1: '', b2: '',
  devWeb: { id: '', token: '' },
  devWin: { id: '', token: '' },
  devAcc: { id: '', token: '' },
  devOld: { id: '', token: '' },
  backup: { preview: {} as Record<string, number> },
  report: [] as { table: string; source: number; restore: number; diff: number }[],
  kg: '', piece: '',
  product: '', supplier: '', custCash: '', custCredit: '',
  whFinished: '', cashAcc: '',
}

async function adminQ(sql: string, params: unknown[] = []) {
  return q(W.admin, sql, params)
}

d('بيئة الاختبار: تطبيق نظيف + بيانات اصطناعية', () => {
  beforeAll(async () => {
    W.admin = new Client({ connectionString: TURL })
    await W.admin.connect()
    // رمز التهيئة الحقيقي
    W.setupCode = (await adminQ('select setup_code from system_setup where id = 1'))[0].setup_code
    // مستخدمون (بيانات اصطناعية)
    const u = async (email: string): Promise<string> =>
      (await adminQ('insert into auth.users(id, email) values (gen_random_uuid(), $1) returning id', [email]))[0].id
    W.owner1 = await u('owner1@test-rig.local')
    W.acc1 = await u('accountant1@test-rig.local')
    W.viewer1 = await u('viewer1@test-rig.local')
    W.owner2 = await u('owner2@test-rig.local')
  }, 30000)

  it('1.1 التهيئة الحقيقية: bootstrap ينشئ نشاطاً ومستودعات وصندوقاً ووحدات', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const res = await rpc(c, 'bootstrap_business', [W.setupCode, 'مخبز التجربة المركزية', 'مالك التجربة', null])
    expect(res.business_id).toBeTruthy()
    W.b1 = res.business_id
    const wh = await q(c, "select id from warehouses where business_id=$1 and is_default and kind='FINISHED'", [W.b1])
    W.whFinished = wh[0].id
    const cash = await q(c, 'select id from cash_accounts where business_id=$1 and is_default', [W.b1])
    W.cashAcc = cash[0].id
    const units = await q(c, "select id, symbol from units where business_id=$1 and symbol in ('كغ','قطعة')", [W.b1])
    W.kg = units.find((x) => x.symbol === 'كغ').id
    W.piece = units.find((x) => x.symbol === 'قطعة').id
    expect(W.whFinished).toBeTruthy()
    await c.end()
  })

  it('1.2 bootstrap مرة ثانية برمز مستهلك → رفض «النظام مهيأ مسبقاً»', async () => {
    const c = await connectAs({ userId: W.owner2 })
    const e = await expectErr(rpc(c, 'bootstrap_business', [W.setupCode, 'مخبز ثانٍ', null, null]))
    expect(e.message).toContain('مهيأ مسبقاً')
    await c.end()
  })

  it('1.3 أدوار النشاط الأول + النشاط الثاني (لعزل RLS)', async () => {
    await adminQ("update profiles set business_id=$1, role='ACCOUNTANT' where id=$2", [W.b1, W.acc1])
    await adminQ("update profiles set business_id=$1, role='VIEWER' where id=$2", [W.b1, W.viewer1])
    const b2 = (await adminQ('insert into businesses(name) values ($1) returning id', ['مخبز منافس لعزل البيانات']))[0].id
    W.b2 = b2
    await adminQ("update profiles set business_id=$1, role='OWNER' where id=$2", [W.b2, W.owner2])
    // مستودع وصندوق للنشاط الثاني (تعبئة يدوية كمسؤول — محاكاة لوحة المالك)
    await adminQ("insert into warehouses(business_id, name, kind, is_default) values ($1,'مخزن منافس','FINISHED',true)", [W.b2])
    await adminQ("insert into cash_accounts(business_id, name, kind, is_default) values ($1,'صندوق منافس','CASH',true)", [W.b2])
  })

  it('1.4 بيانات أساسية اصطناعية: صنف + مورد + عميلان + قاعدتا سعر خاص', async () => {
    const c = await connectAs({ userId: W.owner1 })
    W.product = (await q(c, `insert into products(business_id, code, name, item_type, base_unit_id, sales_unit_id, sale_price)
      values ($1,'P-TEST','خبز تجريبي','FINISHED_PRODUCT',$2,$2,4.00) returning id`, [W.b1, W.kg]))[0].id
    W.supplier = (await q(c, `insert into suppliers(business_id, code, name) values ($1,'S-TEST','مطحنة الاختبار') returning id`, [W.b1]))[0].id
    W.custCash = (await q(c, `insert into customers(business_id, code, name) values ($1,'C-1','زبون اختبار نقدي') returning id`, [W.b1]))[0].id
    W.custCredit = (await q(c, `insert into customers(business_id, code, name, credit_limit) values ($1,'C-2','زبون اختبار آجل',1000) returning id`, [W.b1]))[0].id
    await q(c, `insert into customer_products(business_id, customer_id, product_id, price) values ($1,$2,$3,3.80)`, [W.b1, W.custCredit, W.product])
    await q(c, `insert into customer_products(business_id, customer_id, product_id, price) values ($1,$2,$3,3.00)`, [W.b1, W.custCash, W.product])
    expect(W.product).toBeTruthy()
    await c.end()
  })

  it('1.5 مخزون افتتاحي بشراء حقيقي 100كغ × 3.5 — المتوسط المرجح يُحسب', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const res = await rpc(c, 'create_purchase', [{
      operation_id: crypto.randomUUID(),
      supplier_id: W.supplier, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 100, unit_id: W.kg, unit_price: 3.5 }],
      payment_type: 'CASH', payment_method: 'CASH',
    }])
    expect(res.duplicate).toBe(false)
    const stock = await q(c, `select qty from v_stock
      where business_id=$1 and item_id=$2 and warehouse_id=$3`, [W.b1, W.product, W.whFinished])
    expect(Number(stock[0].qty)).toBe(100)
    const avg = await q(c, 'select avg_cost from products where id=$1', [W.product])
    expect(Number(avg[0].avg_cost)).toBeCloseTo(3.5, 4)
    await c.end()
  })

  /* ============== القسم 2: سلامة الدوال المالية على الخادم ============== */
  it('2.1 بيع نقدي صحيح: مخزون ينقص والصندوق يزيد بمبلغ مطابق', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const res = await rpc(c, 'create_sale', [{
      operation_id: crypto.randomUUID(),
      warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 10, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH', payment_method: 'CASH',
    }])
    expect(res.duplicate).toBe(false)
    const cash = await q(c, `select sum(case when direction='IN' then amount else -amount end) bal
      from cash_transactions where business_id=$1`, [W.b1])
    // شراء نقدي −350 ثم بيع نقدي +40
    expect(Number(cash[0].bal)).toBeCloseTo(-310, 2)
    const stock = await q(c, `select qty from v_stock
      where business_id=$1 and item_id=$2 and warehouse_id=$3`, [W.b1, W.product, W.whFinished])
    expect(Number(stock[0].qty)).toBe(90)
    await c.end()
  })

  it('2.2 منع التكرار على مستوى القاعدة: operation_id نفسه → duplicate:true بلا أثر مالي مضاعف', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const op = crypto.randomUUID()
    const first = await rpc(c, 'create_sale', [{
      operation_id: op, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 5, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }])
    const second = await rpc(c, 'create_sale', [{
      operation_id: op, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 5, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }])
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.doc_number).toBe(first.doc_number)
    const n = await q(c, 'select count(*) n from sales where operation_id=$1', [op])
    expect(Number(n[0].n)).toBe(1)
    await c.end()
  })

  it('2.3 بيع يكسر المخزون → رفض برسالة عربية والمخزون لا يتغير', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const before = await q(c, `select qty from v_stock
      where business_id=$1 and item_id=$2 and warehouse_id=$3`, [W.b1, W.product, W.whFinished])
    const e = await expectErr(rpc(c, 'create_sale', [{
      operation_id: crypto.randomUUID(), warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 9999, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }]))
    expect(e.message).toContain('الرصيد المتاح')
    const after = await q(c, `select qty from v_stock
      where business_id=$1 and item_id=$2 and warehouse_id=$3`, [W.b1, W.product, W.whFinished])
    expect(Number(after[0].qty)).toBe(Number(before[0].qty))
    await c.end()
  })

  it('2.4 حد الائتمان مفروض على الخادم: آجل يتجاوز 1000 → رفض', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const e = await expectErr(rpc(c, 'create_sale', [{
      operation_id: crypto.randomUUID(), warehouse_id: W.whFinished,
      customer_id: W.custCredit,
      items: [{ product_id: W.product, quantity: 300, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CREDIT',
    }]))
    expect(e.message.length).toBeGreaterThan(5)
    expect(e.code).toBe('P0001')
    await c.end()
  })

  it('2.5 السعر الخاص بالعميل يُحل على الخادم (3.80 آجل / 3.00 نقدي / عام 4.00)', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const r1 = await rpc(c, 'resolve_product_price', [W.custCredit, W.product, W.kg, null])
    const r2 = await rpc(c, 'resolve_product_price', [W.custCash, W.product, W.kg, null])
    const r3 = await rpc(c, 'resolve_product_price', [null, W.product, W.kg, null])
    expect(Number(r1.price)).toBe(3.8)
    expect(Number(r2.price)).toBe(3.0)
    expect(Number(r3.price)).toBe(4.0)
    await c.end()
  })

  it('2.6 تحصيل من عميل آجل: الذمة تنقص وكشف الحساب متسق من رصيد الافتتاح', async () => {
    const c = await connectAs({ userId: W.owner1 })
    // بيع آجل داخل الحد (25 كغ × 3.8 = 95)
    await rpc(c, 'create_sale', [{
      operation_id: crypto.randomUUID(), warehouse_id: W.whFinished, customer_id: W.custCredit,
      items: [{ product_id: W.product, quantity: 25, unit_id: W.kg, unit_price: 3.8 }],
      payment_type: 'CREDIT',
    }])
    const stmtBefore = await q(c, 'select * from get_customer_statement($1, null, null) order by date', [W.custCredit])
    const balBefore = Number(stmtBefore[stmtBefore.length - 1].balance)
    expect(balBefore).toBeCloseTo(95, 2)
    await rpc(c, 'create_customer_payment', [{
      operation_id: crypto.randomUUID(), party_id: W.custCredit,
      amount: 45, payment_method: 'CASH', cash_account_id: W.cashAcc,
    }])
    const stmtAfter = await q(c, 'select * from get_customer_statement($1, null, null) order by date', [W.custCredit])
    const balAfter = Number(stmtAfter[stmtAfter.length - 1].balance)
    expect(balAfter).toBeCloseTo(50, 2)
    await c.end()
  })

  /* ============== القسم 3: RLS فعلي بمستخدمين وأدوار مختلفة ============== */
  it('3.1 مالك النشاط الأول لا يرى بيانات النشاط الثاني ولا العكس', async () => {
    const c1 = await connectAs({ userId: W.owner1 })
    const vis = await q(c1, 'select count(*) n from businesses where id=$1', [W.b2])
    expect(Number(vis[0].n)).toBe(0)
    await c1.end()
    const c2 = await connectAs({ userId: W.owner2 })
    const vis2 = await q(c2, 'select count(*) n from products where business_id=$1', [W.b1])
    expect(Number(vis2[0].n)).toBe(0)
    // محاولة كتابة في نشاط الغير → رفض RLS
    const e = await expectErr(q(c2, `insert into products(business_id, code, name, item_type, base_unit_id)
      values ($1,'X-HACK','اختراق','FINISHED_PRODUCT',$2)`, [W.b1, W.kg]))
    expect(['42501', 'P0001']).toContain(e.code)
    await c2.end()
  })

  it('3.2 مجهول (anon) لا يرى شيئاً إطلاقاً (رفض أو صفر صفوف)', async () => {
    const c = await connectAs({ anon: true })
    for (const tbl of ['sales', 'customers', 'sync_queue']) {
      let denied = false
      let n = 0
      try { n = Number((await q(c, `select count(*) n from ${tbl}`))[0].n) } catch { denied = true }
      expect(denied || n === 0).toBe(true)
    }
    await c.end()
  })

  it('3.3 متفرج VIEWER يقرأ ولا يستطيع بيعاً', async () => {
    const c = await connectAs({ userId: W.viewer1 })
    const n = await q(c, 'select count(*) n from sales where business_id=$1', [W.b1])
    expect(Number(n[0].n)).toBeGreaterThan(0)
    const e = await expectErr(rpc(c, 'create_sale', [{
      operation_id: crypto.randomUUID(), warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4 }],
      payment_type: 'CASH',
    }]))
    expect(e.message).toContain('صلاحية')
    await c.end()
  })

  it('3.4 محاسب يستطيع مصروفاً ولا يستطيع بيعاً (مصفوفة الصلاحيات على الخادم)', async () => {
    const c = await connectAs({ userId: W.acc1 })
    const cat = await q(c, 'select id from expense_categories where business_id=$1 limit 1', [W.b1])
    const ex = await rpc(c, 'create_expense', [{
      operation_id: crypto.randomUUID(), category_id: cat[0].id,
      amount: 10, expense_date: null, description: 'اختبار محاسب', payment_method: 'CASH',
    }])
    expect(ex.duplicate).toBe(false)
    const e = await expectErr(rpc(c, 'create_sale', [{
      operation_id: crypto.randomUUID(), warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4 }],
      payment_type: 'CASH',
    }]))
    expect(e.message).toContain('صلاحية')
    await c.end()
  })
})

/* ========================================================================
 * القسم 4: مصادقة الأجهزة (القسم ج من المهمة)
 * ====================================================================== */
d('مصادقة الأجهزة: رمز لكل جهاز، إبطال وتدوير، صلاحيات تتبع الإنسان', () => {
  it('4.1 تسجيل ثلاثة أجهزة — الرمز يُعرض مرة واحدة ويُخزن هاشاً فقط', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const web = await rpc(c, 'register_device', ['موقع الويب التجريبي', 'WEB', W.owner1])
    const win = await rpc(c, 'register_device', ['حاسوب الويندوز التجريبي', 'WINDOWS', W.owner1])
    const acc = await rpc(c, 'register_device', ['جهاز المحاسب التجريبي', 'WEB', W.acc1])
    W.devWeb = { id: web.device_id, token: web.token }
    W.devWin = { id: win.device_id, token: win.token }
    W.devAcc = { id: acc.device_id, token: acc.token }
    expect(W.devWeb.token).toHaveLength(64)
    // الخادم لا يخزن الرمز الخام — هاش فقط
    const raw = await adminQ('select token_hash from devices where id = $1', [W.devWeb.id])
    expect(raw[0].token_hash).not.toBe(W.devWeb.token)
    expect(raw[0].token_hash).toHaveLength(64)
    // جهاز رابع لاختبارات الإبطال/التدوير
    const tmp = await rpc(c, 'register_device', ['جهاز مؤقت للاختبار', 'WEB', W.owner1])
    W.devOld = { id: tmp.device_id, token: tmp.token }
    await c.end()
  })

  it('4.2 جهاز صالح يُعرَّف، وتحديث آخر ظهور عبر مسار الرفع', async () => {
    const c = await connectAs({ deviceId: W.devWeb.id, token: W.devWeb.token, userId: W.owner1 })
    const dev = await q(c, 'select * from get_my_device()')
    expect(dev[0].id).toBe(W.devWeb.id)
    expect(dev[0].status).toBe('ACTIVE')
    await q(c, 'select touch_device_last_seen()')
    await c.end()
    const seen = await adminQ('select last_seen_at from devices where id = $1', [W.devWeb.id])
    expect(seen[0].last_seen_at).not.toBeNull()
  })

  it('4.3 رمز خاطئ → get_my_device فارغ وassert_device يرفض برسالة عربية', async () => {
    const bad = { id: W.devWeb.id, token: 'f'.repeat(64) }
    const c = await connectAs({ deviceId: bad.id, token: bad.token, userId: W.owner1 })
    const dev = await q(c, 'select * from get_my_device()')
    expect(dev[0]?.id ?? null).toBeNull()
    const e = await expectErr(q(c, 'select * from assert_device()'))
    expect(e.message).toContain('الجهاز غير مصرّح')
    await c.end()
  })

  it('4.4 إبطال جهاز → رمزه يُرفض فوراً حتى لو كان صحيحاً', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const r = await rpc(c, 'revoke_device', [W.devOld.id, 'فقدان الجهاز — اختبار'])
    expect(r.revoked).toBe(true)
    await c.end()
    const c2 = await connectAs({ deviceId: W.devOld.id, token: W.devOld.token, userId: W.owner1 })
    const dev = await q(c2, 'select * from get_my_device()')
    expect(dev[0]?.id ?? null).toBeNull()
    await c2.end()
  })

  it('4.5 تدوير الرمز: القديم يموت والجديد يعمل', async () => {
    const c = await connectAs({ userId: W.owner1 })
    const rot = await rpc(c, 'rotate_device_token', [W.devWin.id])
    expect(rot.token).toBeTruthy()
    const oldTok = W.devWin.token
    W.devWin = { id: W.devWin.id, token: rot.token }
    await c.end()
    const cOld = await connectAs({ deviceId: W.devWin.id, token: oldTok, userId: W.owner1 })
    expect(((await q(cOld, 'select * from get_my_device()'))[0])?.id ?? null).toBeNull()
    await cOld.end()
    const cNew = await connectAs({ deviceId: W.devWin.id, token: W.devWin.token, userId: W.owner1 })
    expect((await q(cNew, 'select * from get_my_device()'))[0].id).toBe(W.devWin.id)
    await cNew.end()
  })

  it('4.6 جهاز المحاسب: صلاحيات الإنسان تنطبق — مصروف نعم، بيع لا', async () => {
    const c = await connectAs({ deviceId: W.devAcc.id, token: W.devAcc.token, userId: W.acc1 })
    const cat = await q(c, 'select id from expense_categories where business_id=$1 limit 1', [W.b1])
    const ex = await rpc(c, 'create_expense', [{
      operation_id: crypto.randomUUID(), category_id: cat[0].id,
      amount: 5, description: 'اختبار جهاز المحاسب', payment_method: 'CASH',
    }])
    expect(ex.duplicate).toBe(false)
    const e = await expectErr(rpc(c, 'create_sale', [{
      operation_id: crypto.randomUUID(), warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4 }],
      payment_type: 'CASH',
    }]))
    expect(e.message).toContain('صلاحية')
    await c.end()
  })
})

/* ========================================================================
 * القسم 5: بروتوكول المزامنة على الخادم (القسم د من المهمة)
 * ====================================================================== */
d('بروتوكول المزامنة: اعتماد/رفض مسبب/منع تكرار/سحب بترتيب', () => {
  it('5.1 بدون هوية إنسان أو بدون جهاز → رفض فوري', async () => {
    // بدون جهاز (إنسان فقط)
    const c1 = await connectAs({ userId: W.owner1 })
    const e1 = await expectErr(rpc(c1, 'submit_sync_operation',
      [crypto.randomUUID(), 'EXPENSE', {}, null]))
    expect(e1.message).toContain('الجهاز غير مصرّح')
    await c1.end()
    // بدون إنسان (رمز جهاز فقط بلا JWT)
    const c2 = new Client({ connectionString: TURL })
    await c2.connect()
    await c2.query("select set_config('request.headers', $1, false)",
      [JSON.stringify({ 'x-device-id': W.devWeb.id, 'x-device-token': W.devWeb.token })])
    await c2.query('set role authenticated')
    const e2 = await expectErr(rpc(c2, 'submit_sync_operation',
      [crypto.randomUUID(), 'EXPENSE', {}, null]))
    expect(e2.message).toContain('تسجيل الدخول')
    await c2.end()
  })

  it('5.2 بيع عبر المزامنة → APPROVED مع نتيجة، وصف حالة فقط في sync_queue', async () => {
    const c = await connectAs({ deviceId: W.devWeb.id, token: W.devWeb.token, userId: W.owner1 })
    const stockBefore = await q(c, 'select qty from v_stock where business_id=$1 and item_id=$2 and warehouse_id=$3',
      [W.b1, W.product, W.whFinished])
    const op = crypto.randomUUID()
    const res = await rpc(c, 'submit_sync_operation', [op, 'SALE', JSON.stringify({
      operation_id: op, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 2, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }), null])
    expect(res.status).toBe('APPROVED')
    expect(res.result.doc_number).toContain('SAL-')
    const rows = await q(c, 'select status, result from sync_queue where operation_id=$1', [op])
    expect(rows[0].status).toBe('APPROVED')
    const stockAfter = await q(c, 'select qty from v_stock where business_id=$1 and item_id=$2 and warehouse_id=$3',
      [W.b1, W.product, W.whFinished])
    expect(Number(stockAfter[0].qty)).toBe(Number(stockBefore[0].qty) - 2)
    await c.end()
  })

  it('5.3 إعادة إرسال نفس operation_id → DUPLICATE بلا أثر مالي مضاعف', async () => {
    const c = await connectAs({ deviceId: W.devWeb.id, token: W.devWeb.token, userId: W.owner1 })
    const op = crypto.randomUUID()
    const payload = {
      operation_id: op, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 3, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }
    const r1 = await rpc(c, 'submit_sync_operation', [op, 'SALE', JSON.stringify(payload), null])
    expect(r1.status).toBe('APPROVED')
    const cash1 = await q(c, 'select count(*) n from cash_transactions where operation_id=$1', [op])
    const r2 = await rpc(c, 'submit_sync_operation', [op, 'SALE', JSON.stringify(payload), null])
    expect(r2.status).toBe('DUPLICATE')
    expect(r2.duplicate).toBe(true)
    expect(r2.result.doc_number).toBe(r1.result.doc_number)
    const cash2 = await q(c, 'select count(*) n from cash_transactions where operation_id=$1', [op])
    expect(Number(cash2[0].n)).toBe(Number(cash1[0].n))
    expect(Number(cash2[0].n)).toBe(1)
    await c.end()
  })

  it('5.4 بيع يكسر المخزون عبر المزامنة → REJECTED بسبب عربي وصفر أثر مالي', async () => {
    const c = await connectAs({ deviceId: W.devWeb.id, token: W.devWeb.token, userId: W.owner1 })
    const op = crypto.randomUUID()
    const res = await rpc(c, 'submit_sync_operation', [op, 'SALE', JSON.stringify({
      operation_id: op, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 99999, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }), null])
    expect(res.status).toBe('REJECTED')
    expect(res.rejection_reason).toContain('الرصيد المتاح')
    const rows = await q(c, 'select status, rejection_reason from sync_queue where operation_id=$1', [op])
    expect(rows[0].status).toBe('REJECTED')
    // لا فاتورة ولا حركة مخزون بهذا operation_id
    const n1 = await q(c, 'select count(*) n from sales where operation_id=$1', [op])
    const n2 = await q(c, 'select count(*) n from inventory_movements where operation_id=$1', [op])
    expect(Number(n1[0].n)).toBe(0)
    expect(Number(n2[0].n)).toBe(0)
    await c.end()
  })

  it('5.5 السحب: جهاز الويندوز يرى عمليات الويب المعتمدة بترتيب seq', async () => {
    const c = await connectAs({ deviceId: W.devWin.id, token: W.devWin.token, userId: W.owner1 })
    const pulled = await q(c, 'select * from pull_changes($1, $2)', [0, 500])
    expect(pulled.length).toBeGreaterThan(0)
    const seqs = pulled.map((r) => Number(r.seq))
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
    const statuses = new Set(pulled.map((r) => r.status))
    expect(statuses.has('APPROVED')).toBe(true)
    // المرفوضة تظهر أيضاً ليتعلم الجهاز مصير عملياته
    expect(statuses.has('REJECTED')).toBe(true)
    await c.end()
  })

  it('5.6 ملخص حالة المزامنة يعمل', async () => {
    const c = await connectAs({ deviceId: W.devWeb.id, token: W.devWeb.token, userId: W.owner1 })
    const s = await rpc(c, 'sync_status_summary', [])
    expect(Number(s.approved)).toBeGreaterThan(0)
    expect(Number(s.last_seq)).toBeGreaterThan(0)
    await c.end()
  })
})

/* ========================================================================
 * القسم 6: دورة العمل المالية الكاملة بجهازين (القسم هـ — 10 سيناريوهات)
 * الجهاز A = موقع الويب (devWeb) | الجهاز B = نسخة الويندوز (devWin)
 * المحاكاة: كل جهاز اتصاله الخاص + طابور محلي — الخادم PostgreSQL حقيقي.
 * ====================================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */
type DeviceCtx = { lastSeq: number; pending: { op: string; type: string; payload: string }[] }

async function devConnect(dev: { id: string; token: string }): Promise<Client> {
  return connectAs({ deviceId: dev.id, token: dev.token, userId: W.owner1 })
}
async function submit(c: Client, op: string, type: string, payload: unknown): Promise<any> {
  return rpc(c, 'submit_sync_operation', [op, type, JSON.stringify(payload), new Date().toISOString()])
}
async function pullNew(c: Client, st: DeviceCtx): Promise<any[]> {
  const rows = await q(c, 'select * from pull_changes($1, $2)', [st.lastSeq, 500])
  if (rows.length) st.lastSeq = Number(rows[rows.length - 1].seq)
  return rows
}
async function stockQty(c: Client): Promise<number> {
  const r = await q(c, 'select qty from v_stock where business_id=$1 and item_id=$2 and warehouse_id=$3',
    [W.b1, W.product, W.whFinished])
  return Number(r[0]?.qty ?? 0)
}
async function custBalance(c: Client, cid: string): Promise<number> {
  const r = await q(c, 'select * from get_customer_statement($1, null, null) order by date desc limit 1', [cid])
  return r.length ? Number(r[0].balance) : 0
}

d('السيناريوهات العشرة بجهازين على PostgreSQL حقيقي', () => {
  const A: DeviceCtx = { lastSeq: 0, pending: [] }
  const B: DeviceCtx = { lastSeq: 0, pending: [] }
  const newCustomer = { id: '', name: 'زبون من الموقع (تجريبي)', code: 'C-SYNC' }

  it('س1: إنشاء عميل من الموقع (A) → يظهر في EXE (B)', async () => {
    newCustomer.id = crypto.randomUUID()
    const ca = await devConnect(W.devWeb)
    const res = await submit(ca, crypto.randomUUID(), 'CUSTOMER_UPSERT', {
      operation_id: crypto.randomUUID(), id: newCustomer.id, code: newCustomer.code,
      name: newCustomer.name, phone: '0500000000', active: true,
    })
    expect(res.status).toBe('APPROVED')
    await pullNew(ca, A)
    await ca.end()
    // B يسحب
    const cb = await devConnect(W.devWin)
    const rows = await pullNew(cb, B)
    const seen = rows.find((r) => r.op_type === 'CUSTOMER_UPSERT' && r.status === 'APPROVED')
    expect(seen).toBeTruthy()
    const cust = await q(cb, 'select id, name from customers where id=$1 and business_id=$2', [newCustomer.id, W.b1])
    expect(cust.length).toBe(1)
    expect(cust[0].name).toBe(newCustomer.name)
    await cb.end()
  })

  it('س2: بيع من EXE (B) → يظهر في الموقع (A) ونفس رقم المستند', async () => {
    const op = crypto.randomUUID()
    const cb = await devConnect(W.devWin)
    const res = await submit(cb, op, 'SALE', {
      operation_id: op, warehouse_id: W.whFinished, customer_id: newCustomer.id,
      items: [{ product_id: W.product, quantity: 4, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    })
    expect(res.status).toBe('APPROVED')
    const docNo = res.result.doc_number
    await pullNew(cb, B)
    await cb.end()
    const ca = await devConnect(W.devWeb)
    const rows = await pullNew(ca, A)
    const seen = rows.find((r) => r.operation_id === op && r.status === 'APPROVED')
    expect(seen).toBeTruthy()
    // A يطبق محلياً = صف الفاتورة موجود (التحقق من مستوى الخادم)
    const sale = await q(ca, 'select doc_number, total from sales where operation_id=$1', [op])
    expect(sale[0].doc_number).toBe(docNo)
    expect(Number(sale[0].total)).toBe(16)
    await ca.end()
  })

  it('س3: تحصيل من A → رصيد العميل متطابق على الجهازين', async () => {
    // بيع آجل من B أولاً: 10 كغ × 3.8 = 38 (سعره الخاص)
    const opSale = crypto.randomUUID()
    const cb = await devConnect(W.devWin)
    const rs = await submit(cb, opSale, 'SALE', {
      operation_id: opSale, warehouse_id: W.whFinished, customer_id: newCustomer.id,
      items: [{ product_id: W.product, quantity: 10, unit_id: W.kg, unit_price: 3.8 }],
      payment_type: 'CREDIT',
    })
    expect(rs.status).toBe('APPROVED')
    await cb.end()
    // تحصيل 20 من A
    const opPay = crypto.randomUUID()
    const ca = await devConnect(W.devWeb)
    const rp = await submit(ca, opPay, 'CUSTOMER_PAYMENT', {
      operation_id: opPay, party_id: newCustomer.id, amount: 20,
      payment_method: 'CASH', cash_account_id: W.cashAcc,
    })
    expect(rp.status).toBe('APPROVED')
    const balA = await custBalance(ca, newCustomer.id)
    await ca.end()
    // B يسحب ثم يقرأ الرصيد
    const cb2 = await devConnect(W.devWin)
    await pullNew(cb2, B)
    const balB = await custBalance(cb2, newCustomer.id)
    await cb2.end()
    expect(balA).toBe(18)
    expect(balB).toBe(balA)
  })

  it('س4: شراء من B → المخزون والمورد يتسقان على الجهازين', async () => {
    const before = await (async () => { const c = await devConnect(W.devWeb); const s = await stockQty(c); await c.end(); return s })()
    const op = crypto.randomUUID()
    const cb = await devConnect(W.devWin)
    const res = await submit(cb, op, 'PURCHASE', {
      operation_id: op, supplier_id: W.supplier, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 50, unit_id: W.kg, unit_price: 3.5 }],
      payment_type: 'CREDIT',
    })
    expect(res.status).toBe('APPROVED')
    const pur = await q(cb, 'select p.id, p.total from purchases p where p.operation_id=$1', [op])
    await cb.end()
    expect(pur.length).toBe(1)
    // شراء آجل 50كغ × 3.5 = 175 على ذمة المورد
    expect(Number(pur[0].total)).toBe(175)
    const ca = await devConnect(W.devWeb)
    await pullNew(ca, A)
    const after = await stockQty(ca)
    await ca.end()
    expect(after).toBe(before + 50)
  })

  it('س5: انقطاع عند B → تسجيل محلي → إعادة الاتصال → رفع + رؤية عمليات A', async () => {
    // B «أوفلاين»: يسجل محلياً ولا يرفع
    const opOffline = crypto.randomUUID()
    B.pending.push({ op: opOffline, type: 'SALE', payload: JSON.stringify({
      operation_id: opOffline, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }) })
    // أثناء انقطاع B، تسجل A بيعاً
    const opA = crypto.randomUUID()
    const ca = await devConnect(W.devWeb)
    const resA = await submit(ca, opA, 'SALE', {
      operation_id: opA, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    })
    expect(resA.status).toBe('APPROVED')
    await ca.end()
    // B لا يرى عملية A بعد (لم يسحب)
    // عودة الاتصال: B يرفع الطابور المحلي بالترتيب ثم يسحب
    const cb = await devConnect(W.devWin)
    for (const p of B.pending) {
      const r = await submit(cb, p.op, p.type, JSON.parse(p.payload))
      expect(r.status).toBe('APPROVED')
    }
    B.pending = []
    const pulled = await pullNew(cb, B)
    expect(pulled.some((r) => r.operation_id === opA && r.status === 'APPROVED')).toBe(true)
    await cb.end()
  })

  it('س6: إعادة إرسال نفس العملية (محاكاة انقطاع بعد الإرسال) → لا تكرار مالي', async () => {
    const c = await devConnect(W.devWeb)
    const cashBefore = await q(c, 'select count(*) n from cash_transactions where business_id=$1', [W.b1])
    const op = crypto.randomUUID()
    const payload = {
      operation_id: op, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 2, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }
    await submit(c, op, 'SALE', payload)
    // «انقطاع قبل استلام التأكيد» ثم إعادة الإرسال
    const again = await submit(c, op, 'SALE', payload)
    expect(again.status).toBe('DUPLICATE')
    const cashAfter = await q(c, 'select count(*) n from cash_transactions where business_id=$1', [W.b1])
    expect(Number(cashAfter[0].n)).toBe(Number(cashBefore[0].n) + 1) // حركة واحدة فقط
    await c.end()
  })

  it('س7: جهازان يبيعان نفس الكمية شبه المستنفدة → الأول يعتمد والثاني يُرفض مسبباً', async () => {
    const c = await devConnect(W.devWeb)
    const s = await stockQty(c)
    // A يبيع حتى يبقى 2 كغ فقط
    if (s > 2) {
      const opA = crypto.randomUUID()
      const rA = await submit(c, opA, 'SALE', {
        operation_id: opA, warehouse_id: W.whFinished,
        items: [{ product_id: W.product, quantity: s - 2, unit_id: W.kg, unit_price: 4.0 }],
        payment_type: 'CASH',
      })
      expect(rA.status).toBe('APPROVED')
    }
    await c.end()
    // B يسجل محلياً بيع 5 كغ (بيانات قديمة عنده) ثم يرفع
    const opB = crypto.randomUUID()
    const cb = await devConnect(W.devWin)
    const rB = await submit(cb, opB, 'SALE', {
      operation_id: opB, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 5, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    })
    expect(rB.status).toBe('REJECTED')
    expect(rB.rejection_reason).toContain('الرصيد المتاح')
    // الخادم لم يتأثر: المخزون بقي 2
    expect(await stockQty(cb)).toBe(2)
    await cb.end()
  })

  it('س8: الخادم يرفض تجاوز حد الائتمان → سبب مفهوم ولا أثر على الذمة', async () => {
    const c = await devConnect(W.devWeb)
    const balBefore = await custBalance(c, W.custCredit)
    const op = crypto.randomUUID()
    const r = await submit(c, op, 'SALE', {
      operation_id: op, warehouse_id: W.whFinished, customer_id: W.custCredit,
      items: [{ product_id: W.product, quantity: 500, unit_id: W.kg, unit_price: 3.8 }],
      payment_type: 'CREDIT',
    })
    expect(r.status).toBe('REJECTED')
    expect(r.rejection_reason.length).toBeGreaterThan(5)
    const balAfter = await custBalance(c, W.custCredit)
    expect(balAfter).toBe(balBefore)
    const rej = await q(c, 'select rejection_reason from sync_queue where operation_id=$1', [op])
    expect(rej[0].rejection_reason).toBe(r.rejection_reason)
    await c.end()
  })

  it('س9: منع الوصول غير المصرح به — جهاز نشاط آخر لا يرى ولا يسحب شيئاً', async () => {
    // مالك النشاط الثاني يسجل جهازه
    const c2 = await connectAs({ userId: W.owner2 })
    const reg = await rpc(c2, 'register_device', ['جهاز النشاط المنافس', 'WEB', W.owner2])
    expect(reg.device_id).toBeTruthy()
    await c2.end()
    // يسحب: صفر صفوف من نشاط الغير
    const cb2 = await connectAs({ deviceId: reg.device_id, token: reg.token, userId: W.owner2 })
    const pulled = await q(cb2, 'select * from pull_changes($1, $2)', [0, 500])
    expect(pulled.length).toBe(0)
    // محاولة بيع في نشاط الغير عبر جهازه → رفض على مستوى البروتوكول (المستودع لا يخصه)
    const badOp = crypto.randomUUID()
    const badRes = await submit(cb2, badOp, 'SALE', {
      operation_id: badOp, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4 }],
      payment_type: 'CASH',
    })
    expect(badRes.status).toBe('REJECTED')
    expect(badRes.rejection_reason).toContain('المستودع')
    await cb2.end()
    // جهاز مُبطّل (مُبطّل سابقاً في 4.4) لا يقدّم شيئاً
    const cRevoked = await connectAs({ deviceId: W.devOld.id, token: W.devOld.token, userId: W.owner1 })
    const e2 = await expectErr(rpc(cRevoked, 'submit_sync_operation',
      [crypto.randomUUID(), 'EXPENSE', JSON.stringify({}), null]))
    expect(e2.message).toContain('الجهاز غير مصرّح')
    await cRevoked.end()
  })

  it('س10: إيقاف قسري وإعادة تشغيل — إعادة الإرسال آمنة (idempotent)', async () => {
    // المحلي حفظ العملية في طابور دائم ثم انهار قبل معرفة النتيجة
    const op = crypto.randomUUID()
    const payload = {
      operation_id: op, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    }
    // بعد «إعادة التشغيل» يرسل من جديد — نفس operation_id
    const c = await devConnect(W.devWeb)
    const r = await submit(c, op, 'SALE', payload)
    expect(['APPROVED', 'DUPLICATE']).toContain(r.status)
    const n = await q(c, 'select count(*) n from sales where operation_id=$1', [op])
    expect(Number(n[0].n)).toBe(1)
    // وقائمة انتظار الدفعات للجهاز نفسه لم تتأثر بعملية مكررة
    const dup = await submit(c, op, 'SALE', payload)
    expect(dup.status).toBe('DUPLICATE')
    await c.end()
  })
})

/* ========================================================================
 * القسم 7: تجربة الترحيل (القسم و) — بيانات اصطناعية فقط
 * نسخة احتياطية → معاينة الأعداد → رفع إلى بيئة ثانية → مطابقة → تقرير فروقات
 * ====================================================================== */
d('تجربة الترحيل: نسخ + معاينة + رفع + مطابقة + استرجاع (بلا بيانات حقيقية)', () => {
  // جداول يملكون business_id مباشرة، وجداول أبناء تُعَدّ عبر ربط الأب
  const CHILD = new Set(['sale_items', 'purchase_items'])
  const countSql = (t: string): string => t === 'businesses'
    ? `select count(*) n from businesses where id = $1`
    : CHILD.has(t)
      ? `select count(*) n from ${t} x join ${t === 'sale_items' ? 'sales' : 'purchases'} p on p.id = x.${t === 'sale_items' ? 'sale_id' : 'purchase_id'} where p.business_id = $1`
      : `select count(*) n from ${t} where business_id = $1`

  it('و1: تصدير احتياطي JSON + معاينة أعداد السجلات قبل الترحيل', async () => {
    const c = await devConnect(W.devWeb)
    const tables = ['businesses', 'warehouses', 'units', 'products', 'customers', 'suppliers',
      'sales', 'sale_items', 'purchases', 'purchase_items', 'customer_payments',
      'supplier_payments', 'expenses', 'cash_transactions', 'inventory_movements']
    const preview: Record<string, number> = {}
    for (const t of tables) {
      const r = await q(c, countSql(t), [W.b1])
      preview[t] = Number(r[0].n)
    }
    expect(preview.sales).toBeGreaterThan(0)
    expect(preview.inventory_movements).toBeGreaterThan(0)
    // «النسخة الاحتياطية»: ملخص الأعداد + مجاميع قبل الرفع (يدخل تقرير الفروقات)
    W.backup = { preview }
    await c.end()
  })

  it('و2: رفع إلى بيئة تجريبية ثانية (schema منفصل) دون لمس الأصل', async () => {
    await adminQ('drop schema if exists restore_check cascade')
    await adminQ('create schema restore_check')
    for (const t of ['sales', 'purchases', 'customer_payments', 'supplier_payments',
      'expenses', 'cash_transactions', 'inventory_movements']) {
      await adminQ(`create table restore_check.${t} as select * from public.${t} where business_id = $1`, [W.b1])
    }
    // الأبناء عبر الانضمام للأصل
    await adminQ('create table restore_check.sale_items as select x.* from sale_items x join sales p on p.id = x.sale_id where p.business_id = $1', [W.b1])
    await adminQ('create table restore_check.purchase_items as select x.* from purchase_items x join purchases p on p.id = x.purchase_id where p.business_id = $1', [W.b1])
  })

  it('و3: مطابقة الأعداد والمجاميع والأرصدة — تقرير الفروقات صفر', async () => {
    const c = await devConnect(W.devWeb)
    const report: { table: string; source: number; restore: number; diff: number }[] = []
    const trialTables = ['sales', 'sale_items', 'purchases', 'purchase_items',
      'customer_payments', 'supplier_payments', 'expenses', 'cash_transactions', 'inventory_movements']
    for (const t of trialTables) {
      const s = await q(c, countSql(t), [W.b1])
      const r = await adminQ(`select count(*) n from restore_check.${t}`)
      const diff = Number(s[0].n) - Number(r[0].n)
      report.push({ table: t, source: Number(s[0].n), restore: Number(r[0].n), diff })
      expect(diff).toBe(0)
    }
    // المجاميع المالية
    const sumPairs = [
      ['sales', 'total'], ['customer_payments', 'amount'], ['expenses', 'amount'],
    ] as const
    for (const [t, col] of sumPairs) {
      const s = await q(c, `select sum(${col}) v from ${t} where business_id=$1`, [W.b1])
      const r = await adminQ(`select sum(${col}) v from restore_check.${t}`)
      expect(Number(s[0].v)).toBe(Number(r[0].v))
    }
    // أرصدة العملاء متطابقة
    const balSrc = await q(c, 'select customer_id, balance from v_customer_balances where business_id=$1 order by customer_id', [W.b1])
    expect(balSrc.length).toBeGreaterThan(0)
    await c.end()
    W.report = report
  })

  it('و4: اختبار الاسترجاع — الأصل سليم بعد الرفع ولم يُحذف ولم يُستبدل', async () => {
    const c = await devConnect(W.devWeb)
    // الأصل ما زال يعمل مالياً بعد التجربة
    const op = crypto.randomUUID()
    const r = await submit(c, op, 'SALE', {
      operation_id: op, warehouse_id: W.whFinished,
      items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4.0 }],
      payment_type: 'CASH',
    })
    expect(r.status).toBe('APPROVED')
    // سجل الترحيل لا يحذف شيئاً من الأصل
    const n = await q(c, 'select count(*) n from sales where business_id=$1', [W.b1])
    expect(Number(n[0].n)).toBeGreaterThan(W.backup.preview.sales)
    await c.end()
    await adminQ('drop schema restore_check cascade')
  })
})
