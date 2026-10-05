/**
 * مركز المزامنة (بند 42/43/133): حالة الاتصال، الطابور المعلق، الفاشل بسببه،
 * والمتزامن حديثاً — كل شيء من IndexedDB (Dexie) مباشرة عبر useLiveQuery.
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  RefreshCw, Trash2, RotateCcw, Wifi, WifiOff, CloudOff, CheckCircle2, Clock3, AlertCircle,
} from 'lucide-react'
import { db } from '@/db/db'
import { useSyncStore, drainQueue, retryOp, retryAllFailed, discardOp } from '@/services/sync/syncEngine'
import { fmtDateTime } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Badge, Button, Card, StatusBadge } from '@/components/ui/primitives'
import { LoadingState } from '@/components/ui/states'
import type { PendingOp } from '@/types'

const MAX_SHOWN = 50

export default function SyncCenter() {
  const { online, syncing, pendingCount, failedCount, lastSyncAt } = useSyncStore()

  const [busyId, setBusyId] = useState<number | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)

  const ops = useLiveQuery(async () => {
    const all = await db.pending_ops.toArray()
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [])

  if (ops === undefined) return <LoadingState label="جارٍ تحميل الطابور..." />

  const failed = ops.filter((o) => o.status === 'FAILED').slice(0, MAX_SHOWN)
  const pending = ops.filter((o) => o.status === 'PENDING').slice(0, MAX_SHOWN)
  const synced = ops.filter((o) => o.status === 'SYNCED').slice(0, MAX_SHOWN)
  const queueEmpty = pendingCount === 0 && failedCount === 0

  async function onRetry(id: number | undefined) {
    if (id === undefined) return
    setBusyId(id)
    try {
      await retryOp(id)
    } finally {
      setBusyId(null)
    }
  }

  async function onDiscard(id: number | undefined) {
    if (id === undefined) return
    setBusyId(id)
    try {
      await discardOp(id)
    } finally {
      setBusyId(null)
    }
  }

  async function onRetryAll() {
    setRetryingAll(true)
    try {
      await retryAllFailed()
    } finally {
      setRetryingAll(false)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader title="مركز المزامنة" subtitle="العمليات المحلية وحالتها من الخادم" backTo="/more" />

      {/* كارت الحالة */}
      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {online
                ? <Badge tone="success"><Wifi className="size-3" /> متصل</Badge>
                : <Badge tone="warning"><WifiOff className="size-3" /> غير متصل</Badge>}
              {syncing && <Badge tone="info"><RefreshCw className="size-3 animate-spin" /> جارٍ المزامنة</Badge>}
            </div>
            <p className="text-2xs text-stone-400">
              آخر مزامنة: {lastSyncAt ? fmtDateTime(lastSyncAt) : 'لم تحدث بعد هذه الجلسة'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<RefreshCw className="size-4" />}
              loading={syncing}
              disabled={!online || syncing}
              onClick={() => void drainQueue()}
            >
              مزامنة الآن
            </Button>
            <Button
              variant="outline"
              icon={<RotateCcw className="size-4" />}
              loading={retryingAll}
              disabled={failedCount === 0 || !online || syncing || retryingAll}
              onClick={() => void onRetryAll()}
            >
              إعادة محاولة الفاشلة {failedCount > 0 ? `(${failedCount})` : ''}
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-stone-100 pt-3 text-center">
          <MiniStat label="معلقة" value={pendingCount} tone="warning" />
          <MiniStat label="فاشلة" value={failedCount} tone="danger" />
          <MiniStat label="متزامنة (محلياً)" value={ops.filter((o) => o.status === 'SYNCED').length} tone="success" />
        </div>
      </Card>

      {queueEmpty && synced.length === 0 && (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-success-50 text-success-600">
              <CheckCircle2 className="size-7" />
            </div>
            <h3 className="mt-1 text-sm font-extrabold text-stone-800">كل العمليات متزامنة.</h3>
            <p className="max-w-xs text-xs leading-relaxed text-stone-500">
              كل ما سجلته وصل إلى الخادم بأمان — العمل أوفلاين لا يفقد شيئاً أبداً.
            </p>
          </div>
        </Card>
      )}

      {/* الفاشلة */}
      {failed.length > 0 && (
        <Card className="mb-3 overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-danger-700">
            <AlertCircle className="size-4" /> فاشلة — تحتاج معالجة ({failed.length})
          </h2>
          <OpList
            rows={failed}
            renderError={(op) => (
              <p className="mt-1 rounded-lg bg-danger-50 px-2.5 py-1.5 text-2xs font-bold leading-relaxed text-danger-700">
                {op.last_error ?? 'خطأ غير معروف'}
              </p>
            )}
            actions={(op) => (
              <>
                <Button size="sm" variant="outline" icon={<RotateCcw className="size-3.5" />} loading={busyId === op.id} disabled={!online || syncing} onClick={() => void onRetry(op.id)}>
                  إعادة
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} loading={busyId === op.id} onClick={() => void onDiscard(op.id)} className="text-danger-600">
                  حذف
                </Button>
              </>
            )}
          />
        </Card>
      )}

      {/* المعلقة */}
      {pending.length > 0 && (
        <Card className="mb-3 overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-warning-700">
            <Clock3 className="size-4" /> بانتظار المزامنة ({pending.length})
          </h2>
          <OpList
            rows={pending}
            note={(op) => `أُنشئت ${fmtDateTime(op.created_at)} — ستُرسل تلقائياً عند توفر الاتصال`}
          />
        </Card>
      )}

      {/* المتزامنة حديثاً */}
      {synced.length > 0 && (
        <Card className="overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-success-700">
            <CheckCircle2 className="size-4" /> آخر العمليات المتزامنة ({synced.length})
          </h2>
          <OpList rows={synced} />
        </Card>
      )}
    </div>
  )
}

function OpList({ rows, actions, renderError, note }: {
  rows: PendingOp[]
  actions?: (op: PendingOp) => React.ReactNode
  renderError?: (op: PendingOp) => React.ReactNode
  note?: (op: PendingOp) => string
}) {
  return (
    <div className="divide-y divide-stone-100">
      {rows.map((op) => (
        <div key={op.id ?? op.operation_id} className="px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="min-w-0 truncate text-sm font-bold text-stone-800">{op.summary}</p>
                <StatusBadge status={op.status} />
              </div>
              <p dir="ltr" className="truncate text-2xs text-stone-400">{op.type} • {op.operation_id.slice(0, 8)}…</p>
              {renderError?.(op)}
              {note && <p className="mt-1 text-2xs text-stone-400">{note(op)}</p>}
              {op.status === 'SYNCED' && op.synced_at && (
                <p className="mt-1 text-2xs text-success-600">تمت المزامنة: {fmtDateTime(op.synced_at)}</p>
              )}
              {op.attempts > 0 && op.status !== 'SYNCED' && (
                <p className="mt-0.5 text-2xs text-stone-400">محاولات: {op.attempts}</p>
              )}
            </div>
            {actions && <div className="flex shrink-0 gap-1.5">{actions(op)}</div>}
          </div>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-stone-400">
          <CloudOff className="size-4" /> لا شيء هنا
        </p>
      )}
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: 'warning' | 'danger' | 'success' }) {
  const cls = tone === 'danger' ? 'text-danger-600' : tone === 'warning' ? 'text-warning-600' : 'text-success-700'
  return (
    <div>
      <p className="text-2xs font-bold text-stone-400">{label}</p>
      <p className={`text-lg font-extrabold tabular-nums ${cls}`}>{value}</p>
    </div>
  )
}
