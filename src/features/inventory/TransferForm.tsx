/** المناقلة بين المخازن — حركة موثقة تُنشئ خروج وداخل (بند 99) */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Save, Plus, Trash2, ArrowLeftRight, AlertTriangle } from 'lucide-react'
import { lookups } from '@/services/lookups'
import { inventoryService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { todayISO } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Select, Textarea } from '@/components/ui/primitives'
import { QuantityInput, DateInput, SearchSelect } from '@/components/ui/inputs'
import type { Product, Unit } from '@/types'

interface TransferLine {
  product_id: string | null
  quantity: number | null
  unit_id: string
  unit_symbol: string
}

function emptyLine(): TransferLine {
  return { product_id: null, quantity: null, unit_id: '', unit_symbol: '' }
}

export default function TransferForm() {
  const toast = useToast()
  const navigate = useNavigate()

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const warehouses = useLiveQuery(async () => lookups.warehouses(), [], [])

  const [fromWarehouseId, setFromWarehouseId] = useState<string | null>(null)
  const [toWarehouseId, setToWarehouseId] = useState<string | null>(null)
  const [transferDate, setTransferDate] = useState(todayISO())
  const [lines, setLines] = useState<TransferLine[]>([emptyLine()])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const activeProducts = useMemo(() => products.filter((p: Product) => p.active), [products])
  const unitById = useMemo(() => new Map(units.map((u: Unit) => [u.id, u])), [units])
  const defaultWarehouse = useMemo(() => warehouses.find((w) => w.is_default) ?? warehouses[0], [warehouses])

  const fromWarehouse = fromWarehouseId ?? defaultWarehouse?.id ?? null

  const productOptions = useMemo(
    () =>
      activeProducts.map((p: Product) => ({
        value: p.id,
        label: p.name,
        sublabel: p.code,
      })),
    [activeProducts],
  )

  const sameWarehouse = fromWarehouse !== null && toWarehouseId !== null && fromWarehouse === toWarehouseId

  function updateLine(idx: number, patch: Partial<TransferLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  function selectLineProduct(idx: number, value: string | null) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l
        const p = activeProducts.find((x) => x.id === value)
        return {
          ...l,
          product_id: value,
          unit_id: p ? p.base_unit_id : '',
          unit_symbol: p ? unitById.get(p.base_unit_id)?.symbol ?? '' : '',
        }
      }),
    )
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  async function save() {
    if (!fromWarehouse) { toast.error('اختر المخزن المصدر.'); return }
    if (!toWarehouseId) { toast.error('اختر المخزن الهدف.'); return }
    if (fromWarehouse === toWarehouseId) { toast.error('اختر مخزنين مختلفين للمناقلة.'); return }
    const items: { product_id: string; quantity: number; unit_id: string }[] = []
    for (const l of lines) {
      if (!l.product_id) { toast.error('اختر الصنف في كل السطور.'); return }
      if (!l.quantity || l.quantity <= 0) { toast.error('أدخل كمية أكبر من صفر في كل السطور.'); return }
      items.push({ product_id: l.product_id, quantity: l.quantity, unit_id: l.unit_id })
    }
    if (items.length === 0) { toast.error('أضف صنفاً واحداً على الأقل.'); return }

    setSaving(true)
    try {
      const res = await inventoryService.transfer({
        from_warehouse_id: fromWarehouse,
        to_warehouse_id: toWarehouseId,
        transfer_date: transferDate,
        items,
        notes: notes.trim() || null,
      })
      if (res.offline) {
        toast.offline('تم حفظ المناقلة محلياً وستتم مزامنتها.')
      } else {
        toast.success(`تم تنفيذ المناقلة — ${res.doc_number}`)
      }
      navigate('/inventory')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ المناقلة.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="مناقلة مخزون"
        subtitle="نقل أصناف بين مخزنين"
        backTo="/inventory"
        action={<Button onClick={() => void save()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
      />

      {sameWarehouse && (
        <Card className="mb-3 flex items-center gap-3 border-danger-200 bg-danger-50 p-3.5">
          <AlertTriangle className="size-5 shrink-0 text-danger-600" />
          <p className="text-xs font-bold leading-relaxed text-danger-800">لا يمكن المناقلة من المخزن إلى نفسه — اختر مخزنين مختلفين.</p>
        </Card>
      )}

      <Card className="mb-3 space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Field label="من مخزن" required>
            <Select value={fromWarehouse ?? ''} onChange={(e) => setFromWarehouseId(e.target.value)}>
              <option value="">اختر المخزن...</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
          <div className="hidden pb-3 sm:block">
            <ArrowLeftRight className="size-5 text-stone-400" />
          </div>
          <Field label="إلى مخزن" required>
            <Select value={toWarehouseId ?? ''} onChange={(e) => setToWarehouseId(e.target.value)}>
              <option value="">اختر المخزن...</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="تاريخ المناقلة" required>
          <DateInput value={transferDate} onChange={setTransferDate} className="sm:w-48" />
        </Field>
      </Card>

      <div className="mb-3 space-y-2">
        {lines.map((l, idx) => (
          <Card key={idx} className="space-y-2.5 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs font-bold text-stone-400">سطر {idx + 1}</span>
              <button
                type="button"
                onClick={() => removeLine(idx)}
                className="rounded-lg p-1.5 text-stone-300 transition hover:bg-danger-50 hover:text-danger-600"
                aria-label="حذف السطر"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <Field label="الصنف" required>
              <SearchSelect
                options={productOptions}
                value={l.product_id}
                onChange={(v) => selectLineProduct(idx, v)}
                placeholder="اختر الصنف..."
                emptyText="لا توجد أصناف"
              />
            </Field>
            <Field label="الكمية" required hint={l.unit_symbol ? `الوحدة: ${l.unit_symbol}` : 'حدد الصنف أولاً لعرض الوحدة'}>
              <QuantityInput value={l.quantity} onChange={(v) => updateLine(idx, { quantity: v })} unit={l.unit_symbol} />
            </Field>
          </Card>
        ))}
        <Button
          variant="outline"
          size="sm"
          icon={<Plus className="size-4" />}
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
        >
          إضافة سطر
        </Button>
      </div>

      <Card className="mb-3 space-y-3 p-4">
        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="اختياري..." />
        </Field>
      </Card>

      <Card className="p-4">
        <Button className="w-full" size="lg" loading={saving} onClick={() => void save()} icon={<Save className="size-5" />}>
          تنفيذ المناقلة
        </Button>
      </Card>
    </div>
  )
}
