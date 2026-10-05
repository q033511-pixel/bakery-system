/** حالات الواجهة: تحميل/فارغ/خطأ/اتصال/مزامنة (بند 47/83/91) */
import type { ReactNode } from 'react'
import { Wifi, WifiOff, RefreshCw, Inbox, AlertCircle, Loader2, CheckCircle2, CloudUpload } from 'lucide-react'
import { Badge, Button, Skeleton } from './primitives'
import { useSyncStore } from '@/services/sync/syncEngine'

export function LoadingState({ label = 'جارٍ التحميل...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-stone-400">
      <Loader2 className="size-7 animate-spin" />
      <p className="text-sm font-semibold">{label}</p>
    </div>
  )
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  )
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
        <Inbox className="size-7" />
      </div>
      <h3 className="mt-1 text-sm font-extrabold text-stone-800">{title}</h3>
      {message && <p className="max-w-xs text-xs leading-relaxed text-stone-500">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-danger-50 text-danger-500">
        <AlertCircle className="size-7" />
      </div>
      <h3 className="text-sm font-extrabold text-stone-800">حدث خطأ</h3>
      <p className="max-w-sm text-xs leading-relaxed text-stone-500">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" icon={<RefreshCw className="size-4" />} onClick={onRetry} className="mt-2">
          إعادة المحاولة
        </Button>
      )}
    </div>
  )
}

/** شارة حالة الاتصال والبيانات المعلقة (بند 91) */
export function SyncStatusBadge({ compact }: { compact?: boolean }) {
  const { online, syncing, pendingCount, failedCount } = useSyncStore()

  if (syncing) {
    return (
      <Badge tone="info">
        <RefreshCw className="size-3 animate-spin" /> جارٍ المزامنة{pendingCount > 0 ? ` (${pendingCount})` : ''}
      </Badge>
    )
  }
  if (!online) {
    return (
      <Badge tone="warning">
        <WifiOff className="size-3" />
        {compact ? `أوفلاين${pendingCount > 0 ? ` (${pendingCount})` : ''}` : pendingCount > 0 ? `غير متصل — ${pendingCount} عملية معلقة` : 'غير متصل'}
      </Badge>
    )
  }
  if (failedCount > 0) {
    return <Badge tone="danger">{failedCount} عملية فاشلة</Badge>
  }
  if (pendingCount > 0) {
    return (
      <Badge tone="warning">
        <CloudUpload className="size-3" /> {pendingCount} بانتظار المزامنة
      </Badge>
    )
  }
  return (
    <Badge tone="success">
      {compact ? <Wifi className="size-3" /> : <><Wifi className="size-3" /> متصل</>}
      {!compact && <CheckCircle2 className="size-3" />}
      {!compact && 'متزامن'}
    </Badge>
  )
}
