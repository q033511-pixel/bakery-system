/** تسجيل الدخول + تهيئة أول مرة (بند 67/68) */
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BakeryLogo } from './BakeryLogo'
import { Button, Card, Field, Input } from '@/components/ui/primitives'
import { AlertCircle } from 'lucide-react'
import { signIn, signUp, resetPassword } from '@/services/auth'
import { loadAuthState } from '@/app/authStore'

type Mode = 'signin' | 'signup' | 'reset'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const pendingMsg = (location.state as { pending?: boolean } | null)?.pending

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
        const profile = await loadAuthState()
        // الوضع المحلي: حساب بلا نشاط بعد → ذهاب مباشر لخطوة التهيئة
        if (profile && (profile.role === 'PENDING' || !profile.business_id)) {
          navigate('/bootstrap', { replace: true })
        } else {
          navigate('/', replace_or_root())
        }
      } else if (mode === 'signup') {
        const res = await signUp(email.trim(), password, fullName.trim())
        if (res.needsEmailConfirm) {
          setInfo('تم إنشاء الحساب — أكّد بريدك الإلكتروني ثم سجّل الدخول. بعد التفعيل يتولى المالك تعيين دورك.')
          setMode('signin')
        } else {
          setInfo('تم إنشاء حسابك. سجّل الدخول الآن — يتولى المالك تعيين دورك من الإعدادات.')
          setMode('signin')
        }
      } else {
        await resetPassword(email.trim())
        setInfo('أُرسل رابط إعادة التعيين إلى بريدك الإلكتروني.')
        setMode('signin')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع.')
    } finally {
      setBusy(false)
    }
  }

  function replace_or_root(): undefined {
    return undefined
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary-50 via-surface-50 to-surface-100 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BakeryLogo className="size-16" />
          <h1 className="text-xl font-extrabold text-stone-900">نظام إدارة المخبز</h1>
          <p className="text-xs text-stone-500">بيع، شراء، إنتاج، مخزون، توزيع وحسابات — يعمل أوفلاين ويزامن تلقائياً</p>
        </div>

        {pendingMsg && (
          <Card className="mb-3 border-warning-200 bg-warning-50 p-3">
            <p className="flex items-center gap-2 text-xs font-bold text-warning-700">
              <AlertCircle className="size-4 shrink-0" />
              حسابك بانتظار التفعيل — يتولى مالك النظام تعيين دورك من صفحة الإعدادات ← المستخدمون.
            </p>
          </Card>
        )}

        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            {mode !== 'reset' && mode === 'signup' && (
              <Field label="الاسم الكامل" required>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="مثال: محمد أحمد" autoComplete="name" />
              </Field>
            )}
            <Field label="البريد الإلكتروني" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" dir="ltr" className="text-left" />
            </Field>
            {mode !== 'reset' && (
              <Field label="كلمة المرور" required hint={mode === 'signup' ? '6 أحرف على الأقل' : undefined}>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} dir="ltr" className="text-left" />
              </Field>
            )}

            {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{error}</p>}
            {info && <p className="rounded-lg bg-success-50 px-3 py-2 text-xs font-bold text-success-700">{info}</p>}

            <Button type="submit" className="w-full" size="lg" loading={busy}>
              {mode === 'signin' ? 'تسجيل الدخول' : mode === 'signup' ? 'إنشاء حساب' : 'إرسال رابط إعادة التعيين'}
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-between text-xs font-bold">
            {mode === 'signin' ? (
              <>
                <button onClick={() => setMode('signup')} className="text-primary-700 hover:underline">إنشاء حساب جديد</button>
                <button onClick={() => setMode('reset')} className="text-stone-500 hover:underline">نسيت كلمة المرور؟</button>
              </>
            ) : (
              <button onClick={() => setMode('signin')} className="text-primary-700 hover:underline">العودة لتسجيل الدخول</button>
            )}
          </div>
        </Card>

        <p className="mt-4 text-center text-2xs text-stone-400">
          أول تشغيل للنظام؟{' '}
          <Link to="/bootstrap" className="font-bold text-primary-700 hover:underline">تهيئة النظام والمالك الأول</Link>
        </p>
      </div>
    </div>
  )
}
