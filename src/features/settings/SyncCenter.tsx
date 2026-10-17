/**
 * مركز المزامنة — التفعيل الصريح الوحيد للمزامنة المركزية (تجربة الخطة B).
 * ---------------------------------------------------------------------------
 * - معطّل افتراضياً: لا شيء في التطبيق يمر من هنا قبل ربط صريح من المستخدم.
 * - وضعان: «سحابي» (Supabase حقيقي — GoTrue) و«خادم اختبار» (PostgREST محلي
 *   بتوكن مُصدر من المشغّل — موثق أنه ليس بديلاً عن مصادقة الإنتاج).
 * - لا يُعلن SYNCED إلا بإقرار الخادم. الرفض مسبب ويُعرض مع التعويض المحلي.
 * - لا يُحفظ أي سر في Git أو البناء — كل شيء وقت التشغيل على الجهاز فقط.
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Cloud, CloudOff, RefreshCw, Unplug, KeyRound, AlertTriangle, CheckCircle2,
  Clock3, XCircle, AlertOctagon, Loader2,
} from 'lucide-react'
import { db } from '@/db/db'
import { PageHeader } from '@/components/ui/navigation'
import { Card, Button, Field, Input, Badge } from '@/components/ui/primitives'
import { useToast } from '@/lib/toast'
import {
  connectAndEnable, disableSync, reEnable, forgetConnection, isSyncEnabled,
  runCentralSync, listPendingOps, getSyncConfig, getSyncDevice, getLastSeq,
  type ConnectInput,
} from '@/services/sync/central'

const STATE_BADGE: Record<string, { label: string; tone: 'info' | 'success' | 'warning' | 'danger' }> = {
  LOCAL_ONLY: { label: 'محلية فقط', tone: 'info' },
  PENDING_SYNC: { label: 'بانتظار المزامنة', tone: 'info' },
  SYNCING: { label: 'تُزامن الآن', tone: 'info' },
  SYNCED: { label: 'مؤكدة على الخادم', tone: 'success' },
  FAILED: { label: 'فشل الاتصال — سيعاد', tone: 'warning' },
  REJECTED: { label: 'مرفوضة من الخادم', tone: 'danger' },
  CONFLICT: { label: 'تعارض — تسوية يدوية', tone: 'danger' },
}

export default function SyncCenter() {
  const toast = useToast()
  const enabled = isSyncEnabled()
  const cfg = getSyncConfig()
  const device = getSyncDevice()

  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [mode, setMode] = useState<'cloud' | 'rig'>('cloud')
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [userId, setUserId] = useState('')
  const [deviceName, setDeviceName] = useState(
    typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent) ? 'حاسوب الويندوز' : 'موقع الويب',
  )
  const [shownToken, setShownToken] = useState<string | null>(null)

  const queue = useLiveQuery(async () => listPendingOps(), [], null)
  const counts = useLiveQuery(async () => {
    const rows = await db.sync_ops.toArray()
    const c: Record<string, number> = {}
    for (const r of rows) c[r.state] = (c[r.state] ?? 0) + 1
    return c
  }, [], {} as Record<string, number>)

  async function doConnect() {
    setBusy(true)
    try {
      const input: ConnectInput = { url, anonKey, mode, deviceName: deviceName.trim() }
      if (mode === 'cloud') { input.email = email; input.password = password }
      else { input.accessToken = accessToken; input.userId = userId }
      const res = await connectAndEnable(input)
      setShownToken(res.device.deviceToken)
      toast.success('تم الربط وتفعيل المزامنة لهذا الجهاز.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر الربط.')
    } finally {
      setBusy(false)
    }
  }

  async function doSync() {
    setSyncing(true)
    try {
      const res = await runCentralSync()
      const parts: string[] = []
      parts.push(`مؤكدة: ${res.synced.length}`)
      if (res.rejected.length) parts.push(`مرفوضة: ${res.rejected.length}`)
      if (res.failed.length) parts.push(`فشل اتصال: ${res.failed.length}`)
      parts.push(`مسحوبة: ${res.pulled}`)
      if (res.rejected.length) {
        toast.error(`أُنجزت الدورة مع رفض — ${parts.join(' | ')}. راجع الأسباب في الطابور أدناه.`)
      } else {
        toast.success(`دورة مزامنة كاملة — ${parts.join(' | ')}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'فشلت المزامنة.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="مركز المزامنة"
        subtitle="تجربة الخطة B — معطّلة افتراضياً: لا شيء يُرفع قبل ربط صريح منك"
        backTo="/settings"
      />

      {/* الحالة الحالية */}
      <Card className="mb-3 p-4">
        <div className="flex items-center gap-3">
          {enabled
            ? <CheckCircle2 className="size-6 text-success-600" />
            : <CloudOff className="size-6 text-stone-400" />}
          <div className="flex-1">
            <p className="text-sm font-extrabold text-stone-900">
              {enabled ? 'المزامنة مفعّلة لهذا الجهاز' : 'المزامنة غير مفعّلة — النظام محلي بالكامل'}
            </p>
            <p className="text-2xs text-stone-500">
              {enabled && cfg && device
                ? `${cfg.mode === 'cloud' ? 'سحابي' : 'خادم اختبار'} — ${cfg.url} — جهاز: ${device.name} — آخر seq: ${getLastSeq()}`
                : 'بياناتك على جهازك فقط. الربط اختياري ويتطلب حسابك ومفاتيح مشروعك.'}
            </p>
          </div>
          {enabled && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void doSync()} loading={syncing} icon={<RefreshCw className="size-4" />}>مزامنة الآن</Button>
              <Button size="sm" variant="ghost" onClick={() => { disableSync(); toast.info('أُوقفت المزامنة مؤقتاً — الطابور محفوظ.') }} icon={<Unplug className="size-4" />}>إيقاف مؤقت</Button>
              <Button size="sm" variant="danger" onClick={() => { forgetConnection(); toast.info('حُذف الاتصال من هذا الجهاز — البيانات المحلية لم تُمس.') }}>حذف الاتصال</Button>
            </div>
          )}
          {!enabled && cfg && device && (
            <Button size="sm" onClick={() => { try { reEnable(); toast.success('أُعيد تفعيل المزامنة.') } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذر التفعيل.') } }}>
              إعادة تفعيل
            </Button>
          )}
        </div>
      </Card>

      {/* نموذج الربط — يظهر فقط عند عدم التفعيل */}
      {!enabled && (
        <Card className="mb-3 space-y-3 p-4">
          <p className="flex items-center gap-2 text-xs font-extrabold text-stone-700">
            <Cloud className="size-4 text-primary-600" /> ربط جهاز جديد بمشروع مزامنة
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('cloud')}
              className={`rounded-xl border p-3 text-start transition ${mode === 'cloud' ? 'border-primary-600 bg-primary-50' : 'border-stone-200'}`}
            >
              <p className="text-xs font-extrabold text-stone-900">سحابي — Supabase</p>
              <p className="text-2xs text-stone-500">دخول حقيقي ببريدك وكلمة مرورك (GoTrue)</p>
            </button>
            <button
              type="button"
              onClick={() => setMode('rig')}
              className={`rounded-xl border p-3 text-start transition ${mode === 'rig' ? 'border-primary-600 bg-primary-50' : 'border-stone-200'}`}
            >
              <p className="text-xs font-extrabold text-stone-900">خادم اختبار — PostgREST محلي</p>
              <p className="text-2xs text-stone-500">توكن مُصدر من المشغّل — ليس بديلاً عن مصادقة الإنتاج</p>
            </button>
          </div>

          <Field label="رابط المشروع" required>
            <Input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder={mode === 'cloud' ? 'https://xxxx.supabase.co' : 'http://127.0.0.1:5434'} />
          </Field>
          <Field label="مفتاح publishable (anon)" required hint="المفتاح العام فقط — ليس service_role أبداً">
            <Input dir="ltr" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} placeholder="eyJ..." />
          </Field>

          {mode === 'cloud' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="البريد" required>
                <Input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="كلمة المرور" required>
                <Input dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="توكن الوصول (JWT مُصدر)" required>
                <Input dir="ltr" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
              </Field>
              <Field label="معرف المستخدم (profile id)" required>
                <Input dir="ltr" value={userId} onChange={(e) => setUserId(e.target.value)} />
              </Field>
            </div>
          )}

          <Field label="اسم هذا الجهاز" required hint="يظهر في إدارة الأجهزة على الخادم — ويمكن إبطاله من هناك">
            <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          </Field>

          <Button className="w-full" size="lg" loading={busy} onClick={() => void doConnect()} icon={<KeyRound className="size-4" />}>
            ربط وتفعيل المزامنة
          </Button>
          <p className="flex items-start gap-1.5 rounded-lg bg-stone-50 p-2.5 text-2xs leading-5 text-stone-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-500" />
            لا تُدخل هنا أي مفاتيح service_role. لا تُفعّل المزامنة على بيانات الإنتاج قبل اجتياز
            بوابة التحقق السحابي واعتماد التكلفة — هذه تجربة ميدانية على مشروع اختبار.
          </p>
        </Card>
      )}

      {/* رمز الجهاز يُعرض مرة واحدة */}
      {shownToken && (
        <Card className="mb-3 p-4">
          <p className="flex items-center gap-2 text-xs font-extrabold text-stone-900">
            <KeyRound className="size-4 text-success-600" /> رمز الجهاز — يُعرض مرة واحدة فقط، احفظه الآن
          </p>
          <code dir="ltr" className="mt-2 block break-all rounded-lg bg-stone-900 p-2.5 text-2xs text-lime-300">{shownToken}</code>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShownToken(null)}>أخفِ الرمز</Button>
        </Card>
      )}

      {/* الطابور */}
      <Card className="mb-3 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-extrabold text-stone-700">طابور العمليات ({queue?.length ?? 0})</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(counts ?? {}).map(([state, n]) => (
              <Badge key={state} tone={STATE_BADGE[state]?.tone ?? 'info'}>
                {STATE_BADGE[state]?.label ?? state}: {n}
              </Badge>
            ))}
          </div>
        </div>
        {queue === null ? (
          <p className="flex items-center gap-2 py-4 text-2xs text-stone-400"><Loader2 className="size-4 animate-spin" /> يُحمّل…</p>
        ) : queue.length === 0 ? (
          <p className="py-4 text-center text-2xs text-stone-400">
            لا عمليات في الطابور — {enabled ? 'كل شيء مؤكد على الخادم.' : 'الرفع يبدأ بعد التفعيل: كل عملية جديدة تُدرج هنا ثم تُرفع بإقرار الخادم.'}
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {queue.slice(0, 50).map((op) => {
              const b = STATE_BADGE[op.state] ?? { label: op.state, tone: 'info' as const }
              return (
                <div key={op.operation_id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-extrabold text-stone-800">{op.op_type}</p>
                    <p className="truncate text-2xs text-stone-400">
                      <Clock3 className="mb-0.5 inline size-3" /> {new Date(op.created_at).toLocaleString('ar')} — محاولات: {op.attempts}
                    </p>
                    {op.rejection_reason && (
                      <p className="mt-1 flex items-start gap-1 rounded bg-danger-50 p-1.5 text-2xs font-bold text-danger-700">
                        <XCircle className="mt-0.5 size-3 shrink-0" /> {op.rejection_reason}
                        {op.state === 'CONFLICT' && <AlertOctagon className="size-3 shrink-0" />}
                      </p>
                    )}
                    {op.last_error && op.state === 'FAILED' && (
                      <p className="mt-1 rounded bg-warning-50 p-1.5 text-2xs text-warning-700">{op.last_error}</p>
                    )}
                  </div>
                  <Badge tone={b.tone}>{b.label}</Badge>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <p className="px-1 text-2xs leading-5 text-stone-400">
        الفواتير والدفعات لا تُقبل أبداً بآخر كتابة فائزة: الخادم يعتمد أو يرفض مسبباً. الرفض المالي
        يُعوَّض محلياً بإبطال موجّه للفواتير، وما لا يملك إبطالاً (دفعات/مصروف) يُعلَّم CONFLICT لتسوية يدوية.
        التوزيع (الحمولات) غير قابل للمزامنة حالياً — يبقى محلياً حتى توسيع البروتوكول.
      </p>
    </div>
  )
}
