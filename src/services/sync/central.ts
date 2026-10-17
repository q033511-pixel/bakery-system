/* ============================================================================
 * خدمة المزامنة المركزية — ربط صريح ومدروس لمحرك الخطة B بالتطبيق.
 * ---------------------------------------------------------------------------
 * القاعدة الذهبية: **معطّلة افتراضياً**. لا شيء في التطبيق يتغير قبل تفعيل صريح
 * من المستخدم عبر «مركز المزامنة»، والوضع المحلي يبقى كما هو تماماً. عند عدم
 * التفعيل تكلفة الاستدعاء الوحيدة = فحص متغير واحد (isSyncEnabled).
 *
 * الأمان (مطابق لقرار SYNC_ARCHITECTURE_DECISION):
 *   - لا سر في الكود ولا في البناء ولا في Git — كل شيء يُدخل وقت التشغيل.
 *   - مفتاح publishable (anon) ليس سراً بتصميم Supabase — يدخل في المتصفح حتماً.
 *   - JWT المستخدم: من GoTrue السحابي في الوضع السحابي، أو مُصدر من المشغّل
 *     لخادم اختبار محلي (وضع «خادم اختبار» — موثق أنه ليس بديلاً عن المصادقة الإنتاجية).
 *   - رمز الجهاز يُصدره الخادم ويُخزن على الجهاز فقط — قابل للإبطال/التدوير من الخادم.
 *
 * الحالات: كل عملية تُنفَّذ محلياً أولاً ثم تُدرج PENDING_SYNC — لا تُعلن SYNCED
 * أبداً قبل إقرار الخادم (APPROVED أو DUPLICATE لعملية اعتمدها سابقاً).
 * ========================================================================== */
import type { PendingOp, ServerOp, SyncTransport } from '@/lib/sync/engine'
import { syncOnce, isFinancialOp } from '@/lib/sync/engine'
import { createSupabaseTransport } from '@/lib/sync/supabaseTransport'
import { callRpc } from '@/lib/local/rpc'
import { getCtx } from '@/lib/local/context'
import { db } from '@/db/db'
// ملاحظة: refreshLookups تُستورد ديناميكياً (نفس نمط adapter.ts) لتفادي دورة
// استيراد ساكنة مع services/lookups ← services/sync/syncEngine

/* ---------- مفاتيح التخزين (localStorage — خارج النسخ الاحتياطية للبيانات) ---------- */
const K_CONFIG = 'bakery.sync_config'
const K_JWT = 'bakery.sync_jwt'
const K_DEVICE = 'bakery.sync_device'
const K_SEQ = 'bakery.sync_last_seq'
const K_ENABLED = 'bakery.sync_enabled'

export interface SyncConfig {
  url: string
  anonKey: string
  /** cloud = Supabase حقيقي (GoTrue) | rig = خادم اختبار PostgREST محلي بتوكن مُصدر */
  mode: 'cloud' | 'rig'
}
export interface SyncJwt { access_token: string; userId: string; email: string; obtained_at: string }
export interface SyncDevice { deviceId: string; deviceToken: string; name: string; platform: string }

/* وصول آمن للتخزين — بيئة الاختبار (node) بلا localStorage، وأي عطل تخزين
 * في الإنتاج لا يجوز أن يكسر التطبيق المحلي */
function lsGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null } catch { return null }
}
function lsSet(key: string, value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value) } catch { /* القرص ممتلئ — لا يكسر المحلي */ }
}
function lsDel(key: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key) } catch { /* ignore */ }
}

function readJson<T>(key: string): T | null {
  const raw = lsGet(key)
  return raw ? (JSON.parse(raw) as T) : null
}
function writeJson(key: string, value: unknown): void { lsSet(key, JSON.stringify(value)) }

export function getSyncConfig(): SyncConfig | null { return readJson<SyncConfig>(K_CONFIG) }
export function getSyncJwt(): SyncJwt | null { return readJson<SyncJwt>(K_JWT) }
export function getSyncDevice(): SyncDevice | null { return readJson<SyncDevice>(K_DEVICE) }
export function getLastSeq(): number { return Number(lsGet(K_SEQ) ?? '0') || 0 }

/** هل المزامنة مفعّلة صراحةً وكاملة الأركان؟ */
export function isSyncEnabled(): boolean {
  return lsGet(K_ENABLED) === '1'
    && getSyncConfig() !== null
    && getSyncJwt() !== null
    && getSyncDevice() !== null
}

/* ---------- الطابور الدائم (Dexie sync_ops) — يبقى بعد قتل التطبيق وإعادة فتحه ---------- */
export interface StoredPendingOp extends PendingOp {
  /** معرف السجل المحلي الناتج عن العملية (للتعويض عند الرفض) */
  local_result_id?: string | null
  updated_at: string
}

export const syncOpStore = {
  async load(): Promise<PendingOp[]> {
    const rows = await db.sync_ops.toArray()
    return rows.map(({ local_result_id: _l, updated_at: _u, ...op }) => op)
  },
  async save(ops: PendingOp[]): Promise<void> {
    const now = new Date().toISOString()
    await db.sync_ops.clear()
    if (ops.length > 0) {
      await db.sync_ops.bulkPut(ops.map((o) => ({ ...o, updated_at: now })))
    }
  },
}

/** إضافة عملية معلقة يدوياً (يستخدمها التدفق التلقائي والاختبارات) */
export async function putPendingOp(op: StoredPendingOp): Promise<void> {
  await db.sync_ops.put(op)
}

export async function listPendingOps(): Promise<StoredPendingOp[]> {
  return db.sync_ops.orderBy('created_at').reverse().limit(200).toArray()
}

/* ---------- خريطة أنواع العمليات المحلية ↔ بروتوكول الخادم ---------- */
const SYNC_TYPE_MAP: Record<string, string> = {
  SALE: 'SALE',
  PURCHASE: 'PURCHASE',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  PRODUCTION: 'PRODUCTION_BATCH',
  EXPENSE: 'EXPENSE',
  ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
  WASTE: 'WASTE',
  TRANSFER: 'TRANSFER',
  // DISTRIBUTION_LOAD / DISTRIBUTION_DELIVERY / DISTRIBUTION_RETURN:
  // غير قابلة للمزامنة حالياً — بروتوكول الخادم (0008) لا يدعمها بعد.
  // تبقى محلية بالكامل، وهذا موثق صراحة في التدقيق.
}

/** خريطة أنواع الخادم → معالج محلي (لتطبيق ما سُحب من أجهزة أخرى) */
const PULL_RPC_MAP: Record<string, string> = {
  SALE: 'create_sale',
  PURCHASE: 'create_purchase',
  CUSTOMER_PAYMENT: 'create_customer_payment',
  SUPPLIER_PAYMENT: 'create_supplier_payment',
  PRODUCTION_BATCH: 'create_production_batch',
  EXPENSE: 'create_expense',
  INVENTORY_ADJUSTMENT: 'create_inventory_adjustment',
  WASTE: 'create_waste',
  TRANSFER: 'create_transfer',
}

/* ---------- الإدراج بعد نجاح عملية محلية (من executeOperation) ---------- */
/**
 * تُستدعى بعد نجاح العملية محلياً. معطّلة = صفر عمل. مفعّلة = درج PENDING_SYNC
 * ثم جدولة مزامنة مؤجلة. لا تفشل العملية المحلية أبداً بسبب خطأ إدراج.
 */
export async function enqueueAfterLocalOp(
  localType: string,
  payload: Record<string, unknown>,
  localResultId: string | null,
): Promise<void> {
  if (!isSyncEnabled()) return
  const syncType = SYNC_TYPE_MAP[localType]
  if (!syncType) return
  const operationId = typeof payload.operation_id === 'string' ? payload.operation_id : null
  if (!operationId) return
  await db.sync_ops.put({
    operation_id: operationId,
    op_type: syncType,
    payload,
    state: 'PENDING_SYNC',
    created_at: new Date().toISOString(),
    attempts: 0,
    schema_version: 1,
    local_result_id: localResultId,
    device_id: getSyncDevice()?.deviceId,
    updated_at: new Date().toISOString(),
  })
  scheduleSync()
}

/** إدراج عملية إلغاء (إبطال فاتورة) بعد نجاحه محلياً */
export async function enqueueVoidAfterLocalOp(
  kind: 'SALE_VOID' | 'PURCHASE_VOID',
  refId: string,
  reason: string,
): Promise<void> {
  if (!isSyncEnabled()) return
  await db.sync_ops.put({
    operation_id: crypto.randomUUID(),
    op_type: kind,
    payload: kind === 'SALE_VOID' ? { sale_id: refId, reason } : { purchase_id: refId, reason },
    state: 'PENDING_SYNC',
    created_at: new Date().toISOString(),
    attempts: 0,
    schema_version: 1,
    local_result_id: refId,
    device_id: getSyncDevice()?.deviceId,
    updated_at: new Date().toISOString(),
  })
  scheduleSync()
}

/** إدراج upsert كيان مرجعي (عميل/مورد/صنف/سعر خاص) بعد حفظه محلياً */
export async function enqueueUpsertAfterLocalSave(
  kind: 'CUSTOMER_UPSERT' | 'SUPPLIER_UPSERT' | 'PRODUCT_UPSERT' | 'CUSTOMER_PRICE_UPSERT',
  row: Record<string, unknown>,
): Promise<void> {
  if (!isSyncEnabled()) return
  const id = typeof row.id === 'string' ? row.id : null
  if (!id) return
  const operationId = typeof row.operation_id === 'string' && row.operation_id
    ? row.operation_id
    : crypto.randomUUID()
  await db.sync_ops.put({
    operation_id: id /* مفتاح الطابور = معرف الكيان: آخر upsert يفوز على الوصفي */,
    op_type: kind,
    payload: { ...row, operation_id: operationId },
    state: 'PENDING_SYNC',
    created_at: new Date().toISOString(),
    attempts: 0,
    schema_version: 1,
    local_result_id: id,
    device_id: getSyncDevice()?.deviceId,
    updated_at: new Date().toISOString(),
  })
  scheduleSync()
}

function getCtxBusinessId(): string {
  // سياق الجلسة المحلية — يتوفر دائماً بعد تسجيل الدخول المحلي
  return String(getCtx().businessId ?? '')
}

/* ---------- تطبيق ما سُحب من الخادم (عمليات أجهزة أخرى) ---------- */
async function applyServerOp(op: ServerOp): Promise<void> {
  const payload = (op.payload ?? {}) as Record<string, unknown>
  if (op.op_type === 'CUSTOMER_UPSERT') {
    await db.customers.put({ ...payload, business_id: getCtxBusinessId() } as never)
    void invalidateLookups()
    return
  }
  if (op.op_type === 'SUPPLIER_UPSERT') {
    await db.suppliers.put({ ...payload, business_id: getCtxBusinessId() } as never)
    void invalidateLookups()
    return
  }
  if (op.op_type === 'PRODUCT_UPSERT') {
    await db.products.put({ ...payload, business_id: getCtxBusinessId() } as never)
    void invalidateLookups()
    return
  }
  if (op.op_type === 'CUSTOMER_PRICE_UPSERT') {
    await db.customer_products.put({ ...payload, business_id: getCtxBusinessId() } as never)
    void invalidateLookups()
    return
  }
  if (op.op_type === 'SALE_VOID') {
    await callRpc('void_sale', { p_sale_id: payload.sale_id, p_reason: payload.reason ?? 'إبطال من جهاز آخر' })
    return
  }
  if (op.op_type === 'PURCHASE_VOID') {
    await callRpc('void_purchase', { p_purchase_id: payload.purchase_id, p_reason: payload.reason ?? 'إبطال من جهاز آخر' })
    return
  }
  const fn = PULL_RPC_MAP[op.op_type]
  if (!fn) throw new Error(`نوع غير قابل للتطبيق محلياً: ${op.op_type}`)
  // المعالج المحلي idempotent بـoperation_id داخل الـpayload — التكرار يعيد duplicate
  await callRpc(fn, { p_payload: payload })
}

async function invalidateLookups(): Promise<void> {
  try {
    const { refreshLookups } = await import('@/services/lookups')
    void refreshLookups()
  } catch { /* الكاش سيُحدّث عند إعادة التشغيل */ }
}

/* ---------- التعويض المحلي عند رفض الخادم ---------- */
/**
 * الرفض مسبب من الخادم (كسر مخزون/ائتمان/صلاحية...). المحلي طبق العملية —
 * التعويض: إبطال محلي موجّه للفواتير (متاح)، أو CONFLICT لتدخل يدوي لما لا
 * يملك إبطالاً (دفعات/مصروف/إنتاج/تسويات — حد نظام موثق، لا دمج آلي للمال).
 */
async function compensateRejected(op: PendingOp, reason: string): Promise<void> {
  const stored = op as StoredPendingOp
  const applyConflict = async () => {
    // put دفاعي: حالة التعارض يجب أن تُحفظ حتى لو الصف غائب من الطابور
    const existing = await db.sync_ops.get(op.operation_id)
    await db.sync_ops.put({
      ...op, ...(existing ?? {}),
      state: 'CONFLICT',
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    } as StoredPendingOp)
  }
  try {
    if (op.op_type === 'SALE' && stored.local_result_id) {
      await callRpc('void_sale', { p_sale_id: stored.local_result_id, p_reason: `مرفوض من الخادم: ${reason}` })
      return // إلغاء ناجح — الحالة REJECTED تبقى موثقة بالسبب
    }
    if (op.op_type === 'PURCHASE' && stored.local_result_id) {
      await callRpc('void_purchase', { p_purchase_id: stored.local_result_id, p_reason: `مرفوض من الخادم: ${reason}` })
      return
    }
    await applyConflict()
  } catch {
    // فشل الإبطال المحلي (مثلاً دفعة مرتبطة) — تسوية يدوية إلزامية
    await applyConflict()
  }
}

/* ---------- دورة المزامنة ---------- */
export interface CentralSyncResult {
  uploaded: number
  synced: string[]
  rejected: { operation_id: string; reason: string }[]
  failed: { operation_id: string; error: string }[]
  pulled: number
  lastSeq: number
}

function buildTransport(): SyncTransport {
  const cfg = getSyncConfig()!
  const dev = getSyncDevice()!
  return createSupabaseTransport({
    url: cfg.url,
    anonKey: cfg.anonKey,
    accessToken: () => getSyncJwt()?.access_token ?? '',
    deviceId: dev.deviceId,
    deviceToken: dev.deviceToken,
  })
}

/** دورة كاملة: رفع بترتيب التبعيات → سحب وتطبيق. ترمي إن لم تكن مفعّلة. */
export async function runCentralSync(): Promise<CentralSyncResult> {
  if (!isSyncEnabled()) throw new Error('المزامنة غير مفعّلة — فعّلها من مركز المزامنة أولاً.')
  const lastSeq = getLastSeq()
  const res = await syncOnce(syncOpStore, buildTransport(), lastSeq, applyServerOp, {
    onRejected: (op, reason) => compensateRejected(op, reason),
  })
  lsSet(K_SEQ, String(res.lastSeq))
  return {
    uploaded: res.summary.synced.length + res.summary.rejected.length + res.summary.failed.length,
    synced: res.summary.synced,
    rejected: res.summary.rejected,
    failed: res.summary.failed,
    pulled: res.applied,
    lastSeq: res.lastSeq,
  }
}

/* ---------- جدولة مؤجلة (تجميع النداءات بعد كل عملية) ---------- */
let syncTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleSync(delayMs = 3000): void {
  if (!isSyncEnabled()) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    void runCentralSync().catch(() => undefined) // الأخطاء تظهر في مركز المزامنة
  }, delayMs)
}

/** مستمع عودة الاتصال — يُسجل عند التفعيل ويُلغى عند الإيقاف */
function onOnline(): void { scheduleSync(1500) }
export function installOnlineListener(): void {
  window.addEventListener('online', onOnline)
}
export function removeOnlineListener(): void {
  window.removeEventListener('online', onOnline)
}

/* ---------- التفعيل الصريح (من مركز المزامنة) ---------- */
export interface ConnectInput {
  url: string
  anonKey: string
  mode: 'cloud' | 'rig'
  /** وضع cloud */
  email?: string
  password?: string
  /** وضع rig (خادم اختبار): توكن مُصدر من المشغّل + معرف المستخدم */
  accessToken?: string
  userId?: string
  deviceName: string
}

function normalizeUrl(u: string): string { return u.trim().replace(/\/+$/, '') }

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, init)
  const text = await res.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}

/** تسجيل الجهاز على الخادم — يعيد رمزاً يُعرض مرة واحدة (الخادم يخزن هاشاً فقط) */
async function registerDeviceHttp(jwt: string, userId: string, input: ConnectInput): Promise<SyncDevice> {
  const base = normalizeUrl(input.url)
  const platform = /Electron/i.test(navigator.userAgent) ? 'WINDOWS' : 'WEB'
  const { status, json } = await fetchJson(`${base}/rest/v1/rpc/register_device`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: input.anonKey,
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ p_name: input.deviceName, p_platform: platform, p_profile_id: userId }),
  })
  if (status !== 200) {
    throw new Error(`فشل تسجيل الجهاز (${status}). ${JSON.stringify(json).slice(0, 200)}`)
  }
  const r = json as { device_id: string; token: string }
  if (!r?.device_id || !r?.token) throw new Error('رد غير متوقع من تسجيل الجهاز.')
  return { deviceId: r.device_id, deviceToken: r.token, name: input.deviceName, platform }
}

/**
 * الاتصال والتفعيل الصريح:
 * - cloud: دخول GoTrue الحقيقي (بريد + كلمة مرور) ثم تسجيل جهاز.
 * - rig: توكن مُصدر من المشغّل لخادم اختبار محلي (موثق: ليس بديلاً عن مصادقة الإنتاج).
 */
export async function connectAndEnable(input: ConnectInput): Promise<{ device: SyncDevice; email: string; userId: string }> {
  const url = normalizeUrl(input.url)
  if (!/^https?:\/\//.test(url)) throw new Error('رابط المشروع يجب أن يبدأ بـhttps:// أو http:// (لخادم محلي).')
  if (!input.anonKey.trim()) throw new Error('مفتاح publishable (anon) مطلوب.')
  if (!input.deviceName.trim()) throw new Error('اسم الجهاز مطلوب.')

  let jwt: string
  let userId: string
  let email: string

  if (input.mode === 'cloud') {
    if (!input.email?.trim() || !input.password) throw new Error('البريد وكلمة المرور مطلوبان للوضع السحابي.')
    const { status, json } = await fetchJson(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: input.anonKey },
      body: JSON.stringify({ email: input.email.trim(), password: input.password }),
    })
    if (status !== 200) {
      const msg = (json as { error_description?: string; msg?: string })?.error_description
        ?? (json as { msg?: string })?.msg ?? JSON.stringify(json).slice(0, 160)
      throw new Error(`فشل تسجيل الدخول السحابي (${status}): ${msg}`)
    }
    const session = json as { access_token: string; user?: { id?: string; email?: string } }
    if (!session?.access_token || !session?.user?.id) throw new Error('رد مصادقة غير متوقع.')
    jwt = session.access_token
    userId = session.user.id
    email = session.user.email ?? input.email.trim()
  } else {
    if (!input.accessToken?.trim() || !input.userId?.trim()) {
      throw new Error('وضع خادم الاختبار يتطلب توكن وصول ومعرف مستخدم مُصدرين من المشغّل.')
    }
    jwt = input.accessToken.trim()
    userId = input.userId.trim()
    email = 'test-rig@local'
  }

  const device = await registerDeviceHttp(jwt, userId, { ...input, url })

  writeJson(K_CONFIG, { url, anonKey: input.anonKey, mode: input.mode })
  writeJson(K_JWT, { access_token: jwt, userId, email, obtained_at: new Date().toISOString() })
  writeJson(K_DEVICE, device)
  lsSet(K_ENABLED, '1')
  installOnlineListener()
  return { device, email, userId }
}

/** إيقاف مؤقت — يبقي الإعداد والطابور، فقط يتوقف عن المزامنة */
export function disableSync(): void {
  lsDel(K_ENABLED)
  removeOnlineListener()
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
}

/** حذف الاتصال كلياً — يبقي الطابور المحلي والبيانات كما هي */
export function forgetConnection(): void {
  disableSync()
  lsDel(K_CONFIG)
  lsDel(K_JWT)
  lsDel(K_DEVICE)
  lsDel(K_SEQ)
}

/** إعادة تفعيل بعد إيقاف مؤقت (تحقق أن كل الأركان ما تزال موجودة) */
export function reEnable(): void {
  if (getSyncConfig() && getSyncJwt() && getSyncDevice()) {
    lsSet(K_ENABLED, '1')
    installOnlineListener()
  } else {
    throw new Error('لا يوجد اتصال محفوظ — اربط الجهاز أولاً.')
  }
}

export { isFinancialOp }

/* ---------- مصادر للفحوص فقط — نفس المنطق المستخدم في الدورة الحقيقية ---------- */
export const applyServerOpForTests = applyServerOp
export const compensateForTests = compensateRejected
