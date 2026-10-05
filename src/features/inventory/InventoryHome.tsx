/** المخزون — أرصدة الأصناف لكل مخزن، قيمة المخزون، وتنبيهات الحد الأدنى (بند 26/94) */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Package, AlertTriangle, SlidersHorizontal, Trash2, ArrowLeftRight, ScrollText, Search,
} from 'lucide-react'
import { rpc } from '@/services/rpc'
import { lookups } from '@/services/lookups'
import { useAuthStore } from '@/app/authStore'
import { formatMoney, formatQty, sumMoney } from '@/lib/money'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar, QuickActions, type QuickActionDef } from '@/components/ui/navigation'
import { Card, Input, Select, Button, StatCard, Badge, StatusBadge } from '@/components/ui/primitives'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { ItemType, Unit } from '@/types'

/** صف تقرير المخزون — مطابق لـ get_inventory_report() */
interface InventoryRow {
  product_id: string
  code: string
  name: string
  item_type: ItemType
  warehouse_name: string
  qty: number
  avg_cost: number
  stock_value: number
  min_stock: number
  low: boolean
}

const TYPE_FILTERS: { value: 'ALL' | ItemType; label: string }[] = [
  { value: 'ALL', label: 'الكل' },
  { value: 'RAW_MATERIAL', label: 'مواد خام' },
  { value: 'FINISHED_PRODUCT', label: 'منتجات نهائية' },
  { value: 'PACKAGING', label: 'تغليف' },
]

export default function InventoryHome() {
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)

  const [search, setSearch] = useState('')
  const [warehouse, setWarehouse] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState<'ALL' | ItemType>('ALL')

  const warehouses = useLiveQuery(async () => lookups.warehouses(), [], [])
  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => rpc<InventoryRow[]>('get_inventory_report', {}),
  })

  // رمز وحدة الرصيد من الكاش المحلي (الوحدة الأساسية للصنف)
  const symbolByProduct = useMemo(() => {
    const unitById = new Map<string, Unit>(units.map((u) => [u.id, u]))
    return new Map(products.map((p) => [p.id, unitById.get(p.base_unit_id)?.symbol ?? '']))
  }, [products, units])

  const allRows = useMemo(() => data ?? [], [data])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter(
      (r) =>
        (warehouse === 'ALL' || r.warehouse_name === warehouse) &&
        (typeFilter === 'ALL' || r.item_type === typeFilter) &&
        (q === '' || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)),
    )
  }, [allRows, search, warehouse, typeFilter])

  const totalValue = sumMoney(allRows.map((r) => r.stock_value))
  const lowCount = allRows.filter((r) => r.low).length

  const actions: QuickActionDef[] = [
    { label: 'تسوية مخزون', to: '/inventory/adjust', icon: <SlidersHorizontal className="size-4" />, permission: has('inventory.adjust') },
    { label: 'تسجيل هالك', to: '/inventory/waste', icon: <Trash2 className="size-4" />, permission: has('inventory.waste') },
    { label: 'مناقلة', to: '/inventory/transfer', icon: <ArrowLeftRight className="size-4" />, permission: has('inventory.transfer') },
    { label: 'الحركات', to: '/inventory/movements', icon: <ScrollText className="size-4" />, permission: has('inventory.view') },
  ]

  return (
    <div>
      <PageHeader title="المخزون" subtitle="أرصدة الأصناف وتكلفتها لكل مخزن" backTo="/" />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <StatCard
          title="قيمة المخزون"
          value={formatMoney(totalValue, currency)}
          tone="primary"
          icon={<Package className="size-5" />}
        />
        <StatCard
          title="أصناف تحت الحد الأدنى"
          value={String(lowCount)}
          tone={lowCount > 0 ? 'warning' : 'default'}
          icon={<AlertTriangle className="size-5" />}
        />
      </div>

      <div className="mb-3">
        <QuickActions actions={actions} />
      </div>

      <FilterBar>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الكود..."
            className="w-52 pr-9"
            aria-label="بحث في المخزون"
          />
        </div>
        <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="w-40" aria-label="المخزن">
          <option value="ALL">كل المخازن</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.name}>{w.name}</option>
          ))}
        </Select>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'ALL' | ItemType)}
          className="w-36"
          aria-label="نوع الصنف"
        >
          {TYPE_FILTERS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            exportCSV(
              'inventory',
              ['الصنف', 'الكود', 'النوع', 'المخزن', 'الرصيد', 'تكلفة الوحدة', 'القيمة', 'الحد الأدنى'],
              rows.map((r) => [r.name, r.code, r.item_type, r.warehouse_name, r.qty, r.avg_cost, r.stock_value, r.min_stock]),
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
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل أرصدة المخزون.'} onRetry={() => void refetch()} />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r) => `${r.product_id}-${r.warehouse_name}`}
            emptyTitle="لا توجد أرصدة مخزون"
            emptyMessage="سجّل مشتريات أو إنتاجاً لتظهر الأرصدة هنا."
            columns={[
              {
                key: 'name',
                header: 'الصنف',
                render: (r) => (
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-stone-900">{r.name}</span>
                    <span className="text-2xs tabular-nums text-stone-400">{r.code}</span>
                  </div>
                ),
              },
              { key: 'type', header: 'النوع', render: (r) => <StatusBadge status={r.item_type} />, hideOnMobile: true },
              { key: 'warehouse', header: 'المخزن', render: (r) => r.warehouse_name },
              {
                key: 'qty',
                header: 'الرصيد',
                className: 'tabular-nums font-bold',
                render: (r) => (
                  <span className={`inline-flex items-center gap-1.5 ${r.qty < 0 ? 'text-danger-600' : r.low ? 'text-warning-700' : 'text-stone-900'}`}>
                    {formatQty(r.qty)}
                    <span className="text-2xs font-bold text-stone-400">{symbolByProduct.get(r.product_id) ?? ''}</span>
                    {r.low && <Badge tone="warning">تحت الحد</Badge>}
                  </span>
                ),
              },
              { key: 'avg_cost', header: 'تكلفة الوحدة', className: 'tabular-nums', render: (r) => formatMoney(r.avg_cost, currency), hideOnMobile: true },
              { key: 'value', header: 'القيمة', className: 'tabular-nums font-bold', render: (r) => formatMoney(r.stock_value, currency) },
              { key: 'min_stock', header: 'الحد الأدنى', className: 'tabular-nums', render: (r) => formatQty(r.min_stock), hideOnMobile: true },
            ]}
            mobileCard={(r) => (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-stone-900">{r.name}</p>
                  <p className="text-2xs text-stone-400">{r.warehouse_name} • {r.code}</p>
                  {r.low && <Badge tone="warning" className="mt-1">تحت الحد الأدنى</Badge>}
                </div>
                <div className="shrink-0 text-end">
                  <p className={`text-sm font-extrabold tabular-nums ${r.qty < 0 ? 'text-danger-600' : r.low ? 'text-warning-700' : 'text-stone-900'}`}>
                    {formatQty(r.qty)} <span className="text-2xs font-bold text-stone-400">{symbolByProduct.get(r.product_id) ?? ''}</span>
                  </p>
                  <p className="text-2xs tabular-nums text-stone-500">{formatMoney(r.stock_value, currency)}</p>
                </div>
              </div>
            )}
          />
        )}
      </Card>
    </div>
  )
}
