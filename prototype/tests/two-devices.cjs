// اختبارات الجهازين العشرة — نموذج المزامنة الأولي
// جهاز أ = "الموقع" (CDP 9323) | جهاز ب = "نسخة الويندوز" (CDP 9324) | خادم محلي :7777
const { chromium } = require('playwright-core')
const { execSync, spawn } = require('node:child_process')

const A_CDP = 'http://127.0.0.1:9323'
const B_CDP = 'http://127.0.0.1:9324'
const SERVER = 'http://localhost:7777'
const TOKEN_A = 'site-token-proto-a'
const TOKEN_B = 'exe-token-proto-b'
const ELECTRON = '/home/z/my-project/bakery-system/desktop/node_modules/.bin/electron'
const APP_DIR = '/tmp/proto-app'

const results = []
function pass(name, detail) { results.push([true, name, detail]); console.log(`✅ PASS  ${name}${detail ? ' — ' + detail : ''}`) }
function fail(name, detail) { results.push([false, name, detail]); console.log(`❌ FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect(cdp) {
  const browser = await chromium.connectOverCDP(cdp)
  const ctx = browser.contexts()[0]
  let page = ctx.pages().find((p) => String(p.url()).includes('localhost:7777'))
  if (!page) page = await ctx.newPage()
  return { browser, page }
}

const readState = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const rq = indexedDB.open('proto_sync', 1); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error) })
  const v = await new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly')
    const rq = tx.objectStore('kv').get('state')
    rq.onsuccess = () => res(rq.result)
    tx.onerror = () => rej(tx.error)
  })
  db.close()
  return v ? JSON.parse(v) : null
})

async function resetDevice(page, name) {
  await page.evaluate(async () => {
    await new Promise((res) => { const rq = indexedDB.deleteDatabase('proto_sync'); rq.onsuccess = rq.onerror = rq.onblocked = () => res() })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
}

async function setOffline(page, off) {
  const cur = (await readState(page))?.offline
  if (cur !== off) { await page.click('#toggleOff'); await page.waitForTimeout(500) }
}

async function doOp(page, kind, p) {
  await page.selectOption('#opType', kind)
  await page.waitForTimeout(200)
  if (kind === 'create_sale') {
    await page.evaluate(({ cust, prod, qty, over }) => {
      if (cust !== undefined) document.getElementById('cust').value = cust
      document.getElementById('prod').value = prod
      document.getElementById('qty').value = String(qty)
      document.getElementById('overCredit').checked = !!over
    }, p)
  } else if (kind === 'record_payment') {
    await page.evaluate(({ cust, amount }) => {
      document.getElementById('cust2').value = cust
      document.getElementById('amount').value = String(amount)
    }, p)
  } else {
    await page.evaluate(({ cust, prod, price }) => {
      document.getElementById('cust3').value = cust
      document.getElementById('prod3').value = prod
      document.getElementById('price').value = String(price)
    }, p)
  }
  await page.click('#doOp')
  await page.waitForTimeout(500)
}

async function syncNow(page) {
  await page.click('#syncNow')
  await page.waitForTimeout(900)
}

async function waitUntil(page, pred, timeoutMs = 9000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const s = await readState(page)
    if (s && pred(s)) return s
    await page.click('#syncNow').catch(() => {})
    await sleep(700)
  }
  const s = await readState(page)
  console.log(`   ⏳ timeout waiting: ${label} | state: ${JSON.stringify(s).slice(0, 220)}`)
  return s
}

const serverState = async () => {
  const res = await fetch(SERVER + '/v1/state', { headers: { Authorization: `Bearer ${TOKEN_A}` } })
  return res.json()
}
const mirror = (s) => s.mirror
const bal = (s, id) => mirror(s).customers.find((c) => c.id === id).balance
const stock = (s, id) => mirror(s).products.find((p) => p.id === id).stock
const invCount = (s) => mirror(s).invoices.length

;(async () => {
  const A = await connect(A_CDP)
  const B = await connect(B_CDP)
  const pa = A.page, pb = B.page

  // إعادة تعيين للجهازين (بيانات تجريبية فقط)
  await resetDevice(pa); await resetDevice(pb)
  console.log('— الجهازان جاهزان ومصفّران —\n')

  // ============ S1: بيع من الموقع يظهر في EXE ============
  await doOp(pa, 'create_sale', { cust: 'c-qusai', prod: 'p-khobz', qty: 10 })
  const s1 = await waitUntil(pb, (s) => bal(s, 'c-qusai') === 40 && stock(s, 'p-khobz') === 190, 9000, 'S1 B sees')
  ;(bal(s1, 'c-qusai') === 40 && stock(s1, 'p-khobz') === 190)
    ? pass('S1 فاتورة من الموقع ظهرت في EXE', 'قصي 40₪ + مخزون 190')
    : fail('S1 فاتورة من الموقع ظهرت في EXE', `B: قصي=${bal(s1, 'c-qusai')} خبز=${stock(s1, 'p-khobz')}`)

  // ============ S2: بيع من EXE يظهر في الموقع ============
  await doOp(pb, 'create_sale', { cust: 'c-saher', prod: 'p-kaak', qty: 20 })
  const s2 = await waitUntil(pa, (s) => bal(s, 'c-saher') === 60 && stock(s, 'p-kaak') === 80, 9000, 'S2 A sees')
  ;(bal(s2, 'c-saher') === 60 && stock(s2, 'p-kaak') === 80)
    ? pass('S2 فاتورة من EXE ظهرت في الموقع', 'ساهر 60₪ + مخزون 80')
    : fail('S2 فاتورة من EXE ظهرت في الموقع', `A: ساهر=${bal(s2, 'c-saher')} كعك=${stock(s2, 'p-kaak')}`)

  // ============ S3: انقطاع — العملية تبقى محلية بحالة واضحة ============
  await setOffline(pa, true)
  await doOp(pa, 'create_sale', { cust: 'c-qusai', prod: 'p-kaak', qty: 5 })
  await sleep(2500) // أطول من حلقة المزامنة — يجب ألا يُرسل شيئاً
  const s3 = await readState(pa)
  const op3 = s3.outbox[s3.outbox.length - 1]
  const sv3 = await serverState()
  ;(op3.state === 'PENDING_SYNC' && sv3.head === 2 && op3.attempts === 0)
    ? pass('S3 انقطاع الإنترنت — العملية محفوظة محلياً بحالة PENDING_SYNC واضحة', 'الخادم لم يستلم شيئاً (head=2)')
    : fail('S3 الانقطاع', `op.state=${op3.state} attempts=${op3.attempts} head=${sv3.head}`)

  // ============ S4: عودة الاتصال — مزامنة بلا تكرار ============
  await setOffline(pa, false)
  const s4 = await waitUntil(pa, (s) => s.outbox.every((o) => o.state === 'SYNCED'), 9000, 'S4 synced')
  const sv4 = await serverState()
  const s4b = await waitUntil(pb, (s) => bal(s, 'c-qusai') === 55 && stock(s, 'p-kaak') === 75, 9000, 'S4 B sees')
  const ok4 = s4 && s4.outbox.every((o) => o.state === 'SYNCED') && sv4.head === 3 && bal(s4b, 'c-qusai') === 55
  ok4 ? pass('S4 عودة الاتصال — مزامنة كاملة بلا تكرار', 'head=3، قصي 55 عند الجهازين')
    : fail('S4 عودة الاتصال', `head=${sv4.head} Bقصي=${bal(s4b, 'c-qusai')}`)

  // ============ S5: الإرسال مرتين — لا ازدواج مالي ============
  await doOp(pa, 'create_sale', { cust: 'c-qusai', prod: 'p-khobz', qty: 1 })
  await page_dup(pa)
  async function page_dup(p) { await p.click('#dupOp'); await p.waitForTimeout(400) }
  const s5 = await waitUntil(pa, (s) => s.outbox.filter((o) => o.state === 'SYNCED').length >= s.outbox.length && s.outbox[s.outbox.length - 1].reason !== null, 9000, 'S5 dup')
  const sv5 = await serverState()
  const dupEntry = s5.outbox[s5.outbox.length - 1]
  const invs5 = sv5.state.invoices.filter((i) => i.qty === 1).length
  ;(dupEntry.reason && dupEntry.reason.includes('مكررة') && invs5 === 1 && bal(s5, 'c-qusai') === 59)
    ? pass('S5 إرسال العملية مرتين — أثر مالي واحد فقط', `قصي=59، فواتير qty=1: ${invs5}`)
    : fail('S5 منع التكرار', `reason=${dupEntry.reason} invs=${invs5} قصي=${bal(s5, 'c-qusai')}`)
  await waitUntil(pb, (s) => bal(s, 'c-qusai') === 59, 9000, 'S5 B')

  // ============ S6: جهازان يبيعان نفس الكمية — تعارض يُكتشف ويُعوَّض ============
  // كعك الآن 75. أ يبيع 60 (ينجح)، ب يبيع 60 (يُرفض: المتاح 15)
  await doOp(pa, 'create_sale', { cust: null, prod: 'p-kaak', qty: 60 }) // نقدي بلا عميل
  await waitUntil(pb, (s) => stock(s, 'p-kaak') === 15, 9000, 'S6 stock 15 at B')
  await doOp(pb, 'create_sale', { cust: null, prod: 'p-kaak', qty: 60 })
  const s6 = await waitUntil(pb, (s) => s.outbox[s.outbox.length - 1].state === 'REJECTED', 9000, 'S6 rejected')
  const op6 = s6.outbox[s6.outbox.length - 1]
  const sv6 = await serverState()
  const stockServer = sv6.state.products.find((p) => p.id === 'p-kaak').stock
  ;(op6.state === 'REJECTED' && op6.reason.includes('المتاح: 15') && stockServer === 15 && stock(s6, 'p-kaak') === 15)
    ? pass('S6 بيع نفس الكمية من جهازين — الأول فاز والثاني رُفض برسالة عربية + تعويض المرآة', `المتاح: 15 | مخزون الخادم 15 | مرآة ب 15`)
    : fail('S6 التعارض', `op=${op6.state} reason=${op6.reason} server=${stockServer} mirror=${stock(s6, 'p-kaak')}`)

  // ============ S7: رفض الخادم (حد ائتمان) + تجاوز صريح ============
  // ساهر: رصيد 60، حد 500. بيع 150×4=600 → 660 > 500 → CONFLICT ثم تجاوز
  await doOp(pb, 'create_sale', { cust: 'c-saher', prod: 'p-khobz', qty: 150 })
  let s7 = await waitUntil(pb, (s) => s.outbox[s.outbox.length - 1].state === 'CONFLICT', 9000, 'S7 conflict')
  const op7 = s7.outbox[s7.outbox.length - 1]
  const conflictOk = op7.state === 'CONFLICT' && op7.reason.includes('تجاوز حد الائتمان') && bal(s7, 'c-saher') === 60 // تعويض كامل
  // إعادة الإرسال مع تجاوز صريح
  await doOp(pb, 'create_sale', { cust: 'c-saher', prod: 'p-khobz', qty: 150, over: true })
  s7 = await waitUntil(pb, (s) => bal(s, 'c-saher') === 660, 9000, 'S7 override applied')
  ;(conflictOk && bal(s7, 'c-saher') === 660)
    ? pass('S7 رفض الخادم يُعرض بسببه ولا يُعتبر مؤكداً، والتجاوز الصريح يعمل', `CONFLICT ثم رصيد ساهر 660`)
    : fail('S7 حد الائتمان', `conflict=${conflictOk} ساهر=${bal(s7, 'c-saher')}`)
  await waitUntil(pa, (s) => bal(s, 'c-saher') === 660, 9000, 'S7 A')

  // ============ S8: تغيير السعر لا يعدّل التاريخ المالي ============
  await doOp(pa, 'upsert_price_rule', { cust: 'c-qusai', prod: 'p-kaak', price: 3.5 })
  await waitUntil(pb, (s) => s.mirror.price_rules.some((r) => r.customer_id === 'c-qusai' && r.product_id === 'p-kaak' && r.price === 3.5), 9000, 'S8 rule at B')
  const totalsBefore = (await readState(pa)).mirror.invoices.map((i) => i.total)
  await doOp(pa, 'create_sale', { cust: 'c-qusai', prod: 'p-kaak', qty: 2 }) // 2×3.5=7
  const s8 = await waitUntil(pb, (s) => s.mirror.invoices.some((i) => i.total === 7 && i.qty === 2), 9000, 'S8 new invoice')
  const totalsAfter = s8.mirror.invoices.filter((i) => !(i.qty === 2 && i.total === 7)).map((i) => i.total)
  const unchanged = totalsBefore.every((t) => totalsAfter.includes(t)) && totalsBefore.length === totalsAfter.length
  ;(unchanged && bal(s8, 'c-qusai') === 66)
    ? pass('S8 تغيير الأسعار لا يعدّل الفواتير التاريخية', `القديمة ثابتة ${JSON.stringify(totalsBefore)} + الجديدة 7`)
    : fail('S8 ثبات التاريخ المالي', `before=${JSON.stringify(totalsBefore)} after=${JSON.stringify(totalsAfter)}`)

  // ============ S9: صلاحيات — رمز غير مصرح يُرفض ولا تُعتبر العملية مؤكدة ============
  await pa.evaluate(() => { window.__SYNC_TOKEN = 'token-مسرور' })
  await doOp(pa, 'create_sale', { cust: 'c-qusai', prod: 'p-khobz', qty: 1 })
  const s9 = await waitUntil(pa, (s) => s.outbox[s.outbox.length - 1].state === 'FAILED' && (s.outbox[s.outbox.length - 1].reason || '').includes('401'), 9000, 'S9 failed')
  const op9 = s9.outbox[s9.outbox.length - 1]
  await pa.evaluate(() => { window.__SYNC_TOKEN = 'site-token-proto-a' })
  await syncNow(pa)
  const s9b = await readState(pa)
  ;(op9.state === 'FAILED' && s9b.outbox[s9b.outbox.length - 1].state === 'SYNCED')
    ? pass('S9 وصول غير مصرح يُرفض من الخادم برسالة واضحة ثم ينجمح بعد إصلاح الرمز')
    : fail('S9 الصلاحيات', `op9=${op9.state}/${op9.reason} after=${s9b.outbox[s9b.outbox.length - 1].state}`)

  // ============ S10: إعادة تشغيل كاملة — المعلقات تنجو ثم تُزامن ============
  await setOffline(pa, true)
  await doOp(pa, 'create_sale', { cust: 'c-qusai', prod: 'p-khobz', qty: 3 })
  const pendBefore = (await readState(pa)).outbox.filter((o) => o.state === 'PENDING_SYNC').length
  // قتل وإعادة تشغيل جهاز أ
  A.browser.close()
  execSync('pkill -f "remote-debugging-port=932[3]" ; true')
  await sleep(2500)
  spawn(ELECTRON, [APP_DIR, '--remote-debugging-port=9323', '--user-data-dir=/tmp/proto-dev-a'], {
    env: { ...process.env, DISPLAY: ':99', PROTO_DEVICE: 'device-site' },
    detached: true, stdio: 'ignore',
  }).unref()
  await sleep(9000)
  const A2 = await connect(A_CDP)
  const pa2 = A2.page
  await pa2.waitForTimeout(1500)
  const s10 = await readState(pa2)
  const stillPending = s10 && s10.outbox.filter((o) => o.state === 'PENDING_SYNC').length === pendBefore
  await setOffline(pa2, false)
  const s10b = await waitUntil(pa2, (s) => s.outbox.every((o) => o.state === 'SYNCED'), 9000, 'S10 synced')
  const s10c = await waitUntil(pb, (s) => bal(s, 'c-qusai') === 82 && stock(s, 'p-khobz') === 35, 9000, 'S10 B sees')
  ;(stillPending && s10b.outbox.every((o) => o.state === 'SYNCED') && bal(s10c, 'c-qusai') === 82)
    ? pass('S10 إعادة تشغيل الجهاز — المعلقات بقيت ثم زُامنت', 'قصي=82 عند الجهازين، خبز=35')
    : fail('S10 البقاء بعد إعادة التشغيل', `pending=${stillPending} قصيB=${bal(s10c, 'c-qusai')}`)

  // ============ المطابقة النهائية: الخادم = الجهازين ============
  const fin = await serverState()
  const fa = await readState(pa2)
  const fb = await readState(pb)
  const match = bal(fa, 'c-qusai') === bal(fb, 'c-qusai') && bal(fa, 'c-qusai') === fin.state.customers.find((c) => c.id === 'c-qusai').balance
    && stock(fa, 'p-khobz') === fin.state.products.find((p) => p.id === 'p-khobz').stock
  match ? pass('المطابقة النهائية — الخادم والجهازان على نفس الأرقام', `قصي=${fin.state.customers.find((c) => c.id === 'c-qusai').balance} خبز=${fin.state.products.find((p) => p.id === 'p-khobz').stock}`)
    : fail('المطابقة النهائية')

  // ============ الخلاصة ============
  console.log('\n================ نتيجة اختبارات الجهازين ================')
  const okCount = results.filter((r) => r[0]).length
  results.forEach(([okk, name]) => console.log(`${okk ? '✅' : '❌'} ${name}`))
  console.log(`\n${okCount}/${results.length} ناجح`)
  process.exit(okCount === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL:', e); process.exit(1) })
