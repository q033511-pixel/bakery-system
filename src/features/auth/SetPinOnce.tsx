/**
 * تعيين الرمز السري — مرة واحدة فقط:
 * للأجهزة المُهيأة بإصدار سابق (بلا رمز) — تعيين رمز 4 أرقام ثم فتح النظام مباشرة.
 */
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { KeyRound, Sparkles } from 'lucide-react'
import { BakeryLogo } from './BakeryLogo'
import { Button, Card } from '@/components/ui/primitives'
import PinPad from './PinPad'
import { setPinFirstTime } from '@/services/auth'
import { loadAuthState } from '@/app/authStore'
import { hasPin } from '@/lib/pin'

export default function SetPinOnce() {
  const navigate = useNavigate()
  const [pin, setPinState] = useState('')
  const [firstPin, setFirstPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [phase, setPhase] = useState<'enter' | 'confirm'>('enter')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)

  const fail = (msg: string) => {
    setError(msg)
    setShake(true)
    if (navigator.vibrate) navigator.vibrate(150)
    setTimeout(() => setShake(false), 500)
  }

  const onComplete = async (code: string) => {
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
      await setPinFirstTime(code)
      await loadAuthState()
      navigate('/', { replace: true })
    } catch (err) {
      setPinState('')
      setConfirmPin('')
      setFirstPin('')
      setPhase('enter')
      fail(err instanceof Error ? err.message : 'تعذر تعيين الرمز.')
      setBusy(false)
    }
  }

  const padValue = phase === 'enter' ? pin : confirmPin

  // رمز موجود مسبقاً؟ هذه الصفحة للمرة الأولى فقط — كل الـhooks أُكملت فوق
  if (hasPin()) return <Navigate to="/lock" replace />

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary-50 via-surface-50 to-surface-100 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="anim-pop flex size-16 items-center justify-center rounded-2xl bg-white shadow-card-lg">
            <BakeryLogo className="size-12" />
          </div>
          <h1 className="flex items-center gap-1.5 text-lg font-black text-stone-900">
            <KeyRound className="size-5 text-primary-600" /> عيّن رمزك السري
          </h1>
          <p className="max-w-xs text-xs leading-relaxed text-stone-500">
            أضفنا قفلاً برمز من 4 أرقام — من الآن فصاعداً يفتح النظام بهذا الرمز بدل كلمة المرور.
          </p>
        </div>

        <Card className="p-5">
          <p className="mb-4 text-center text-xs font-extrabold text-stone-700">
            {phase === 'enter' ? 'اختر رمزاً من 4 أرقام' : 'أعد إدخال الرمز للتأكيد'}
          </p>
          <PinPad
            value={padValue}
            onChange={phase === 'enter' ? setPinState : setConfirmPin}
            onComplete={(v) => void onComplete(v)}
            disabled={busy}
            shake={shake}
          />
          {error && <p className="mt-4 rounded-lg bg-danger-50 px-3 py-2 text-center text-xs font-bold text-danger-700">{error}</p>}
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={() => {
              if (phase === 'confirm') { setConfirmPin(''); setPhase('enter'); setError(null) }
            }}
            disabled={busy || phase === 'enter'}
          >
            رجوع
          </Button>
        </Card>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-2xs text-stone-400">
          <Sparkles className="size-3" /> الرمز يُحفظ مشفّراً على جهازك فقط
        </p>
      </div>
    </div>
  )
}
