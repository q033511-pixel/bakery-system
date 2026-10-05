/** دفعة إنتاج جديدة — استهلاك المواد تلقائياً حسب نسخة الوصفة (بند 23/24/25) */
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Save, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { lookups } from '@/services/lookups'
import { productionService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { todayISO } from '@/lib/dates'
import { formatQty } from '@/lib/money'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Select, Textarea } from '@/components/ui/primitives'
import { QuantityInput, DateInput } from '@/components/ui/inputs'
import type { Product, RecipeVersion, Unit } from '@/types'

const SHIFTS = ['صباحية', 'مسائية', 'ليلية', 'أخرى'] as const

export default function ProductionForm() {
  const toast = useToast()
  const navigate = useNavigate()

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const warehouses = useLiveQuery(async () => lookups.warehouses(), [], [])
  const recipeVersions = useLiveQuery(async () => lookups.recipeVersions(), [], [])

  const [productId, setProductId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [recipeVersionId, setRecipeVersionId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  const [batchDate, setBatchDate] = useState(todayISO())
  const [shift, setShift] = useState<string>('صباحية')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // أسماء الوصفات لربط النسخة باسم وصفتها (recipe_id → name)
  const { data: recipes } = useQuery({
    queryKey: ['recipes', 'names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('recipes').select('id,name,product_id')
      if (error) throw new Error(error.message)
      return data as unknown as { id: string; name: string; product_id: string }[]
    },
  })

  const finishedProducts = useMemo(
    () => products.filter((p: Product) => p.active && p.item_type === 'FINISHED_PRODUCT'),
    [products],
  )
  const unitById = useMemo(() => new Map(units.map((u: Unit) => [u.id, u])), [units])
  const recipeById = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes])
  const defaultWarehouse = useMemo(() => warehouses.find((w) => w.is_default) ?? warehouses[0], [warehouses])

  const product = useMemo(() => finishedProducts.find((p) => p.id === productId), [finishedProducts, productId])
  const warehouseIdEffective = warehouseId ?? defaultWarehouse?.id ?? null
  const unitSymbol = product ? unitById.get(product.base_unit_id)?.symbol ?? '' : ''

  const versionOptions = useMemo(
    () => recipeVersions.filter((v: RecipeVersion) => recipeById.get(v.recipe_id)?.product_id === productId),
    [recipeVersions, recipeById, productId],
  )
  const selectedVersion = useMemo(
    () => recipeVersions.find((v: RecipeVersion) => v.id === recipeVersionId),
    [recipeVersions, recipeVersionId],
  )
  const selectedRecipe = selectedVersion ? recipeById.get(selectedVersion.recipe_id) : undefined

  // إعادة ضبط النسخة عند تغيير المنتج
  useEffect(() => {
    setRecipeVersionId(null)
  }, [productId])

  const outputSymbol = selectedVersion ? unitById.get(selectedVersion.output_unit_id)?.symbol ?? '' : ''
  const factor = selectedVersion && selectedVersion.output_quantity > 0
    ? (quantity ?? 0) / selectedVersion.output_quantity
    : null

  async function save() {
    if (!product) { toast.error('اختر المنتج النهائي.'); return }
    if (!warehouseIdEffective) { toast.error('اختر المخزن.'); return }
    if (!recipeVersionId) { toast.error('اختر نسخة الوصفة.'); return }
    if (!quantity || quantity <= 0) { toast.error('أدخل كمية الإنتاج.'); return }

    setSaving(true)
    try {
      const res = await productionService.create({
        product_id: product.id,
        warehouse_id: warehouseIdEffective,
        recipe_version_id: recipeVersionId,
        quantity,
        unit_id: product.base_unit_id,
        batch_date: batchDate,
        shift,
        notes: notes.trim() || null,
      })
      if (res.offline) {
        toast.offline('تم حفظ الإنتاج محلياً وستتم مزامنته.')
      } else {
        toast.success(`تم تسجيل الإنتاج — ${res.doc_number}`)
      }
      navigate('/production')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الإنتاج.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="دفعة إنتاج"
        subtitle="تسجيل إنتاج مع استهلاك المواد حسب الوصفة"
        backTo="/production"
        action={<Button onClick={() => void save()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
      />

      {/* معاينة حية لعملية الإنتاج */}
      <Card className="mb-3 border-info-200 bg-info-50 p-4">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 size-5 shrink-0 text-info-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-relaxed text-info-800">
              سيتحقق النظام من توفر المواد ويحسب الاستهلاك تلقائياً حسب الوصفة.
            </p>
            {selectedVersion && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                <PreviewRow label="الوصفة" value={selectedRecipe?.name ?? '—'} />
                <PreviewRow label="النسخة" value={`v${selectedVersion.version_no}`} />
                <PreviewRow label="مخرجات النسخة" value={`${formatQty(selectedVersion.output_quantity)} ${outputSymbol}`} />
                <PreviewRow label="معامل الدفعة" value={factor !== null ? `${formatQty(factor)} ×` : '—'} />
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="mb-3 space-y-3 p-4">
        <Field label="المنتج" required>
          <Select value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)}>
            <option value="">اختر المنتج...</option>
            {finishedProducts.map((p: Product) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="المخزن" required>
          <Select value={warehouseIdEffective ?? ''} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">اختر المخزن...</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </Field>

        <Field
          label="نسخة الوصفة"
          required
          hint={productId
            ? (selectedRecipe ? `الوصفة: ${selectedRecipe.name}` : 'اختر نسخة من القائمة')
            : 'حدد المنتج أولاً لعرض نسخ وصفته'}
        >
          <Select value={recipeVersionId ?? ''} onChange={(e) => setRecipeVersionId(e.target.value || null)} disabled={!productId}>
            <option value="">اختر النسخة...</option>
            {versionOptions.map((v: RecipeVersion) => (
              <option key={v.id} value={v.id}>
                {`النسخة ${v.version_no} — ${formatQty(v.output_quantity)}`}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="كمية الإنتاج" required hint={unitSymbol ? `الوحدة: ${unitSymbol}` : 'حدد المنتج أولاً لعرض الوحدة'}>
          <QuantityInput value={quantity} onChange={setQuantity} unit={unitSymbol} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="تاريخ الإنتاج" required>
            <DateInput value={batchDate} onChange={setBatchDate} />
          </Field>
          <Field label="الوردية">
            <Select value={shift} onChange={(e) => setShift(e.target.value)}>
              {SHIFTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="اختياري..." />
        </Field>
      </Card>

      <Card className="p-4">
        <Button className="w-full" size="lg" loading={saving} onClick={() => void save()} icon={<Save className="size-5" />}>
          حفظ دفعة الإنتاج
        </Button>
      </Card>
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-info-100 pb-1">
      <span className="shrink-0 text-2xs font-bold text-info-700">{label}</span>
      <span className="min-w-0 truncate text-2xs font-extrabold tabular-nums text-info-900">{value}</span>
    </div>
  )
}
