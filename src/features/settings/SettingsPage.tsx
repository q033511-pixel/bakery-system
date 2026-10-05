/**
 * الإعدادات (بند 68/69): بيانات النشاط (تعديل مباشر بصلاحية)، المستودعات، الوحدات والتحويلات،
 * فئات المنتجات والمصروفات، طرق الدفع (ثابتة)، ورابط إدارة المستخدمين.
 */
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, Plus, Settings2, Users, Warehouse as WarehouseIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/services/rpc'
import { lookups, refreshLookups } from '@/services/lookups'
import { useToast } from '@/lib/toast'
import { useAuthStore } from '@/app/authStore'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select } from '@/components/ui/primitives'
import { QuantityInput } from '@/components/ui/inputs'
import { Modal } from '@/components/ui/overlays'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Business, ExpenseCategory, ProductCategory, Unit, UnitConversion, Warehouse } from '@/types'

const WAREHOUSE_KINDS: Record<string, string> = {
  MAIN: 'رئيسي', RAW: 'مواد خام', FINISHED: 'منتجات نهائية', BRANCH: 'فرع', DISTRIBUTION: 'توزيع',
}

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'نقدي' },
  { value: 'BANK_TRANSFER', label: 'تحويل بنكي' },
  { value: 'CHECK', label: 'شيك' },
  { value: 'OTHER', label: 'أخرى' },
]

async function fetchList<T>(table: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

async function insertRow(table: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from(table).insert(payload)
  if (error) throw new Error(error.message)
}

async function updateRow(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export default function SettingsPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const has = useAuthStore((s) => s.has)
  const canManage = has('settings.manage')

  // ----- بيانات النشاط -----
  const businessQ = useQuery({
    queryKey: ['business-settings'],
    enabled: Boolean(profile?.business_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', profile?.business_id ?? '')
        .single()
      if (error) throw new Error(error.message)
      return data as Business
    },
  })

  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('')
  const [currencySymbol, setCurrencySymbol] = useState('')
  const [timezone, setTimezone] = useState('')
  const [allowNegative, setAllowNegative] = useState(false)
  const [savingBusiness, setSavingBusiness] = useState(false)

  useEffect(() => {
    if (businessQ.data) {
      setName(businessQ.data.name)
      setCurrency(businessQ.data.currency)
      setCurrencySymbol(businessQ.data.currency_symbol)
      setTimezone(businessQ.data.timezone)
      setAllowNegative(businessQ.data.allow_negative_stock)
    }
  }, [businessQ.data])

  async function saveBusiness() {
    if (!name.trim()) { toast.error('أدخل اسم النشاط.'); return }
    if (!currencySymbol.trim()) { toast.error('أدخل رمز العملة.'); return }
    setSavingBusiness(true)
    try {
      await rpc('update_business', {
        p_patch: {
          name: name.trim(),
          currency: currency.trim(),
          currency_symbol: currencySymbol.trim(),
          timezone: timezone.trim(),
          allow_negative_stock: allowNegative,
        },
      })
      toast.success('تم حفظ الإعدادات.')
      void queryClient.invalidateQueries({ queryKey: ['business-settings'] })
      // تحديث الكاش المحلي ورمز العملة في كل التطبيق
      await refreshLookups()
      const biz = await lookups.business()
      if (biz[0]) useAuthStore.getState().setBusiness(biz[0])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.')
    } finally {
      setSavingBusiness(false)
    }
  }

  // ----- القوائم -----
  const warehousesQ = useQuery({ queryKey: ['warehouses-list'], queryFn: () => fetchList<Warehouse>('warehouses') })
  const unitsQ = useQuery({ queryKey: ['units-list'], queryFn: () => fetchList<Unit>('units') })
  const conversionsQ = useQuery({ queryKey: ['unit-conversions-list'], queryFn: () => fetchList<UnitConversion>('unit_conversions') })
  const productCatsQ = useQuery({ queryKey: ['product-categories-list'], queryFn: () => fetchList<ProductCategory>('product_categories') })
  const expenseCatsQ = useQuery({ queryKey: ['expense-categories-list'], queryFn: () => fetchList<ExpenseCategory>('expense_categories') })

  // ----- حالات الإضافة -----
  const [whOpen, setWhOpen] = useState(false)
  const [whName, setWhName] = useState('')
  const [unitOpen, setUnitOpen] = useState(false)
  const [unitName, setUnitName] = useState('')
  const [unitSymbol, setUnitSymbol] = useState('')
  const [convOpen, setConvOpen] = useState(false)
  const [convFrom, setConvFrom] = useState('')
  const [convTo, setConvTo] = useState('')
  const [convFactor, setConvFactor] = useState<number | null>(null)
  const [catOpen, setCatOpen] = useState(false)
  const [catName, setCatName] = useState('')
  const [expOpen, setExpOpen] = useState(false)
  const [expName, setExpName] = useState('')
  const [saving, setSaving] = useState(false)

  const unitById = new Map((unitsQ.data ?? []).map((u) => [u.id, u]))

  async function addWarehouse() {
    if (!profile?.business_id) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!whName.trim()) { toast.error('أدخل اسم المستودع.'); return }
    setSaving(true)
    try {
      await insertRow('warehouses', { business_id: profile.business_id, name: whName.trim(), kind: 'MAIN', is_default: false, active: true })
      toast.success('تمت إضافة المستودع.')
      setWhOpen(false); setWhName('')
      void queryClient.invalidateQueries({ queryKey: ['warehouses-list'] })
      void refreshLookups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ المستودع.')
    } finally { setSaving(false) }
  }

  async function toggleWarehouse(w: Warehouse) {
    try {
      await updateRow('warehouses', w.id, { active: !w.active })
      toast.success(!w.active ? `تم تفعيل «${w.name}».` : `تم تعطيل «${w.name}».`)
      void queryClient.invalidateQueries({ queryKey: ['warehouses-list'] })
      void refreshLookups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث الحالة.')
    }
  }

  async function addUnit() {
    if (!profile?.business_id) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!unitName.trim()) { toast.error('أدخل اسم الوحدة.'); return }
    if (!unitSymbol.trim()) { toast.error('أدخل رمز الوحدة.'); return }
    setSaving(true)
    try {
      await insertRow('units', { business_id: profile.business_id, name: unitName.trim(), symbol: unitSymbol.trim(), is_base: false })
      toast.success('تمت إضافة الوحدة.')
      setUnitOpen(false); setUnitName(''); setUnitSymbol('')
      void queryClient.invalidateQueries({ queryKey: ['units-list'] })
      void refreshLookups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ الوحدة.')
    } finally { setSaving(false) }
  }

  async function addConversion() {
    if (!profile?.business_id) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!convFrom || !convTo) { toast.error('اختر وحدتي التحويل.'); return }
    if (convFrom === convTo) { toast.error('اختر وحدتين مختلفتين.'); return }
    if ((convFactor ?? 0) <= 0) { toast.error('المعامل يجب أن يكون أكبر من صفر.'); return }
    setSaving(true)
    try {
      await insertRow('unit_conversions', { business_id: profile.business_id, from_unit_id: convFrom, to_unit_id: convTo, factor: convFactor as number })
      toast.success('تمت إضافة التحويل.')
      setConvOpen(false); setConvFrom(''); setConvTo(''); setConvFactor(null)
      void queryClient.invalidateQueries({ queryKey: ['unit-conversions-list'] })
      void refreshLookups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ التحويل.')
    } finally { setSaving(false) }
  }

  async function addCategory() {
    if (!profile?.business_id) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!catName.trim()) { toast.error('أدخل اسم الفئة.'); return }
    setSaving(true)
    try {
      await insertRow('product_categories', { business_id: profile.business_id, name: catName.trim() })
      toast.success('تمت إضافة الفئة.')
      setCatOpen(false); setCatName('')
      void queryClient.invalidateQueries({ queryKey: ['product-categories-list'] })
      void refreshLookups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ الفئة.')
    } finally { setSaving(false) }
  }

  async function addExpenseCategory() {
    if (!profile?.business_id) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!expName.trim()) { toast.error('أدخل اسم الفئة.'); return }
    setSaving(true)
    try {
      await insertRow('expense_categories', { business_id: profile.business_id, name: expName.trim() })
      toast.success('تمت إضافة فئة المصروفات.')
      setExpOpen(false); setExpName('')
      void queryClient.invalidateQueries({ queryKey: ['expense-categories-list'] })
      void refreshLookups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ الفئة.')
    } finally { setSaving(false) }
  }

  return (
    <div className="pb-4">
      <PageHeader title="الإعدادات" subtitle="بيانات النشاط والبيانات المرجعية" backTo="/more" />

      {/* ---------- بيانات النشاط ---------- */}
      <Card className="mb-4 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-stone-800">
          <Settings2 className="size-4 text-primary-700" /> بيانات النشاط
        </h2>
        {businessQ.isLoading ? (
          <LoadingState label="جارٍ التحميل..." />
        ) : businessQ.isError || !businessQ.data ? (
          <ErrorState message={businessQ.error instanceof Error ? businessQ.error.message : 'تعذر تحميل بيانات النشاط.'} onRetry={() => void businessQ.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="اسم النشاط" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
              </Field>
              <Field label="العملة (كود)" hint="مثل: ILS / SAR">
                <Input value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!canManage} dir="ltr" className="text-left" />
              </Field>
              <Field label="رمز العملة" required>
                <Input value={currencySymbol} onChange={(e) => setCurrencySymbol(e.target.value)} disabled={!canManage} />
              </Field>
              <Field label="المنطقة الزمنية" hint="مثل: Asia/Gaza">
                <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canManage} dir="ltr" className="text-left" />
              </Field>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={allowNegative}
                disabled={!canManage}
                onChange={(e) => setAllowNegative(e.target.checked)}
                className="size-4 accent-primary-600"
              />
              <span className="text-xs font-bold text-stone-700">السماح بالبيع برصيد سالب</span>
            </label>
            {canManage && (
              <Button className="mt-4" loading={savingBusiness} onClick={() => void saveBusiness()}>حفظ الإعدادات</Button>
            )}
          </>
        )}
      </Card>

      {/* ---------- المستودعات ---------- */}
      <ListSection
        title="المستودعات"
        icon={<WarehouseIcon className="size-4 text-primary-700" />}
        canAdd={canManage}
        onAdd={() => setWhOpen(true)}
        loading={warehousesQ.isLoading}
        error={warehousesQ.error}
        onRetry={() => void warehousesQ.refetch()}
        rows={(warehousesQ.data ?? []).map((w) => ({
          id: w.id,
          title: w.name,
          sub: `${WAREHOUSE_KINDS[w.kind] ?? w.kind}${w.is_default ? ' • افتراضي' : ''}`,
          active: w.active,
          onToggle: canManage ? () => void toggleWarehouse(w) : undefined,
        }))}
        emptyText="لا توجد مستودعات — أضف واحداً على الأقل."
      />

      {/* ---------- الوحدات + التحويلات ---------- */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-extrabold text-stone-800">الوحدات</h2>
          <div className="flex gap-2">
            {canManage && (
              <>
                <Button size="sm" variant="outline" onClick={() => setConvOpen(true)}>تحويل وحدات</Button>
                <Button size="sm" onClick={() => setUnitOpen(true)}>إضافة وحدة</Button>
              </>
            )}
          </div>
        </div>
        {unitsQ.isLoading ? (
          <LoadingState />
        ) : unitsQ.isError ? (
          <ErrorState message={unitsQ.error instanceof Error ? unitsQ.error.message : 'تعذر تحميل الوحدات.'} onRetry={() => void unitsQ.refetch()} />
        ) : (unitsQ.data ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-stone-400">لا توجد وحدات.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {(unitsQ.data ?? []).map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm font-bold text-stone-800">{u.name}</span>
                <span className="flex items-center gap-2">
                  {u.is_base && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-2xs font-bold text-primary-700">أساسية</span>}
                  <span className="text-xs font-extrabold tabular-nums text-stone-500">{u.symbol}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {(conversionsQ.data ?? []).length > 0 && (
          <div className="border-t border-stone-100 bg-stone-50/60 px-4 py-3">
            <p className="mb-2 text-2xs font-bold text-stone-400">تحويلات الوحدات</p>
            <div className="flex flex-wrap gap-1.5">
              {(conversionsQ.data ?? []).map((c) => (
                <span key={c.id} className="rounded-lg bg-white px-2.5 py-1 text-2xs font-bold text-stone-600 shadow-sm">
                  1 {unitById.get(c.from_unit_id)?.symbol ?? '؟'} = {c.factor} {unitById.get(c.to_unit_id)?.symbol ?? '؟'}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ---------- فئات المنتجات ---------- */}
      <ListSection
        title="فئات المنتجات"
        canAdd={canManage}
        onAdd={() => setCatOpen(true)}
        loading={productCatsQ.isLoading}
        error={productCatsQ.error}
        onRetry={() => void productCatsQ.refetch()}
        rows={(productCatsQ.data ?? []).map((c) => ({ id: c.id, title: c.name, sub: c.notes ?? undefined }))}
        emptyText="لا توجد فئات منتجات."
      />

      {/* ---------- فئات المصروفات ---------- */}
      <ListSection
        title="فئات المصروفات"
        canAdd={canManage}
        onAdd={() => setExpOpen(true)}
        loading={expenseCatsQ.isLoading}
        error={expenseCatsQ.error}
        onRetry={() => void expenseCatsQ.refetch()}
        rows={(expenseCatsQ.data ?? []).map((c) => ({ id: c.id, title: c.name }))}
        emptyText="لا توجد فئات مصروفات."
      />

      {/* ---------- طرق الدفع (ثابتة) ---------- */}
      <Card className="mb-4 overflow-hidden">
        <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-stone-800">طرق الدفع</h2>
        <div className="divide-y divide-stone-100">
          {PAYMENT_METHODS.map((m) => (
            <div key={m.value} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-bold text-stone-800">{m.label}</span>
              <span dir="ltr" className="text-2xs font-bold text-stone-400">{m.value}</span>
            </div>
          ))}
        </div>
        <p className="border-t border-stone-100 px-4 py-2.5 text-2xs text-stone-400">طرق ثابتة في النظام — تُحدد عند التسجيل لكل عملية.</p>
      </Card>

      {/* ---------- إدارة المستخدمين ---------- */}
      {has('users.manage') && (
        <Link
          to="/settings/users"
          className="mb-4 flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-card transition active:scale-[.99] hover:border-primary-300"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <Users className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-stone-900">إدارة المستخدمين والصلاحيات</span>
            <span className="block text-2xs text-stone-500">تفعيل الأعضاء وتعيين الأدوار</span>
          </span>
          <ChevronLeft className="size-4 shrink-0 text-stone-300" />
        </Link>
      )}

      {/* ---------- المودالات ---------- */}
      <Modal open={whOpen} onClose={() => setWhOpen(false)} title="إضافة مستودع">
        <div className="space-y-3">
          <Field label="اسم المستودع" required>
            <Input value={whName} onChange={(e) => setWhName(e.target.value)} autoFocus />
          </Field>
          <Button className="w-full" loading={saving} onClick={() => void addWarehouse()}>حفظ</Button>
        </div>
      </Modal>

      <Modal open={unitOpen} onClose={() => setUnitOpen(false)} title="إضافة وحدة">
        <div className="space-y-3">
          <Field label="اسم الوحدة" required>
            <Input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="مثال: كيس" autoFocus />
          </Field>
          <Field label="رمز الوحدة" required>
            <Input value={unitSymbol} onChange={(e) => setUnitSymbol(e.target.value)} placeholder="مثال: كيس" />
          </Field>
          <Button className="w-full" loading={saving} onClick={() => void addUnit()}>حفظ</Button>
        </div>
      </Modal>

      <Modal open={convOpen} onClose={() => setConvOpen(false)} title="إضافة تحويل وحدات">
        <div className="space-y-3">
          <Field label="من وحدة" required>
            <Select value={convFrom} onChange={(e) => setConvFrom(e.target.value)}>
              <option value="">اختر...</option>
              {(unitsQ.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
            </Select>
          </Field>
          <Field label="إلى وحدة" required>
            <Select value={convTo} onChange={(e) => setConvTo(e.target.value)}>
              <option value="">اختر...</option>
              {(unitsQ.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
            </Select>
          </Field>
          <Field label="المعامل" required hint="كمية من الوحدة الأولى × المعامل = الوحدة الثانية (مثال: 1 كيس = 50 كغ)">
            <QuantityInput value={convFactor} onChange={setConvFactor} placeholder="50" />
          </Field>
          <Button className="w-full" loading={saving} onClick={() => void addConversion()}>حفظ التحويل</Button>
        </div>
      </Modal>

      <Modal open={catOpen} onClose={() => setCatOpen(false)} title="إضافة فئة منتجات">
        <div className="space-y-3">
          <Field label="اسم الفئة" required>
            <Input value={catName} onChange={(e) => setCatName(e.target.value)} autoFocus />
          </Field>
          <Button className="w-full" loading={saving} onClick={() => void addCategory()}>حفظ</Button>
        </div>
      </Modal>

      <Modal open={expOpen} onClose={() => setExpOpen(false)} title="إضافة فئة مصروفات">
        <div className="space-y-3">
          <Field label="اسم الفئة" required>
            <Input value={expName} onChange={(e) => setExpName(e.target.value)} autoFocus />
          </Field>
          <Button className="w-full" loading={saving} onClick={() => void addExpenseCategory()}>حفظ</Button>
        </div>
      </Modal>
    </div>
  )
}

// ---------- مكون قسم قائمة عام ----------
interface ListRowItem {
  id: string
  title: string
  sub?: string | undefined
  active?: boolean | undefined
  onToggle?: (() => void) | undefined
}

function ListSection({ title, icon, rows, canAdd, onAdd, loading, error, onRetry, emptyText }: {
  title: string
  icon?: React.ReactNode
  rows: ListRowItem[]
  canAdd: boolean
  onAdd: () => void
  loading: boolean
  error: unknown
  onRetry: () => void
  emptyText: string
}) {
  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
          {icon} {title}
        </h2>
        {canAdd && <Button size="sm" icon={<Plus className="size-4" />} onClick={onAdd}>إضافة</Button>}
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل البيانات.'} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-stone-400">{emptyText}</p>
      ) : (
        <div className="divide-y divide-stone-100">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-stone-800">{r.title}</p>
                {r.sub && <p className="truncate text-2xs text-stone-400">{r.sub}</p>}
              </div>
              {r.onToggle && (
                <label className="flex shrink-0 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={r.active ?? true} onChange={r.onToggle} className="size-4 accent-primary-600" aria-label="تفعيل" />
                  <span className={`text-2xs font-bold ${r.active ? 'text-success-700' : 'text-stone-400'}`}>{r.active ? 'نشط' : 'معطل'}</span>
                </label>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
