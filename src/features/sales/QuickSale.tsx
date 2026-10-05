/**
 * Quick Sale — البيع السريع (بند 18/51): تسجيل البيع خلال ثوانٍ.
 * Mobile First: أصناف كأزرار +/-، أسعار تلقائية، حفظ بأوفر خطوات.
 * تعمل أوفلاين بالكامل: الأصناف والعملاء من الكاش المحلي، والحفظ عبر الطابور.
 */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Minus, Trash2, Save, ShoppingCart, Banknote, Clock3 } from 'lucide-react'
import { lookups } from '@/services/lookups'
import { salesService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { formatMoney, lineTotal, roundMoney, sumMoney } from '@/lib/money'
import { todayISO } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select } from '@/components/ui/primitives'
import { MoneyInput, SearchSelect } from '@/components/ui/inputs'
import { useAuthStore } from '@/app/authStore'
import { stockHint } from './stockHint'
import type { PaymentType, Product, Unit } from '@/types'

interface Line {
  product_id: string
  name: string
  quantity: number
  unit_id: string
  unit_symbol: string
  unit_price: number
  stock_qty: number | null
}

export default function QuickSale() {
  const toast = useToast()
  const currency = useAuthStore((s) => s.currencySymbol())

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const customers = useLiveQuery(async () => lookups.customers(), [], [])
  const warehouses = useLiveQuery(async () => lookups.warehouses(), [], [])

  const [customerId, setCustomerId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [discount, setDiscount] = useState<number | null>(0)
  const [paymentType, setPaymentType] = useState<PaymentType>('CASH')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const unitById = useMemo(() => new Map(units.map((u: Unit) => [u.id, u])), [units])
  const defaultWarehouse = useMemo(() => warehouses.find((w) => w.is_default) ?? warehouses[0], [warehouses])

  const activeProducts = useMemo(
    () => products.filter((p: Product) => p.active && p.item_type === 'FINISHED_PRODUCT'),
    [products],
  )
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return activeProducts
    return activeProducts.filter((p: Product) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
  }, [activeProducts, search])

  const stockByProduct = useLiveQuery(async () => {
    if (!warehouseId) return {}
    return stockHint(warehouseId)
  }, [warehouseId]) ?? {}

  const subtotal = sumMoney(lines.map((l) => lineTotal(l.quantity, l.unit_price)))
  const total = roundMoney(subtotal - (discount ?? 0))

  function addProduct(p: Product) {
    const unit = p.sales_unit_id ?? p.base_unit_id
    const symbol = unitById.get(unit)?.symbol ?? ''
    setLines((prev) => {
      const existing = prev.find((l) => l.product_id === p.id && l.unit_id === unit)
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [
        ...prev,
        {
          product_id: p.id, name: p.name, quantity: 1, unit_id: unit, unit_symbol: symbol,
          unit_price: p.sale_price, stock_qty: stockByProduct[p.id] ?? null,
        },
      ]
    })
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  async function save() {
    if (lines.length === 0) { toast.error('أضف صنفاً واحداً على الأقل.'); return }
    const wh = warehouseId ?? defaultWarehouse?.id ?? null
    if (!wh) { toast.error('لا يوجد مستودع — أضف مستودعاً من الإعدادات.'); return }
    if ((discount ?? 0) > subtotal) { toast.error('الخصم أكبر من إجمالي الفاتورة.'); return }
    if (paymentType === 'CREDIT' && !customerId) { toast.error('البيع الآجل يتطلب اختيار عميل.'); return }

    setSaving(true)
    try {
      const res = await salesService.create({
        customer_id: customerId,
        warehouse_id: wh,
        sale_date: todayISO(),
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_id: l.unit_id, unit_price: l.unit_price })),
        discount: discount ?? 0,
        payment_type: paymentType,
        payment_method: paymentType === 'CASH' ? 'CASH' : null,
        notes: null,
      })
      if (res.offline) {
        toast.offline('تم حفظ البيع محلياً وسيتم مزامنته عند عودة الإنترنت.')
      } else if (res.duplicate) {
        toast.info('هذه العملية مسجلة مسبقاً — لن يتم تكرارها.')
      } else {
        toast.success(`تم تسجيل البيع بنجاح — ${res.doc_number}`)
      }
      setLines([])
      setDiscount(0)
      setPaymentType('CASH')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ البيع.')
    } finally {
      setSaving(false)
    }
  }

  const customerOptions = useMemo(() => customers.map((c) => ({ value: c.id, label: c.name, sublabel: c.phone ?? c.area ?? '' })), [customers])

  return (
    <div className="pb-4">
      <PageHeader
        title="بيع سريع"
        subtitle="سجّل البيع خلال ثوانٍ — يعمل أوفلاين"
        backTo="/"
        action={<Button onClick={() => void save()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
      />

      {/* العميل + المستودع */}
      <Card className="mb-3 space-y-3 p-4">
        <Field label="العميل" hint="اتركه فارغاً للبيع النقدي المباشر">
          <SearchSelect options={customerOptions} value={customerId} onChange={setCustomerId} placeholder="عميل نقدي / اختر عميلاً..." />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المستودع" required>
            <Select value={warehouseId ?? defaultWarehouse?.id ?? ''} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="نوع الدفع" required>
            <div className="grid grid-cols-2 gap-2">
              <PaymentToggle active={paymentType === 'CASH'} onClick={() => setPaymentType('CASH')} icon={<Banknote className="size-4" />} label="نقدي" />
              <PaymentToggle active={paymentType === 'CREDIT'} onClick={() => setPaymentType('CREDIT')} icon={<Clock3 className="size-4" />} label="آجل" />
            </div>
          </Field>
        </div>
        {paymentType === 'CREDIT' && !customerId && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-2xs font-bold text-warning-700">البيع الآجل يتطلب اختيار عميل.</p>
        )}
      </Card>

      {/* الأصناف */}
      <Card className="mb-3 overflow-hidden">
        <div className="border-b border-stone-100 p-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن صنف..." className="h-10" />
        </div>
        <div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto p-3 scrollbar-thin sm:grid-cols-3">
          {filteredProducts.length === 0 && (
            <p className="col-span-full py-6 text-center text-xs text-stone-400">
              لا توجد منتجات نهائية — أضفها من «المزيد ← المنتجات».
            </p>
          )}
          {filteredProducts.map((p: Product) => {
            const stock = stockByProduct[p.id]
            return (
              <button
                key={p.id}
                onClick={() => addProduct(p)}
                className="flex flex-col items-start gap-1 rounded-xl border border-stone-200 bg-white p-3 text-start transition active:scale-[.97] hover:border-primary-400 hover:bg-primary-50/50"
              >
                <span className="w-full truncate text-xs font-extrabold text-stone-800">{p.name}</span>
                <span className="flex w-full items-center justify-between">
                  <span className="text-2xs font-bold tabular-nums text-primary-700">{formatMoney(p.sale_price, currency)}</span>
                  {stock !== undefined && (
                    <span className={`text-2xs tabular-nums ${stock <= 0 ? 'text-danger-500' : 'text-stone-400'}`}>
                      {stock <= 0 ? 'نفد' : `${stock}`}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      {/* السطور */}
      {lines.length > 0 && (
        <Card className="mb-3 divide-y divide-stone-100">
          {lines.map((l, idx) => {
            const stock = stockByProduct[l.product_id]
            const overStock = stock !== undefined && stock !== null && l.quantity > stock
            return (
              <div key={`${l.product_id}-${l.unit_id}`} className="space-y-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-stone-900">{l.name}</p>
                  <button onClick={() => removeLine(idx)} className="rounded-lg p-1.5 text-stone-300 transition hover:bg-danger-50 hover:text-danger-600" aria-label="حذف السطر">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-stone-200">
                    <button onClick={() => updateLine(idx, { quantity: Math.max(0.001, l.quantity - 1) })} className="flex size-10 items-center justify-center text-stone-600 transition hover:bg-stone-50" aria-label="نقصان">
                      <Minus className="size-4" />
                    </button>
                    <input
                      type="text" inputMode="decimal" dir="ltr" value={l.quantity}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/[^\d.]/g, ''))
                        updateLine(idx, { quantity: Number.isNaN(n) ? 0 : n })
                      }}
                      className="h-10 w-14 border-x border-stone-200 text-center text-sm font-extrabold tabular-nums focus:outline-none"
                    />
                    <button onClick={() => updateLine(idx, { quantity: l.quantity + 1 })} className="flex size-10 items-center justify-center text-stone-600 transition hover:bg-stone-50" aria-label="زيادة">
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <span className="text-2xs font-bold text-stone-400">{l.unit_symbol}</span>
                  <div className="flex-1">
                    <MoneyInput value={l.unit_price} onChange={(v) => updateLine(idx, { unit_price: v ?? 0 })} currencySymbol={currency} aria-label="سعر الوحدة" />
                  </div>
                  <span className="w-20 text-end text-sm font-extrabold tabular-nums text-stone-900">{formatMoney(lineTotal(l.quantity, l.unit_price), currency)}</span>
                </div>
                {overStock && (
                  <p className="text-2xs font-bold text-warning-600">
                    تنبيه: الكمية أكبر من الرصيد المتاح {stock !== null ? `(${stock})` : ''} — سيتم رفض العملية إذا كانت سياسة المخزون السالب معطلة.
                  </p>
                )}
              </div>
            )
          })}
        </Card>
      )}

      {/* الإجمالي */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold text-stone-500">المجموع</span>
          <span className="font-extrabold tabular-nums text-stone-900">{formatMoney(subtotal, currency)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-stone-500">الخصم</span>
          <div className="w-32"><MoneyInput value={discount} onChange={setDiscount} currencySymbol={currency} /></div>
        </div>
        <div className="flex items-center justify-between border-t border-stone-200 pt-3">
          <span className="text-sm font-extrabold text-stone-900">الإجمالي</span>
          <span className="text-xl font-extrabold tabular-nums text-primary-700">{formatMoney(total, currency)}</span>
        </div>
        <Button className="w-full" size="lg" loading={saving} onClick={() => void save()} icon={<ShoppingCart className="size-5" />}>
          حفظ البيع
        </Button>
      </Card>
    </div>
  )
}

function PaymentToggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 items-center justify-center gap-1.5 rounded-lg border text-xs font-extrabold transition ${
        active ? 'border-primary-600 bg-primary-600 text-white' : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
      }`}
    >
      {icon} {label}
    </button>
  )
}
