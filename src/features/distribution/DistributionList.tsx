/**
 * قائمة حمولات التوزيع (بند 29/30): تقرير مجمّع من get_distribution_report
 * مع كميات محمولة/مبيعة/مرتجعة/غير مفسرة وفروق النقد — وتصدير CSV.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { rpc } from '@/services/rpc'
import { useAuthStore } from '@/app/authStore'
import { formatMoney, formatQty } from '@/lib/money'
import { rangeFor, fmtDate, type DateRangePreset } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar, AddButton } from '@/components/ui/navigation'
import { Card, Button, StatusBadge } from '@/components/ui/primitives'
import { DateInput } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'

interface LoadRow {
  id: string
  doc_number: string
  load_date: string
  vehicle_name: string | null
  driver_name: string | null
  status: string
  loaded_qty: number
  sold_qty: number
  returned_qty: number
  unaccounted_qty: number
  cash_collected: number
  cash_variance: number
}

interface Filters {
  preset: DateRangePreset
  from: string
  to: string
}

export default function DistributionList() {
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)
  const [filters, setFilters] = useState<Filters>(() => {
    const r = rangeFor('this_month')
    return { preset: 'this_month', from: r.from, to: r.to }
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['loads', filters.from, filters.to],
    queryFn: () => rpc<LoadRow[]>('get_distribution_report', { p_from: filters.from, p_to: filters.to }),
  })

  const rows = data ?? []

  function applyPreset(p: DateRangePreset) {
    const r = rangeFor(p)
    setFilters({ preset: p, from: r.from, to: r.to })
  }

  return (
    <div>
      <PageHeader
        title="التوزيع"
        subtitle="الحمولات والمبيعات والمرتجعات والتسويات"
        backTo="/"
        action={has('distribution.manage') ? <AddButton to="/distribution/new" label="حمولة جديدة" /> : undefined}
      />

      <FilterBar>
        <div className="flex flex-wrap gap-1.5">
          {(['today', 'yesterday', 'this_week', 'this_month'] as DateRangePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`h-9 rounded-lg px-3 text-xs font-bold transition ${filters.preset === p ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              {{ today: 'اليوم', yesterday: 'أمس', this_week: 'هذا الأسبوع', this_month: 'هذا الشهر', custom: 'مخصص' }[p]}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <DateInput value={filters.from} onChange={(v) => setFilters((f) => ({ ...f, from: v, preset: 'custom' }))} className="w-36" aria-label="من تاريخ" />
          <DateInput value={filters.to} onChange={(v) => setFilters((f) => ({ ...f, to: v, preset: 'custom' }))} className="w-36" aria-label="إلى تاريخ" />
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => exportCSV('distribution_loads', ['الحمولة', 'التاريخ', 'السيارة', 'السائق', 'الحالة', 'المحمول', 'المبيع', 'المرتجع', 'غير مفسّر', 'النقد المحصّل', 'فرق النقد'],
            rows.map((r) => [r.doc_number, r.load_date, r.vehicle_name ?? '', r.driver_name ?? '', r.status, r.loaded_qty, r.sold_qty, r.returned_qty, r.unaccounted_qty, r.cash_collected, r.cash_variance]))}
        >
          تصدير CSV
        </Button>
      </FilterBar>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingState label="جارٍ تحميل الحمولات..." />
        ) : isError ? (
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل الحمولات.'} onRetry={() => void refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد حمولات في هذه الفترة"
            emptyMessage="أنشئ حمولة جديدة لبدء دورة توزيع."
            columns={[
              { key: 'doc', header: 'الحمولة', render: (r) => <span className="font-bold tabular-nums">{r.doc_number}</span> },
              { key: 'date', header: 'التاريخ', render: (r) => fmtDate(r.load_date), hideOnMobile: true },
              { key: 'vehicle', header: 'السيارة', render: (r) => r.vehicle_name ?? '—' },
              { key: 'driver', header: 'السائق', render: (r) => r.driver_name ?? '—', hideOnMobile: true },
              { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'loaded', header: 'محمول', className: 'tabular-nums', render: (r) => formatQty(r.loaded_qty), hideOnMobile: true },
              { key: 'sold', header: 'مبيع', className: 'tabular-nums', render: (r) => formatQty(r.sold_qty), hideOnMobile: true },
              { key: 'returned', header: 'مرتجع', className: 'tabular-nums', render: (r) => formatQty(r.returned_qty), hideOnMobile: true },
              {
                key: 'unaccounted', header: 'غير مفسّر', className: 'tabular-nums',
                render: (r) => <span className={r.unaccounted_qty !== 0 ? 'font-extrabold text-danger-600' : ''}>{formatQty(r.unaccounted_qty)}</span>,
              },
              { key: 'cash', header: 'النقد المحصّل', className: 'tabular-nums', render: (r) => formatMoney(r.cash_collected, currency), hideOnMobile: true },
              {
                key: 'variance', header: 'فرق النقد', className: 'tabular-nums',
                render: (r) => <span className={r.cash_variance !== 0 ? 'font-extrabold text-danger-600' : ''}>{formatMoney(r.cash_variance, currency)}</span>,
              },
              {
                key: 'actions', header: '', render: (r) => (
                  <Link to={`/distribution/${r.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:underline">
                    <Eye className="size-3.5" /> تفاصيل
                  </Link>
                ),
              },
            ]}
            mobileCard={(r) => (
              <Link to={`/distribution/${r.id}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold">{r.vehicle_name ?? '—'} • {r.doc_number}</p>
                  <p className="text-2xs text-stone-400">
                    {fmtDate(r.load_date)} • محمول {formatQty(r.loaded_qty)} • مبيع {formatQty(r.sold_qty)}
                  </p>
                  {r.unaccounted_qty !== 0 && (
                    <p className="text-2xs font-bold text-danger-600">غير مفسّر: {formatQty(r.unaccounted_qty)}</p>
                  )}
                </div>
                <div className="text-end">
                  <p className="text-sm font-extrabold tabular-nums">{formatMoney(r.cash_collected, currency)}</p>
                  <div className="mt-0.5 flex justify-end"><StatusBadge status={r.status} /></div>
                </div>
              </Link>
            )}
          />
        )}
      </Card>
    </div>
  )
}
