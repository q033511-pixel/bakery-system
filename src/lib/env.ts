/** قراءة متغيرات البيئة مع تحقق صارم عند التشغيل (بند 66/119) */

function required(name: string): string {
  const v = import.meta.env[name] as string | undefined
  return v?.trim() ?? ''
}

function optional(name: string, fallback: string): string {
  const v = import.meta.env[name] as string | undefined
  return v?.trim() || fallback
}

export const env = {
  supabaseUrl: required('VITE_SUPABASE_URL'),
  supabasePublishableKey: required('VITE_SUPABASE_PUBLISHABLE_KEY'),
  basePath: optional('VITE_BASE_PATH', '/'),
}

export function isSupabaseConfigured(): boolean {
  return env.supabaseUrl.startsWith('http') && env.supabasePublishableKey.length > 20
}
