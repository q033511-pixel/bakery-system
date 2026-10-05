/** قائمة المشتريات (بند 21): فلاتر تاريخ، ملخص، تصدير CSV — نفس أنماط SalesList */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/app/authStore'
import { formatMoney } from '@/lib/money'
import { rangeFor, fmtDate, type DateRangePreset } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar, AddButton } from '@/components/ui/navigation'
import { Card, Button, StatusBadge } from '@/components/ui/primitives'
import { DateInput } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Purchase } from '@/types'

type PurchaseRow = Purchase & { suppliers: { name: string } | null }

interface Filters {
  preset: DateRangePreset
  from: string
  to: string
}

const PRESET_KEYS = ['today', 'yesterday', 'this_week', 'this_month'] as const
const PRESET_LABELS: Record<(typeof PRESET_KEYS)[number], string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  this_week: 'هذا الأسبوع',
  this_month: 'هذا الشهر',
}

export default function PurchasesList() {
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)
  const [filters, setFilters] = useState<Filters>(() => {
    const r = rangeFor('today')
    return { preset: 'today', from: r.from, to: r.to }
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['purchases', filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchases')
        .select('*, suppliers(name)')
        .gte('purchase_date', filters.from)
        .lte('purchase_date', filters.to)
        .order('purchase_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      return data as unknown as PurchaseRow[]
    },
  })

  const rows = useMemo(() => data ?? [], [data])
  const totals = useMemo(() => {
    const confirmed = rows.filter((r) => r.status === 'CONFIRMED')
    return {
      count: confirmed.length,
      total: confirmed.reduce((a, r) => a + r.total, 0),
      cash: confirmed.filter((r) => r.payment_type === 'CASH').reduce((a, r) => a + r.total, 0),
      credit: confirmed.filter((r) => r.payment_type === 'CREDIT').reduce((a, r) => a + r.total, 0),
    }
  }, [rows])

  function applyPreset(p: (typeof PRESET_KEYS)[number]) {
    const r = rangeFor(p)
    setFilters((f) => ({ ...f, preset: p, from: r.from, to: r.to }))
  }

  return (
    <div>
      <PageHeader
        title="المشتريات"
        backTo="/"
        action={has('purchases.manage') ? <AddButton to="/purchases/new" label="شراء جديد" /> : undefined}
      />

      <FilterBar>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_KEYS.map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`h-9 rounded-lg px-3 text-xs font-bold transition ${filters.preset === p ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <DateInput value={filters.from} onChange={(v) => setFilters((f) => ({ ...f, from: v, preset: 'custom' }))} className="w-36" aria-label="من تاريخ" />
          <DateInput value={filters.to} onChange={(v) => setFilters((f) => ({ ...f, to: v, preset: 'custom' }))} className="w-36" aria-label="إلى تاريخ" />
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => exportCSV('purchases', ['التاريخ', 'رقم الفاتورة', 'المورد', 'فاتورة المورد', 'الإجمالي', 'الدفع', 'الحالة'],
            rows.map((r) => [r.purchase_date, r.doc_number, r.suppliers?.name ?? '—', r.invoice_number ?? '—', r.total, r.payment_type, r.status]))}
        >
          تصدير CSV
        </Button>
      </FilterBar>

      <Card className="mb-3 grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Total label="عدد الفواتير" value={String(totals.count)} />
        <Total label="الإجمالي" value={formatMoney(totals.total, currency)} strong />
        <Total label="نقدي" value={formatMoney(totals.cash, currency)} />
        <Total label="آجل" value={formatMoney(totals.credit, currency)} />
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل المشتريات.'} onRetry={() => void refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد مشتريات في هذه الفترة"
            emptyMessage="جرّب تغيير الفلاتر أو سجّل فاتورة شراء جديدة."
            columns={[
              { key: 'doc', header: 'الفاتورة', render: (r) => <span className="font-bold tabular-nums">{r.doc_number}</span> },
              { key: 'date', header: 'التاريخ', render: (r) => fmtDate(r.purchase_date), hideOnMobile: true },
              { key: 'supplier', header: 'المورد', render: (r) => r.suppliers?.name ?? '—' },
              { key: 'invoice', header: 'فاتورة المورد', render: (r) => r.invoice_number ?? '—', hideOnMobile: true },
              { key: 'total', header: 'الإجمالي', className: 'font-bold tabular-nums', render: (r) => formatMoney(r.total, currency) },
              { key: 'payment', header: 'الدفع', render: (r) => <StatusBadge status={r.payment_type} /> },
              { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
              {
                key: 'actions', header: '', render: (r) => (
                  <Link to={`/purchases/${r.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:underline">
                    <Eye className="size-3.5" /> تفاصيل
                  </Link>
                ),
              },
            ]}
            mobileCard={(r) => (
              <Link to={`/purchases/${r.id}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold">{r.suppliers?.name ?? '—'}</p>
                  <p className="text-2xs text-stone-400">{fmtDate(r.purchase_date)} • {r.doc_number}</p>
                </div>
                <div className="text-end">
                  <p className="text-sm font-extrabold tabular-nums">{formatMoney(r.total, currency)}</p>
                  <div className="mt-0.5 flex justify-end gap-1"><StatusBadge status={r.payment_type} /><StatusBadge status={r.status} /></div>
                </div>
              </Link>
            )}
          />
        )}
      </Card>
    </div>
  )
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-2xs font-bold text-stone-400">{label}</p>
      <p className={`tabular-nums ${strong ? 'text-lg font-extrabold text-primary-700' : 'text-sm font-extrabold text-stone-900'}`}>{value}</p>
    </div>
  )
}
