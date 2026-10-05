/**
 * PurchaseForm — فاتورة شراء جديدة (بند 21): مورد + مستودع + أصناف + دفع نقدي/آجل.
 * تعمل أوفلاين بالكامل: الموردون والأصناف من الكاش المحلي، والحفظ عبر الطابور.
 */
import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Save, Truck } from 'lucide-react'
import { lookups } from '@/services/lookups'
import { purchasesService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { formatMoney, lineTotal, roundMoney, sumMoney } from '@/lib/money'
import { todayISO } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { DateInput, MoneyInput, QuantityInput, SearchSelect } from '@/components/ui/inputs'
import { useAuthStore } from '@/app/authStore'
import type { PaymentMethod, PaymentType, Product } from '@/types'

interface Line {
  key: number
  product_id: string | null
  quantity: number | null
  unit_id: string | null
  unit_symbol: string
  unit_price: number | null
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'نقدي' },
  { value: 'BANK_TRANSFER', label: 'حوالة' },
  { value: 'CHECK', label: 'شيك' },
  { value: 'OTHER', label: 'أخرى' },
]

export default function PurchaseForm() {
  const toast = useToast()
  const navigate = useNavigate()
  const currency = useAuthStore((s) => s.currencySymbol())

  const suppliersQ = useLiveQuery(async () => lookups.suppliers(), [])
  const productsQ = useLiveQuery(async () => lookups.products(), [])
  const unitsQ = useLiveQuery(async () => lookups.units(), [])
  const warehousesQ = useLiveQuery(async () => lookups.warehouses(), [])
  const suppliers = useMemo(() => suppliersQ ?? [], [suppliersQ])
  const products = useMemo(() => productsQ ?? [], [productsQ])
  const units = useMemo(() => unitsQ ?? [], [unitsQ])
  const warehouses = useMemo(() => warehousesQ ?? [], [warehousesQ])

  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [purchaseDate, setPurchaseDate] = useState(todayISO())
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType>('CASH')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [discount, setDiscount] = useState<number | null>(0)
  const [saving, setSaving] = useState(false)
  const lineSeq = useRef(0)

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const productById = useMemo(() => new Map(products.map((p: Product) => [p.id, p])), [products])
  const defaultWarehouse = useMemo(() => warehouses.find((w) => w.is_default) ?? warehouses[0], [warehouses])

  const activeProducts = useMemo(() => products.filter((p: Product) => p.active), [products])
  const productOptions = useMemo(
    () => activeProducts.map((p: Product) => {
      const symbol = unitById.get(p.base_unit_id)?.symbol ?? ''
      return { value: p.id, label: `${p.name} (${symbol})`, sublabel: p.code }
    }),
    [activeProducts, unitById],
  )
  const supplierOptions = useMemo(() => suppliers.map((s) => ({ value: s.id, label: s.name, sublabel: s.phone ?? '' })), [suppliers])

  const subtotal = sumMoney(lines.map((l) => lineTotal(l.quantity ?? 0, l.unit_price ?? 0)))
  const total = roundMoney(subtotal - (discount ?? 0))

  function addLine() {
    lineSeq.current += 1
    setLines((prev) => [...prev, { key: lineSeq.current, product_id: null, quantity: null, unit_id: null, unit_symbol: '', unit_price: null }])
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function setLineProduct(key: number, productId: string | null) {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l
      if (!productId) return { ...l, product_id: null, unit_id: null, unit_symbol: '', unit_price: null }
      const p = productById.get(productId)
      const unitId = p?.base_unit_id ?? null
      const symbol = unitId ? unitById.get(unitId)?.symbol ?? '' : ''
      const price = l.unit_price ?? (p ? p.last_purchase_cost ?? p.default_cost : null)
      return { ...l, product_id: productId, unit_id: unitId, unit_symbol: symbol, unit_price: price }
    }))
  }

  function optionsForLine(key: number) {
    const used = new Set(lines.filter((l) => l.key !== key && l.product_id).map((l) => l.product_id))
    return productOptions.filter((o) => !used.has(o.value))
  }

  async function save() {
    if (!supplierId) { toast.error('اختر المورد.'); return }
    const wh = warehouseId ?? defaultWarehouse?.id ?? null
    if (!wh) { toast.error('لا يوجد مستودع — أضف مستودعاً من الإعدادات.'); return }

    const items: { product_id: string; quantity: number; unit_id: string; unit_price: number }[] = []
    for (const l of lines) {
      if (!l.product_id) continue
      if (l.quantity === null || l.quantity <= 0) { toast.error('الكمية يجب أن تكون أكبر من صفر لكل صنف.'); return }
      if (!l.unit_id) { toast.error('أكمل بيانات الأصناف — الوحدة مطلوبة.'); return }
      if (l.unit_price === null || l.unit_price < 0) { toast.error('أدخل سعر شراء صحيحاً لكل صنف.'); return }
      items.push({ product_id: l.product_id, quantity: l.quantity, unit_id: l.unit_id, unit_price: l.unit_price })
    }
    if (items.length === 0) { toast.error('أضف صنفاً واحداً على الأقل.'); return }
    if ((discount ?? 0) > subtotal) { toast.error('الخصم أكبر من إجمالي الفاتورة.'); return }

    setSaving(true)
    try {
      const res = await purchasesService.create({
        supplier_id: supplierId,
        warehouse_id: wh,
        purchase_date: purchaseDate,
        invoice_number: invoiceNumber.trim() === '' ? null : invoiceNumber.trim(),
        items,
        discount: discount ?? 0,
        payment_type: paymentType,
        payment_method: paymentType === 'CASH' ? paymentMethod : null,
        notes: notes.trim() === '' ? null : notes.trim(),
      })
      if (res.offline) {
        toast.offline('تم حفظ الشراء محلياً وسيتم مزامنته عند عودة الإنترنت.')
      } else if (res.duplicate) {
        toast.info('هذه العملية مسجلة مسبقاً — لن يتم تكرارها.')
      } else {
        toast.success(`تم تسجيل الشراء بنجاح — ${res.doc_number}`)
      }
      window.setTimeout(() => navigate('/purchases'), 800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الشراء.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="فاتورة شراء"
        subtitle="تسجيل مشتريات من مورد — تُضاف تلقائياً للمخزون"
        backTo="/purchases"
        action={<Button onClick={() => void save()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
      />

      {/* المورد + المستودع + التاريخ */}
      <Card className="mb-3 space-y-3 p-4">
        <Field label="المورد" required hint="المورد مسؤول عن دفع المبالغ الآجلة لاحقاً">
          <SearchSelect options={supplierOptions} value={supplierId} onChange={setSupplierId} placeholder="اختر المورد..." emptyText="لا يوجد موردون" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المستودع" required>
            <Select value={warehouseId ?? defaultWarehouse?.id ?? ''} onChange={(e) => setWarehouseId(e.target.value)} aria-label="المستودع">
              {warehouses.length === 0 && <option value="">لا يوجد مستودعات</option>}
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="تاريخ الشراء" required>
            <DateInput value={purchaseDate} onChange={setPurchaseDate} className="w-full" aria-label="تاريخ الشراء" />
          </Field>
        </div>
        <Field label="رقم فاتورة المورد" hint="اختياري — كما يظهر على فاتورة المورد الورقية">
          <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="مثال: INV-2451" dir="ltr" className="text-left" />
        </Field>
        <Field label="نوع الدفع" required>
          <div className="grid grid-cols-2 gap-2">
            <PaymentToggle active={paymentType === 'CASH'} onClick={() => setPaymentType('CASH')} label="نقدي" />
            <PaymentToggle active={paymentType === 'CREDIT'} onClick={() => setPaymentType('CREDIT')} label="آجل" />
          </div>
        </Field>
        {paymentType === 'CASH' && (
          <>
            <Field label="طريقة الدفع النقدي">
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            </Field>
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-2xs font-bold text-warning-700">الشراء النقدي يخصم من الصندوق تلقائياً.</p>
          </>
        )}
        <Field label="ملاحظات" hint="اختياري">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="أي ملاحظات على الفاتورة..." />
        </Field>
      </Card>

      {/* الأصناف */}
      <Card className="mb-3 overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-100 p-3">
          <p className="text-sm font-extrabold text-stone-800">الأصناف</p>
          <Button variant="outline" size="sm" onClick={addLine} icon={<Plus className="size-4" />}>إضافة صنف</Button>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
              <Truck className="size-6" />
            </div>
            <p className="text-sm font-extrabold text-stone-800">لا توجد أصناف بعد</p>
            <p className="max-w-xs text-xs text-stone-500">اضغط «إضافة صنف» وابدأ بإدخال المواد المشتراة.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {lines.map((l) => {
              const lineSum = lineTotal(l.quantity ?? 0, l.unit_price ?? 0)
              return (
                <div key={l.key} className="space-y-2 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-stone-900">
                      {l.product_id ? productById.get(l.product_id)?.name ?? '—' : 'اختر صنفاً...'}
                    </p>
                    <button onClick={() => removeLine(l.key)} className="rounded-lg p-1.5 text-stone-300 transition hover:bg-danger-50 hover:text-danger-600" aria-label="حذف السطر">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <SearchSelect
                    options={optionsForLine(l.key)}
                    value={l.product_id}
                    onChange={(v) => setLineProduct(l.key, v)}
                    placeholder="ابحث عن صنف..."
                    emptyText="لا نتائج"
                  />
                  <div className="flex items-center gap-2">
                    <div className="w-28">
                      <QuantityInput
                        value={l.quantity}
                        onChange={(v) => updateLine(l.key, { quantity: v })}
                        unit={l.unit_symbol}
                        placeholder="كمية"
                        aria-label="الكمية"
                      />
                    </div>
                    <div className="flex-1">
                      <MoneyInput
                        value={l.unit_price}
                        onChange={(v) => updateLine(l.key, { unit_price: v })}
                        currencySymbol={currency}
                        placeholder="سعر الوحدة"
                        aria-label="سعر الوحدة"
                      />
                    </div>
                    <span className="w-24 text-end text-sm font-extrabold tabular-nums text-stone-900">{formatMoney(lineSum, currency)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* الإجمالي */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold text-stone-500">المجموع</span>
          <span className="font-extrabold tabular-nums text-stone-900">{formatMoney(subtotal, currency)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-stone-500">الخصم</span>
          <div className="w-32"><MoneyInput value={discount} onChange={setDiscount} currencySymbol={currency} aria-label="الخصم" /></div>
        </div>
        <div className="flex items-center justify-between border-t border-stone-200 pt-3">
          <span className="text-sm font-extrabold text-stone-900">الإجمالي</span>
          <span className="text-xl font-extrabold tabular-nums text-primary-700">{formatMoney(total, currency)}</span>
        </div>
        <Button className="w-full" size="lg" loading={saving} onClick={() => void save()} icon={<Save className="size-5" />}>
          حفظ فاتورة الشراء
        </Button>
      </Card>
    </div>
  )
}

function PaymentToggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 items-center justify-center gap-1.5 rounded-lg border text-xs font-extrabold transition ${
        active ? 'border-primary-600 bg-primary-600 text-white' : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
      }`}
    >
      {label}
    </button>
  )
}
