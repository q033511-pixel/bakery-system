/**
 * قائمة العملاء (بند 14/50): بحث وفلاتر، الأرصدة من تقرير RPC، إضافة عميل جديد.
 * تدعم وضع «تحصيل» (?payment=1) بعرض تلميح يرشد المستخدم لكشف الحساب.
 */
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Eye, Users, TrendingUp, Wallet, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/services/rpc'
import { lookups } from '@/services/lookups'
import { useAuthStore } from '@/app/authStore'
import { useToast } from '@/lib/toast'
import { formatMoney, sumMoney } from '@/lib/money'
import { PageHeader, FilterBar, AddButton } from '@/components/ui/navigation'
import { Card, StatCard, Field, Input, Select, Textarea, Button } from '@/components/ui/primitives'
import { MoneyInput } from '@/components/ui/inputs'
import { Modal } from '@/components/ui/overlays'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Customer } from '@/types'

/** صف تقرير العملاء — مطابق لما ترجعه get_customers_report() */
interface CustomerReportRow {
  customer_id: string
  code: string
  name: string
  phone: string | null
  total_sales: number
  balance: number
}

/** صف العرض بعد الدمج مع الكاش المحلي (المنطقة/الحالة) */
interface CustomerListRow extends CustomerReportRow {
  area: string | null
  active: boolean
}

interface CustomerForm {
  name: string
  phone: string
  area: string
  salesperson: string
  credit_limit: number | null
  payment_terms_days: number | null
  notes: string
}

const EMPTY_FORM: CustomerForm = {
  name: '', phone: '', area: '', salesperson: '',
  credit_limit: null, payment_terms_days: null, notes: '',
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE'

export default function CustomersList() {
  const toast = useToast()
  const qc = useQueryClient()
  const currency = useAuthStore((s) => s.currencySymbol())
  const canManage = useAuthStore((s) => s.has('customers.manage'))
  const [params] = useSearchParams()
  const paymentHint = params.get('payment') === '1'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // تقرير الأرصدة من الخادم (RPC)
  const report = useQuery({
    queryKey: ['customers-report'],
    queryFn: () => rpc<CustomerReportRow[]>('get_customers_report', {}),
  })

  // كاش العملاء المحلي — يعمل أوفلاين (منطقة/نشط/هاتف احتياطي)
  const cacheQ = useQuery({
    queryKey: ['customers-lookup'],
    queryFn: lookups.customers,
    staleTime: 5 * 60_000,
  })

  const rows = useMemo<CustomerListRow[]>(() => {
    const byId = new Map<string, Customer>((cacheQ.data ?? []).map((c) => [c.id, c]))
    return (report.data ?? []).map((r) => {
      const cached = byId.get(r.customer_id)
      return {
        ...r,
        phone: r.phone ?? cached?.phone ?? null,
        area: cached?.area ?? null,
        active: cached?.active ?? true,
      }
    })
  }, [report.data, cacheQ.data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter === 'ACTIVE' && !r.active) return false
      if (statusFilter === 'INACTIVE' && r.active) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        (r.phone ?? '').toLowerCase().includes(q) ||
        (r.area ?? '').toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q)
      )
    })
  }, [rows, search, statusFilter])

  const totals = useMemo(() => ({
    count: filtered.length,
    totalSales: sumMoney(filtered.map((r) => r.total_sales)),
    totalBalance: sumMoney(filtered.map((r) => r.balance)),
  }), [filtered])

  function openAddModal() {
    setForm(EMPTY_FORM)
    setNameError(null)
    setAddOpen(true)
  }

  async function submitAdd() {
    if (!form.name.trim()) {
      setNameError('اسم العميل مطلوب.')
      return
    }
    const businessId = useAuthStore.getState().profile?.business_id
    if (!businessId) {
      toast.error('لا يوجد نشاط تجاري مرتبط بحسابك — أعد تسجيل الدخول.')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('customers').insert({
        business_id: businessId,
        code: 'CU-' + Date.now().toString(36).toUpperCase(),
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        area: form.area.trim() || null,
        salesperson: form.salesperson.trim() || null,
        credit_limit: form.credit_limit ?? 0,
        payment_terms_days: form.payment_terms_days ?? 0,
        notes: form.notes.trim() || null,
      })
      if (error) throw new Error(error.message)
      toast.success('تم إضافة العميل')
      setAddOpen(false)
      void qc.invalidateQueries({ queryKey: ['customers-report'] })
      void qc.invalidateQueries({ queryKey: ['customers-lookup'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إضافة العميل — حاول مجدداً.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="العملاء"
        subtitle="الأرصدة والمديونيات حسب كشف الحساب"
        backTo="/"
        action={canManage ? <AddButton label="إضافة عميل" onClick={openAddModal} /> : undefined}
      />

      {paymentHint && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-bold leading-relaxed text-warning-800">
            <Info className="size-4 shrink-0" />
            لتحصيل دفعة من عميل: افتح كشف حسابه من القائمة بالأسفل ثم اضغط «تسجيل تحصيل».
          </p>
          <Link to="/" className="shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold text-warning-800 underline transition hover:bg-warning-100">
            لوحة التحكم
          </Link>
        </div>
      )}

      <FilterBar>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو الهاتف أو المنطقة أو الكود..."
          className="w-full sm:w-72"
          aria-label="بحث في العملاء"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="w-36" aria-label="حالة العميل">
          <option value="ALL">كل العملاء</option>
          <option value="ACTIVE">النشطون فقط</option>
          <option value="INACTIVE">غير النشطين</option>
        </Select>
      </FilterBar>

      <Card className="mb-3 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <StatCard title="عدد العملاء المعروضين" value={String(totals.count)} icon={<Users className="size-5" />} />
        <StatCard title="إجمالي المبيعات" value={formatMoney(totals.totalSales, currency)} icon={<TrendingUp className="size-5" />} />
        <StatCard
          title="إجمالي المديونيات"
          value={formatMoney(totals.totalBalance, currency)}
          tone={totals.totalBalance > 0 ? 'warning' : 'default'}
          icon={<Wallet className="size-5" />}
        />
      </Card>

      <Card className="overflow-hidden">
        {report.isLoading || cacheQ.isLoading ? (
          <LoadingState label="جارٍ تحميل العملاء..." />
        ) : report.isError ? (
          <ErrorState
            message={report.error instanceof Error ? report.error.message : 'تعذر تحميل قائمة العملاء.'}
            onRetry={() => void report.refetch()}
          />
        ) : (
          <DataTable
            rows={filtered}
            keyOf={(r) => r.customer_id}
            emptyTitle="لا يوجد عملاء"
            emptyMessage={rows.length > 0 ? 'جرّب تغيير البحث أو الفلاتر.' : 'أضف أول عميل من زر «إضافة عميل» بالأعلى.'}
            columns={[
              { key: 'code', header: 'الكود', render: (r) => <span className="font-bold tabular-nums text-stone-500">{r.code}</span>, hideOnMobile: true },
              {
                key: 'name', header: 'الاسم', render: (r) => (
                  <span className="font-extrabold text-stone-900">
                    {r.name}
                    {!r.active && <span className="ms-1.5 text-2xs font-bold text-stone-400">(غير نشط)</span>}
                  </span>
                ),
              },
              { key: 'phone', header: 'الهاتف', render: (r) => (r.phone ? <span className="tabular-nums" dir="ltr">{r.phone}</span> : <span className="text-stone-300">—</span>) },
              { key: 'area', header: 'المنطقة', render: (r) => r.area ?? <span className="text-stone-300">—</span>, hideOnMobile: true },
              {
                key: 'balance', header: 'الرصيد', className: 'tabular-nums', render: (r) => (
                  <span className={r.balance > 0 ? 'font-extrabold text-warning-700' : 'font-bold text-stone-900'}>
                    {formatMoney(r.balance, currency)}
                  </span>
                ),
              },
              {
                key: 'actions', header: '', render: (r) => (
                  <Link to={`/customers/${r.customer_id}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:underline">
                    <Eye className="size-3.5" /> كشف الحساب
                  </Link>
                ),
              },
            ]}
            mobileCard={(r) => (
              <Link to={`/customers/${r.customer_id}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-stone-900">
                    {r.name}
                    {!r.active && <span className="ms-1 text-2xs font-bold text-stone-400">(غير نشط)</span>}
                  </p>
                  <p className="truncate text-2xs text-stone-400">
                    {r.code} • {r.phone ?? 'بدون هاتف'}{r.area ? ` • ${r.area}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className={`text-sm font-extrabold tabular-nums ${r.balance > 0 ? 'text-warning-700' : 'text-stone-900'}`}>
                    {formatMoney(r.balance, currency)}
                  </p>
                  <p className="text-2xs text-stone-400">الرصيد</p>
                </div>
              </Link>
            )}
          />
        )}
      </Card>

      {/* إضافة عميل */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="إضافة عميل">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submitAdd() }}>
          <Field label="اسم العميل" required error={nameError}>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثال: مخبز الأمل — فرع الوسط"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم الهاتف">
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                inputMode="tel"
                dir="ltr"
                placeholder="0599..."
              />
            </Field>
            <Field label="المنطقة">
              <Input
                value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                placeholder="مثال: المنطقة الشرقية"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="المندوب المسؤول">
              <Input value={form.salesperson} onChange={(e) => setForm((f) => ({ ...f, salesperson: e.target.value }))} />
            </Field>
            <Field label="سقف الدين الآجل" hint="اتركه صفراً لبدون سقف">
              <MoneyInput
                value={form.credit_limit}
                onChange={(v) => setForm((f) => ({ ...f, credit_limit: v }))}
                currencySymbol={currency}
              />
            </Field>
          </div>
          <Field label="مدة السداد (أيام)">
            <Input
              type="number"
              min={0}
              step={1}
              dir="ltr"
              className="text-start"
              value={form.payment_terms_days ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, payment_terms_days: e.target.value === '' ? null : Number(e.target.value) }))}
            />
          </Field>
          <Field label="ملاحظات">
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
          </Field>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1" loading={saving}>حفظ العميل</Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setAddOpen(false)} disabled={saving}>
              إلغاء
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
