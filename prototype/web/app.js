import { loadState, saveState, enqueue, syncOnce, push, pull } from './sync-engine.mjs'

const qs = new URLSearchParams(location.search)
// هوية الجهاز: من الرابط أو من متغيرات يحقنها الإلكترون
const DEVICE_ID = qs.get('device') || window.__SYNC_DEVICE_ID || 'device-site'
const TOKEN = window.__SYNC_TOKEN || (DEVICE_ID === 'device-site' ? 'site-token-proto-a' : 'exe-token-proto-b')
const NAME = DEVICE_ID === 'device-site' ? 'الموقع (جهاز أ)' : 'نسخة الويندوز (جهاز ب)'
window.__SYNC_DEVICE_ID = DEVICE_ID
window.__SYNC_TOKEN = TOKEN

let S = null
// التهيئة: تحميل الحالة الدائمة من IndexedDB ثم التزريع إن كانت أول تشغيل
;(async () => {
  S = await loadState(NAME)
  if (S.mirror.products.length === 0) {
    S.mirror = {
      products: [
        { id: 'p-khobz', name: 'خبز صمون', price: 4.0, stock: 200 },
        { id: 'p-kaak', name: 'كعك سمسم', price: 3.0, stock: 100 },
      ],
      customers: [
        { id: 'c-qusai', name: 'قصي', balance: 0, credit_limit: 1000 },
        { id: 'c-saher', name: 'ساهر', balance: 0, credit_limit: 500 },
      ],
      price_rules: [{ customer_id: 'c-qusai', product_id: 'p-khobz', price: 4.0 }],
      invoices: [], payments: [],
    }
    saveState(S)
  }
  render()
  showOpType()
  setInterval(() => { if (S && !S.offline) void autoSync() }, 2000)
})()

const $ = (id) => document.getElementById(id)
$('devName').textContent = NAME
$('devId').textContent = DEVICE_ID

function fillSelects() {
  const opts = (arr) => arr.map((x) => `<option value="${x.id}">${x.name}</option>`).join('')
  $('cust').innerHTML = opts(S.mirror.customers) + '<option value="">بيع نقدي (بلا عميل)</option>'
  $('cust2').innerHTML = opts(S.mirror.customers)
  $('cust3').innerHTML = opts(S.mirror.customers)
  $('prod').innerHTML = opts(S.mirror.products)
  $('prod3').innerHTML = opts(S.mirror.products)
}

function render() {
  if (!S) return
  $('connBadge').textContent = S.offline ? 'أوفلاين — العمليات محلية' : 'متصل'
  $('connBadge').className = 'badge ' + (S.offline ? 'off' : 'on')
  $('toggleOff').textContent = S.offline ? 'استعادة الاتصال' : 'قطع الاتصال (محاكاة أوفلاين)'
  $('opsBody').innerHTML = [...S.outbox].reverse().map((o) => {
    const det = o.type === 'create_sale'
      ? `بيع ${o.payload.qty} × ${S.mirror.products.find((p) => p.id === o.payload.product_id)?.name ?? '؟'}${o.payload.customer_id ? ' — ' + (S.mirror.customers.find((c) => c.id === o.payload.customer_id)?.name ?? '') : ' — نقدي'}`
      : o.type === 'record_payment'
        ? `تحصيل ${o.payload.amount} — ${S.mirror.customers.find((c) => c.id === o.payload.customer_id)?.name ?? ''}`
        : `سعر ${S.mirror.customers.find((c) => c.id === o.payload.customer_id)?.name} × ${S.mirror.products.find((p) => p.id === o.payload.product_id)?.name} = ${o.payload.price}`
    return `<tr><td>${o.type}</td><td>${det}</td><td><span class="st ${o.state}">${o.state}</span></td><td>${o.attempts}</td><td class="reason">${o.reason ?? ''}</td><td>${o.doc_number ?? ''}</td></tr>`
  }).join('') || '<tr><td colspan="6" class="muted">لا عمليات بعد</td></tr>'
  $('custBody').innerHTML = S.mirror.customers.map((c) => `<tr><td>${c.name}</td><td><b>${c.balance.toFixed(2)} ₪</b></td><td>${c.credit_limit}</td></tr>`).join('')
  $('prodBody').innerHTML = S.mirror.products.map((p) => `<tr><td>${p.name}</td><td>${p.stock}</td><td>${p.price.toFixed(2)} ₪</td></tr>`).join('')
  $('docBody').innerHTML = [
    ...S.mirror.invoices.map((i) => `<tr><td>${i.doc_number}</td><td>بيع</td><td>${(S.mirror.customers.find((c) => c.id === i.customer_id)?.name ?? 'نقدي')} — ${i.qty}×${S.mirror.products.find((p) => p.id === i.product_id)?.name}</td><td>${i.total.toFixed(2)} ₪</td><td>${i.pending ? 'محلي معلق' : i.remote ? 'من الجهاز الآخر' : 'هذا الجهاز'}</td></tr>`),
    ...S.mirror.payments.map((p) => `<tr><td>${p.doc_number}</td><td>تحصيل</td><td>${S.mirror.customers.find((c) => c.id === p.customer_id)?.name ?? ''}</td><td>${p.amount.toFixed(2)} ₪</td><td>${p.remote ? 'من الجهاز الآخر' : 'هذا الجهاز'}</td></tr>`),
  ].join('') || '<tr><td colspan="5" class="muted">لا مستندات بعد</td></tr>'
  $('ruleBody').innerHTML = S.mirror.price_rules.map((r) => `<tr><td>${S.mirror.customers.find((c) => c.id === r.customer_id)?.name ?? r.customer_id}</td><td>${S.mirror.products.find((p) => p.id === r.product_id)?.name ?? r.product_id}</td><td>${Number(r.price).toFixed(2)} ₪</td></tr>`).join('')
  fillSelects()
}

function showOpType() {
  const t = $('opType').value
  $('saleFields').style.display = t === 'create_sale' ? '' : 'none'
  $('payFields').style.display = t === 'record_payment' ? '' : 'none'
  $('ruleFields').style.display = t === 'upsert_price_rule' ? '' : 'none'
}
$('opType').onchange = showOpType

function buildPayload() {
  const t = $('opType').value
  if (t === 'create_sale') return { customer_id: $('cust').value || null, product_id: $('prod').value, qty: Number($('qty').value), sale_date: new Date().toISOString().slice(0, 10), allow_over_credit: $('overCredit').checked }
  if (t === 'record_payment') return { customer_id: $('cust2').value, amount: Number($('amount').value) }
  return { customer_id: $('cust3').value, product_id: $('prod3').value, price: Number($('price').value) }
}

let lastOp = null
$('doOp').onclick = () => {
  lastOp = enqueue(S, $('opType').value, buildPayload())
  $('lastAction').textContent = 'سُجلت محلياً: ' + lastOp.operation_id
  render()
  if (!S.offline) void autoSync()
}
$('dupOp').onclick = () => {
  if (!lastOp) { $('lastAction').textContent = 'سجّل عميلة أولاً'; return }
  // إرسال نفس operation_id مرة ثانية — يجب أن يُستقبل DUPLICATE بلا أثر مزدوج
  S.outbox.push({ ...lastOp, state: 'PENDING_SYNC', attempts: 0, reason: null })
  saveState(S)
  $('lastAction').textContent = 'أُعيد إرسال نفس العملية: ' + lastOp.operation_id
  render()
  if (!S.offline) void autoSync()
}
$('toggleOff').onclick = () => {
  S.offline = !S.offline
  saveState(S)
  render()
  if (!S.offline) void autoSync()
}
$('syncNow').onclick = () => void autoSync()
$('pullOnly').onclick = async () => { if (!S.offline) { await pull(S); render() } }

let syncing = false
async function autoSync() {
  if (syncing) return
  syncing = true
  try { await syncOnce(S) } finally { syncing = false; render() }
}
// حلقة دورية كل 2 ثانية + عند العودة من الأوفلاين (تُشتغل من التهيئة)

render()
showOpType()
