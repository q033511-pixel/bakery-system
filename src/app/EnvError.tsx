/**
 * شاشة الإعداد (بند 119) — تظهر عندما لا تكون مفاتيح الاتصال بقاعدة البيانات مضبوطة.
 * بدلاً من إنهار التطبيق أو طلب إعادة بناء، تتيح هذه الشاشة ربط قاعدة البيانات
 * مباشرة من الموقع المنشور: تُدخل مفاتيح Supabase فتُحفظ في هذا المتصفح فقط
 * (localStorage) ويعمل التطبيق فوراً.
 * أمنياً: يُقبل مفتاح Publishable (anon) فقط — بند 66.
 */
import { useState } from 'react'
import { CheckCircle2, Database, Eye, EyeOff, ExternalLink, KeyRound, Link2, ShieldCheck, Trash2 } from 'lucide-react'
import { Button, Card, Field, Input } from '@/components/ui/primitives'
import { clearRuntimeConfig, env, isSupabaseConfigured, saveRuntimeConfig } from '@/lib/env'

const STEPS: [string, string][] = [
  ['أنشئ مشروعاً', 'سجّل مجاناً في supabase.com وأنشئ مشروعاً جديداً (New project).'],
  ['انسخ الرابط', 'من إعدادات المشروع: Settings → API → Project URL.'],
  ['انسخ المفتاح', 'من نفس الصفحة: Project API Keys → انسخ مفتاح Publishable "anon".'],
]

export function EnvError() {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [errors, setErrors] = useState<{ url?: string; key?: string }>({})

  const savedInvalid = env.fromRuntime && !isSupabaseConfigured()

  function connect() {
    const next: { url?: string; key?: string } = {}
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url.trim())) {
      next.url = 'أدخل رابط مشروع صحيحاً بالشكل: https://xxxx.supabase.co'
    }
    if (key.trim().length <= 20) {
      next.key = 'المفتاح قصير جداً — انسخ مفتاح Publishable (anon) كاملاً من Supabase.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    saveRuntimeConfig(url, key)
    window.location.reload()
  }

  function resetSaved() {
    clearRuntimeConfig()
    window.location.reload()
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 via-surface-50 to-warning-50 p-4 sm:p-6"
      dir="rtl"
    >
      <div className="w-full max-w-xl">
        {/* الترويسة */}
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-primary-600 shadow-lg shadow-primary-600/25">
            <Database className="size-8 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-stone-900">نظام إدارة وتشغيل المخبز</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
            النظام جاهز للعمل — خطوة واحدة متبقية: ربط قاعدة البيانات بهذا المتصفح.
          </p>
        </div>

        <Card className="p-5 sm:p-6">
          {savedInvalid && (
            <div className="mb-4 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm leading-relaxed text-warning-800">
              <span className="font-bold">الإعداد المحفوظ سابقاً غير صالح.</span> أدخل المفاتيح الصحيحة أدناه،
              أو{' '}
              <button onClick={resetSaved} className="inline-flex items-center gap-1 font-bold text-warning-900 underline underline-offset-4">
                <Trash2 className="size-3.5" /> امسح الإعداد المحفوظ وابدأ من جديد
              </button>
              .
            </div>
          )}

          {/* الخطوات */}
          <div className="mb-5 space-y-2.5">
            {STEPS.map(([title, desc], i) => (
              <div key={title} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-extrabold text-primary-700">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-stone-700">
                  <span className="font-bold text-stone-900">{title}:</span> {desc}
                </p>
              </div>
            ))}
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 pt-1 text-sm font-bold text-primary-700 underline-offset-4 hover:underline"
            >
              <ExternalLink className="size-4" />
              فتح لوحة تحكم Supabase في تبويب جديد
            </a>
          </div>

          <hr className="mb-5 border-stone-200" />

          {/* الحقول */}
          <div className="space-y-4">
            <Field label="رابط المشروع (Project URL)" required error={errors.url} hint="يبدأ بـ https:// وينتهي بـ supabase.co">
              <div className="relative">
                <Link2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden />
                <Input
                  dir="ltr"
                  className="pr-9 text-left"
                  placeholder="https://abcdefgh.supabase.co"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </Field>

            <Field label="مفتاح النشر (Publishable / anon key)" required error={errors.key}>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden />
                <Input
                  dir="ltr"
                  className="pl-10 pr-9 text-left"
                  type={showKey ? 'text' : 'password'}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-600"
                  aria-label={showKey ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            <Button size="lg" className="w-full" onClick={connect} icon={<CheckCircle2 className="size-5" />}>
              ربط قاعدة البيانات وبدء الاستخدام
            </Button>

            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-stone-500">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success-600" aria-hidden />
              يُحفظ الإعداد في هذا المتصفح فقط ولا يُرسل لأي جهة. استخدم مفتاح Publishable (anon) حصراً —
              ولا تضع مفتاح service_role في الواجهة أبداً.
            </p>
          </div>
        </Card>

        <p className="mt-4 text-center text-2xs text-stone-400">
          نظام إدارة المخبز — مشتريات · مخزون · إنتاج · مبيعات · توزيع · حسابات
        </p>
      </div>
    </div>
  )
}
