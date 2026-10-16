/* ============================================================================
 * ناقل Supabase — يربط محرك المزامنة بمشروع Supabase حقيقي عبر PostgREST RPC.
 * ---------------------------------------------------------------------------
 * الأمان:
 *   - المفتاح العام (anon key) فقط داخل التطبيق — هذا مفتاح publishable وليس سراً.
 *   - سر الجهاز (device token) يُدخل في إعدادات التطبيق وقت التشغيل لكل جهاز
 *     (localStorage/متغير جلسة) — لا يوضع في المستودع ولا في بناء EXE.
 *   - كل طلب يحمل: Authorization: Bearer <JWT المستخدم> + ترويستي الجهاز.
 *     الخادم يتحقق من الاثنين معاً (هوية إنسان + هوية آلة).
 * هذه الوحدة لا تُستخدم إلا عند تهيئة المزامنة صراحة (تجربة الخطة B) —
 * التشغيل المحلي الحالي لا يلمسها إطلاقاً.
 * ========================================================================== */
import type { PendingOp, ServerOp, SubmitResult, SyncTransport } from './engine'

export interface SupabaseTransportConfig {
  url: string               // https://<project>.supabase.co
  anonKey: string           // publishable key — ليس سراً
  accessToken: () => string // JWT المستخدم الحالي (يرجعه تسجيل الدخول لاحقاً)
  deviceId: string
  deviceToken: string
  fetchFn?: typeof fetch
}

export function createSupabaseTransport(cfg: SupabaseTransportConfig): SyncTransport {
  const f = cfg.fetchFn ?? fetch
  const base = cfg.url.replace(/\/+$/, '')

  async function rpc<T>(fn: string, body: unknown): Promise<T> {
    const res = await f(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.accessToken()}`,
        'x-device-id': cfg.deviceId,
        'x-device-token': cfg.deviceToken,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`فشل اتصال الخادم (${res.status}). ${text.slice(0, 200)}`)
    }
    return (await res.json()) as T
  }

  return {
    async submit(op: PendingOp): Promise<SubmitResult> {
      const r = await rpc<SubmitResult>('submit_sync_operation', {
        p_operation_id: op.operation_id,
        p_op_type: op.op_type,
        p_payload: op.payload,
        p_client_recorded_at: op.created_at,
      })
      return r
    },
    async pull(sinceSeq: number, limit = 500): Promise<ServerOp[]> {
      const rows = await rpc<ServerOp[]>('pull_changes', {
        p_since_seq: sinceSeq,
        p_limit: limit,
      })
      return Array.isArray(rows) ? rows : []
    },
  }
}
