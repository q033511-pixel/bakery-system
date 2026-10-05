/** تهيئة النظام وأول مالك (بند 68) — تتطلب: تسجيل دخول + رمز تهيئة من قاعدة البيانات */
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BakeryLogo } from './BakeryLogo'
import { Button, Card, Field, Input } from '@/components/ui/primitives'
import { signIn, bootstrapBusiness } from '@/services/auth'
import { loadAuthState } from '@/app/authStore'

export default function BootstrapPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      await bootstrapBusiness(setupCode.trim(), businessName.trim(), fullName.trim() || null, phone.trim() || null)
      await loadAuthState()
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء التهيئة.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary-50 via-surface-50 to-surface-100 p-5">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BakeryLogo className="size-16" />
          <h1 className="text-xl font-extrabold text-stone-900">تهيئة النظام — الخطوة الأولى</h1>
          <p className="max-w-sm text-xs leading-relaxed text-stone-500">
            أنشئ حسابك أولاً من شاشة الدخول («إنشاء حساب جديد»)، سجّل الدخول، ثم أكمل التهيئة هنا برمز التهيئة.
          </p>
        </div>

        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <Field label="البريد الإلكتروني" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" className="text-left" />
            </Field>
            <Field label="كلمة المرور" required>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required dir="ltr" className="text-left" />
            </Field>
            <Field label="رمز التهيئة" required hint="يُستخرج من SQL Editor في Supabase: select setup_code from system_setup;">
              <Input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} required dir="ltr" className="text-left font-mono" placeholder="BAKERY-SETUP-XXXXXXXX" />
            </Field>
            <Field label="اسم المخبز / النشاط" required>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required placeholder="مثال: مخبز النور" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="اسمك الكامل">
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
              <Field label="الهاتف">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" className="text-left" />
              </Field>
            </div>

            {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{error}</p>}

            <Button type="submit" className="w-full" size="lg" loading={busy}>
              إنشاء النظام وتعييني مالكاً
            </Button>
          </form>

          <div className="mt-4 text-center text-xs font-bold">
            <Link to="/login" className="text-primary-700 hover:underline">العودة لتسجيل الدخول</Link>
          </div>
        </Card>

        <Card className="mt-3 border-info-200 bg-info-50/60 p-4">
          <h2 className="text-xs font-extrabold text-info-800">ماذا تفعل التهيئة؟</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-2xs leading-relaxed text-info-900">
            <li>تنشئ النشاط التجاري وترقّي حسابك إلى المالك (OWNER) — التهيئة تعمل مرة واحدة فقط.</li>
            <li>تنشئ الوحدات الافتراضية (كغ، ربطة، كيس...) والتحويلات، والمستودعين، والصندوق الرئيسي، وفئات المصروفات.</li>
            <li>لا يمكن لأي شخص آخر أن يصبح مالكاً بمجرد التسجيل — الحماية داخل قاعدة البيانات.</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
