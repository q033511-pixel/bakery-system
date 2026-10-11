/**
 * Dashboard VIP — Mobile First (بند 46/124):
 * هيرو ترحيبي بتدرج العلامة + رسم مبيعات آخر ٧ أيام (محلي من Dexie) + KPIs من get_dashboard_summary()
 * + نشاط حديث + قائمة ترحيب للنظام الجديد + تنبيه النسخ الاحتياطية.
 * لا أرقام وهمية إطلاقاً (بند 129) — كل قيمة من قاعدة البيانات المحلية.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ShoppingCart, Wallet, ReceiptText, Factory, TrendingDown, Users, Truck,
  Plus, Package, AlertTriangle, RefreshCw, CalendarDays, HardDrive, History,
  CheckCircle2, Circle, ArrowLeft, ShieldCheck, CloudOff,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { rpc } from '@/services/rpc'
import { db } from '@/db/db'
import { useAuthStore } from '@/app/authStore'
import { useSyncStore } from '@/services/sync/syncEngine'
import { formatMoney } from '@/lib/money'
import { fmtDate } from '@/lib/dates'
import { StatCard, Card, Skeleton, MiniBars, type MiniBarPoint } from '@/components/ui/primitives'
import { QuickActions, type QuickActionDef } from '@/components/ui/navigation'
import type { DashboardSummary } from '@/types'

const DAY_LABELS = ['أحد', 'إثن', 'ثلث', 'أرب', 'خمي', 'جمع', 'سبت']
const BACKUP_KEY = 'bakery.last_backup'
const BACKUP_DISMISS_KEY = 'bakery.backup_reminder_dismissed'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'صباح الخير'
  if (h < 17) return 'مساء الخير'
  return 'ليلة موفقة'
}

/** مبيعات آخر ٧ أيام — تُجمع محلياً من جدول الفواتير بالتوقيت المحلي */
function useWeeklySales(bid: string | undefined) {
  return useQuery({
    queryKey: ['dash_week', bid],
    enabled: !!bid,
    queryFn: async (): Promise<MiniBarPoint[]> => {
      const rows = (await db.sales.where('business_id').equals(bid!).toArray())
        .filter((r) => r.status === 'CONFIRMED')
      const base = new Date()
      const points: MiniBarPoint[] = []
      for (let k = 6; k >= 0; k--) {
        const d = new Date(base)
        d.setDate(d.getDate() - k)
        const day = format(d, 'yyyy-MM-dd')
        const sum = rows.reduce((acc, r) => {
          try {
            return format(parseISO(String(r.created_at ?? '')), 'yyyy-MM-dd') === day
              ? acc + Number(r.total ?? 0) : acc
          } catch { return acc }
        }, 0)
        points.push({ label: DAY_LABELS[d.getDay()] ?? '', value: Math.round(sum * 100) / 100, highlight: k === 0 })
      }
      return points
    },
    staleTime: 60_000,
  })
}

interface ActItem {
  id: string
  kind: 'sale' | 'purchase' | 'cpay' | 'spay' | 'expense' | 'production'
  title: string
  sub: string
  amount: number
  at: string
  to: string
}

/** نشاط حديث — آخر عمليات من كل الوحدات */
function useRecentActivity(bid: string | undefined) {
  return useQuery({
    queryKey: ['dash_activity', bid],
    enabled: !!bid,
    queryFn: async (): Promise<ActItem[]> => {
      const [sales, purchases, cpays, spays, exps, prods, customers, suppliers] = await Promise.all([
        db.sales.where('business_id').equals(bid!).toArray(),
        db.purchases.where('business_id').equals(bid!).toArray(),
        db.customer_payments.where('business_id').equals(bid!).toArray(),
        db.supplier_payments.where('business_id').equals(bid!).toArray(),
        db.expenses.where('business_id').equals(bid!).toArray(),
        db.production_batches.where('business_id').equals(bid!).toArray(),
        db.customers.where('business_id').equals(bid!).toArray(),
        db.suppliers.where('business_id').equals(bid!).toArray(),
      ])
      const custName = new Map(customers.map((c) => [c.id, String(c.name ?? '')]))
      const supName = new Map(suppliers.map((s) => [s.id, String(s.name ?? '')]))
      const items: ActItem[] = []
      for (const s of sales) if (s.status === 'CONFIRMED') {
        items.push({ id: `s${s.id}`, kind: 'sale', title: 'فاتورة بيع', sub: String(s.doc_number ?? ''), amount: Number(s.total ?? 0), at: String(s.created_at ?? ''), to: `/sales/${s.id}` })
      }
      for (const p of purchases) if (p.status === 'CONFIRMED') {
        items.push({ id: `p${p.id}`, kind: 'purchase', title: 'فاتورة شراء', sub: String(p.doc_number ?? ''), amount: Number(p.total ?? 0), at: String(p.created_at ?? ''), to: `/purchases/${p.id}` })
      }
      for (const c of cpays) {
        items.push({ id: `c${c.id}`, kind: 'cpay', title: 'تحصيل من عميل', sub: custName.get(String(c.customer_id ?? '')) ?? '', amount: Number(c.amount ?? 0), at: String(c.created_at ?? ''), to: `/customers/${c.customer_id}` })
      }
      for (const s of spays) {
        items.push({ id: `sp${s.id}`, kind: 'spay', title: 'دفعة لمورد', sub: supName.get(String(s.supplier_id ?? '')) ?? '', amount: Number(s.amount ?? 0), at: String(s.created_at ?? ''), to: `/suppliers/${s.supplier_id}` })
      }
      for (const e of exps) {
        items.push({ id: `e${e.id}`, kind: 'expense', title: 'مصروف', sub: String(e.description ?? ''), amount: Number(e.amount ?? 0), at: String(e.created_at ?? ''), to: '/expenses' })
      }
      for (const b of prods) {
        items.push({ id: `b${b.id}`, kind: 'production', title: 'دفعة إنتاج', sub: String(b.doc_number ?? ''), amount: Number(b.material_cost ?? 0), at: String(b.created_at ?? ''), to: '/production' })
      }
      return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 7)
    },
    staleTime: 30_000,
  })
}

/** هل يحتاج النظام تذكير النسخ الاحتياطي؟ */
function needsBackupReminder(): boolean {
  try {
    const last = localStorage.getItem(BACKUP_KEY)
    const dismissed = localStorage.getItem(BACKUP_DISMISS_KEY)
    if (last) return false
    if (dismissed) {
      const days = (Date.now() - Number(dismissed)) / 86_400_000
      return days > 7
    }
    return true
  } catch { return false }
}

const ACT_STYLE: Record<ActItem['kind'], { icon: typeof ShoppingCart; wash: string }> = {
  sale: { icon: ShoppingCart, wash: 'bg-primary-50 text-primary-600' },
  purchase: { icon: ReceiptText, wash: 'bg-info-50 text-info-600' },
  cpay: { icon: Wallet, wash: 'bg-success-50 text-success-600' },
  spay: { icon: Wallet, wash: 'bg-warning-50 text-warning-600' },
  expense: { icon: TrendingDown, wash: 'bg-danger-50 text-danger-600' },
  production: { icon: Factory, wash: 'bg-stone-100 text-stone-600' },
}

function relTime(iso: string): string {
  try {
    const mins = Math.floor((Date.now() - parseISO(iso).getTime()) / 60_000)
    if (mins < 1) return 'الآن'
    if (mins < 60) return `قبل ${mins} د`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `قبل ${hrs} س`
    return fmtDate(iso)
  } catch { return '' }
}

export default function Dashboard() {
  const { data, isLoading, isError, error, refetch } = useDashboard()
  const business = useAuthStore((s) => s.business)
  const profile = useAuthStore((s) => s.profile)
  const has = useAuthStore((s) => s.has)
  const currency = business?.currency_symbol ?? '₪'
  const bid = business?.id
  const { online, pendingCount } = useSyncStore()
  const week = useWeeklySales(bid)
  const activity = useRecentActivity(bid)

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
  const weekTotal = week.data?.reduce((a, p) => a + p.value, 0) ?? 0
  const todaySales = week.data?.[week.data.length - 1]?.value ?? 0
  const prevAvg = week.data && week.data.length > 1
    ? week.data.slice(0, -1).reduce((a, p) => a + p.value, 0) / (week.data.length - 1) : 0
  let trend: { dir: 'up' | 'down'; label: string } | undefined
  if (prevAvg > 0) {
    const pct = Math.round(((todaySales - prevAvg) / prevAvg) * 100)
    if (pct !== 0) trend = { dir: pct > 0 ? 'up' : 'down', label: `${Math.abs(pct)}٪ عن متوسط الأسبوع` }
  } else if (todaySales > 0) {
    trend = { dir: 'up', label: 'بداية قوية اليوم' }
  }

  const showChecklist = !!data && data.products_count === 0
  const showBackupBanner = !!data && (data.sales_today_count > 0 || weekTotal > 0) && needsBackupReminder()

  return (
    <div className="space-y-4">
      {/* ===== الهيرو الترحيبي ===== */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-primary-700 via-primary-600 to-warning-500 p-5 text-white shadow-card-lg">
        <div className="dot-grid absolute inset-0 opacity-20" aria-hidden="true" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-primary-100">{greeting()} 👋</p>
              <h1 className="mt-0.5 truncate text-xl font-black">{business?.name ?? 'نظام المخبز'}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-primary-100/90">
                <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" /> {fmtDate(new Date().toISOString())}</span>
                {profile?.full_name && <><span className="opacity-50">•</span><span>{profile.full_name}</span></>}
              </p>
            </div>
            <button onClick={() => void refetch()} className="rounded-lg p-2 text-primary-100 transition hover:bg-white/15" aria-label="تحديث">
              <RefreshCw className="size-4" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              to="/sale/new"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-extrabold text-primary-700 shadow-sm transition hover:bg-primary-50 active:scale-[.97]"
            >
              <Plus className="size-4" /> فاتورة بيع جديدة
            </Link>
            <span className="glass-card inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-2xs font-bold">
              <CloudOff className="size-3.5" />
              {online ? 'بياناتك على جهازك — ومتاحة بدون إنترنت' : 'أوفلاين — كل شيء يعمل طبيعياً'}
            </span>
          </div>
        </div>
      </div>

      {/* تنبيه الأوفلاين */}
      {!online && pendingCount > 0 && (
        <Card className="flex items-center gap-3 border-warning-200 bg-warning-50 p-3.5">
          <AlertTriangle className="size-5 shrink-0 text-warning-600" />
          <p className="text-xs font-bold leading-relaxed text-warning-800">
            {pendingCount} عملية بانتظار المزامنة — كلها محفوظة بأمان على جهازك.
          </p>
        </Card>
      )}

      {/* ===== قائمة الترحيب للنظام الجديد ===== */}
      {showChecklist && (
        <Card className="anim-pop border-primary-200 bg-gradient-to-l from-primary-50/80 to-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-900">
            <ShieldCheck className="size-4 text-primary-600" /> خطواتك الأولى
          </h2>
          <p className="mt-1 text-2xs leading-relaxed text-stone-500">ثلاث خطوات وتصبح جاهزاً للعمل الكامل:</p>
          <div className="mt-3 space-y-2">
            <ChecklistItem done={false} to="/products/new" label="أضف منتجاتك وأسعارها" desc="ابدأ بأصنافك الأساسية — خبز، كعك، معجنات..." />
            <ChecklistItem done={false} to="/purchases/new" label="سجّل أول فاتورة شراء مواد" desc="الدقيق والسمن والمواد الخام" />
            <ChecklistItem done={false} to="/settings/backup" label="اعمل نسخة احتياطية" desc="بياناتك على جهازك — النسخة الاحتياطية تضمنها" />
          </div>
        </Card>
      )}

      {/* تنبيه النسخ الاحتياطية */}
      {showBackupBanner && (
        <Card className="flex items-center gap-3 border-info-200 bg-info-50 p-3.5">
          <HardDrive className="size-5 shrink-0 text-info-600" />
          <p className="min-w-0 flex-1 text-xs font-bold leading-relaxed text-info-900">
            لم تنشئ نسخة احتياطية بعد — بياناتك محفوظة على هذا الجهاز فقط.
          </p>
          <Link to="/settings/backup" className="shrink-0 rounded-lg bg-info-600 px-3 py-1.5 text-2xs font-extrabold text-white transition hover:bg-info-700">
            إنشاء نسخة الآن
          </Link>
        </Card>
      )}

      {/* Quick Actions */}
      <QuickActions actions={actions} />

      {/* ===== رسم مبيعات الأسبوع ===== */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
            <History className="size-4 text-primary-600" /> مبيعات آخر ٧ أيام
          </h2>
          <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-2xs font-extrabold tabular-nums text-primary-700">
            {kpi(weekTotal)}
          </span>
        </div>
        {week.isLoading ? (
          <div className="flex items-end justify-between gap-1.5" style={{ height: 96 }}>
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="flex-1" shimmer />)}
          </div>
        ) : week.data ? (
          <MiniBars points={week.data} format={(v) => kpi(v)} />
        ) : null}
      </Card>

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
            <StatCard title="مبيعات اليوم" value={kpi(data.sales_today)} sub={`${data.sales_today_count} فاتورة`} tone="primary" icon={<ShoppingCart className="size-5" />} trend={trend} />
            <StatCard title="تحصيل اليوم" value={kpi(data.collections_today)} tone="success" icon={<Wallet className="size-5" />} />
            <StatCard title="مشتريات اليوم" value={kpi(data.purchases_today)} icon={<ReceiptText className="size-5" />} />
            <StatCard title="إنتاج اليوم" value={kpi(data.production_today)} sub="تكلفة المواد" icon={<Factory className="size-5" />} />
            <StatCard title="مصروفات اليوم" value={kpi(data.expenses_today)} icon={<TrendingDown className="size-5" />} />
            <StatCard title="صافي الصندوق" value={kpi(data.cash_balance ?? 0)} tone={(data.cash_balance ?? 0) < 0 ? 'danger' : 'default'} icon={<Wallet className="size-5" />} />
            <StatCard title="ديون العملاء" value={kpi(data.customer_receivables)} tone="warning" icon={<Users className="size-5" />} />
            <StatCard title="مستحقات الموردين" value={kpi(data.supplier_payables)} tone="warning" icon={<Users className="size-5" />} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Link to="/inventory" className="rounded-xl border border-stone-200 bg-white p-3.5 text-center shadow-card transition hover:-translate-y-0.5 hover:border-primary-300">
              <p className="text-xs font-bold text-stone-500">قيمة المخزون</p>
              <p className="mt-1 truncate text-sm font-extrabold tabular-nums text-stone-900">{kpi(data.inventory_value)}</p>
            </Link>
            <Link to="/inventory" className={`rounded-xl border p-3.5 text-center shadow-card transition hover:-translate-y-0.5 ${data.low_stock_count > 0 ? 'border-warning-300 bg-warning-50' : 'border-stone-200 bg-white hover:border-primary-300'}`}>
              <p className="text-xs font-bold text-stone-500">أصناف تحت الحد</p>
              <p className={`mt-1 text-sm font-extrabold tabular-nums ${data.low_stock_count > 0 ? 'text-warning-700' : 'text-stone-900'}`}>{data.low_stock_count}</p>
            </Link>
            <Link to="/distribution" className="rounded-xl border border-stone-200 bg-white p-3.5 text-center shadow-card transition hover:-translate-y-0.5 hover:border-primary-300">
              <p className="text-xs font-bold text-stone-500">حمولات مفتوحة</p>
              <p className="mt-1 text-sm font-extrabold tabular-nums text-stone-900">{data.distribution_open_loads}</p>
            </Link>
          </div>

          {/* ===== النشاط الحديث ===== */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
                <History className="size-4 text-primary-600" /> النشاط الحديث
              </h2>
              {activity.data && activity.data.length > 0 && (
                <Link to="/reports" className="inline-flex items-center gap-1 text-2xs font-bold text-primary-700 hover:underline">
                  التقارير <ArrowLeft className="size-3" />
                </Link>
              )}
            </div>
            {activity.isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11" />)}
              </div>
            )}
            {activity.data && activity.data.length === 0 && (
              <p className="py-6 text-center text-xs font-semibold text-stone-400">لا عمليات بعد — أول فاتورة تظهر هنا مباشرة</p>
            )}
            {activity.data && activity.data.length > 0 && (
              <ul className="divide-y divide-stone-100">
                {activity.data.map((a) => {
                  const st = ACT_STYLE[a.kind]
                  const Icon = st.icon
                  const negative = a.kind === 'purchase' || a.kind === 'spay' || a.kind === 'expense'
                  return (
                    <li key={a.id}>
                      <Link to={a.to} className="flex items-center gap-3 py-2.5 transition hover:bg-stone-50">
                        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${st.wash}`}>
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-extrabold text-stone-800">{a.title}</span>
                          <span className="block truncate text-2xs text-stone-400">
                            {[a.sub, relTime(a.at)].filter(Boolean).join(' • ')}
                          </span>
                        </span>
                        <span className={`shrink-0 text-xs font-extrabold tabular-nums ${negative ? 'text-danger-600' : 'text-stone-900'}`}>
                          {negative ? '−' : '+'}{kpi(a.amount)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function ChecklistItem({ done, to, label, desc }: { done: boolean; to: string; label: string; desc: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-card transition hover:border-primary-300 active:scale-[.99]">
      {done
        ? <CheckCircle2 className="size-5 shrink-0 text-success-600" />
        : <Circle className="size-5 shrink-0 text-stone-300" />}
      <span className="min-w-0 flex-1">
        <span className={`block text-xs font-extrabold ${done ? 'text-stone-400 line-through' : 'text-stone-900'}`}>{label}</span>
        <span className="block truncate text-2xs text-stone-500">{desc}</span>
      </span>
      <ArrowLeft className="size-4 shrink-0 text-stone-300" />
    </Link>
  )
}

function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => rpc<DashboardSummary>('get_dashboard_summary', {}),
    refetchInterval: 120_000,
  })
}
