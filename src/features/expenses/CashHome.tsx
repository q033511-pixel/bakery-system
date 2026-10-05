/**
 * الصندوق — أرصدة الحسابات + سجل الحركات (بند 24/33).
 * الرصيد يُحسب من الحركات عبر view v_cash_balances، والحركات عبر get_cash_report.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/services/rpc'
import { useAuthStore } from '@/app/authStore'
import { formatMoney, sumMoney } from '@/lib/money'
import { rangeFor, fmtDateTime, type DateRangePreset } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar } from '@/components/ui/navigation'
import { Card, Button, Badge, StatCard } from '@/components/ui/primitives'
import { DateInput } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import { Info, Wallet, Landmark, Vault } from 'lucide-react'

interface CashBalanceRow {
  account_id: string
  name: string
  kind: string
  balance: number
}

interface CashReportRow {
  id: string
  created_at: string
  account_name: string
  direction: string
  amount: number
  description: string | null
  reference_type: string | null
}

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

const KIND_LABELS: Record<string, string> = {
  CASH: 'صندوق نقدي',
  BANK: 'حساب بنكي',
  OTHER: 'أخرى',
}

export default function CashHome() {
  const currency = useAuthStore((s) => s.currencySymbol())
  const [filters, setFilters] = useState<Filters>(() => {
    const r = rangeFor('this_month')
    return { preset: 'this_month', from: r.from, to: r.to }
  })

  const balancesQ = useQuery({
    queryKey: ['cash-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_cash_balances').select('*')
      if (error) throw new Error(error.message)
      return data as unknown as CashBalanceRow[]
    },
  })

  const reportQ = useQuery({
    queryKey: ['cash-report', filters.from, filters.to],
    queryFn: async () => {
      const rows = await rpc<CashReportRow[]>('get_cash_report', { p_from: filters.from, p_to: filters.to })
      return rows ?? []
    },
  })

  const balances = useMemo(() => balancesQ.data ?? [], [balancesQ.data])
  const rows = useMemo(() => reportQ.data ?? [], [reportQ.data])

  const totalBalance = useMemo(() => sumMoney(balances.map((b) => b.balance)), [balances])

  const totals = useMemo(() => ({
    inflow: rows.filter((r) => r.direction === 'IN').reduce((a, r) => a + r.amount, 0),
    outflow: rows.filter((r) => r.direction === 'OUT').reduce((a, r) => a + r.amount, 0),
  }), [rows])

  function applyPreset(p: (typeof PRESET_KEYS)[number]) {
    const r = rangeFor(p)
    setFilters((f) => ({ ...f, preset: p, from: r.from, to: r.to }))
  }

  return (
    <div className="pb-4">
      <PageHeader title="الصندوق" subtitle="أرصدة الحسابات وسجل الحركات المالية" backTo="/" />

      {/* أرصدة الحسابات */}
      {balancesQ.isLoading ? (
        <Card className="mb-3"><LoadingState /></Card>
      ) : balancesQ.isError ? (
        <Card className="mb-3">
          <ErrorState message={balancesQ.error instanceof Error ? balancesQ.error.message : 'تعذر تحميل الأرصدة.'} onRetry={() => void balancesQ.refetch()} />
        </Card>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            title="إجمالي الصندوق"
            value={formatMoney(totalBalance, currency)}
            sub={`${balances.length} ${balances.length === 1 ? 'حساب' : 'حسابات'}`}
            tone="primary"
            icon={<Vault className="size-5" />}
          />
          {balances.map((b) => (
            <StatCard
              key={b.account_id}
              title={b.name}
              value={formatMoney(b.balance, currency)}
              sub={KIND_LABELS[b.kind] ?? b.kind}
              tone={b.balance < 0 ? 'danger' : 'default'}
              icon={b.kind === 'BANK' ? <Landmark className="size-5" /> : <Wallet className="size-5" />}
            />
          ))}
        </div>
      )}

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
          onClick={() => exportCSV('cash-report', ['التاريخ', 'الحساب', 'الاتجاه', 'المبلغ', 'الوصف', 'النوع'],
            rows.map((r) => [fmtDateTime(r.created_at), r.account_name, r.direction === 'IN' ? 'داخل' : 'خارج', r.amount, r.description ?? '', r.reference_type ?? '']))}
        >
          تصدير CSV
        </Button>
      </FilterBar>

      <Card className="overflow-hidden">
        {reportQ.isLoading ? (
          <LoadingState />
        ) : reportQ.isError ? (
          <ErrorState message={reportQ.error instanceof Error ? reportQ.error.message : 'تعذر تحميل حركات الصندوق.'} onRetry={() => void reportQ.refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد حركات صندوق في هذه الفترة"
            emptyMessage="كل عملية بيع/شراء/مصروف نقدية تُسجّل هنا تلقائياً."
            columns={[
              { key: 'date', header: 'التاريخ', render: (r) => <span className="tabular-nums">{fmtDateTime(r.created_at)}</span>, hideOnMobile: true },
              { key: 'account', header: 'الحساب', render: (r) => <span className="font-bold">{r.account_name}</span> },
              { key: 'direction', header: 'الاتجاه', render: (r) => r.direction === 'IN' ? <Badge tone="success">داخل</Badge> : <Badge tone="danger">خارج</Badge> },
              {
                key: 'amount', header: 'المبلغ', className: 'font-bold tabular-nums', render: (r) => (
                  <span className={r.direction === 'IN' ? 'text-success-700' : 'text-danger-700'}>
                    {r.direction === 'IN' ? '+' : '−'}{formatMoney(r.amount, currency)}
                  </span>
                ),
              },
              { key: 'description', header: 'الوصف', render: (r) => <span className="block max-w-56 truncate">{r.description ?? '—'}</span> },
            ]}
            mobileCard={(r) => (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold">{r.account_name}</p>
                  <p className="truncate text-2xs text-stone-400">{fmtDateTime(r.created_at)} • {r.description ?? '—'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {r.direction === 'IN' ? <Badge tone="success">داخل</Badge> : <Badge tone="danger">خارج</Badge>}
                  <span className={`text-sm font-extrabold tabular-nums ${r.direction === 'IN' ? 'text-success-700' : 'text-danger-700'}`}>
                    {r.direction === 'IN' ? '+' : '−'}{formatMoney(r.amount, currency)}
                  </span>
                </div>
              </div>
            )}
          />
        )}
      </Card>

      <Card className="mt-3 flex items-start gap-2 p-4 text-xs leading-relaxed text-stone-600">
        <Info className="mt-0.5 size-4 shrink-0 text-info-600" />
        <div>
          <p className="font-bold text-stone-800">الرصيد يُحسب من الحركات — كل عملية مالية تُسجل حركة صندوق آلية.</p>
          <p className="mt-1">
            حركة «داخل»: تحصيلات العملاء والبيع النقدي. حركة «خارج»: الشراء النقدي والمصروفات ودفعات الموردين.
            خلال الفترة المحددة: داخل {formatMoney(totals.inflow, currency)} — خارج {formatMoney(totals.outflow, currency)}.
          </p>
        </div>
      </Card>
    </div>
  )
}
