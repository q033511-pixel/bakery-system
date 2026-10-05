/**
 * عارض التقارير (بند 54/55/142): تقرير واحد بإعدادات موحدة — فلاتر تاريخ + فلتر خاص +
 * جدول DataTable + تصدير CSV. التقرير الربحية يعرض بطاقات مؤشرات وتنبيه تقديرية (بند 113).
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Download, TrendingDown, TrendingUp, Wallet, ReceiptText } from 'lucide-react'
import { rpc } from '@/services/rpc'
import { useAuthStore } from '@/app/authStore'
import { lookups } from '@/services/lookups'
import { formatMoney, formatQty } from '@/lib/money'
import { rangeFor, fmtDate, fmtDateTime, type DateRangePreset } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader, FilterBar } from '@/components/ui/navigation'
import { Badge, Button, Card, Select, StatCard, StatusBadge } from '@/components/ui/primitives'
import { DateInput, SearchSelect } from '@/components/ui/inputs'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states'

// ---------- أنواع الإعداد ----------
type ColKind = 'text' | 'money' | 'qty' | 'date' | 'datetime' | 'badge' | 'bool' | 'movement' | 'audit'

interface ReportCol {
  key: string
  header: string
  kind?: ColKind
  className?: string
  hideOnMobile?: boolean
}

interface ReportConfig {
  reportId: string
  title: string
  fnName: string
  useDates: boolean
  extra?: 'customer' | 'movement'
  columns: ReportCol[]
}

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE_IN: 'شراء (إدخال)',
  PURCHASE_RETURN_OUT: 'مرتجع شراء',
  PRODUCTION_CONSUMPTION_OUT: 'استهلاك إنتاج',
  PRODUCTION_IN: 'إنتاج (إدخال)',
  SALE_OUT: 'بيع (إخراج)',
  SALE_RETURN_IN: 'مرتجع بيع',
  WASTE_OUT: 'هالك',
  ADJUSTMENT_IN: 'تسوية (إدخال)',
  ADJUSTMENT_OUT: 'تسوية (إخراج)',
  TRANSFER_IN: 'مناقلة (إدخال)',
  TRANSFER_OUT: 'مناقلة (إخراج)',
  DISTRIBUTION_LOAD_OUT: 'تحميل توزيع',
  DISTRIBUTION_RETURN_IN: 'مرتجع توزيع',
}

const ACTION_TONES: Record<string, 'success' | 'info' | 'danger' | 'primary' | 'warning' | 'neutral'> = {
  CREATE: 'success', UPDATE: 'info', VOID: 'danger', PAYMENT: 'primary',
  RETURN: 'warning', ADJUSTMENT: 'warning', DELETE: 'danger', SETTLEMENT: 'info',
}

// ---------- إعدادات التقارير ----------
const REPORTS: ReportConfig[] = [
  {
    reportId: 'sales', title: 'تقرير المبيعات', fnName: 'get_sales_report', useDates: true, extra: 'customer',
    columns: [
      { key: 'doc_number', header: 'الفاتورة', className: 'font-bold tabular-nums' },
      { key: 'sale_date', header: 'التاريخ', kind: 'date', hideOnMobile: true },
      { key: 'customer_name', header: 'العميل' },
      { key: 'total', header: 'الإجمالي', kind: 'money', className: 'font-bold' },
      { key: 'cost_total', header: 'تكلفة المواد', kind: 'money', hideOnMobile: true },
      { key: 'payment_type', header: 'الدفع', kind: 'badge' },
      { key: 'status', header: 'الحالة', kind: 'badge' },
      { key: 'channel', header: 'القناة', kind: 'badge', hideOnMobile: true },
    ],
  },
  {
    reportId: 'sales_daily', title: 'ملخص المبيعات اليومي', fnName: 'get_sales_daily_summary', useDates: true,
    columns: [
      { key: 'day', header: 'اليوم', kind: 'date', className: 'font-bold' },
      { key: 'invoices', header: 'الفواتير', kind: 'qty' },
      { key: 'total', header: 'الإجمالي', kind: 'money', className: 'font-bold' },
      { key: 'cash_total', header: 'نقدي', kind: 'money' },
      { key: 'credit_total', header: 'آجل', kind: 'money' },
      { key: 'cost', header: 'تكلفة المواد', kind: 'money', hideOnMobile: true },
    ],
  },
  {
    reportId: 'purchases', title: 'تقرير المشتريات', fnName: 'get_purchases_report', useDates: true,
    columns: [
      { key: 'doc_number', header: 'الفاتورة', className: 'font-bold tabular-nums' },
      { key: 'purchase_date', header: 'التاريخ', kind: 'date', hideOnMobile: true },
      { key: 'supplier_name', header: 'المورد' },
      { key: 'invoice_number', header: 'فاتورة المورد', hideOnMobile: true },
      { key: 'total', header: 'الإجمالي', kind: 'money', className: 'font-bold' },
      { key: 'payment_type', header: 'الدفع', kind: 'badge' },
      { key: 'status', header: 'الحالة', kind: 'badge' },
    ],
  },
  {
    reportId: 'inventory', title: 'تقرير المخزون', fnName: 'get_inventory_report', useDates: false,
    columns: [
      { key: 'code', header: 'الرمز', hideOnMobile: true },
      { key: 'name', header: 'الصنف', className: 'font-bold' },
      { key: 'warehouse_name', header: 'المستودع' },
      { key: 'qty', header: 'الرصيد', kind: 'qty' },
      { key: 'avg_cost', header: 'متوسط التكلفة', kind: 'money', hideOnMobile: true },
      { key: 'stock_value', header: 'قيمة المخزون', kind: 'money', className: 'font-bold' },
      { key: 'low', header: 'تحت الحد', kind: 'bool' },
    ],
  },
  {
    reportId: 'movements', title: 'حركات المخزون', fnName: 'get_movements_report', useDates: true, extra: 'movement',
    columns: [
      { key: 'created_at', header: 'التاريخ', kind: 'datetime' },
      { key: 'item_name', header: 'الصنف', className: 'font-bold' },
      { key: 'warehouse_name', header: 'المستودع', hideOnMobile: true },
      { key: 'movement_type', header: 'الحركة', kind: 'movement' },
      { key: 'quantity', header: 'الكمية', kind: 'qty' },
      { key: 'total_cost', header: 'التكلفة', kind: 'money', className: 'font-bold' },
      { key: 'doc_number', header: 'المرجع', hideOnMobile: true },
    ],
  },
  {
    reportId: 'production', title: 'تقرير الإنتاج', fnName: 'get_production_report', useDates: true,
    columns: [
      { key: 'doc_number', header: 'الدفعة', className: 'font-bold tabular-nums' },
      { key: 'batch_date', header: 'التاريخ', kind: 'date', hideOnMobile: true },
      { key: 'product_name', header: 'المنتج' },
      { key: 'quantity', header: 'الكمية', kind: 'qty' },
      { key: 'unit_symbol', header: 'الوحدة' },
      { key: 'material_cost', header: 'تكلفة المواد', kind: 'money', className: 'font-bold' },
      { key: 'shift', header: 'الوردية', hideOnMobile: true },
    ],
  },
  {
    reportId: 'customers', title: 'أرصدة العملاء', fnName: 'get_customers_report', useDates: false,
    columns: [
      { key: 'code', header: 'الرمز', hideOnMobile: true },
      { key: 'name', header: 'العميل', className: 'font-bold' },
      { key: 'phone', header: 'الهاتف', hideOnMobile: true },
      { key: 'total_sales', header: 'إجمالي المبيعات الآجلة', kind: 'money' },
      { key: 'balance', header: 'الرصيد المستحق', kind: 'money', className: 'font-bold' },
    ],
  },
  {
    reportId: 'suppliers', title: 'أرصدة الموردين', fnName: 'get_suppliers_report', useDates: false,
    columns: [
      { key: 'code', header: 'الرمز', hideOnMobile: true },
      { key: 'name', header: 'المورد', className: 'font-bold' },
      { key: 'phone', header: 'الهاتف', hideOnMobile: true },
      { key: 'total_purchases', header: 'إجمالي المشتريات الآجلة', kind: 'money' },
      { key: 'balance', header: 'الرصيد المستحق', kind: 'money', className: 'font-bold' },
    ],
  },
  {
    reportId: 'expenses', title: 'تقرير المصروفات', fnName: 'get_expenses_report', useDates: true,
    columns: [
      { key: 'category_name', header: 'الفئة', className: 'font-bold' },
      { key: 'total', header: 'الإجمالي', kind: 'money', className: 'font-bold' },
      { key: 'cnt', header: 'عدد العمليات', kind: 'qty' },
    ],
  },
  {
    reportId: 'cash', title: 'حركة الصندوق', fnName: 'get_cash_report', useDates: true,
    columns: [
      { key: 'created_at', header: 'التاريخ', kind: 'datetime' },
      { key: 'account_name', header: 'الحساب' },
      { key: 'direction', header: 'الاتجاه', kind: 'badge' },
      { key: 'amount', header: 'المبلغ', kind: 'money', className: 'font-bold' },
      { key: 'description', header: 'الوصف', hideOnMobile: true },
    ],
  },
  {
    reportId: 'distribution', title: 'تقرير التوزيع', fnName: 'get_distribution_report', useDates: true,
    columns: [
      { key: 'doc_number', header: 'الحمولة', className: 'font-bold tabular-nums' },
      { key: 'load_date', header: 'التاريخ', kind: 'date', hideOnMobile: true },
      { key: 'vehicle_name', header: 'السيارة' },
      { key: 'driver_name', header: 'السائق', hideOnMobile: true },
      { key: 'status', header: 'الحالة', kind: 'badge' },
      { key: 'loaded_qty', header: 'محمول', kind: 'qty', hideOnMobile: true },
      { key: 'sold_qty', header: 'مبيع', kind: 'qty', hideOnMobile: true },
      { key: 'returned_qty', header: 'مرتجع', kind: 'qty', hideOnMobile: true },
      { key: 'unaccounted_qty', header: 'غير مفسّر', kind: 'qty' },
      { key: 'cash_collected', header: 'النقد المحصّل', kind: 'money' },
      { key: 'cash_variance', header: 'فرق النقد', kind: 'money' },
    ],
  },
  {
    reportId: 'audit', title: 'سجل التدقيق', fnName: 'get_audit_logs', useDates: true,
    columns: [
      { key: 'created_at', header: 'التاريخ', kind: 'datetime' },
      { key: 'user_email', header: 'المستخدم' },
      { key: 'operation', header: 'العملية' },
      { key: 'entity', header: 'الجدول', hideOnMobile: true },
      { key: 'action', header: 'الحدث', kind: 'audit' },
    ],
  },
]

interface ProfitResult {
  revenue: number
  material_cost: number
  expenses: number
  estimated_result: number
  disclaimer: string
}

// ---------- تنسيق القيم ----------
function toStringValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function formatValue(v: unknown, kind: ColKind | undefined, currency: string): string {
  switch (kind) {
    case 'money':
      return v === null || v === undefined ? '—' : formatMoney(Number(v), currency)
    case 'qty':
      return v === null || v === undefined ? '—' : formatQty(Number(v))
    case 'date':
      return fmtDate(typeof v === 'string' ? v : null)
    case 'datetime':
      return fmtDateTime(typeof v === 'string' ? v : null)
    default:
      return toStringValue(v)
  }
}

function renderCell(v: unknown, kind: ColKind | undefined, currency: string) {
  switch (kind) {
    case 'badge':
      return <StatusBadge status={toStringValue(v)} />
    case 'bool':
      return v
        ? <Badge tone="warning">تحت الحد</Badge>
        : <Badge tone="success">جيد</Badge>
    case 'movement':
      return <span>{MOVEMENT_LABELS[toStringValue(v)] ?? toStringValue(v)}</span>
    case 'audit': {
      const action = toStringValue(v)
      const tone = ACTION_TONES[action] ?? 'neutral'
      return <Badge tone={tone}>{action}</Badge>
    }
    default:
      return <span className={kind === 'money' || kind === 'qty' ? 'tabular-nums' : ''}>{formatValue(v, kind, currency)}</span>
  }
}

// ---------- الصفحة ----------
export default function ReportView() {
  const { reportId } = useParams<{ reportId: string }>()
  const currency = useAuthStore((s) => s.currencySymbol())

  const cfg = REPORTS.find((r) => r.reportId === reportId)
  const isProfit = reportId === 'profit'

  const [preset, setPreset] = useState<DateRangePreset>('this_month')
  const initial = rangeFor('this_month')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [customerFilter, setCustomerFilter] = useState<string | null>(null)
  const [movementFilter, setMovementFilter] = useState('ALL')

  const customerOptions = useQuery({
    queryKey: ['customers-lookup'],
    enabled: cfg?.extra === 'customer',
    queryFn: async () => {
      const rows = await lookups.customers()
      return rows.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, sublabel: c.phone ?? '' }))
    },
  })

  const params = useMemo<Record<string, unknown>>(() => {
    if (!cfg) return {}
    if (cfg.reportId === 'audit') return { p_from: from, p_to: to, p_limit: 200 }
    if (!cfg.useDates) return {}
    const base: Record<string, unknown> = { p_from: from, p_to: to }
    if (cfg.extra === 'customer') base.p_customer = customerFilter
    if (cfg.extra === 'movement') base.p_movement = movementFilter === 'ALL' ? null : movementFilter
    return base
  }, [cfg, from, to, customerFilter, movementFilter])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report', reportId, params],
    enabled: Boolean(cfg),
    queryFn: () => rpc<Record<string, unknown>[]>(cfg?.fnName ?? 'noop', params),
  })

  const profit = useQuery({
    queryKey: ['report', 'profit', from, to],
    enabled: isProfit,
    queryFn: () => rpc<ProfitResult>('get_profit_report', { p_from: from, p_to: to }),
  })

  function applyPreset(p: DateRangePreset) {
    const r = rangeFor(p)
    setPreset(p); setFrom(r.from); setTo(r.to)
  }

  if (!cfg && !isProfit) {
    return (
      <div>
        <PageHeader title="تقرير غير معروف" backTo="/reports" />
        <EmptyState title="التقرير المطلوب غير موجود" message="اختر تقريراً من قائمة التقارير." />
      </div>
    )
  }

  const title = isProfit ? 'الربحية التقديرية' : cfg?.title ?? ''
  const columns = cfg?.columns ?? []

  function exportCurrentCSV(): void {
    if (isProfit) return
    const rows = data ?? []
    exportCSV(
      reportId ?? 'report',
      columns.map((c) => c.header),
      rows.map((row) => columns.map((c) => formatValue(row[c.key], c.kind, currency))),
    )
  }

  return (
    <div className="pb-4">
      <PageHeader
        title={title}
        backTo="/reports"
        action={!isProfit ? (
          <Button variant="outline" size="sm" icon={<Download className="size-4" />} onClick={exportCurrentCSV}>
            تصدير CSV
          </Button>
        ) : undefined}
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
        {(isProfit || cfg?.useDates) && (
          <div className="flex items-end gap-2">
            <DateInput value={from} onChange={(v) => { setFrom(v); setPreset('custom') }} className="w-36" aria-label="من تاريخ" />
            <DateInput value={to} onChange={(v) => { setTo(v); setPreset('custom') }} className="w-36" aria-label="إلى تاريخ" />
          </div>
        )}
        {cfg?.extra === 'customer' && (
          <div className="w-48">
            <SearchSelect
              options={customerOptions.data ?? []}
              value={customerFilter}
              onChange={setCustomerFilter}
              placeholder="كل العملاء"
              emptyText="لا يوجد عملاء"
            />
          </div>
        )}
        {cfg?.extra === 'movement' && (
          <Select value={movementFilter} onChange={(e) => setMovementFilter(e.target.value)} className="w-48">
            <option value="ALL">كل الحركات</option>
            {Object.entries(MOVEMENT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </Select>
        )}
      </FilterBar>

      {/* تقرير الربحية التقديرية — بطاقات مؤشرات */}
      {isProfit && (
        <ProfitSection
          data={profit.data}
          isLoading={profit.isLoading}
          isError={profit.isError}
          error={profit.error}
          onRetry={() => void profit.refetch()}
          currency={currency}
          from={from}
          to={to}
        />
      )}

      {/* الجدول العام */}
      {!isProfit && (
        <Card className="overflow-hidden">
          {isLoading ? (
            <LoadingState label="جارٍ تحميل التقرير..." />
          ) : isError ? (
            <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل التقرير.'} onRetry={() => void refetch()} />
          ) : (
            <DataTable
              rows={data ?? []}
              keyOf={(row, i) => String(row['id'] ?? i)}
              emptyTitle="لا توجد بيانات في هذه الفترة"
              emptyMessage="جرّب توسيع نطاق التاريخ أو تغيير الفلاتر."
              columns={columns.map((c) => ({
                key: c.key,
                header: c.header,
                className: [c.kind === 'money' || c.kind === 'qty' ? 'tabular-nums' : '', c.className ?? ''].join(' ').trim(),
                hideOnMobile: c.hideOnMobile ?? false,
                render: (row: Record<string, unknown>) => renderCell(row[c.key], c.kind, currency),
              }))}
            />
          )}
        </Card>
      )}
    </div>
  )
}

// ---------- الربحية التقديرية (بند 113) ----------
function ProfitSection({ data, isLoading, isError, error, onRetry, currency, from, to }: {
  data: ProfitResult | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  currency: string
  from: string
  to: string
}) {
  if (isLoading) return <Card><LoadingState label="جارٍ حساب الربحية..." /></Card>
  if (isError || !data) {
    return <ErrorState message={error instanceof Error ? error.message : 'تعذر حساب الربحية.'} onRetry={onRetry} />
  }
  const k = (v: number) => formatMoney(v, currency)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard title="الإيرادات" value={k(data.revenue)} tone="primary" icon={<Wallet className="size-5" />} />
        <StatCard title="تكلفة المواد" value={k(data.material_cost)} icon={<ReceiptText className="size-5" />} />
        <StatCard title="المصروفات" value={k(data.expenses)} icon={<TrendingDown className="size-5" />} />
        <StatCard
          title="النتيجة التقديرية"
          value={k(data.estimated_result)}
          tone={data.estimated_result >= 0 ? 'success' : 'danger'}
          icon={<TrendingUp className="size-5" />}
        />
      </div>
      <Card className="flex items-start gap-3 border-warning-200 bg-warning-50 p-3.5">
        <p className="text-xs font-bold leading-relaxed text-warning-800">
          {data.disclaimer ?? 'الأرباح تقديرية وتعتمد على اكتمال ودقة البيانات المدخلة.'}
        </p>
      </Card>
      <p className="px-1 text-2xs text-stone-400">
        الصيغة: الإيرادات − تكلفة المواد − المصروفات — للفترة {fmtDate(from)} إلى {fmtDate(to)}
      </p>
    </div>
  )
}
