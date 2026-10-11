/** تهيئة النظام وأول مالك (بند 68) — معالج فاخر من خطوتين: بياناتك ثم مخبزك */
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Store, UserRound, ShieldCheck, Sparkles } from 'lucide-react'
import { BakeryLogo } from './BakeryLogo'
import { Button, Card, Field, Input } from '@/components/ui/primitives'
import { signIn, bootstrapBusiness } from '@/services/auth'
import { loadAuthState } from '@/app/authStore'

export default function BootstrapPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), [email])
  const step2Valid = businessName.trim().length >= 2

  const goStep2 = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!emailValid) return setError('أدخل بريداً إلكترونياً صحيحاً.')
    if (password.length < 6) return setError('كلمة المرور 6 أحرف على الأقل.')
    if (confirm !== password) return setError('تأكيد كلمة المرور غير مطابق.')
    setStep(2)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      await bootstrapBusiness('LOCAL', businessName.trim(), fullName.trim() || null, phone.trim() || null)
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
        {/* الترويسة */}
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="anim-pop flex size-16 items-center justify-center rounded-2xl bg-white shadow-card-lg">
            <BakeryLogo className="size-12" />
          </div>
          <h1 className="text-xl font-black text-stone-900">أهلاً بك في نظام إدارة المخبز</h1>
          <p className="max-w-sm text-xs leading-relaxed text-stone-500">
            خطوتان فقط وتصبح جاهزاً — كل بياناتك تُخزّن على هذا الجهاز فقط وتعمل بلا إنترنت.
          </p>
        </div>

        {/* مؤشر الخطوات */}
        <div className="mb-4 flex items-center justify-center gap-2">
          <StepDot n={1} label="بياناتك" active={step === 1} done={step > 1} />
          <div className={`h-0.5 w-10 rounded-full transition-colors ${step > 1 ? 'bg-primary-500' : 'bg-stone-300'}`} />
          <StepDot n={2} label="مخبزك" active={step === 2} done={false} />
        </div>

        <Card className="overflow-hidden">
          {step === 1 ? (
            <form key="s1" onSubmit={goStep2} className="anim-slide-in space-y-4 p-5">
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
                <UserRound className="size-4 text-primary-600" /> بيانات المالك
              </h2>
              <Field label="البريد الإلكتروني" required hint="يُستخدم كاسم مستخدم محلي — لا يُرسل لأي جهة">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className="text-left" placeholder="you@example.com" autoComplete="email" />
              </Field>
              <Field label="كلمة المرور" required hint="6 أحرف على الأقل">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className="text-left" autoComplete="new-password" />
              </Field>
              <Field label="تأكيد كلمة المرور" required error={confirm && confirm !== password ? 'غير مطابق' : null}>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" className="text-left" autoComplete="new-password" />
              </Field>
              {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{error}</p>}
              <Button type="submit" className="w-full" size="lg" icon={<ChevronLeft className="size-4" />}>
                التالي — بيانات المخبز
              </Button>
            </form>
          ) : (
            <form key="s2" onSubmit={submit} className="anim-slide-in space-y-4 p-5">
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
                <Store className="size-4 text-primary-600" /> بيانات المخبز
              </h2>
              <Field label="اسم المخبز / النشاط" required>
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required placeholder="مثال: مخبز النور" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="اسمك الكامل">
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="محمد أحمد" />
                </Field>
                <Field label="الهاتف">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" className="text-left" placeholder="05..." />
                </Field>
              </div>
              {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{error}</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" icon={<ChevronRight className="size-4" />} onClick={() => setStep(1)} disabled={busy}>
                  رجوع
                </Button>
                <Button type="submit" className="flex-1" size="lg" loading={busy} icon={<Sparkles className="size-4" />} disabled={!step2Valid}>
                  إنشاء النظام وتعييني مالكاً
                </Button>
              </div>
            </form>
          )}
        </Card>

        <Card className="mt-3 border-info-200 bg-info-50/60 p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-extrabold text-info-800">
            <ShieldCheck className="size-4" /> ماذا يفعل الإنشاء؟
          </h2>
          <ul className="mt-2 space-y-1 text-2xs leading-relaxed text-info-900">
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0" /> ينشئ النشاط التجاري ويرقّي حسابك إلى المالك — مرة واحدة فقط.</li>
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0" /> يجهز الوحدات والمستودعات والصندوق وفئات المصروفات تلقائياً.</li>
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0" /> بياناتك محفوظة على هذا الجهاز فقط — ويمكنك تصديرها من مركز النسخ الاحتياطية.</li>
          </ul>
        </Card>

        <div className="mt-4 text-center text-xs font-bold">
          <Link to="/login" className="text-primary-700 hover:underline">العودة لتسجيل الدخول</Link>
        </div>
      </div>
    </div>
  )
}

function StepDot({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`flex size-6 items-center justify-center rounded-full text-2xs font-black transition-all ${
          done ? 'bg-success-600 text-white' : active ? 'bg-primary-600 text-white shadow-sm' : 'bg-stone-200 text-stone-500'
        }`}
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <span className={`text-2xs font-extrabold ${active ? 'text-stone-900' : 'text-stone-400'}`}>{label}</span>
    </div>
  )
}
