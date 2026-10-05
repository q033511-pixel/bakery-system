/** حركات المخزون — سجل كل الداخل/الخارج مع فلاتر التاريخ والنوع (بند 12/28) */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { rpc } from '@/services/rpc'
import { useAuthStore } from '@/app/authStore'
import { formatMoney, formatQty } from '@/lib/money'
import { rangeFor, fmtDateTime, type DateRangePreset, type DateRange } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar } from '@/components/ui/navigation'
import { Card, Select, Button, Badge } from '@/components/ui/primitives'
import { DateInput } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { MovementType } from '@/types'

/** صف تقرير الحركات — مطابق لـ get_movements_report() */
interface MovementRow {
  id: string
  created_at: string
  item_name: string
  warehouse_name: string
  movement_type: MovementType
  quantity: number
  unit_cost: number
  total_cost: number
  reference_type: string | null
  doc_number: string | null
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  PURCHASE_IN: 'شراء',
  PURCHASE_RETURN_OUT: 'مرتجع شراء',
  PRODUCTION_CONSUMPTION_OUT: 'استهلاك إنتاج',
  PRODUCTION_IN: 'إنتاج',
  SALE_OUT: 'بيع',
  SALE_RETURN_IN: 'مرتجع بيع',
  WASTE_OUT: 'هالك',
  ADJUSTMENT_IN: 'تسوية داخل',
  ADJUSTMENT_OUT: 'تسوية خارج',
  TRANSFER_IN: 'مناقلة داخل',
  TRANSFER_OUT: 'مناقلة خارج',
  DISTRIBUTION_LOAD_OUT: 'تحميل توزيع',
  DISTRIBUTION_RETURN_IN: 'مرتجع توزيع',
}

function directionOf(t: MovementType): 'IN' | 'OUT' {
  return t.endsWith('_IN') ? 'IN' : 'OUT'
}

export default function InventoryMovements() {
  const currency = useAuthStore((s) => s.currencySymbol())

  const [preset, setPreset] = useState<DateRangePreset>('today')
  const [range, setRange] = useState<DateRange>(() => rangeFor('today'))
  const [type, setType] = useState<'ALL' | MovementType>('ALL')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['movements', range.from, range.to, type],
    queryFn: () =>
      rpc<MovementRow[]>('get_movements_report', {
        p_from: range.from,
        p_to: range.to,
        p_movement: type === 'ALL' ? null : type,
      }),
  })

  const rows = useMemo(() => data ?? [], [data])

  function applyPreset(p: DateRangePreset) {
    setPreset(p)
    setRange(rangeFor(p))
  }

  return (
    <div>
      <PageHeader title="حركات المخزون" subtitle="سجل موحد لكل حركات الداخل والخارج" backTo="/inventory" />

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
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as 'ALL' | MovementType)}
          className="w-44"
          aria-label="نوع الحركة"
        >
          <option value="ALL">كل الحركات</option>
          {(Object.keys(MOVEMENT_LABELS) as MovementType[]).map((t) => (
            <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>
          ))}
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            exportCSV(
              'inventory-movements',
              ['التاريخ', 'الصنف', 'المخزن', 'نوع الحركة', 'الاتجاه', 'الكمية', 'تكلفة الوحدة', 'الإجمالي', 'المستند'],
              rows.map((r) => [
                fmtDateTime(r.created_at),
                r.item_name,
                r.warehouse_name,
                MOVEMENT_LABELS[r.movement_type],
                directionOf(r.movement_type) === 'IN' ? 'داخل' : 'خارج',
                r.quantity,
                r.unit_cost,
                r.total_cost,
                r.doc_number,
              ]),
            )
          }
        >
          تصدير CSV
        </Button>
      </FilterBar>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل حركات المخزون.'} onRetry={() => void refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد حركات في هذه الفترة"
            emptyMessage="جرّب توسيع نطاق التاريخ أو تغيير نوع الحركة."
            columns={[
              { key: 'date', header: 'التاريخ', render: (r) => <span className="tabular-nums">{fmtDateTime(r.created_at)}</span>, hideOnMobile: true },
              { key: 'item', header: 'الصنف', render: (r) => <span className="font-bold text-stone-900">{r.item_name}</span> },
              { key: 'warehouse', header: 'المخزن', render: (r) => r.warehouse_name, hideOnMobile: true },
              { key: 'type', header: 'نوع الحركة', render: (r) => MOVEMENT_LABELS[r.movement_type] },
              {
                key: 'direction',
                header: 'الاتجاه',
                render: (r) =>
                  directionOf(r.movement_type) === 'IN'
                    ? <Badge tone="success">داخل</Badge>
                    : <Badge tone="danger">خارج</Badge>,
              },
              { key: 'qty', header: 'الكمية', className: 'tabular-nums font-bold', render: (r) => formatQty(r.quantity) },
              { key: 'total', header: 'الإجمالي', className: 'tabular-nums', render: (r) => formatMoney(r.total_cost, currency), hideOnMobile: true },
              { key: 'ref', header: 'المستند', className: 'tabular-nums', render: (r) => r.doc_number ?? '—', hideOnMobile: true },
            ]}
            mobileCard={(r) => (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-stone-900">{r.item_name}</p>
                  <p className="text-2xs text-stone-400">{MOVEMENT_LABELS[r.movement_type]} • {fmtDateTime(r.created_at)}</p>
                  <p className="text-2xs text-stone-400">{r.warehouse_name}{r.doc_number ? ` • ${r.doc_number}` : ''}</p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-sm font-extrabold tabular-nums text-stone-900">{formatQty(r.quantity)}</p>
                  {directionOf(r.movement_type) === 'IN'
                    ? <Badge tone="success">داخل</Badge>
                    : <Badge tone="danger">خارج</Badge>}
                </div>
              </div>
            )}
          />
        )}
      </Card>
    </div>
  )
}
