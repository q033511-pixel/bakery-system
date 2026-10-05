/**
 * حمولة توزيع جديدة (بند 29): اختيار سيارة/سائق/مستودع وتحميل أصناف من المستودع.
 * تعمل أوفلاين — البيانات المرجعية من الكاش المحلي والحفظ عبر طابور المزامنة.
 */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Plus, Save, Trash2, Truck } from 'lucide-react'
import { lookups } from '@/services/lookups'
import { distributionService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { useAuthStore } from '@/app/authStore'
import { todayISO } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Select, Textarea } from '@/components/ui/primitives'
import { DateInput, QuantityInput, SearchSelect } from '@/components/ui/inputs'
import type { Product, Unit } from '@/types'

interface LoadLine {
  key: number
  product_id: string | null
  quantity: number | null
}

let lineKey = 0
function newLine(): LoadLine {
  lineKey += 1
  return { key: lineKey, product_id: null, quantity: null }
}

export default function LoadForm() {
  const toast = useToast()
  const navigate = useNavigate()
  const has = useAuthStore((s) => s.has)

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const vehicles = useLiveQuery(async () => lookups.vehicles(), [], [])
  const drivers = useLiveQuery(async () => lookups.drivers(), [], [])
  const warehouses = useLiveQuery(async () => lookups.warehouses(), [], [])

  const [vehicleId, setVehicleId] = useState<string | null>(null)
  const [driverId, setDriverId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState<string>('')
  const [loadDate, setLoadDate] = useState(todayISO())
  const [lines, setLines] = useState<LoadLine[]>([newLine()])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const unitById = useMemo(() => new Map(units.map((u: Unit) => [u.id, u])), [units])
  const productById = useMemo(() => new Map(products.map((p: Product) => [p.id, p])), [products])
  const defaultWarehouse = useMemo(() => warehouses.find((w) => w.is_default) ?? warehouses[0], [warehouses])

  const activeVehicles = vehicles.filter((v) => v.active)
  const activeDrivers = drivers.filter((d) => d.active)
  const activeWarehouses = warehouses.filter((w) => w.active)
  const effectiveWarehouse = warehouseId || defaultWarehouse?.id || ''

  const productOptions = useMemo(
    () => products
      .filter((p: Product) => p.active)
      .map((p: Product) => ({
        value: p.id,
        label: p.name,
        sublabel: unitById.get(p.base_unit_id)?.symbol ?? '',
      })),
    [products, unitById],
  )

  function updateLine(key: number, patch: Partial<LoadLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function save() {
    if (!vehicleId) { toast.error('اختر سيارة.'); return }
    if (!effectiveWarehouse) { toast.error('لا يوجد مستودع — أضف مستودعاً من الإعدادات.'); return }
    const items = lines
      .filter((l) => l.product_id && (l.quantity ?? 0) > 0)
      .map((l) => ({ product_id: l.product_id as string, quantity: l.quantity as number, unit_id: productById.get(l.product_id as string)?.base_unit_id ?? '' }))
    if (items.length === 0) { toast.error('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر.'); return }
    if (items.some((i) => !i.unit_id)) { toast.error('صنف بدون وحدة أساسية — راجع تعريف المنتجات.'); return }

    setSaving(true)
    try {
      const res = await distributionService.createLoad({
        vehicle_id: vehicleId,
        driver_id: driverId,
        distributor_id: null,
        warehouse_id: effectiveWarehouse,
        load_date: loadDate,
        items,
        notes: notes.trim() || null,
      })
      if (res.offline) {
        toast.offline('تم حفظ الحمولة محلياً وستتم مزامنتها عند عودة الإنترنت.')
        navigate('/distribution')
      } else if (res.duplicate) {
        toast.info('هذه العملية مسجلة مسبقاً — لن يتم تكرارها.')
        if (res.id) navigate(`/distribution/${res.id}`)
      } else {
        toast.success(`تم إنشاء الحمولة — ${res.doc_number}`)
        if (res.id) navigate(`/distribution/${res.id}`)
        else navigate('/distribution')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الحمولة.')
    } finally {
      setSaving(false)
    }
  }

  if (!has('distribution.manage')) {
    return (
      <Card className="p-6 text-center text-sm font-bold text-stone-500">ليس لديك صلاحية إنشاء حمولات توزيع.</Card>
    )
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="حمولة توزيع جديدة"
        subtitle="تحميل أصناف من المستودع إلى السيارة"
        backTo="/distribution"
        action={<Button onClick={() => void save()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
      />

      <Card className="mb-3 space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="السيارة" required>
            <Select value={vehicleId ?? ''} onChange={(e) => setVehicleId(e.target.value || null)}>
              <option value="">اختر سيارة...</option>
              {activeVehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.name}{v.plate ? ` — ${v.plate}` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="السائق" hint="اختياري">
            <Select value={driverId ?? ''} onChange={(e) => setDriverId(e.target.value || null)}>
              <option value="">بدون سائق</option>
              {activeDrivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="المستودع" required>
            <Select value={effectiveWarehouse} onChange={(e) => setWarehouseId(e.target.value)}>
              {activeWarehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (افتراضي)' : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="تاريخ الحمولة" required>
            <DateInput value={loadDate} onChange={setLoadDate} className="w-full" />
          </Field>
        </div>
      </Card>

      <Card className="mb-3 overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-100 p-3">
          <h2 className="text-sm font-extrabold text-stone-800">المحمولات</h2>
          <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => setLines((prev) => [...prev, newLine()])}>
            إضافة صنف
          </Button>
        </div>
        <div className="divide-y divide-stone-100">
          {lines.map((l, idx) => (
            <div key={l.key} className="space-y-2 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xs font-bold text-stone-400">صنف #{idx + 1}</p>
                {lines.length > 1 && (
                  <button
                    onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    className="rounded-lg p-1.5 text-stone-300 transition hover:bg-danger-50 hover:text-danger-600"
                    aria-label="حذف السطر"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem]">
                <SearchSelect
                  options={productOptions}
                  value={l.product_id}
                  onChange={(v) => updateLine(l.key, { product_id: v })}
                  placeholder="ابحث عن صنف..."
                />
                <QuantityInput
                  value={l.quantity}
                  onChange={(v) => updateLine(l.key, { quantity: v })}
                  unit={l.product_id ? unitById.get(productById.get(l.product_id)?.base_unit_id ?? '')?.symbol ?? '' : ''}
                  placeholder="الكمية"
                  aria-label="الكمية"
                />
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <p className="py-6 text-center text-xs text-stone-400">لا أصناف — أضف صنفاً للتحميل.</p>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <Field label="ملاحظات" hint="اختياري">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات على الحمولة..." />
        </Field>
        <Button className="mt-4 w-full" size="lg" loading={saving} onClick={() => void save()} icon={<Truck className="size-5" />}>
          حفظ الحمولة
        </Button>
      </Card>
    </div>
  )
}
