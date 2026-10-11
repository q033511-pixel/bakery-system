/**
 * صفحة الإعداد الأول — خطوتان فقط بلا أي حسابات (طلب الزبون):
 * 1) معلومات أساسية بسيطة: اسم المخبز + اسمك + الهاتف
 * 2) رمز سري من 4 أرقام يفتح النظام في كل مرة
 * كل شيء يُنشأ محلياً على هذا الجهاز — لا بريد ولا كلمة مرور ولا خادم.
 */
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Check, ChevronLeft, Store, UserRound, ShieldCheck, Sparkles } from 'lucide-react'
import { BakeryLogo } from './BakeryLogo'
import { Button, Card, Field, Input } from '@/components/ui/primitives'
import PinPad from './PinPad'
import { setupLocalSystem } from '@/services/auth'
import { loadAuthState } from '@/app/authStore'
import { hasPin } from '@/lib/pin'

export default function SetupPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2>(1)
  const [businessName, setBusinessName] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPinState] = useState('')
  const [firstPin, setFirstPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [phase, setPhase] = useState<'enter' | 'confirm'>('enter')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)

  // جهاز مُهيأ مسبقاً برمز؟ لا يجوز الوصول للإعداد — العودة للقفل
  if (hasPin()) return <Navigate to="/lock" replace />

  const step1Valid = businessName.trim().length >= 2

  const goStep2 = () => {
    setError(null)
    if (!step1Valid) return setError('أدخل اسم المخبز (حرفان على الأقل).')
    setStep(2)
  }

  const fail = (msg: string) => {
    setError(msg)
    setShake(true)
    setTimeout(() => setShake(false), 500)
    if (navigator.vibrate) navigator.vibrate(150)
  }

  const onPadComplete = async (code: string) => {
    setError(null)
    if (phase === 'enter') {
      setFirstPin(code) // الهدف يُخزَّن منفصلاً — اللوحة تُفرَّغ للتأكيد
      setConfirmPin('')
      setPhase('confirm')
      return
    }
    if (code !== firstPin) {
      setPinState('')
      setConfirmPin('')
      setFirstPin('')
      setPhase('enter')
      fail('الرمزان غير متطابقين — أدخلهما من جديد.')
      return
    }
    setBusy(true)
    try {
      await setupLocalSystem({ businessName, fullName, phone, pin: code })
      await loadAuthState()
      navigate('/', { replace: true })
    } catch (err) {
      setPinState('')
      setConfirmPin('')
      setFirstPin('')
      setPhase('enter')
      fail(err instanceof Error ? err.message : 'حدث خطأ أثناء التهيئة.')
      setBusy(false)
    }
  }

  const padValue = phase === 'enter' ? pin : confirmPin

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
          <StepDot n={1} label="معلوماتك" active={step === 1} done={step > 1} />
          <div className={`h-0.5 w-10 rounded-full transition-colors ${step > 1 ? 'bg-primary-500' : 'bg-stone-300'}`} />
          <StepDot n={2} label="الرمز السري" active={step === 2} done={false} />
        </div>

        <Card className="overflow-hidden">
          {step === 1 ? (
            <form
              key="s1"
              onSubmit={(e) => { e.preventDefault(); goStep2() }}
              className="anim-slide-in space-y-4 p-5"
            >
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
                <Store className="size-4 text-primary-600" /> معلومات المخبز
              </h2>
              <Field label="اسم المخبز / النشاط" required>
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required placeholder="مثال: مخبز النور" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="اسمك الكامل" hint="اختياري">
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="محمد أحمد" />
                </Field>
                <Field label="الهاتف" hint="اختياري">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" className="text-left" placeholder="05..." />
                </Field>
              </div>
              {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{error}</p>}
              <Button type="submit" className="w-full" size="lg" icon={<ChevronLeft className="size-4" />} disabled={!step1Valid}>
                التالي — تعيين الرمز السري
              </Button>
            </form>
          ) : (
            <div key="s2" className="anim-slide-in space-y-5 p-5">
              <div className="text-center">
                <h2 className="flex items-center justify-center gap-2 text-sm font-extrabold text-stone-800">
                  <UserRound className="size-4 text-primary-600" />
                  {phase === 'enter' ? 'اختر رمزاً سرياً من 4 أرقام' : 'أعد إدخال الرمز للتأكيد'}
                </h2>
                <p className="mt-1 text-2xs text-stone-500">
                  هذا الرمز يفتح النظام في كل مرة — اجعله سهلاً عليك وصعباً على غيرك.
                </p>
              </div>
              <PinPad
                value={padValue}
                onChange={phase === 'enter' ? setPinState : setConfirmPin}
                onComplete={(v) => void onPadComplete(v)}
                disabled={busy}
                shake={shake}
              />
              {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-center text-xs font-bold text-danger-700">{error}</p>}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  icon={<ChevronLeft className="size-4" />}
                  onClick={() => {
                    if (phase === 'confirm') { setConfirmPin(''); setPhase('enter'); setError(null) }
                    else setStep(1)
                  }}
                  disabled={busy}
                >
                  رجوع
                </Button>
                <Button type="button" className="flex-1" size="lg" loading={busy} icon={<Sparkles className="size-4" />} disabled={phase !== 'confirm'}>
                  إنشاء نظامي والدخول
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="mt-3 border-info-200 bg-info-50/60 p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-extrabold text-info-800">
            <ShieldCheck className="size-4" /> ماذا يحدث عند الإنشاء؟
          </h2>
          <ul className="mt-2 space-y-1 text-2xs leading-relaxed text-info-900">
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0" /> يجهز الوحدات والمستودعات والصندوق وفئات المصروفات تلقائياً.</li>
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0" /> بياناتك محفوظة على هذا الجهاز فقط — ويمكنك تصديرها من مركز النسخ الاحتياطية.</li>
            <li className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0" /> الرمز السري يُحفظ مشفّراً — ولا يُرسل لأي جهة إطلاقاً.</li>
          </ul>
        </Card>
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
