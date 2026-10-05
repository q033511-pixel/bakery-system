/** تسوية المخزون — تعديل الرصيد عبر حركة موثقة فقط (بند 27/94) */
import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Save, Info, Plus, Minus } from 'lucide-react'
import { lookups } from '@/services/lookups'
import { inventoryService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { todayISO } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { QuantityInput, DateInput, SearchSelect } from '@/components/ui/inputs'
import type { Product, Unit, Warehouse } from '@/types'

export default function InventoryAdjust() {
  const toast = useToast()
  const navigate = useNavigate()

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const warehouses = useLiveQuery(async () => lookups.warehouses(), [], [])

  const [productId, setProductId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN')
  const [quantity, setQuantity] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [adjustedAt, setAdjustedAt] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const activeProducts = useMemo(() => products.filter((p: Product) => p.active), [products])
  const unitById = useMemo(() => new Map(units.map((u: Unit) => [u.id, u])), [units])
  const defaultWarehouse = useMemo(() => warehouses.find((w: Warehouse) => w.is_default) ?? warehouses[0], [warehouses])

  const product = useMemo(() => activeProducts.find((p) => p.id === productId), [activeProducts, productId])
  const warehouseIdEffective = warehouseId ?? defaultWarehouse?.id ?? null
  const unitSymbol = product ? unitById.get(product.base_unit_id)?.symbol ?? '' : ''

  const productOptions = useMemo(
    () =>
      activeProducts.map((p: Product) => ({
        value: p.id,
        label: `${p.name} — ${unitById.get(p.base_unit_id)?.symbol ?? ''}`,
        sublabel: p.code,
      })),
    [activeProducts, unitById],
  )

  async function save() {
    if (!product) { toast.error('اختر الصنف.'); return }
    if (!warehouseIdEffective) { toast.error('اختر المخزن.'); return }
    if (!quantity || quantity <= 0) { toast.error('أدخل كمية أكبر من صفر.'); return }
    if (!reason.trim()) { toast.error('اكتب سبب التسوية.'); return }

    setSaving(true)
    try {
      const res = await inventoryService.adjust({
        product_id: product.id,
        warehouse_id: warehouseIdEffective,
        direction,
        quantity,
        unit_id: product.base_unit_id,
        reason: reason.trim(),
        adjusted_at: adjustedAt,
        notes: notes.trim() || null,
      })
      if (res.offline) {
        toast.offline('تم حفظ التسوية محلياً وستتم مزامنتها.')
      } else {
        toast.success(`تم تسجيل التسوية — ${res.doc_number}`)
      }
      navigate('/inventory')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ التسوية.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="تسوية مخزون"
        subtitle="تعديل الرصيد بزيادة أو نقص موثّق"
        backTo="/inventory"
        action={<Button onClick={() => void save()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
      />

      <Card className="mb-3 flex items-center gap-3 border-info-200 bg-info-50 p-3.5">
        <Info className="size-5 shrink-0 text-info-600" />
        <p className="text-xs font-bold leading-relaxed text-info-800">
          الرصيد يُعدل فقط عبر حركة موثقة — لا تعديل مباشر.
        </p>
      </Card>

      <Card className="mb-3 space-y-3 p-4">
        <Field label="الصنف" required>
          <SearchSelect
            options={productOptions}
            value={productId}
            onChange={setProductId}
            placeholder="اختر الصنف..."
            emptyText="لا توجد أصناف"
          />
        </Field>

        <Field label="المخزن" required>
          <Select value={warehouseIdEffective ?? ''} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">اختر المخزن...</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="الاتجاه" required>
          <div className="grid grid-cols-2 gap-2">
            <DirectionToggle active={direction === 'IN'} onClick={() => setDirection('IN')} icon={<Plus className="size-4" />} label="زيادة" tone="success" />
            <DirectionToggle active={direction === 'OUT'} onClick={() => setDirection('OUT')} icon={<Minus className="size-4" />} label="نقص" tone="danger" />
          </div>
        </Field>

        <Field label="الكمية" required hint={unitSymbol ? `الوحدة: ${unitSymbol}` : 'حدد الصنف أولاً لعرض الوحدة'}>
          <QuantityInput value={quantity} onChange={setQuantity} unit={unitSymbol} />
        </Field>

        <Field label="السبب" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: جرد فعلي، تصحيح إدخال..." />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="تاريخ التسوية" required>
            <DateInput value={adjustedAt} onChange={setAdjustedAt} />
          </Field>
        </div>

        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="اختياري..." />
        </Field>
      </Card>

      <Card className="p-4">
        <Button className="w-full" size="lg" loading={saving} onClick={() => void save()} icon={<Save className="size-5" />}>
          حفظ التسوية
        </Button>
      </Card>
    </div>
  )
}

function DirectionToggle({ active, onClick, icon, label, tone }: {
  active: boolean; onClick: () => void; icon: ReactNode; label: string; tone: 'success' | 'danger'
}) {
  const activeClass = tone === 'success'
    ? 'border-success-600 bg-success-600 text-white'
    : 'border-danger-600 bg-danger-600 text-white'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-extrabold transition ${
        active ? activeClass : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
      }`}
    >
      {icon} {label}
    </button>
  )
}
