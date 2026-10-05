/** قائمة المبيعات (بند 50/56): فلاتر تاريخ/عميل/نوع دفع، ملخص، تصدير CSV */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/app/authStore'
import { formatMoney } from '@/lib/money'
import { rangeFor, type DateRangePreset, fmtDate } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar, AddButton } from '@/components/ui/navigation'
import { Card, Select, Button, StatusBadge } from '@/components/ui/primitives'
import { DateInput, SearchSelect } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Sale } from '@/types'

interface Filters {
  preset: DateRangePreset
  from: string
  to: string
  customerId: string | null
  payment: string
}

export default function SalesList() {
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)
  const [params] = useSearchParams()
  const quickPayment = params.get('payment')
  const [filters, setFilters] = useState<Filters>(() => {
    const r = rangeFor('today')
    return { preset: 'today', from: r.from, to: r.to, customerId: null, payment: quickPayment === '1' ? 'CREDIT' : 'ALL' }
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sales', filters],
    queryFn: async () => {
      let q = supabase
        .from('sales')
        .select('*, customers(name)')
        .gte('sale_date', filters.from)
        .lte('sale_date', filters.to)
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (filters.customerId) q = q.eq('customer_id', filters.customerId)
      if (filters.payment !== 'ALL') q = q.eq('payment_type', filters.payment)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return data as unknown as (Sale & { customers: { name: string } | null })[]
    },
  })

  const [customerFilterOptions, setCustomerFilterOptions] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    void import('@/services/lookups').then(({ lookups }) => {
      void lookups.customers().then((rows) => {
        setCustomerFilterOptions(rows.map((c) => ({ value: c.id, label: c.name })))
      })
    })
  }, [])

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

  function applyPreset(p: DateRangePreset) {
    const r = rangeFor(p)
    setFilters((f) => ({ ...f, preset: p, from: r.from, to: r.to }))
  }

  return (
    <div>
      <PageHeader
        title="المبيعات"
        backTo="/"
        action={has('sales.manage') ? <AddButton to="/sale/new" label="بيع جديد" /> : undefined}
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
        <div className="w-48">
          <SearchSelect
            options={customerFilterOptions}
            value={filters.customerId}
            onChange={(v) => setFilters((f) => ({ ...f, customerId: v }))}
            placeholder="كل العملاء"
            emptyText="لا يوجد عملاء"
          />
        </div>
        <Select value={filters.payment} onChange={(e) => setFilters((f) => ({ ...f, payment: e.target.value }))} className="w-32">
          <option value="ALL">كل الدفع</option>
          <option value="CASH">نقدي</option>
          <option value="CREDIT">آجل</option>
        </Select>
        <Button
          variant="outline" size="sm"
          onClick={() => exportCSV('sales', ['التاريخ', 'رقم الفاتورة', 'العميل', 'الإجمالي', 'الدفع', 'الحالة'],
            rows.map((r) => [r.sale_date, r.doc_number, r.customers?.name ?? 'عميل نقدي', r.total, r.payment_type, r.status]))}
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
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل المبيعات.'} onRetry={() => void refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد مبيعات في هذه الفترة"
            emptyMessage="جرّب تغيير الفلاتر أو سجّل بيعاً جديداً."
            columns={[
              { key: 'doc', header: 'الفاتورة', render: (r) => <span className="font-bold tabular-nums">{r.doc_number}</span> },
              { key: 'date', header: 'التاريخ', render: (r) => fmtDate(r.sale_date), hideOnMobile: true },
              { key: 'customer', header: 'العميل', render: (r) => r.customers?.name ?? 'عميل نقدي' },
              { key: 'total', header: 'الإجمالي', className: 'font-bold tabular-nums', render: (r) => formatMoney(r.total, currency) },
              { key: 'payment', header: 'الدفع', render: (r) => <StatusBadge status={r.payment_type} /> },
              { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'channel', header: 'القناة', render: (r) => <StatusBadge status={r.channel} />, hideOnMobile: true },
              {
                key: 'actions', header: '', render: (r) => (
                  <Link to={`/sales/${r.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:underline">
                    <Eye className="size-3.5" /> تفاصيل
                  </Link>
                ),
              },
            ]}
            mobileCard={(r) => (
              <Link to={`/sales/${r.id}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold">{r.customers?.name ?? 'عميل نقدي'}</p>
                  <p className="text-2xs text-stone-400">{fmtDate(r.sale_date)} • {r.doc_number}</p>
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
