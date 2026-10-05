/**
 * Dashboard — Mobile First (بند 46/124):
 * اسم المخبز + التاريخ + حالة الاتصال، ثم Quick Actions، ثم KPIs من قاعدة البيانات، ثم تنبيهات.
 * لا أرقام وهمية إطلاقاً (بند 129) — كل قيمة من get_dashboard_summary().
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ShoppingCart, Wallet, ReceiptText, Factory, TrendingDown, Users, Truck,
  Plus, Package, AlertTriangle, RefreshCw, CalendarDays,
} from 'lucide-react'
import { rpc } from '@/services/rpc'
import { useAuthStore } from '@/app/authStore'
import { useSyncStore } from '@/services/sync/syncEngine'
import { formatMoney } from '@/lib/money'
import { todayISO, fmtDate } from '@/lib/dates'
import { StatCard, Card } from '@/components/ui/primitives'
import { QuickActions, type QuickActionDef } from '@/components/ui/navigation'
import { Skeleton } from '@/components/ui/primitives'
import type { DashboardSummary } from '@/types'

function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => rpc<DashboardSummary>('get_dashboard_summary', {}),
    refetchInterval: 120_000,
  })
}

export default function Dashboard() {
  const { data, isLoading, isError, error, refetch } = useDashboard()
  const business = useAuthStore((s) => s.business)
  const profile = useAuthStore((s) => s.profile)
  const has = useAuthStore((s) => s.has)
  const currency = business?.currency_symbol ?? '₪'
  const { online, pendingCount } = useSyncStore()

  const actions: QuickActionDef[] = [
    { label: 'بيع', to: '/sale/new', icon: <Plus className="size-4" />, permission: has('sales.manage') },
    { label: 'شراء', to: '/purchases/new', icon: <ReceiptText className="size-4" />, permission: has('purchases.manage') },
    { label: 'تحصيل', to: '/customers?payment=1', icon: <Wallet className="size-4" />, permission: has('payments.manage') },
    { label: 'إنتاج', to: '/production/new', icon: <Factory className="size-4" />, permission: has('production.manage') },
    { label: 'مصروف', to: '/expenses/new', icon: <TrendingDown className="size-4" />, permission: has('expenses.manage') },
    { label: 'مخزون', to: '/inventory', icon: <Package className="size-4" />, permission: has('inventory.view') },
    { label: 'حمولة', to: '/distribution/new', icon: <Truck className="size-4" />, permission: has('distribution.manage') },
  ]

  const kpi = (v: number) => formatMoney(v, currency)

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-stone-900">{business?.name ?? 'نظام المخبز'}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500">
            <CalendarDays className="size-3.5" /> {fmtDate(todayISO())}
            {profile && <span className="text-stone-300">•</span>}
            {profile?.full_name}
          </p>
        </div>
        <button onClick={() => void refetch()} className="rounded-lg p-2 text-stone-400 transition hover:bg-stone-100" aria-label="تحديث">
          <RefreshCw className="size-4" />
        </button>
      </div>

      {/* تنبيه الأوفلاين */}
      {!online && (
        <Card className="flex items-center gap-3 border-warning-200 bg-warning-50 p-3.5">
          <AlertTriangle className="size-5 shrink-0 text-warning-600" />
          <p className="text-xs font-bold leading-relaxed text-warning-800">
            أنت غير متصل بالإنترنت — استخدم النظام بشكل طبيعي، وستُحفظ العمليات محلياً وستتم مزامنتها عند عودة الاتصال
            {pendingCount > 0 && ` (${pendingCount} عملية بانتظار المزامنة)`}.
          </p>
        </Card>
      )}

      {/* Quick Actions */}
      <QuickActions actions={actions} />

      {/* KPIs */}
      {isLoading && (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {isError && (
        <Card className="flex items-center justify-between gap-3 border-danger-200 bg-danger-50 p-4">
          <p className="text-xs font-bold text-danger-700">
            تعذر تحميل المؤشرات: {error instanceof Error ? error.message : 'خطأ غير معروف'}
          </p>
          <button onClick={() => void refetch()} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-danger-700">إعادة</button>
        </Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatCard title="مبيعات اليوم" value={kpi(data.sales_today)} sub={`${data.sales_today_count} فاتورة`} tone="primary" icon={<ShoppingCart className="size-5" />} />
            <StatCard title="تحصيل اليوم" value={kpi(data.collections_today)} tone="success" icon={<Wallet className="size-5" />} />
            <StatCard title="مشتريات اليوم" value={kpi(data.purchases_today)} icon={<ReceiptText className="size-5" />} />
            <StatCard title="إنتاج اليوم" value={kpi(data.production_today)} sub="تكلفة المواد" icon={<Factory className="size-5" />} />
            <StatCard title="مصروفات اليوم" value={kpi(data.expenses_today)} icon={<TrendingDown className="size-5" />} />
            <StatCard title="صافي الصندوق" value={kpi(data.cash_balance ?? 0)} tone={(data.cash_balance ?? 0) < 0 ? 'danger' : 'default'} icon={<Wallet className="size-5" />} />
            <StatCard title="ديون العملاء" value={kpi(data.customer_receivables)} tone="warning" icon={<Users className="size-5" />} />
            <StatCard title="مستحقات الموردين" value={kpi(data.supplier_payables)} tone="warning" icon={<Users className="size-5" />} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Link to="/inventory" className="rounded-xl border border-stone-200 bg-white p-3.5 text-center shadow-card transition hover:border-primary-300">
              <p className="text-xs font-bold text-stone-500">قيمة المخزون</p>
              <p className="mt-1 truncate text-sm font-extrabold tabular-nums text-stone-900">{kpi(data.inventory_value)}</p>
            </Link>
            <Link to="/inventory" className={`rounded-xl border p-3.5 text-center shadow-card transition ${data.low_stock_count > 0 ? 'border-warning-300 bg-warning-50' : 'border-stone-200 bg-white hover:border-primary-300'}`}>
              <p className="text-xs font-bold text-stone-500">أصناف تحت الحد</p>
              <p className={`mt-1 text-sm font-extrabold tabular-nums ${data.low_stock_count > 0 ? 'text-warning-700' : 'text-stone-900'}`}>{data.low_stock_count}</p>
            </Link>
            <Link to="/distribution" className="rounded-xl border border-stone-200 bg-white p-3.5 text-center shadow-card transition hover:border-primary-300">
              <p className="text-xs font-bold text-stone-500">حمولات مفتوحة</p>
              <p className="mt-1 text-sm font-extrabold tabular-nums text-stone-900">{data.distribution_open_loads}</p>
            </Link>
          </div>

          {/* ملخص سريع */}
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-extrabold text-stone-800">ملخص التشغيل</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <SummaryRow label="العملاء النشطون" value={String(data.customers_count)} />
              <SummaryRow label="الأصناف النشطة" value={String(data.products_count)} />
              <SummaryRow label="عمليات بانتظار المزامنة" value={String(pendingCount)} />
              <SummaryRow label="حمولات بحاجة تسوية" value={String(data.distribution_open_loads)} />
            </div>
            {pendingCount > 0 && (
              <Link to="/sync" className="mt-3 inline-block text-xs font-bold text-primary-700 hover:underline">
                عرض مركز المزامنة ←
              </Link>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-stone-100 pb-1.5">
      <span className="text-stone-500">{label}</span>
      <span className="font-extrabold tabular-nums text-stone-900">{value}</span>
    </div>
  )
}
