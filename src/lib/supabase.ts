import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured } from './env'

/**
 * Supabase client — يستخدم Publishable Key فقط (بند 66).
 * لا يوجد أي service_role أو secret في الواجهة إطلاقاً.
 *
 * آمن عند الإقلاع: إذا لم تُضبط مفاتيح الاتصال بعد (موقع منشور دون إعداد)
 * نُصدّر عميلاً بديلاً (stub) لا يُسقط التطبيق عند الاستيراد — تتحقق بوابة
 * الإعداد في App.tsx (isSupabaseConfigured) وتعرض شاشة ربط قاعدة البيانات،
 * ولا تُنفَّذ أي استعلام في تلك الحالة أصلاً.
 */

export const DB_NOT_CONFIGURED_MSG = 'قاعدة البيانات غير مربوطة — أكمل الإعداد أولاً ثم أعد تحميل الصفحة.'

/** عميل بديل آمن: أي استعلام يُرفض برسالة واضحة، وauth يعيد قيمًا فارغة سليمة */
function createStubClient(): SupabaseClient {
  const rejectChain = (): unknown => {
    const fn = new Proxy(function stub() {}, {
      get(_t, prop) {
        // ثم-able يرفض: كل await على أي سلسلة استعلام يفشل برسالة واضحة
        if (prop === 'then') {
          return (_res: unknown, rej: (e: Error) => void) => rej(new Error(DB_NOT_CONFIGURED_MSG))
        }
        if (prop === 'catch' || prop === 'finally') {
          return () => rejectChain()
        }
        return rejectChain()
      },
      apply() {
        return rejectChain()
      },
    })
    return fn
  }

  const authNamespace = {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe() { /* noop */ } } },
    }),
  }

  return new Proxy({} as Record<PropertyKey, unknown>, {
    get(_t, prop) {
      if (prop === 'auth') return authNamespace
      if (prop === 'then') {
        return (_res: unknown, rej: (e: Error) => void) => rej(new Error(DB_NOT_CONFIGURED_MSG))
      }
      return rejectChain()
    },
  }) as unknown as SupabaseClient
}

export const supabase: SupabaseClient = isSupabaseConfigured()
  ? createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'bakery.auth',
      },
      db: { schema: 'public' },
      global: { headers: { 'x-client-info': 'bakery-system/1.0.0' } },
    })
  : createStubClient()
