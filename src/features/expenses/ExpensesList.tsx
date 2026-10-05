/** قائمة المصروفات (بند 32): فلاتر تاريخ، ملخص، تصدير CSV */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/app/authStore'
import { formatMoney } from '@/lib/money'
import { rangeFor, fmtDate, type DateRangePreset } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar, AddButton } from '@/components/ui/navigation'
import { Card, Button, Badge } from '@/components/ui/primitives'
import { DateInput } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Expense, PaymentMethod } from '@/types'

type ExpenseRow = Expense & { expense_categories: { name: string } | null }

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

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'نقدي',
  BANK_TRANSFER: 'حوالة',
  CHECK: 'شيك',
  OTHER: 'أخرى',
}

export default function ExpensesList() {
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)
  const [filters, setFilters] = useState<Filters>(() => {
    const r = rangeFor('today')
    return { preset: 'today', from: r.from, to: r.to }
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['expenses', filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, expense_categories(name)')
        .gte('expense_date', filters.from)
        .lte('expense_date', filters.to)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      return data as unknown as ExpenseRow[]
    },
  })

  const rows = useMemo(() => data ?? [], [data])
  const totals = useMemo(() => ({
    count: rows.length,
    total: rows.reduce((a, r) => a + r.amount, 0),
  }), [rows])

  function applyPreset(p: (typeof PRESET_KEYS)[number]) {
    const r = rangeFor(p)
    setFilters((f) => ({ ...f, preset: p, from: r.from, to: r.to }))
  }

  return (
    <div>
      <PageHeader
        title="المصروفات"
        backTo="/"
        action={has('expenses.manage') ? <AddButton to="/expenses/new" label="مصروف جديد" /> : undefined}
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
          onClick={() => exportCSV('expenses', ['التاريخ', 'البند', 'الوصف', 'المبلغ', 'طريقة الدفع'],
            rows.map((r) => [r.expense_date, r.expense_categories?.name ?? '—', r.description ?? '', r.amount, METHOD_LABELS[r.payment_method]]))}
        >
          تصدير CSV
        </Button>
      </FilterBar>

      <Card className="mb-3 grid grid-cols-2 gap-3 p-4">
        <Total label="عدد العمليات" value={String(totals.count)} />
        <Total label="الإجمالي" value={formatMoney(totals.total, currency)} strong />
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل المصروفات.'} onRetry={() => void refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد مصروفات في هذه الفترة"
            emptyMessage="جرّب تغيير الفلاتر أو سجّل مصروفاً جديداً."
            columns={[
              { key: 'date', header: 'التاريخ', render: (r) => fmtDate(r.expense_date) },
              { key: 'category', header: 'البند', render: (r) => <span className="font-bold">{r.expense_categories?.name ?? '—'}</span> },
              { key: 'description', header: 'الوصف', render: (r) => <span className="block max-w-56 truncate">{r.description ?? '—'}</span>, hideOnMobile: true },
              { key: 'amount', header: 'المبلغ', className: 'font-bold tabular-nums', render: (r) => formatMoney(r.amount, currency) },
              { key: 'method', header: 'الدفع', render: (r) => <Badge tone="neutral">{METHOD_LABELS[r.payment_method]}</Badge> },
            ]}
            mobileCard={(r) => (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold">{r.expense_categories?.name ?? '—'}</p>
                  <p className="truncate text-2xs text-stone-400">{fmtDate(r.expense_date)} • {r.description ?? 'بدون وصف'}</p>
                </div>
                <div className="text-end">
                  <p className="text-sm font-extrabold tabular-nums">{formatMoney(r.amount, currency)}</p>
                  <p className="text-2xs font-bold text-stone-400">{METHOD_LABELS[r.payment_method]}</p>
                </div>
              </div>
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
