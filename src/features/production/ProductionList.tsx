/** دفعات الإنتاج — قائمة الدفعات مع تكلفة المواد والفلاتر (بند 23/24) */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { rpc } from '@/services/rpc'
import { useAuthStore } from '@/app/authStore'
import { formatMoney, formatQty, sumMoney } from '@/lib/money'
import { rangeFor, fmtDate, type DateRangePreset, type DateRange } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar, AddButton } from '@/components/ui/navigation'
import { Card, Button } from '@/components/ui/primitives'
import { DateInput } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'

/** صف تقرير الإنتاج — مطابق لـ get_production_report() */
interface ProductionRow {
  id: string
  doc_number: string
  batch_date: string
  product_name: string
  quantity: number
  unit_symbol: string
  material_cost: number
  shift: string | null
  recipe_version_no: number | null
}

export default function ProductionList() {
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)

  const [preset, setPreset] = useState<DateRangePreset>('today')
  const [range, setRange] = useState<DateRange>(() => rangeFor('today'))

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['production', range.from, range.to],
    queryFn: () =>
      rpc<ProductionRow[]>('get_production_report', { p_from: range.from, p_to: range.to }),
  })

  const rows = useMemo(() => data ?? [], [data])
  const totalCost = useMemo(() => sumMoney(rows.map((r) => r.material_cost)), [rows])

  function applyPreset(p: DateRangePreset) {
    setPreset(p)
    setRange(rangeFor(p))
  }

  return (
    <div>
      <PageHeader
        title="الإنتاج"
        subtitle="دفعات الإنتاج وتكلفة المواد"
        backTo="/"
        action={has('production.manage') ? <AddButton to="/production/new" label="دفعة إنتاج" /> : undefined}
      />

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
          <DateInput
            value={range.from}
            onChange={(v) => { setRange((r) => ({ ...r, from: v })); setPreset('custom') }}
            className="w-36"
            aria-label="من تاريخ"
          />
          <DateInput
            value={range.to}
            onChange={(v) => { setRange((r) => ({ ...r, to: v })); setPreset('custom') }}
            className="w-36"
            aria-label="إلى تاريخ"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            exportCSV(
              'production',
              ['التاريخ', 'الدفعة', 'المنتج', 'الكمية', 'الوحدة', 'تكلفة المواد', 'الوردية', 'النسخة'],
              rows.map((r) => [
                r.batch_date,
                r.doc_number,
                r.product_name,
                r.quantity,
                r.unit_symbol,
                r.material_cost,
                r.shift,
                r.recipe_version_no,
              ]),
            )
          }
        >
          تصدير CSV
        </Button>
      </FilterBar>

      <Card className="mb-3 grid grid-cols-2 gap-3 p-4">
        <Total label="عدد الدفعات" value={String(rows.length)} />
        <Total label="إجمالي تكلفة المواد" value={formatMoney(totalCost, currency)} strong />
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل دفعات الإنتاج.'} onRetry={() => void refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد دفعات إنتاج في هذه الفترة"
            emptyMessage="جرّب تغيير الفلاتر أو سجّل دفعة إنتاج جديدة."
            columns={[
              { key: 'doc', header: 'الدفعة', render: (r) => <span className="font-bold tabular-nums">{r.doc_number}</span> },
              { key: 'date', header: 'التاريخ', render: (r) => <span className="tabular-nums">{fmtDate(r.batch_date)}</span>, hideOnMobile: true },
              { key: 'product', header: 'المنتج', render: (r) => r.product_name },
              {
                key: 'qty',
                header: 'الكمية',
                className: 'tabular-nums font-bold',
                render: (r) => (
                  <span>
                    {formatQty(r.quantity)} <span className="text-2xs font-bold text-stone-400">{r.unit_symbol}</span>
                  </span>
                ),
              },
              { key: 'cost', header: 'تكلفة المواد', className: 'tabular-nums', render: (r) => formatMoney(r.material_cost, currency) },
              { key: 'shift', header: 'الوردية', render: (r) => r.shift ?? '—', hideOnMobile: true },
              { key: 'version', header: 'النسخة', className: 'tabular-nums', render: (r) => (r.recipe_version_no ? `v${r.recipe_version_no}` : '—'), hideOnMobile: true },
            ]}
            mobileCard={(r) => (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-stone-900">{r.product_name}</p>
                  <p className="text-2xs text-stone-400">{fmtDate(r.batch_date)} • {r.doc_number}</p>
                  {r.shift && <p className="text-2xs text-stone-400">وردية: {r.shift}</p>}
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-sm font-extrabold tabular-nums text-stone-900">
                    {formatQty(r.quantity)} <span className="text-2xs font-bold text-stone-400">{r.unit_symbol}</span>
                  </p>
                  <p className="text-2xs tabular-nums text-stone-500">{formatMoney(r.material_cost, currency)}</p>
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
