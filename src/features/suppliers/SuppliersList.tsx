/**
 * قائمة الموردين (بند 16/50): بحث وفلاتر، المستحقات من تقرير RPC، إضافة مورد جديد.
 * الرصيد هنا = مستحقات المورد (ما علينا للمورد).
 */
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Eye, Users, TrendingUp, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/services/rpc'
import { lookups } from '@/services/lookups'
import { useAuthStore } from '@/app/authStore'
import { useToast } from '@/lib/toast'
import { formatMoney, sumMoney } from '@/lib/money'
import { PageHeader, FilterBar, AddButton } from '@/components/ui/navigation'
import { Card, StatCard, Field, Input, Select, Textarea, Button } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlays'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Supplier } from '@/types'

/** صف تقرير الموردين — مطابق لما ترجعه get_suppliers_report() */
interface SupplierReportRow {
  supplier_id: string
  code: string
  name: string
  phone: string | null
  total_purchases: number
  balance: number
}

/** صف العرض بعد الدمج مع الكاش المحلي (العنوان/الحالة) */
interface SupplierListRow extends SupplierReportRow {
  address: string | null
  active: boolean
}

interface SupplierForm {
  name: string
  phone: string
  address: string
  notes: string
}

const EMPTY_FORM: SupplierForm = { name: '', phone: '', address: '', notes: '' }

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE'

export default function SuppliersList() {
  const toast = useToast()
  const qc = useQueryClient()
  const currency = useAuthStore((s) => s.currencySymbol())
  const canManage = useAuthStore((s) => s.has('suppliers.manage'))

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // تقرير المستحقات من الخادم (RPC)
  const report = useQuery({
    queryKey: ['suppliers-report'],
    queryFn: () => rpc<SupplierReportRow[]>('get_suppliers_report', {}),
  })

  // كاش الموردين المحلي — يعمل أوفلاين (عنوان/نشط/هاتف احتياطي)
  const cacheQ = useQuery({
    queryKey: ['suppliers-lookup'],
    queryFn: lookups.suppliers,
    staleTime: 5 * 60_000,
  })

  const rows = useMemo<SupplierListRow[]>(() => {
    const byId = new Map<string, Supplier>((cacheQ.data ?? []).map((s) => [s.id, s]))
    return (report.data ?? []).map((r) => {
      const cached = byId.get(r.supplier_id)
      return {
        ...r,
        phone: r.phone ?? cached?.phone ?? null,
        address: cached?.address ?? null,
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
        (r.address ?? '').toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q)
      )
    })
  }, [rows, search, statusFilter])

  const totals = useMemo(() => ({
    count: filtered.length,
    totalPurchases: sumMoney(filtered.map((r) => r.total_purchases)),
    totalBalance: sumMoney(filtered.map((r) => r.balance)),
  }), [filtered])

  function openAddModal() {
    setForm(EMPTY_FORM)
    setNameError(null)
    setAddOpen(true)
  }

  async function submitAdd() {
    if (!form.name.trim()) {
      setNameError('اسم المورد مطلوب.')
      return
    }
    const businessId = useAuthStore.getState().profile?.business_id
    if (!businessId) {
      toast.error('لا يوجد نشاط تجاري مرتبط بحسابك — أعد تسجيل الدخول.')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('suppliers').insert({
        business_id: businessId,
        code: 'SU-' + Date.now().toString(36).toUpperCase(),
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      })
      if (error) throw new Error(error.message)
      toast.success('تم إضافة المورد')
      setAddOpen(false)
      void qc.invalidateQueries({ queryKey: ['suppliers-report'] })
      void qc.invalidateQueries({ queryKey: ['suppliers-lookup'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إضافة المورد — حاول مجدداً.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="الموردون"
        subtitle="مستحقات الموردين حسب كشف الحساب"
        backTo="/"
        action={canManage ? <AddButton label="إضافة مورد" onClick={openAddModal} /> : undefined}
      />

      <FilterBar>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو الهاتف أو العنوان أو الكود..."
          className="w-full sm:w-72"
          aria-label="بحث في الموردين"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="w-36" aria-label="حالة المورد">
          <option value="ALL">كل الموردين</option>
          <option value="ACTIVE">النشطون فقط</option>
          <option value="INACTIVE">غير النشطين</option>
        </Select>
      </FilterBar>

      <Card className="mb-3 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <StatCard title="عدد الموردين المعروضين" value={String(totals.count)} icon={<Users className="size-5" />} />
        <StatCard title="إجمالي المشتريات" value={formatMoney(totals.totalPurchases, currency)} icon={<TrendingUp className="size-5" />} />
        <StatCard
          title="إجمالي المستحقات"
          value={formatMoney(totals.totalBalance, currency)}
          tone={totals.totalBalance > 0 ? 'warning' : 'default'}
          icon={<Wallet className="size-5" />}
        />
      </Card>

      <Card className="overflow-hidden">
        {report.isLoading || cacheQ.isLoading ? (
          <LoadingState label="جارٍ تحميل الموردين..." />
        ) : report.isError ? (
          <ErrorState
            message={report.error instanceof Error ? report.error.message : 'تعذر تحميل قائمة الموردين.'}
            onRetry={() => void report.refetch()}
          />
        ) : (
          <DataTable
            rows={filtered}
            keyOf={(r) => r.supplier_id}
            emptyTitle="لا يوجد موردون"
            emptyMessage={rows.length > 0 ? 'جرّب تغيير البحث أو الفلاتر.' : 'أضف أول مورد من زر «إضافة مورد» بالأعلى.'}
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
              { key: 'address', header: 'العنوان', render: (r) => r.address ?? <span className="text-stone-300">—</span>, hideOnMobile: true },
              {
                key: 'balance', header: 'مستحقات المورد', className: 'tabular-nums', render: (r) => (
                  <span className={r.balance > 0 ? 'font-extrabold text-warning-700' : 'font-bold text-stone-900'}>
                    {formatMoney(r.balance, currency)}
                  </span>
                ),
              },
              {
                key: 'actions', header: '', render: (r) => (
                  <Link to={`/suppliers/${r.supplier_id}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:underline">
                    <Eye className="size-3.5" /> كشف الحساب
                  </Link>
                ),
              },
            ]}
            mobileCard={(r) => (
              <Link to={`/suppliers/${r.supplier_id}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-stone-900">
                    {r.name}
                    {!r.active && <span className="ms-1 text-2xs font-bold text-stone-400">(غير نشط)</span>}
                  </p>
                  <p className="truncate text-2xs text-stone-400">
                    {r.code} • {r.phone ?? 'بدون هاتف'}{r.address ? ` • ${r.address}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className={`text-sm font-extrabold tabular-nums ${r.balance > 0 ? 'text-warning-700' : 'text-stone-900'}`}>
                    {formatMoney(r.balance, currency)}
                  </p>
                  <p className="text-2xs text-stone-400">المستحقات</p>
                </div>
              </Link>
            )}
          />
        )}
      </Card>

      {/* إضافة مورد */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="إضافة مورد">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submitAdd() }}>
          <Field label="اسم المورد" required error={nameError}>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثال: مطاحن القدس"
              autoFocus
            />
          </Field>
          <Field label="رقم الهاتف">
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              inputMode="tel"
              dir="ltr"
              placeholder="0599..."
            />
          </Field>
          <Field label="العنوان">
            <Input
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="مثال: المنطقة الصناعية — شارع المصانع"
            />
          </Field>
          <Field label="ملاحظات">
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
          </Field>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1" loading={saving}>حفظ المورد</Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setAddOpen(false)} disabled={saving}>
              إلغاء
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
