/** إضافة/تعديل صنف — كامل الحقول (بند 9/10) */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { enqueueUpsertAfterLocalSave } from '@/services/sync/central'
import { supabase } from '@/lib/supabase'
import { db } from '@/db/db'
import { lookups } from '@/services/lookups'
import { useToast } from '@/lib/toast'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select, Textarea, Skeleton } from '@/components/ui/primitives'
import { MoneyInput, QuantityInput } from '@/components/ui/inputs'
import { useAuthStore } from '@/app/authStore'
import type { ItemType, Product, Unit } from '@/types'

export default function ProductForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const currency = useAuthStore((s) => s.currencySymbol())
  const businessId = useAuthStore((s) => s.business?.id ?? '')
  const isEdit = Boolean(id)

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const product = products.find((p: Product) => p.id === id)

  const [name, setName] = useState('')
  const [itemType, setItemType] = useState<ItemType>('FINISHED_PRODUCT')
  const [baseUnit, setBaseUnit] = useState('')
  const [salePrice, setSalePrice] = useState<number | null>(0)
  const [minStock, setMinStock] = useState<number | null>(0)
  const [active, setActive] = useState(true)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // تهيئة النموذج من المنتج مرة واحدة — ضبط أثناء الرسم بدل تأثير
  // (نفس دلالات السلوك السابق: مرة واحدة لكل تركيب)
  const [hydrated, setHydrated] = useState(false)
  if (product && !hydrated) {
    setHydrated(true)
    setName(product.name)
    setItemType(product.item_type)
    setBaseUnit(product.base_unit_id)
    setSalePrice(product.sale_price)
    setMinStock(product.min_stock)
    setActive(product.active)
    setNotes(product.notes ?? '')
  }

  // افتراضي حقيقي للوحدة في وضع الإضافة: القائمة تعرض أول وحدة بصرياً — يجب أن تطابقها الحالة
  // (بدون هذا كان الحفظ يُرفض برسالة «اختر الوحدة» رغم ظهور وحدة مختارة)
  // — ضبط أثناء الرسم: بعد الضبط يصبح baseUnit غير فارغ فلا تكرار
  if (!isEdit && baseUnit === '' && units.length > 0) {
    const kg = units.find((u) => u.symbol === 'كغ' || u.name.includes('كيلو'))
    const fallback = kg ?? units[0]
    if (fallback) setBaseUnit(fallback.id)
  }

  /** كود تلقائي متسلسل P-0001 */
  async function nextProductCode(): Promise<string> {
    const rows = await db.products.where('business_id').equals(businessId).toArray()
    let max = 0
    for (const r of rows) {
      const m = /^P-(\d+)$/.exec(String(r.code ?? ''))
      if (m) max = Math.max(max, Number(m[1]))
    }
    return `P-${String(max + 1).padStart(4, '0')}`
  }

  async function save() {
    if (!name.trim()) { toast.error('اسم الصنف مطلوب.'); return }
    if (!baseUnit) { toast.error('اختر الوحدة الأساسية.'); return }
    setSaving(true)
    try {
      if (isEdit) {
        const { error } = await supabase.from('products').update({
          name: name.trim(),
          item_type: itemType,
          base_unit_id: baseUnit,
          sale_price: salePrice ?? 0,
          min_stock: minStock ?? 0,
          active,
          notes: notes.trim() || null,
        }).eq('id', id)
        if (error) throw new Error('تعذر حفظ التعديلات.')
        toast.success('تم حفظ التعديلات.')
        // مزامنة التعديل (تجربة الخطة B): الصف المدموج يُرفع كـupsert — معطّلة افتراضياً
        if (product) {
          try {
            await enqueueUpsertAfterLocalSave('PRODUCT_UPSERT', {
              ...product,
              name: name.trim(),
              item_type: itemType,
              base_unit_id: baseUnit,
              sale_price: salePrice ?? 0,
              min_stock: minStock ?? 0,
              active,
              notes: notes.trim() || null,
            })
          } catch { /* لا يعطل المحلي */ }
        }
      } else {
        const code = await nextProductCode()
        // معرف مُولّد مسبقاً — للإدراج ولطابور المزامنة معاً (تجربة الخطة B)
        const row = {
          id: crypto.randomUUID(),
          business_id: businessId,
          code,
          name: name.trim(),
          item_type: itemType,
          base_unit_id: baseUnit,
          sales_unit_id: baseUnit,
          sale_price: itemType === 'FINISHED_PRODUCT' ? (salePrice ?? 0) : 0,
          min_stock: minStock ?? 0,
          active,
          notes: notes.trim() || null,
          avg_cost: 0,
          last_purchase_cost: 0,
        }
        const { error } = await supabase.from('products').insert(row)
        if (error) throw new Error('تعذر إضافة الصنف.')
        try { await enqueueUpsertAfterLocalSave('PRODUCT_UPSERT', row) } catch { /* لا يعطل المحلي */ }
        toast.success(`تمت إضافة الصنف — الكود ${code}`)
      }
      const { refreshLookups } = await import('@/services/lookups')
      void refreshLookups()
      void queryClient.invalidateQueries()
      navigate('/products')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ.')
    } finally {
      setSaving(false)
    }
  }

  if (isEdit && !product) {
    return (
      <div className="space-y-3">
        <PageHeader title="تعديل صنف" backTo="/products" />
        <Card className="space-y-3 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></Card>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <PageHeader title={isEdit ? `تعديل: ${product?.code ?? ''}` : 'إضافة صنف جديد'} backTo="/products" />

      <Card className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="اسم الصنف" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="النوع" required>
            <Select value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
              <option value="FINISHED_PRODUCT">منتج نهائي</option>
              <option value="RAW_MATERIAL">مادة خام</option>
              <option value="PACKAGING">تغليف</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الوحدة الأساسية" required hint="تُخزن بها حركات المخزون">
            <Select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}>
              {units.map((u: Unit) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
            </Select>
          </Field>
          {itemType === 'FINISHED_PRODUCT' && (
            <Field label="سعر البيع">
              <MoneyInput value={salePrice} onChange={setSalePrice} currencySymbol={currency} />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الحد الأدنى للمخزون" hint="يُستخدم لتنبيهات النقص">
            <QuantityInput value={minStock} onChange={setMinStock} allowDecimal={false} />
          </Field>
          <Field label="الحالة">
            <button
              type="button"
              onClick={() => setActive(!active)}
              className={`h-11 w-full rounded-lg border text-sm font-extrabold transition ${active ? 'border-success-300 bg-success-50 text-success-700' : 'border-stone-300 bg-stone-50 text-stone-500'}`}
            >
              {active ? 'نشط' : 'معطل'}
            </button>
          </Field>
        </div>
        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        <div className="flex gap-2">
          <Button className="flex-1" loading={saving} onClick={() => void save()}>{isEdit ? 'حفظ التعديلات' : 'إضافة الصنف'}</Button>
          <Button variant="outline" className="flex-1" onClick={() => navigate('/products')} disabled={saving}>إلغاء</Button>
        </div>
      </Card>

      <Card className="mt-3 border-info-200 bg-info-50/50 p-4">
        <p className="text-2xs leading-relaxed text-info-900">
          ملاحظات محاسبية: متوسط التكلفة (avg_cost) يتحدث تلقائياً عند تسجيل فواتير الشراء (التكلفة المرجحة) — لا يُعدل يدوياً.
          تغيير الوحدة الأساسية لصنف عليه حركات قد يفسد تقارير المخزون — يُفضل إنشاء صنف جديد.
        </p>
      </Card>
    </div>
  )
}
