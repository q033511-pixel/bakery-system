/**
 * خادم المزامنة النموذجي (وقوف مكان Supabase PostgreSQL محلياً — بلا لمس الإنتاج)
 *
 * العقد المطابق لما سيُنفذ على Supabase:
 * - POST /v1/ops          — تطبيق عملية مالية idempotent (operation_id فريد) بتحقق من الخادم
 * - GET  /v1/changes?since=N — سجل العمليات المرتب بـserver_seq (للسحب)
 * - GET  /v1/state        — الحالة الكاملة (للاختبار والتحقق)
 * - مصادقة Bearer Token لكل جهاز — رمز غير معروف = 401
 *
 * سياسات مصممة عمداً (تطابق SYNC_ARCHITECTURE_DECISION.md):
 * - المخزون: تحقق لحظة التطبيق — الأول يفوز، الثاني يُرفض برسالة عربية (لا last-write-wins مالياً)
 * - الأسعار تُحل في الخادم لحظة التطبيق وتُنسخ في الفاتورة — تغيير السعر لا يعدّل الفواتير القديمة
 * - الدفعات جمعية (commutative) فلا تعارض عليها
 * - قواعد الأسعار: آخر كتابة تفوز (غير حرجة مالياً) ومرتبة بالتسلسل
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const LOG_FILE = path.join(DATA_DIR, 'ops.jsonl')

// رموز الأجهزة (محاكاة auth.users + RLS)
const DEVICE_TOKENS = {
  'site-token-proto-a': 'device-site',
  'exe-token-proto-b': 'device-exe',
}

// بيانات تجريبية فقط — لا علاقة ببيانات الزبون
const SEED = {
  products: [
    { id: 'p-khobz', name: 'خبز صمون', price: 4.0, stock: 200 },
    { id: 'p-kaak', name: 'كعك سمسم', price: 3.0, stock: 100 },
  ],
  customers: [
    { id: 'c-qusai', name: 'قصي', balance: 0, credit_limit: 1000 },
    { id: 'c-saher', name: 'ساهر', balance: 0, credit_limit: 500 },
  ],
  price_rules: [
    { customer_id: 'c-qusai', product_id: 'p-khobz', price: 4.0 },
  ],
  invoices: [],
  payments: [],
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return JSON.parse(JSON.stringify(SEED))
  }
}
function loadLog() {
  try {
    return fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

let state = loadState()
let opsLog = loadLog()
let seq = opsLog.length

function persist() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
  fs.writeFileSync(LOG_FILE, opsLog.map((o) => JSON.stringify(o)).join('\n'))
}

function resolvePrice(productId, customerId) {
  const rule = state.price_rules.find((r) => r.product_id === productId && r.customer_id === customerId)
  if (rule) return { price: rule.price, source: 'special' }
  const p = state.products.find((x) => x.id === productId)
  return { price: p ? p.price : 0, source: 'default' }
}

/** تطبيق عملية — يُرجع {status, reason?, doc_number?} */
function applyOp(op) {
  const { type, payload } = op
  if (type === 'create_sale') {
    const prod = state.products.find((p) => p.id === payload.product_id)
    if (!prod) return { status: 'REJECTED', reason: 'الصنف غير موجود' }
    const qty = Number(payload.qty)
    if (!Number.isFinite(qty) || qty <= 0) return { status: 'REJECTED', reason: 'الكمية غير صحيحة' }
    if (qty > prod.stock) {
      return { status: 'REJECTED', reason: `الكمية المطلوبة أكبر من الرصيد المتاح. المتاح: ${prod.stock}` }
    }
    const { price, source } = resolvePrice(payload.product_id, payload.customer_id ?? null)
    const total = Math.round(price * qty * 100) / 100
    let creditBlocked = null
    if (payload.customer_id) {
      const cus = state.customers.find((c) => c.id === payload.customer_id)
      if (!cus) return { status: 'REJECTED', reason: 'العميل غير موجود' }
      if (cus.credit_limit > 0 && cus.balance + total > cus.credit_limit && payload.allow_over_credit !== true) {
        creditBlocked = `تجاوز حد الائتمان: رصيد العميل ${cus.balance} + هذه الفاتورة ${total} يتجاوز الحد ${cus.credit_limit} — أكّد التجاوز للمتابعة.`
      }
    }
    if (creditBlocked) return { status: 'REJECTED', reason: creditBlocked, over_credit: true }
    // تطبيق
    prod.stock = Math.round((prod.stock - qty) * 1000) / 1000
    const doc = `SAL-${String(state.invoices.length + 1).padStart(6, '0')}`
    state.invoices.push({
      id: op.operation_id, operation_id: op.operation_id, doc_number: doc,
      customer_id: payload.customer_id ?? null, product_id: payload.product_id,
      qty, unit_price: price, price_source: source, total,
      sale_date: String(payload.sale_date ?? ''), allow_over_credit: payload.allow_over_credit === true,
    })
    if (payload.customer_id) {
      const cus = state.customers.find((c) => c.id === payload.customer_id)
      cus.balance = Math.round((cus.balance + total) * 100) / 100
    }
    return { status: 'APPLIED', doc_number: doc, price, total }
  }
  if (type === 'record_payment') {
    const cus = state.customers.find((c) => c.id === payload.customer_id)
    if (!cus) return { status: 'REJECTED', reason: 'العميل غير موجود' }
    const amount = Number(payload.amount)
    if (!Number.isFinite(amount) || amount <= 0) return { status: 'REJECTED', reason: 'المبلغ غير صحيح' }
    const doc = `PAY-${String(state.payments.length + 1).padStart(6, '0')}`
    state.payments.push({ id: op.operation_id, operation_id: op.operation_id, doc_number: doc, customer_id: cus.id, amount })
    cus.balance = Math.round((cus.balance - amount) * 100) / 100
    return { status: 'APPLIED', doc_number: doc }
  }
  if (type === 'upsert_price_rule') {
    const { customer_id, product_id, price } = payload
    if (!(Number(price) > 0)) return { status: 'REJECTED', reason: 'السعر غير صحيح' }
    const existing = state.price_rules.find((r) => r.customer_id === customer_id && r.product_id === product_id)
    if (existing) existing.price = Number(price)
    else state.price_rules.push({ customer_id, product_id, price: Number(price) })
    // الفواتير القديمة لا تُلمس — عمداً
    return { status: 'APPLIED' }
  }
  return { status: 'REJECTED', reason: `نوع عملية غير معروف: ${type}` }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')

  // خدمة الملفات الثابتة لواجهة النموذج (من prototype/web)
  if (!url.pathname.startsWith('/v1/')) {
    const webDir = path.join(__dirname, '..', 'web')
    const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
    let file = path.join(webDir, safe === '/' || safe === '\\' ? 'index.html' : safe)
    if (!file.startsWith(webDir)) { res.statusCode = 403; res.end('forbidden'); return }
    try {
      const data = fs.readFileSync(file)
      const mime = file.endsWith('.html') ? 'text/html; charset=utf-8'
        : file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : 'application/octet-stream'
      res.setHeader('Content-Type', mime)
      res.end(data)
    } catch {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('not found')
    }
    return
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  // مصادقة
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const deviceId = DEVICE_TOKENS[token]
  if (url.pathname.startsWith('/v1/') && !deviceId) {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'رمز جهاز غير معروف — الوصول مرفوض (محاكاة RLS)' }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/ops') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let op
      try { op = JSON.parse(body) } catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad json' })); return }
      if (!op.operation_id || !op.type) { res.statusCode = 400; res.end(JSON.stringify({ error: 'operation_id و type مطلوبان' })); return }
      // Idempotency: نفس operation_id → نفس النتيجة بلا أثر مزدوج
      const existing = opsLog.find((o) => o.operation_id === op.operation_id)
      if (existing) {
        res.end(JSON.stringify({ status: 'DUPLICATE', original: existing.result, server_seq: existing.server_seq }))
        return
      }
      const result = applyOp({ ...op, device_id: deviceId })
      seq += 1
      const logged = { server_seq: seq, operation_id: op.operation_id, device_id: deviceId, type: op.type, payload: op.payload, result, applied_at: new Date().toISOString() }
      opsLog.push(logged)
      persist()
      res.end(JSON.stringify({ ...result, server_seq: seq }))
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/changes') {
    const since = Number(url.searchParams.get('since') ?? '0')
    res.end(JSON.stringify({ changes: opsLog.filter((o) => o.server_seq > since), head: seq }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/state') {
    res.end(JSON.stringify({ state, head: seq }))
    return
  }

  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})

const PORT = Number(process.env.PORT ?? 7777)
server.listen(PORT, () => console.log(`sync-prototype server on :${PORT}`))
