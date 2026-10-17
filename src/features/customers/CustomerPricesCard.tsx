/**
 * أسعار العميل الخاصة — إدارة قواعد (صنف × وحدة × سعر × مدة صلاحية).
 * السعر يظهر تلقائياً في فاتورة البيع عند اختيار العميل (resolveUnitPrice)،
 * وقيمة الفواتير القديمة لا تتأثر أبداً لأن السعر يُنسخ داخل كل سطر فاتورة.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc } from '@/services/rpc'
import { enqueueUpsertAfterLocalSave } from '@/services/sync/central'
import { lookups } from '@/services/lookups'
import { useAuthStore } from '@/app/authStore'
import { formatMoney } from '@/lib/money'
import { Card, Button, Field, Input, Badge } from '@/components/ui/primitives'
import { DateInput, SearchSelect } from '@/components/ui/inputs'
import { Modal } from '@/components/ui/overlays'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/lib/toast'
import { Tag, Plus, Trash2 } from 'lucide-react'

interface PriceRule {
  id: string
  product_id: string
  unit_id: string | null
  price: number
  start_date: string | null
  end_date: string | null
  notes: string | null
}

interface ProductRow { id: string; name: string; code?: string | null; sale_price?: number | null }
interface UnitRow { id: string; name: string; symbol: string }

export default function CustomerPricesCard({ customerId }: { customerId: string }) {
  const currency = useAuthStore((s) => s.currencySymbol())
  const toast = useToast()
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [productId, setProductId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const rulesQ = useQuery({
    queryKey: ['customer-prices', customerId],
    queryFn: async () => (await rpc<PriceRule[]>('get_customer_prices', { p_customer: customerId })) ?? [],
  })
  const productsQ = useQuery({ queryKey: ['products-lookup'], queryFn: () => lookups.products() })
  const unitsQ = useQuery({ queryKey: ['units-lookup'], queryFn: () => lookups.units() })

  const products = (productsQ.data ?? []) as unknown as ProductRow[]
  const units = (unitsQ.data ?? []) as unknown as UnitRow[]
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'صنف محذوف'
  const unitSymbol = (id: string | null) => (id ? units.find((u) => u.id === id)?.symbol ?? '' : '')

  const saveMutation = useMutation({
    mutationFn: async () => {
      return rpc<{ id: string; updated: boolean }>('upsert_customer_price', {
        p_customer: customerId, p_product: productId, p_unit: unitId,
        p_price: Number(price), p_start_date: startDate || null, p_end_date: endDate || null,
      })
    },
    onSuccess: (res) => {
      toast.success(res.updated ? 'تم تحديث السعر الخاص.' : 'تمت إضافة السعر الخاص — سيظهر تلقائياً في فواتير هذا العميل.')
      // مزامنة قاعدة السعر (تجربة الخطة B): payload مطابق لـapply_customer_price_upsert
      try {
        void enqueueUpsertAfterLocalSave('CUSTOMER_PRICE_UPSERT', {
          id: res.id,
          customer_id: customerId,
          product_id: productId,
          unit_id: unitId || null,
          price: Number(price),
          start_date: startDate || null,
          end_date: endDate || null,
          active: true,
        })
      } catch { /* لا يعطل المحلي */ }
      setModalOpen(false)
      resetForm()
      void qc.invalidateQueries({ queryKey: ['customer-prices', customerId] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'تعذر حفظ السعر.'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => rpc('delete_customer_price', { p_id: id }),
    onSuccess: () => {
      toast.success('حُذفت القاعدة — عاد الصنف لسعره الافتراضي.')
      void qc.invalidateQueries({ queryKey: ['customer-prices', customerId] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'تعذر الحذف.'),
  })

  function resetForm() {
    setProductId(null); setUnitId(null); setPrice(''); setStartDate(''); setEndDate('')
  }

  const selectedProduct = products.find((p) => p.id === productId)

  return (
    <Card className="mb-3 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="size-5 text-primary-600" />
          <h2 className="text-base font-extrabold">أسعار خاصة لهذا العميل</h2>
        </div>
        <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => setModalOpen(true)}>
          سعر خاص
        </Button>
      </div>

      {rulesQ.isLoading ? (
        <p className="text-sm text-stone-500">جارٍ التحميل...</p>
      ) : (rulesQ.data ?? []).length === 0 ? (
        <EmptyState
          title="لا أسعار خاصة بعد"
          message="أضف سعراً خاصاً (مثال: خبز طازج = 3.8 لهذا العميل) وسيُقترح تلقائياً في كل فاتورة له."
        />
      ) : (
        <div className="space-y-1.5">
          {(rulesQ.data ?? []).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
              <span className="font-bold">{productName(r.product_id)}</span>
              {r.unit_id && <Badge>{unitSymbol(r.unit_id)}</Badge>}
              <span className="font-extrabold tabular-nums text-primary-700">{formatMoney(r.price, currency)}</span>
              {r.start_date && <span className="text-2xs text-stone-500">من {r.start_date}</span>}
              {r.end_date && <span className="text-2xs text-stone-500">إلى {r.end_date}</span>}
              <span className="flex-1" />
              <button
                className="rounded-lg p-1.5 text-danger-600 hover:bg-danger-50"
                onClick={() => deleteMutation.mutate(r.id)}
                aria-label="حذف القاعدة"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="إضافة سعر خاص">
        <div className="space-y-3">
          <Field label="الصنف" required>
            <SearchSelect
              options={products.map((p) => ({ value: p.id, label: p.name, sublabel: p.code ?? '' }))}
              value={productId}
              onChange={(v) => { setProductId(v); setUnitId(null) }}
              placeholder="اختر الصنف..."
              emptyText="لا توجد أصناف بعد"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سعر الوحدة" required hint={selectedProduct?.sale_price != null ? `الافتراضي: ${formatMoney(Number(selectedProduct.sale_price), currency)}` : undefined}>
              <Input type="number" inputMode="decimal" step="0.0001" min="0" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="سعر الوحدة" />
            </Field>
            <Field label="الوحدة" hint="اتركها فارغة لسعر الوحدة الأساسية">
              <SearchSelect
                options={[{ value: '', label: 'الوحدة الأساسية' }, ...units.map((u) => ({ value: u.id, label: `${u.name} (${u.symbol})` }))]}
                value={unitId ?? ''}
                onChange={(v) => setUnitId(v === '' ? null : v)}
                placeholder="الوحدة..."
                emptyText="لا توجد وحدات"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سعر من تاريخ">
              <DateInput value={startDate} onChange={setStartDate} aria-label="من تاريخ" />
            </Field>
            <Field label="حتى تاريخ" hint="اختياري — فارغ = دائم">
              <DateInput value={endDate} onChange={setEndDate} aria-label="حتى تاريخ" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button
              loading={saveMutation.isPending}
              disabled={!productId || price === '' || Number.isNaN(Number(price))}
              onClick={() => saveMutation.mutate()}
            >
              حفظ السعر
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}
