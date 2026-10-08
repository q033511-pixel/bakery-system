/** قراءة متغيرات البيئة + دعم الإعداد التفاعلي وقت التشغيل (بند 66/119)
 *
 * مصادر الإعداد بالترتيب:
 * 1) الإعداد التفاعلي المحفوظ في هذا المتصفح (localStorage) — يتيح ربط قاعدة
 *    البيانات من الموقع المنشور مباشرة دون إعادة بناء أو نشر.
 * 2) متغيرات البناء (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
 */

const RUNTIME_CONFIG_KEY = 'bakery.runtime_config'

export interface RuntimeConfig {
  supabaseUrl: string
  supabasePublishableKey: string
}

function readRuntimeConfig(): RuntimeConfig | null {
  try {
    const raw = localStorage.getItem(RUNTIME_CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RuntimeConfig>
    const url = String(parsed?.supabaseUrl ?? '').trim()
    const key = String(parsed?.supabasePublishableKey ?? '').trim()
    if (!url || !key) return null
    return { supabaseUrl: url, supabasePublishableKey: key }
  } catch {
    return null
  }
}

function buildTime(name: string): string {
  const v = import.meta.env[name] as string | undefined
  return v?.trim() ?? ''
}

const runtime = readRuntimeConfig()

export const env = {
  supabaseUrl: runtime?.supabaseUrl || buildTime('VITE_SUPABASE_URL'),
  supabasePublishableKey: runtime?.supabasePublishableKey || buildTime('VITE_SUPABASE_PUBLISHABLE_KEY'),
  basePath: buildTime('VITE_BASE_PATH') || '/',
  /** هل الإعداد الحالي قادم من الإدخال التفاعلي في هذا المتصفح؟ */
  fromRuntime: Boolean(runtime),
}

export function isSupabaseConfigured(): boolean {
  return /^https?:\/\/.+/i.test(env.supabaseUrl) && env.supabasePublishableKey.length > 20
}

/** حفظ مفاتيح الاتصال في هذا المتصفح ثم إعادة تحميل التطبيق (بدون إعادة بناء) */
export function saveRuntimeConfig(url: string, key: string): void {
  const cfg: RuntimeConfig = {
    supabaseUrl: url.trim(),
    supabasePublishableKey: key.trim(),
  }
  localStorage.setItem(RUNTIME_CONFIG_KEY, JSON.stringify(cfg))
}

/** مسح الإعداد التفاعلي المحفوظ في هذا المتصفح */
export function clearRuntimeConfig(): void {
  localStorage.removeItem(RUNTIME_CONFIG_KEY)
}
