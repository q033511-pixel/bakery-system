/** قائمة المنتجات والمواد الخام (بند 9/10/111): فلترة بال نوع، بحث، إضافة سريعة */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { lookups } from '@/services/lookups'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/lib/toast'
import { formatMoney, formatQty } from '@/lib/money'
import { PageHeader, AddButton } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select, StatusBadge, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlays'
import { MoneyInput, QuantityInput } from '@/components/ui/inputs'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states'
void LoadingState
void ErrorState
import { useAuthStore } from '@/app/authStore'
import type { ItemType, Product, Unit } from '@/types'

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'الكل' },
  { value: 'RAW_MATERIAL', label: 'مواد خام' },
  { value: 'FINISHED_PRODUCT', label: 'منتجات نهائية' },
  { value: 'PACKAGING', label: 'تغليف' },
]

export default function ProductsList() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const unitById = useMemo(() => new Map(units.map((u: Unit) => [u.id, u])), [units])

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter((p: Product) => (typeFilter === 'ALL' ? true : p.item_type === typeFilter))
      .filter((p: Product) => (!q ? true : p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)))
      .sort((a: Product, b: Product) => a.name.localeCompare(b.name, 'ar'))
  }, [products, search, typeFilter])

  return (
    <div>
      <PageHeader
        title="المنتجات والمواد"
        subtitle="مصنفة: مواد خام / منتجات نهائية / تغليف"
        backTo="/"
        action={has('products.manage') ? <AddButton label="صنف جديد" onClick={() => setAddOpen(true)} /> : undefined}
      />

      <Card className="mb-3 flex flex-wrap items-center gap-2 p-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الكود..." className="h-10 w-full sm:w-64" />
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className={`h-9 rounded-lg px-3 text-xs font-bold transition ${typeFilter === t.value ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {products.length === 0 ? (
          <EmptyState title="لا توجد أصناف بعد" message="أضف أول صنف — مواد خام مثل الطحين أو منتجات نهائية مثل الخبز العربي." />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50/70 text-xs font-extrabold text-stone-500">
                    <th className="px-4 py-3 text-start">الكود</th>
                    <th className="px-4 py-3 text-start">الصنف</th>
                    <th className="px-4 py-3 text-start">النوع</th>
                    <th className="px-4 py-3 text-start">الوحدة</th>
                    <th className="px-4 py-3 text-start">سعر البيع</th>
                    <th className="px-4 py-3 text-start">متوسط التكلفة</th>
                    <th className="px-4 py-3 text-start">الحد الأدنى</th>
                    <th className="px-4 py-3 text-start">الحالة</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p: Product) => (
                    <tr key={p.id} className="border-b border-stone-100 hover:bg-stone-50/60">
                      <td className="px-4 py-3 tabular-nums text-stone-500">{p.code}</td>
                      <td className="px-4 py-3 font-bold text-stone-900">{p.name}</td>
                      <td className="px-4 py-3"><StatusBadge status={p.item_type} /></td>
                      <td className="px-4 py-3 text-stone-600">{unitById.get(p.base_unit_id)?.symbol ?? '—'}</td>
                      <td className="px-4 py-3 tabular-nums font-bold">{p.item_type === 'FINISHED_PRODUCT' ? formatMoney(p.sale_price, currency) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{formatMoney(p.avg_cost, currency)}</td>
                      <td className="px-4 py-3 tabular-nums text-stone-600">{formatQty(p.min_stock)}</td>
                      <td className="px-4 py-3">{p.active ? <StatusBadge status="CONFIRMED" label="نشط" /> : <StatusBadge status="VOIDED" label="معطل" />}</td>
                      <td className="px-4 py-3">
                        {has('products.manage') ? (
                          <Link to={`/products/${p.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:underline">
                            <Pencil className="size-3.5" /> تعديل
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <EmptyState title="لا نتائج" message="جرّب تعديل البحث أو الفلتر." />}
            </div>

            {/* Mobile */}
            <div className="divide-y divide-stone-100 md:hidden">
              {filtered.map((p: Product) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-stone-900">{p.name}</p>
                      <p className="text-2xs text-stone-400">{p.code}</p>
                    </div>
                    <StatusBadge status={p.item_type} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="tabular-nums text-stone-500">
                      {p.item_type === 'FINISHED_PRODUCT' ? `بيع: ${formatMoney(p.sale_price, currency)}` : `تكلفة: ${formatMoney(p.avg_cost, currency)}`}
                    </span>
                    <span className={`text-2xs font-bold ${p.active ? 'text-success-600' : 'text-danger-500'}`}>{p.active ? 'نشط' : 'معطل'}</span>
                  </div>
                  {has('products.manage') && (
                    <Link to={`/products/${p.id}`} className="mt-2 inline-flex items-center gap-1 text-2xs font-bold text-primary-700">
                      <Pencil className="size-3" /> تعديل
                    </Link>
                  )}
                </div>
              ))}
              {filtered.length === 0 && <EmptyState title="لا نتائج" />}
            </div>
          </>
        )}
      </Card>

      <QuickAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false)
          toast.success('تم إضافة الصنف.')
          const { refreshLookups } = await import('@/services/lookups')
          void refreshLookups()
          void queryClient.invalidateQueries()
        }}
      />
    </div>
  )
}

export function QuickAddModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: () => void | Promise<void>
}) {
  const toast = useToast()
  const businessId = useAuthStore((s) => s.profile?.business_id)
  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const currency = useAuthStore((s) => s.currencySymbol())

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [itemType, setItemType] = useState<ItemType>('FINISHED_PRODUCT')
  const [baseUnit, setBaseUnit] = useState<string>('')
  const [salePrice, setSalePrice] = useState<number | null>(null)
  const [defaultCost, setDefaultCost] = useState<number | null>(null)
  const [minStock, setMinStock] = useState<number | null>(0)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { toast.error('اسم الصنف مطلوب.'); return }
    if (!baseUnit) { toast.error('اختر وحدة الصنف الأساسية.'); return }
    setSaving(true)
    try {
      const finalCode = code.trim() || `${itemType === 'RAW_MATERIAL' ? 'RM' : itemType === 'PACKAGING' ? 'PK' : 'FP'}-${String(products.length + 1).padStart(3, '0')}`
      const { error } = await supabase.from('products').insert({
        business_id: businessId,
        code: finalCode,
        name: name.trim(),
        item_type: itemType,
        base_unit_id: baseUnit,
        sale_price: salePrice ?? 0,
        default_cost: defaultCost ?? 0,
        avg_cost: defaultCost ?? 0,
        min_stock: minStock ?? 0,
        notes: notes.trim() || null,
      })
      if (error) throw new Error(error.message.includes('duplicate') ? 'كود الصنف مستخدم مسبقاً.' : 'تعذر حفظ الصنف.')
      setCode(''); setName(''); setNotes(''); setSalePrice(null); setDefaultCost(null); setMinStock(0)
      await onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="صنف جديد">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="كود الصنف" hint="تلقائي إذا تُرك فارغاً">
            <Input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" className="text-left" placeholder="FP-001" />
          </Field>
          <Field label="اسم الصنف" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="خبز عربي" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="النوع" required>
            <Select value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
              <option value="FINISHED_PRODUCT">منتج نهائي</option>
              <option value="RAW_MATERIAL">مادة خام</option>
              <option value="PACKAGING">تغليف</option>
            </Select>
          </Field>
          <Field label="الوحدة الأساسية" required hint="تُخزن بها الحركات">
            <Select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}>
              <option value="">اختر...</option>
              {units.map((u: Unit) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {itemType === 'FINISHED_PRODUCT' && (
            <Field label="سعر البيع">
              <MoneyInput value={salePrice} onChange={setSalePrice} currencySymbol={currency} />
            </Field>
          )}
          <Field label="التكلفة الافتراضية">
            <MoneyInput value={defaultCost} onChange={setDefaultCost} currencySymbol={currency} />
          </Field>
          <Field label="الحد الأدنى">
            <QuantityInput value={minStock} onChange={setMinStock} allowDecimal={false} />
          </Field>
        </div>
        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        <div className="flex gap-2">
          <Button className="flex-1" loading={saving} onClick={() => void save()}>حفظ الصنف</Button>
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>إلغاء</Button>
        </div>
      </div>
    </Modal>
  )
}

