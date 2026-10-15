/**
 * محرك المزامنة النموذجي — آلة حالات 7 حالات (نفس ما سيُبنى فوق Dexie في التطبيق الحقيقي):
 * LOCAL_ONLY → PENDING_SYNC → SYNCING → SYNCED
 *                                  ├→ REJECTED (رفض خادم نهائي — رسالة عربية)
 *                                  ├→ FAILED   (خطأ شبكة — يُعاد لاحقاً)
 *                                  └→ CONFLICT (تعارض مخزون/ائتمان — يُعرض للمستخدم)
 *
 * - operation_id (uuid) يولَّد محلياً — الخادم idempotent حقه
 * - التطبيق المتفائل محلياً + تعويض كامل عند الرفض (المرآة تعود كما كانت)
 * - السحب: /changes?since=cursor — العمليات البعيدة تُطبق محلياً مرة واحدة (processed_ids)
 * - البقاء: كل الحالة في IndexedDB (دلالات Dexie) — المعلقات تنجو من إعادة تشغيل الجهاز
 */
const SERVER = window.__SYNC_SERVER || ''

/** طبقة بقاء على IndexedDB — نفس دلالات Dexie في التطبيق الحقيقي (التزام دائم عند اكتمال المعاملة) */
function idb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('proto_sync', 1)
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv')
    rq.onsuccess = () => resolve(rq.result)
    rq.onerror = () => reject(rq.error)
  })
}
async function idbSet(key, val) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(val, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
async function idbGet(key) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly')
    const rq = tx.objectStore('kv').get(key)
    rq.onsuccess = () => { db.close(); resolve(rq.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

const EMPTY = {
  deviceName: 'جهاز',
  offline: false,
  cursor: 0,
  mirror: { products: [], customers: [], price_rules: [], invoices: [], payments: [] },
  outbox: [],        // {operation_id, type, payload, state, attempts, reason?, created_at, synced_at?}
  processed_ids: {}, // operation_id → true (عمليات بعيدة طُبقت محلياً)
}

export async function loadState(deviceName) {
  const raw = await idbGet('state')
  if (raw) {
    const s = JSON.parse(raw)
    s.deviceName = deviceName
    return s
  }
  return { ...JSON.parse(JSON.stringify(EMPTY)), deviceName }
}
/** حفظ دائم — كل تغيير حالة يُكتب فوراً في IndexedDB */
export function saveState(s) {
  // fire-and-forget: المعاملة تُلتزم خلال أجزاء من الثانية — نفس نموذج Dexie
  idbSet('state', JSON.stringify({ ...s, deviceName: undefined })).catch(() => {})
}

async function api(path, opts = {}) {
  const res = await fetch(SERVER + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.__SYNC_TOKEN}`, ...(opts.headers || {}) },
  })
  if (res.status === 401) throw Object.assign(new Error('رمز الجهاز مرفوض من الخادم (401) — الوصول محجوب'), { authError: true })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'خطأ خادم')
  return data
}

function resolveLocalPrice(s, productId, customerId) {
  const rule = s.mirror.price_rules.find((r) => r.product_id === productId && r.customer_id === customerId)
  if (rule) return rule.price
  return s.mirror.products.find((p) => p.id === productId)?.price ?? 0
}

/** إنشاء عملية: تُطبق محلياً فوراً (offline-first) وتُدرج PENDING_SYNC */
export function enqueue(s, type, payload) {
  const op = {
    operation_id: uuid(), type, payload,
    state: 'PENDING_SYNC',
    attempts: 0, created_at: new Date().toISOString(), reason: null,
  }
  s.outbox.push(op)
  applyLocal(s, { type, payload, mine: true })
  saveState(s)
  return op
}

/** تطبيق محلي (متoptimistic للمحلي، حقيقي للبعيد) */
function applyLocal(s, { type, payload, mine, result }) {
  const m = s.mirror
  if (type === 'create_sale') {
    const price = resolveLocalPrice(s, payload.product_id, payload.customer_id)
    const total = Math.round(price * payload.qty * 100) / 100
    const prod = m.products.find((p) => p.id === payload.product_id)
    if (prod) prod.stock = Math.round((prod.stock - payload.qty) * 1000) / 1000
    m.invoices.push({
      doc_number: mine ? '…محلي' : (result?.doc_number ?? '—'),
      customer_id: payload.customer_id, product_id: payload.product_id,
      qty: payload.qty, unit_price: price, total, sale_date: payload.sale_date,
      remote: !mine, pending: mine,
    })
    if (payload.customer_id) {
      const cus = m.customers.find((c) => c.id === payload.customer_id)
      if (cus) cus.balance = Math.round((cus.balance + total) * 100) / 100
    }
  }
  if (type === 'record_payment') {
    const cus = m.customers.find((c) => c.id === payload.customer_id)
    if (cus) cus.balance = Math.round((cus.balance - payload.amount) * 100) / 100
    m.payments.push({ doc_number: mine ? '…محلي' : (result?.doc_number ?? '—'), customer_id: payload.customer_id, amount: payload.amount, remote: !mine, pending: mine })
  }
  if (type === 'upsert_price_rule') {
    const r = m.price_rules.find((x) => x.customer_id === payload.customer_id && x.product_id === payload.product_id)
    if (r) r.price = payload.price
    else m.price_rules.push({ ...payload })
  }
}

/** تعويض الأثر المحلي المتفائل عند رفض الخادم — المرآة تعود كما كانت */
function compensate(s, { type, payload }) {
  const m = s.mirror
  if (type === 'create_sale') {
    const total = Math.round(resolveLocalPrice(s, payload.product_id, payload.customer_id) * payload.qty * 100) / 100
    const prod = m.products.find((p) => p.id === payload.product_id)
    if (prod) prod.stock = Math.round((prod.stock + payload.qty) * 1000) / 1000
    const idx = m.invoices.findIndex((i) => i.pending && i.qty === payload.qty && Math.abs(i.total - total) < 0.001)
    if (idx >= 0) m.invoices.splice(idx, 1)
    if (payload.customer_id) {
      const cus = m.customers.find((c) => c.id === payload.customer_id)
      if (cus) cus.balance = Math.round((cus.balance - total) * 100) / 100
    }
  }
  if (type === 'record_payment') {
    const cus = m.customers.find((c) => c.id === payload.customer_id)
    if (cus) cus.balance = Math.round((cus.balance + payload.amount) * 100) / 100
    const idx = m.payments.findIndex((p) => p.pending === true && p.amount === payload.amount && p.customer_id === payload.customer_id)
    if (idx >= 0) m.payments.splice(idx, 1)
  }
  // upsert_price_rule: آخر كتابة تفوز (غير حرج مالياً) — لا تعويض
}

/** دفع الطابور للخادم */
export async function push(s) {
  if (s.offline) return
  for (const op of s.outbox) {
    if (!['PENDING_SYNC', 'FAILED', 'CONFLICT'].includes(op.state)) continue
    op.state = 'SYNCING'
    op.attempts += 1
    saveState(s)
    try {
      const res = await api('/v1/ops', { method: 'POST', body: JSON.stringify({ operation_id: op.operation_id, type: op.type, payload: op.payload }) })
      if (res.status === 'APPLIED' || res.status === 'DUPLICATE') {
        op.state = 'SYNCED'
        op.synced_at = new Date().toISOString()
        op.reason = res.status === 'DUPLICATE' ? 'مكررة — أثرها المالي مرة واحدة فقط' : null
        op.doc_number = res.doc_number ?? res.original?.doc_number ?? null
        const inv = s.mirror.invoices.find((i) => i.pending && i.qty === op.payload.qty && op.type === 'create_sale')
        if (inv) { inv.doc_number = op.doc_number; inv.pending = false }
        const pay = s.mirror.payments.find((p) => p.pending && op.type === 'record_payment')
        if (pay) { pay.doc_number = op.doc_number; pay.pending = false }
      } else if (res.status === 'REJECTED') {
        compensate(s, op)
        op.state = res.over_credit ? 'CONFLICT' : 'REJECTED'
        op.reason = res.reason
      }
    } catch (e) {
      op.state = 'FAILED'
      op.reason = e.authError ? e.message : 'تعذر الوصول للخادم — سيُعاد تلقائياً'
      if (e.authError) break
    }
    saveState(s)
  }
}

/** سحب عمليات الأجهزة الأخرى وتطبيقها محلياً مرة واحدة */
export async function pull(s) {
  if (s.offline) return
  try {
    const { changes } = await api(`/v1/changes?since=${s.cursor}`)
    for (const ch of changes) {
      if (ch.device_id === window.__SYNC_DEVICE_ID) { s.cursor = ch.server_seq; continue }
      if (s.processed_ids[ch.operation_id]) { s.cursor = ch.server_seq; continue }
      if (ch.result.status === 'APPLIED') {
        applyLocal(s, { type: ch.type, payload: ch.payload, mine: false, result: ch.result })
        s.processed_ids[ch.operation_id] = true
      }
      s.cursor = ch.server_seq
    }
    saveState(s)
  } catch { /* الشبكة — لاحقاً */ }
}

export async function syncOnce(s) {
  await push(s)
  await pull(s)
}
