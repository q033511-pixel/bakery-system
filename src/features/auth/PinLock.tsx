/**
 * شاشة القفل — تفتح النظام بالرمز السري (4 أرقام):
 * - تظهر عند كل فتح للتطبيق أو بعد الخمول (القفل التلقائي).
 * - اهتزاز ورسالة عند خطأ الرمز + عدّاد المحاولات.
 * - «نسيت الرمز؟» → استرداد آمن: تصدير نسخة احتياطية تلقائياً ثم مسح
 *   الجهاز والعودة لمعالج الإعداد — بياناتك لا تضيع إذا صدّرت النسخة.
 */
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ShieldAlert, KeyRound, Download, ShieldCheck, Phone } from 'lucide-react'
import { BakeryLogo } from './BakeryLogo'
import { Button, Card } from '@/components/ui/primitives'
import { ConfirmDialog } from '@/components/ui/overlays'
import PinPad from './PinPad'
import { signInWithPin } from '@/services/auth'
import { loadAuthState, useAuthStore } from '@/app/authStore'
import { hasPin } from '@/lib/pin'
import { exportBackupFile, wipeAllData } from '@/lib/backup'
import { db } from '@/db/db'

export default function PinLock() {
  const navigate = useNavigate()
  const business = useAuthStore((s) => s.business)
  const [bizName, setBizName] = useState<string>('')
  const [pin, setPinState] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [showRecovery, setShowRecovery] = useState(false)
  const [backupSaved, setBackupSaved] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)

  // اسم المخبز من المتجر أو من القاعدة مباشرة (قد لا تكون الجلسة مفتوحة بعد)
  useEffect(() => {
    if (business?.name) { setBizName(business.name); return }
    void db.businesses.toArray().then((rows) => {
      const name = rows[0]?.name
      if (typeof name === 'string') setBizName(name)
    }).catch(() => undefined)
  }, [business])

  // لا رمز مضبوط؟ → تعيين رمز للمرة الأولى (ترحيل) — بعد كل الـhooks
  if (!hasPin()) return <Navigate to="/set-pin" replace />

  const fail = (msg: string) => {
    setError(msg)
    setShake(true)
    if (navigator.vibrate) navigator.vibrate(180)
    setTimeout(() => setShake(false), 500)
  }

  const onComplete = async (code: string) => {
    setBusy(true)
    setError(null)
    try {
      const ok = await signInWithPin(code)
      if (!ok) {
        setAttempts((a) => a + 1)
        setPinState('')
        fail('الرمز غير صحيح — حاول مجدداً.')
        setBusy(false)
        return
      }
      await loadAuthState()
      navigate('/', { replace: true })
    } catch (err) {
      setPinState('')
      fail(err instanceof Error ? err.message : 'تعذر فتح القفل.')
      setBusy(false)
    }
  }

  const doBackup = async () => {
    try {
      await exportBackupFile()
      setBackupSaved(true)
      setError(null)
    } catch {
      setError('تعذر تصدير النسخة — تأكد أن المتصفح لا يمنع التنزيلات.')
    }
  }

  const doRecoveryWipe = async () => {
    // wipeAllData يمسح البيانات + الرمز + الجلسة → عودة لحالة أول تشغيل
    await wipeAllData()
    window.location.hash = '#/setup'
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary-50 via-surface-50 to-surface-100 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="anim-pop flex size-16 items-center justify-center rounded-2xl bg-white shadow-card-lg">
            <BakeryLogo className="size-12" />
          </div>
          <h1 className="text-lg font-black text-stone-900">{bizName || 'نظام إدارة المخبز'}</h1>
          <p className="flex items-center gap-1.5 text-xs text-stone-500">
            <KeyRound className="size-3.5" /> النظام مقفل — أدخل الرمز السري للمتابعة
          </p>
        </div>

        <Card className="p-5">
          <PinPad value={pin} onChange={setPinState} onComplete={(v) => void onComplete(v)} disabled={busy} shake={shake} />
          {error && (
            <p className="mt-4 rounded-lg bg-danger-50 px-3 py-2 text-center text-xs font-bold text-danger-700">
              {error}
              {attempts >= 3 && (
                <span className="mt-1 block font-normal text-danger-600">إذا نسيت الرمز استخدم «نسيت الرمز؟» بالأسفل.</span>
              )}
            </p>
          )}
          <button
            onClick={() => { setShowRecovery((v) => !v); setError(null) }}
            className="mt-4 w-full text-center text-xs font-bold text-stone-400 transition hover:text-primary-700 hover:underline"
          >
            نسيت الرمز؟
          </button>

          {showRecovery && (
            <div className="anim-slide-in mt-4 rounded-xl border border-warning-200 bg-warning-50/70 p-4">
              <h2 className="flex items-center gap-1.5 text-xs font-extrabold text-warning-800">
                <ShieldAlert className="size-4" /> استرداد الحساب — خطوتان
              </h2>
              <ol className="mt-2 space-y-2 text-2xs leading-relaxed text-warning-900">
                <li>
                  <b>1) صدّر نسخة احتياطية أولاً</b> — ملف JSON فيه كل بياناتك سيُنزَّل الآن:
                  <Button
                    size="sm"
                    variant={backupSaved ? 'outline' : 'primary'}
                    className="mt-1.5 w-full"
                    icon={backupSaved ? <ShieldCheck className="size-4" /> : <Download className="size-4" />}
                    onClick={() => void doBackup()}
                  >
                    {backupSaved ? 'تم التنزيل — احفظه في مكان آمن' : 'تنزيل النسخة الاحتياطية الآن'}
                  </Button>
                </li>
                <li>
                  <b>2) امسح الجهاز وأعد الإعداد</b> — بعد مسح كل البيانات ستعود لمعالج البداية
                  وتضبط رمزاً جديداً، ثم تستعيد بياناتك من مركز النسخ الاحتياطية.
                  <Button
                    size="sm"
                    variant="danger"
                    className="mt-1.5 w-full"
                    disabled={!backupSaved}
                    onClick={() => setConfirmWipe(true)}
                  >
                    مسح الجهاز وإعادة الإعداد...
                  </Button>
                  {!backupSaved && (
                    <span className="mt-1 block text-warning-700">لا يمكن المتابعة قبل تنزيل النسخة الاحتياطية.</span>
                  )}
                </li>
              </ol>
            </div>
          )}
        </Card>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-2xs text-stone-400">
          <Phone className="size-3" /> بياناتك على هذا الجهاز فقط — ولا تُرسل لأي جهة
        </p>
      </div>

      <ConfirmDialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        onConfirm={() => void doRecoveryWipe()}
        danger
        title="مسح الجهاز وإعادة الإعداد؟"
        message="سيتم مسح كل البيانات من هذا الجهاز. تأكد أنك صدّرت النسخة الاحتياطية وحفظتها في مكان آمن — بعدها يمكنك استعادتها من مركز النسخ الاحتياطية."
        confirmLabel="نعم، امسح وأعد الإعداد"
      />
    </div>
  )
}
