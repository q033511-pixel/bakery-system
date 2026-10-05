/**
 * RPC wrapper — استدعاء دوال PostgreSQL عبر Supabase مع رسائل خطأ عربية واضحة (بند 64/90).
 * لا stack traces للمستخدم؛ التفاصيل تُسجل في console للمطوّر.
 */
import { supabase } from '@/lib/supabase'

export class RpcError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

export async function rpc<T = unknown>(fnName: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fnName, params)
  if (error) {
    // رسائل PostgreSQL العربية تصل كما هي؛ الأخرى تُترجم
    const msg = translateError(error.message)
    if (!/[\u0600-\u06FF]/.test(msg)) {
      console.error(`[rpc:${fnName}]`, error)
    }
    throw new RpcError(msg, error.code)
  }
  return data as T
}

function translateError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('failed to fetch') || m.includes('network')) return 'تعذر الاتصال بالخادم — تحقق من الإنترنت.'
  if (m.includes('jwt') || m.includes('invalid refresh token') || m.includes('auth')) {
    return 'انتهت الجلسة — أعد تسجيل الدخول.'
  }
  if (m.includes('permission denied') || m.includes('row-level security')) {
    return 'ليس لديك صلاحية لتنفيذ هذه العملية.'
  }
  if (m.includes('duplicate key') || m.includes('unique constraint')) {
    return 'هذه العملية مسجلة مسبقاً — لن يتم تكرارها.'
  }
  return msg
}
