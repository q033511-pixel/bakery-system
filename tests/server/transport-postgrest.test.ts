/* ============================================================================
 * اختبارات طبقة النقل الحقيقية — ناقل التطبيق (supabaseTransport.ts) أمام
 * PostgREST 12 حقيقي (نفس محرك الـAPI الذي يشغله Supabase السحابي) عبر بوابة
 * /rest/v1 — كل حركة جهاز هنا HTTP فعلي: ترويسات JWT + هوية الجهاز + RLS.
 * ---------------------------------------------------------------------------
 * تشترط: TEST_DATABASE_URL (تهيئة عالم الاختبار) + POSTGREST_URL (البوابة).
 * بدون POSTGREST_URL تُتخطى تلقائياً (لا فشل وهمي — التخطي موثق صراحة).
 * بيانات اصطناعية بالكامل (نشاط «مخبز طبقة النقل») — صفر بيانات زبون حقيقية.
 * ========================================================================== */
import { describe, expect, it, beforeAll } from 'vitest'
import { Client } from 'pg'
import crypto from 'node:crypto'
import { createSupabaseTransport } from '@/lib/sync/supabaseTransport'
import { syncOnce, createMemoryStore, type PendingOp, type ServerOp } from '@/lib/sync/engine'

const TURL = process.env.TEST_DATABASE_URL ?? ''
const PURL = process.env.POSTGREST_URL ?? ''
const SECRET = process.env.TEST_JWT_SECRET ?? ''
const hasRig = TURL.length > 0 && PURL.length > 0 && SECRET.length > 0
const d = hasRig ? describe : describe.skip

/* ---------- موقّع JWT (HS256) بأدوات node القياسية — بلا تبعيات جديدة ---------- */
function b64u(b: Buffer): string {
  return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function jwt(payload: Record<string, unknown>, secret: string): string {
  const h = b64u(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const p = b64u(Buffer.from(JSON.stringify(payload)))
  const sig = b64u(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())
  return `${h}.${p}.${sig}`
}
const claims = (userId?: string, role = 'authenticated') =>
  jwt({ sub: userId ?? undefined, role, aud: 'authenticated' }, SECRET)

/* ---------- نداء RPC خام عبر البوابة (نفس شكل روابط Supabase) ---------- */
async function rpcCall(fn: string, body: unknown, opts: { userId?: string; token?: { deviceId: string; token: string } } = {}): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${PURL}/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: 'local-test',
      Authorization: `Bearer ${claims(opts.userId)}`,
      ...(opts.token ? { 'x-device-id': opts.token.deviceId, 'x-device-token': opts.token.token } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}

/* ---------- ناقل حقيقي لجهاز معيّن (الوحدة قيد الاختبار نفسها) ---------- */
function transportFor(dev: { deviceId: string; token: string }, userId: string) {
  return createSupabaseTransport({
    url: PURL.replace(/\/rest\/v1\/?$/, ''),
    anonKey: 'local-test',
    accessToken: () => claims(userId),
    deviceId: dev.deviceId,
    deviceToken: dev.token,
  })
}

type Row = Record<string, unknown>
async function adminQ(sql: string, params: unknown[] = []): Promise<Row[]> {
  const c = new Client({ connectionString: TURL })
  await c.connect()
  try { return (await c.query(sql, params)).rows } finally { await c.end() }
}

/* ---------- عالم الاختبار ---------- */
const W = {
  owner: '', viewer: '', owner2: '',
  b1: '', b2: '', wh: '', cash: '', kg: '', product: '', supplier: '',
  web: { deviceId: '', token: '' },
  win: { deviceId: '', token: '' },
  viewerDev: { deviceId: '', token: '' },
  old: { deviceId: '', token: '' },
  b2dev: { deviceId: '', token: '' },
}

d('طبقة النقل الحقيقية: ناقل التطبيق ← بوابة /rest/v1 ← PostgREST 12 ← PostgreSQL 17', () => {
  beforeAll(async () => {
    // عالم معزول بإنشاء مسؤول مباشر (رمز التهيئة يُستهلك من suite الخادم — محاكاة نشاط قائم)
    const u = async (email: string): Promise<string> =>
      (await adminQ('insert into auth.users(id, email) values (gen_random_uuid(), $1) returning id', [email]))[0].id as string
    W.owner = await u('tp-owner@test-rig.local')
    W.viewer = await u('tp-viewer@test-rig.local')
    W.owner2 = await u('tp-owner2@test-rig.local')
    W.b1 = (await adminQ('insert into businesses(name) values ($1) returning id', ['مخبز طبقة النقل (تجريبي)']))[0].id as string
    W.wh = (await adminQ("insert into warehouses(business_id, name, kind, is_default) values ($1,'مخزن النقل','FINISHED',true) returning id", [W.b1]))[0].id as string
    W.cash = (await adminQ("insert into cash_accounts(business_id, name, kind, is_default) values ($1,'صندوق النقل','CASH',true) returning id", [W.b1]))[0].id as string
    // profiles تُنشأ آلياً بمُشغّل على auth.users — نحدّثها إلى أدوار العالم
    await adminQ("update profiles set business_id=$2, role='OWNER', full_name='مالك النقل', active=true where id=$1", [W.owner, W.b1])
    await adminQ("update profiles set business_id=$2, role='VIEWER', full_name='مطالع النقل', active=true where id=$1", [W.viewer, W.b1])
    W.kg = (await adminQ("insert into units(business_id, name, symbol) values ($1,'كيلو غرام','كغ') returning id", [W.b1]))[0].id as string
    W.product = (await adminQ(`insert into products(business_id, code, name, item_type, base_unit_id, sales_unit_id, sale_price)
      values ($1,'TP-1','خبز طبقة النقل','FINISHED_PRODUCT',$2,$2,4.00) returning id`, [W.b1, W.kg]))[0].id as string
    W.supplier = (await adminQ("insert into suppliers(business_id, code, name) values ($1,'TS-1','مطحنة طبقة النقل') returning id", [W.b1]))[0].id as string
    // نشاط ثانٍ معلَم للجهاز B2 (عزل RLS عبر HTTP)
    W.b2 = (await adminQ('insert into businesses(name) values ($1) returning id', ['مخبز منافس للنقل']))[0].id as string
    await adminQ("update profiles set business_id=$2, role='OWNER', full_name='مالك المنافس', active=true where id=$1", [W.owner2, W.b2])
    await adminQ("insert into warehouses(business_id, name, kind, is_default) values ($1,'مخزن منافس','FINISHED',true)", [W.b2])
  }, 30000)

  it('RP-1 تسجيل جهازين عبر HTTP برمز يُعرض مرة واحدة — والرمز لا يُخزن إلا هاشاً', async () => {
    for (const [key, name, uid] of [['web', 'موقع التجربة', W.owner], ['win', 'ويندوز التجربة', W.owner]] as const) {
      const { status, json } = await rpcCall('register_device', { p_name: name, p_platform: key === 'web' ? 'WEB' : 'WINDOWS', p_profile_id: uid }, { userId: W.owner })
      expect(status).toBe(200)
      const r = json as { device_id: string; token: string }
      expect(r.device_id).toBeTruthy()
      expect(r.token).toMatch(/^[0-9a-f]{64}$/)
      W[key].deviceId = r.device_id
      W[key].token = r.token
    }
    // لا رمز صريح في القاعدة — هاش فقط
    const rows = await adminQ('select token_hash from devices where business_id=$1', [W.b1])
    expect(rows.length).toBe(2)
    const anyPlain = rows.some((r) => String(r.token_hash) === W.web.token || String(r.token_hash) === W.win.token)
    expect(anyPlain).toBe(false)
  })

  it('RP-2 رفع عملية عبر الناقل الحقيقي → APPROVED والصف موجود في القاعدة', async () => {
    const t = transportFor(W.web, W.owner)
    const op: PendingOp = {
      operation_id: crypto.randomUUID(), op_type: 'CUSTOMER_UPSERT',
      payload: { operation_id: '', id: crypto.randomUUID(), code: 'TP-C1', name: 'زبون من طبقة النقل', active: true },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    }
    ;(op.payload as { operation_id: string }).operation_id = op.operation_id
    const res = await t.submit(op)
    expect(res.status).toBe('APPROVED')
    const rows = await adminQ('select id, name from customers where business_id=$1 and code=$2', [W.b1, 'TP-C1'])
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe('زبون من طبقة النقل')
  })

  it('RP-3 إعادة إرسال operation_id نفسه عبر HTTP → DUPLICATE بلا تكرار مالي', async () => {
    const t = transportFor(W.win, W.owner)
    const oid = crypto.randomUUID()
    const payload = {
      operation_id: oid, supplier_id: W.supplier, warehouse_id: W.wh,
      items: [{ product_id: W.product, quantity: 100, unit_id: W.kg, unit_price: 3.5 }],
      payment_type: 'CASH', payment_method: 'CASH',
    }
    const first = await t.submit({ operation_id: oid, op_type: 'PURCHASE', payload, state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1 })
    expect(first.status).toBe('APPROVED')
    const second = await t.submit({ operation_id: oid, op_type: 'PURCHASE', payload, state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1 })
    expect(second.status).toBe('DUPLICATE')
    const n = await adminQ('select count(*) n from purchases where operation_id=$1', [oid])
    expect(Number(n[0].n)).toBe(1)
    const cash = await adminQ(`select sum(case when direction='IN' then amount else -amount end) bal
      from cash_transactions where business_id=$1`, [W.b1])
    expect(Number(cash[0].bal)).toBe(-350) // شراء نقدي واحد فقط 100×3.5
  })

  it('RP-4 جهازان عبر HTTP: بيع من win → يظهر عند web بسحب seq', async () => {
    const oid = crypto.randomUUID()
    const tw = transportFor(W.win, W.owner)
    const res = await tw.submit({
      operation_id: oid, op_type: 'SALE',
      payload: { operation_id: oid, warehouse_id: W.wh, items: [{ product_id: W.product, quantity: 6, unit_id: W.kg, unit_price: 4.0 }], payment_type: 'CASH' },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    })
    expect(res.status).toBe('APPROVED')
    const docNo = (res.result as { doc_number: number }).doc_number
    const tWeb = transportFor(W.web, W.owner)
    const pulled = await tWeb.pull(0, 500)
    const seen = pulled.find((r) => r.operation_id === oid)
    expect(seen?.status).toBe('APPROVED')
    const sale = await adminQ('select doc_number, total from sales where operation_id=$1', [oid])
    expect(String(sale[0].doc_number)).toBe(String(docNo))
    expect(Number(sale[0].total)).toBe(24)
  })

  it('RP-5 بيع يكسر المخزون عبر HTTP → REJECTED مسبب بلا أي أثر، والرفض يصل للجهاز الآخر', async () => {
    const oid = crypto.randomUUID()
    const t = transportFor(W.win, W.owner)
    const res = await t.submit({
      operation_id: oid, op_type: 'SALE',
      payload: { operation_id: oid, warehouse_id: W.wh, items: [{ product_id: W.product, quantity: 9999, unit_id: W.kg, unit_price: 4.0 }], payment_type: 'CASH' },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    })
    expect(res.status).toBe('REJECTED')
    expect(String(res.rejection_reason)).toContain('الكمية المطلوبة أكبر من الرصيد المتاح')
    const sales = await adminQ('select count(*) n from sales where operation_id=$1', [oid])
    expect(Number(sales[0].n)).toBe(0)
    const stock = await adminQ('select qty from v_stock where business_id=$1 and item_id=$2 and warehouse_id=$3', [W.b1, W.product, W.wh])
    expect(Number(stock[0].qty)).toBe(94) // 100 − 6 من RP-4
    const tWeb = transportFor(W.web, W.owner)
    const pulled = await tWeb.pull(0, 500)
    const rej = pulled.find((r) => r.operation_id === oid)
    expect(rej?.status).toBe('REJECTED')
    expect(String(rej?.rejection_reason)).toContain('الرصيد المتاح')
  })

  it('RP-6 JWT بتوقيع مزوّر → بوابة PostgREST ترفض 401 (تحقق توقيع فعلي)', async () => {
    const good = claims(W.owner)
    const tampered = good.slice(0, -2) + (good.endsWith('aa') ? 'bb' : 'aa')
    const res = await fetch(`${PURL}/rpc/submit_sync_operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: 'x', Authorization: `Bearer ${tampered}` },
      body: JSON.stringify({ p_operation_id: crypto.randomUUID(), p_op_type: 'SALE', p_payload: {}, p_client_recorded_at: null }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { message?: string }
    expect(String(body.message).toLowerCase()).toMatch(/signature|jws/)
  })

  it('RP-7 رمز جهاز خاطئ → رفض عربي من assert_device عبر HTTP', async () => {
    const t = transportFor({ deviceId: W.win.deviceId, token: 'f'.repeat(64) }, W.owner)
    await expect(t.submit({
      operation_id: crypto.randomUUID(), op_type: 'SALE',
      payload: { operation_id: crypto.randomUUID(), warehouse_id: W.wh, items: [], payment_type: 'CASH' },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    })).rejects.toThrow(/الجهاز غير مصرّح|401|403/)
  })

  it('RP-8 إبطال جهاز عبر HTTP → رمزه يموت فوراً، والتدوير يعطي سراً جديداً', async () => {
    const reg = await rpcCall('register_device', { p_name: 'جهاز قديم للنقل', p_platform: 'WINDOWS', p_profile_id: W.owner }, { userId: W.owner })
    const r = reg.json as { device_id: string; token: string }
    W.old.deviceId = r.device_id
    W.old.token = r.token
    // يعمل قبل الإبطال (الرفع يمر بهوية الجهاز — pull لا يفحص الجهاز أصلاً)
    const t1 = transportFor(W.old, W.owner)
    const okOp = crypto.randomUUID()
    const okRes = await t1.submit({
      operation_id: okOp, op_type: 'CUSTOMER_UPSERT',
      payload: { operation_id: okOp, id: crypto.randomUUID(), code: 'TP-OLD', name: 'قبل الإبطال', active: true },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    })
    expect(okRes.status).toBe('APPROVED')
    // الإبطال من جهاز المالك
    const rev = await rpcCall('revoke_device', { p_device_id: r.device_id, p_reason: 'فقدان الجهاز التجريبي' }, { userId: W.owner, token: W.web })
    expect(rev.status).toBe(200)
    await expect(t1.submit({
      operation_id: crypto.randomUUID(), op_type: 'CUSTOMER_UPSERT',
      payload: { operation_id: crypto.randomUUID(), id: crypto.randomUUID(), code: 'TP-X', name: 'مرفوض', active: true },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    })).rejects.toThrow(/الجهاز غير مصرّح/)
    // التدوير: جهاز نشط يأخذ سراً جديداً والقديم يفنى
    const rot = await rpcCall('rotate_device_token', { p_device_id: W.win.deviceId }, { userId: W.owner, token: W.web })
    const rr = rot.json as { token: string }
    expect(rr.token).toMatch(/^[0-9a-f]{64}$/)
    expect(rr.token).not.toBe(W.win.token)
    const oldTok = transportFor(W.win, W.owner)
    await expect(oldTok.submit({
      operation_id: crypto.randomUUID(), op_type: 'CUSTOMER_UPSERT',
      payload: { operation_id: crypto.randomUUID(), id: crypto.randomUUID(), code: 'TP-Y', name: 'رمز قديم', active: true },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    })).rejects.toThrow(/الجهاز غير مصرّح/)
    W.win.token = rr.token // الجهاز نفسه بعد تحديث السر يعمل
    const renewedOp = crypto.randomUUID()
    const renewed = await transportFor(W.win, W.owner).submit({
      operation_id: renewedOp, op_type: 'CUSTOMER_UPSERT',
      payload: { operation_id: renewedOp, id: crypto.randomUUID(), code: 'TP-Z', name: 'بعد التدوير', active: true },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    })
    expect(renewed.status).toBe('APPROVED')
  })

  it('RP-9 عزل RLS عبر HTTP: نشاط ثانٍ لا يرى شيئاً + anon مرفوض + VIEWER مرفوض من البيع', async () => {
    // جهاز النشاط الثاني يسحب — لا يرى أي عملية من النشاط الأول
    const reg2 = await rpcCall('register_device', { p_name: 'جهاز المنافس', p_platform: 'WEB', p_profile_id: W.owner2 }, { userId: W.owner2 })
    expect(reg2.status).toBe(200)
    W.b2dev.deviceId = (reg2.json as { device_id: string }).device_id
    W.b2dev.token = (reg2.json as { token: string }).token
    const t2 = transportFor(W.b2dev, W.owner2)
    const rows2 = await t2.pull(0, 500)
    expect(rows2.length).toBe(0)
    // anon (بلا هوية إنسان) — الوظيفة غير متاحة له أصلاً في PostgREST
    const anon = await fetch(`${PURL}/rpc/pull_changes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'x', Authorization: `Bearer ${claims(undefined, 'anon')}` },
      body: JSON.stringify({ p_since_seq: 0, p_limit: 10 }),
    })
    expect(anon.status).toBeGreaterThanOrEqual(400)
    // VIEWER: المالك يسجل له جهازاً خاصاً به — فيصل assert_device ثم يُرفض بصلاحية عربية
    const regv = await rpcCall('register_device', { p_name: 'جهاز المطالع', p_platform: 'WEB', p_profile_id: W.viewer }, { userId: W.owner, token: W.web })
    expect(regv.status).toBe(200)
    W.viewerDev.deviceId = (regv.json as { device_id: string }).device_id
    W.viewerDev.token = (regv.json as { token: string }).token
    const tv = transportFor(W.viewerDev, W.viewer)
    const vres = await tv.submit({
      operation_id: crypto.randomUUID(), op_type: 'SALE',
      payload: { operation_id: crypto.randomUUID(), warehouse_id: W.wh, items: [{ product_id: W.product, quantity: 1, unit_id: W.kg, unit_price: 4 }], payment_type: 'CASH' },
      state: 'PENDING_SYNC', created_at: new Date().toISOString(), attempts: 0, schema_version: 1,
    })
    // رفض مسبب يصل للجهاز كسبب عربي مفهوم — بلا أثر مالي
    expect(vres.status).toBe('REJECTED')
    expect(String(vres.rejection_reason)).toContain('صلاحية')
    const n = await adminQ('select count(*) n from sales where business_id=$1', [W.b1])
    expect(Number(n[0].n)).toBe(1) // فقط بيع RP-4
  })

  it('RP-10 دورة محرك كاملة فوق HTTP: طابور دائم → رفع بترتيب التبعيات → SYNCED + سحب وتطبيق', async () => {
    const custId = crypto.randomUUID()
    const saleOp = crypto.randomUUID()
    const custOp = crypto.randomUUID()
    const mk = (oid: string, type: string, payload: Record<string, unknown>, created: string): PendingOp =>
      ({ operation_id: oid, op_type: type, payload, state: 'LOCAL_ONLY', created_at: created, attempts: 0, schema_version: 1 })
    const ops: PendingOp[] = [
      // محفوظة بالعكس عمداً — المحرك يجب أن يرفع العميل قبل فاتورته
      mk(saleOp, 'SALE', { operation_id: saleOp, warehouse_id: W.wh, customer_id: custId, items: [{ product_id: W.product, quantity: 2, unit_id: W.kg, unit_price: 4.0 }], payment_type: 'CASH' }, '2026-10-16T10:02:00.000Z'),
      mk(custOp, 'CUSTOMER_UPSERT', { operation_id: custOp, id: custId, code: 'TP-C2', name: 'زبون دورة المحرك', active: true }, '2026-10-16T10:01:00.000Z'),
    ]
    const store = createMemoryStore(ops)
    const t = transportFor(W.win, W.owner)
    const applied: ServerOp[] = []
    const out = await syncOnce(store, t, 0, async (op) => { applied.push(op) })
    // كل العمليات وصلت SYNCED بالترتيب الصحيح
    const byId = new Map(out.ops.map((o) => [o.operation_id, o.state]))
    expect(byId.get(custOp)).toBe('SYNCED')
    expect(byId.get(saleOp)).toBe('SYNCED')
    expect(out.summary.synced.length).toBe(2)
    // الحالة محفوظة في الطابور الدائم بعد الدورة
    const persisted = await store.load()
    expect(persisted.every((o) => o.state === 'SYNCED')).toBe(true)
    // القاعدة: العميل + الفاتورة موجودان فعلاً ومرتبطان
    const cust = await adminQ('select id from customers where id=$1 and business_id=$2', [custId, W.b1])
    expect(cust.length).toBe(1)
    const sale = await adminQ('select total from sales where operation_id=$1', [saleOp])
    expect(Number(sale[0].total)).toBe(8)
    // السحب أعاد عمليات أخرى (سجل الحركات) بلا كسر
    expect(out.lastSeq).toBeGreaterThan(0)
    expect(applied.length).toBeGreaterThanOrEqual(2)
  })
})
