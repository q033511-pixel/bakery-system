/** تسجيل الهالك — خصم موثق من المخزون بسبب محدد (بند 27/94) */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Save, AlertTriangle } from 'lucide-react'
import { lookups } from '@/services/lookups'
import { inventoryService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { todayISO } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { QuantityInput, DateInput, SearchSelect } from '@/components/ui/inputs'
import type { Product, Unit, Warehouse } from '@/types'

const WASTE_REASONS = ['تلف', 'انتهاء صلاحية', 'خطأ إنتاج', 'أخرى'] as const

export default function WasteForm() {
  const toast = useToast()
  const navigate = useNavigate()

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const warehouses = useLiveQuery(async () => lookups.warehouses(), [], [])

  const [productId, setProductId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  const [reasonChoice, setReasonChoice] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [wastedAt, setWastedAt] = useState(todayISO())
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
    if (!reasonChoice) { toast.error('اختر سبب الهالك.'); return }
    const finalReason = reasonChoice === 'أخرى' ? customReason.trim() : reasonChoice
    if (!finalReason) { toast.error('اكتب سبب الهالك.'); return }

    setSaving(true)
    try {
      const res = await inventoryService.waste({
        product_id: product.id,
        warehouse_id: warehouseIdEffective,
        quantity,
        unit_id: product.base_unit_id,
        reason: finalReason,
        wasted_at: wastedAt,
        notes: notes.trim() || null,
      })
      if (res.offline) {
        toast.offline('تم حفظ الهالك محلياً وستتم مزامنته.')
      } else {
        toast.success(`تم تسجيل الهالك — ${res.doc_number}`)
      }
      navigate('/inventory')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الهالك.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="تسجيل هالك"
        subtitle="خصم كمية تالفة أو منتهية من المخزون"
        backTo="/inventory"
        action={<Button onClick={() => void save()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
      />

      <Card className="mb-3 flex items-center gap-3 border-warning-200 bg-warning-50 p-3.5">
        <AlertTriangle className="size-5 shrink-0 text-warning-600" />
        <p className="text-xs font-bold leading-relaxed text-warning-800">
          الهالك يخصم من المخزون — تأكد من الكمية والسبب قبل الحفظ.
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

        <Field label="الكمية" required hint={unitSymbol ? `الوحدة: ${unitSymbol}` : 'حدد الصنف أولاً لعرض الوحدة'}>
          <QuantityInput value={quantity} onChange={setQuantity} unit={unitSymbol} />
        </Field>

        <Field label="السبب" required>
          <Select value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)}>
            <option value="">اختر السبب...</option>
            {WASTE_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>

        {reasonChoice === 'أخرى' && (
          <Field label="اكتب السبب" required>
            <Input value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="سبب الهالك..." />
          </Field>
        )}

        <Field label="تاريخ الهالك" required>
          <DateInput value={wastedAt} onChange={setWastedAt} />
        </Field>

        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="اختياري..." />
        </Field>
      </Card>

      <Card className="p-4">
        <Button className="w-full" size="lg" loading={saving} onClick={() => void save()} icon={<Save className="size-5" />}>
          حفظ الهالك
        </Button>
      </Card>
    </div>
  )
}
