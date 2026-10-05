/** شاشة تظهر عندما لا تكون متغيرات البيئة مضبوطة (بند 119) */
import { Card } from '@/components/ui/primitives'

export function EnvError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-100 p-6" dir="rtl">
      <Card className="max-w-lg p-6">
        <h1 className="text-lg font-extrabold text-stone-900">الإعداد غير مكتمل</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          لم يتم ضبط متغيرات البيئة الخاصة بـ Supabase. انسخ الملف <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-bold">.env.example</code> إلى
          <code className="mx-1 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-bold">.env</code>
          واملأ <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-bold">VITE_SUPABASE_URL</code> و
          <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-bold">VITE_SUPABASE_PUBLISHABLE_KEY</code>
          من إعدادات مشروعك في Supabase (Settings → API).
        </p>
        <p className="mt-3 text-xs leading-relaxed text-stone-500">
          ملاحظة أمنية: استخدم مفتاح Publishable (anon) فقط — لا تضع service_role key في الواجهة أبداً.
        </p>
      </Card>
    </div>
  )
}
