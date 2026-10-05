/**
 * سجل التدقيق (بند 37): عرض كل التغييرات الحساسة مع فلترة تاريخية.
 * المحمية بالصلاحية audit.view — والحماية الفعلية عبر RLS على الخادم.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { rpc } from '@/services/rpc'
import { useAuthStore } from '@/app/authStore'
import { rangeFor, fmtDateTime, type DateRangePreset } from '@/lib/dates'
import { PageHeader, FilterBar } from '@/components/ui/navigation'
import { Badge, Card } from '@/components/ui/primitives'
import { DateInput } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states'

interface AuditRow {
  id: string
  created_at: string
  user_email: string | null
  operation: string
  entity: string
  action: string
  entity_id: string | null
}

type Tone = 'success' | 'info' | 'danger' | 'primary' | 'warning' | 'neutral'

const ACTION_TONES: Record<string, { tone: Tone }> = {
  CREATE: { tone: 'success' },
  UPDATE: { tone: 'info' },
  VOID: { tone: 'danger' },
  PAYMENT: { tone: 'primary' },
  RETURN: { tone: 'warning' },
  ADJUSTMENT: { tone: 'warning' },
  DELETE: { tone: 'danger' },
  SETTLEMENT: { tone: 'info' },
}

function ActionBadge({ action }: { action: string }) {
  const conf = ACTION_TONES[action] ?? { tone: 'neutral' as Tone }
  return <Badge tone={conf.tone}>{action}</Badge>
}

export default function AuditLogPage() {
  const has = useAuthStore((s) => s.has)
  const [preset, setPreset] = useState<DateRangePreset>('this_month')
  const initial = rangeFor('this_month')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audit', from, to],
    enabled: has('audit.view'),
    queryFn: () => rpc<AuditRow[]>('get_audit_logs', { p_from: from, p_to: to, p_limit: 200 }),
  })

  if (!has('audit.view')) {
    return <EmptyState title="ليس لديك صلاحية عرض سجل التدقيق." message="تواصل مع مدير النظام لمنحك صلاحية audit.view." />
  }

  function applyPreset(p: DateRangePreset) {
    const r = rangeFor(p)
    setPreset(p); setFrom(r.from); setTo(r.to)
  }

  const rows = data ?? []

  return (
    <div>
      <PageHeader title="سجل التدقيق" subtitle="آخر 200 عملية حساسة خلال الفترة" backTo="/more" />

      <FilterBar>
        <div className="flex flex-wrap gap-1.5">
          {(['today', 'yesterday', 'this_week', 'this_month'] as DateRangePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`h-9 rounded-lg px-3 text-xs font-bold transition ${preset === p ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              {{ today: 'اليوم', yesterday: 'أمس', this_week: 'هذا الأسبوع', this_month: 'هذا الشهر', custom: 'مخصص' }[p]}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <DateInput value={from} onChange={(v) => { setFrom(v); setPreset('custom') }} className="w-36" aria-label="من تاريخ" />
          <DateInput value={to} onChange={(v) => { setTo(v); setPreset('custom') }} className="w-36" aria-label="إلى تاريخ" />
        </div>
      </FilterBar>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingState label="جارٍ تحميل السجل..." />
        ) : isError ? (
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل سجل التدقيق.'} onRetry={() => void refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد أحداث في هذه الفترة"
            emptyMessage="تُسجل هنا كل عمليات البيع والإلغاء والدفع والتسوية والتعديلات الحساسة."
            columns={[
              { key: 'created_at', header: 'التاريخ', render: (r) => fmtDateTime(r.created_at) },
              { key: 'user_email', header: 'المستخدم', render: (r) => <span dir="ltr" className="inline-block text-xs">{r.user_email ?? '—'}</span> },
              { key: 'operation', header: 'العملية', render: (r) => <span className="font-bold text-stone-800">{r.operation}</span> },
              { key: 'entity', header: 'الجدول', render: (r) => r.entity, hideOnMobile: true },
              { key: 'action', header: 'الحدث', render: (r) => <ActionBadge action={r.action} /> },
              { key: 'entity_id', header: 'المرجع', render: (r) => <span dir="ltr" className="inline-block text-2xs text-stone-400">{r.entity_id ? `${r.entity_id.slice(0, 8)}…` : '—'}</span>, hideOnMobile: true },
            ]}
            mobileCard={(r) => (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-stone-800">{r.operation}</p>
                  <p className="truncate text-2xs text-stone-400">{fmtDateTime(r.created_at)} • {r.user_email ?? '—'}</p>
                </div>
                <ActionBadge action={r.action} />
              </div>
            )}
          />
        )}
      </Card>
    </div>
  )
}
