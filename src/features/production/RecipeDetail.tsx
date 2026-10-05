/**
 * تفاصيل الوصفة — إنشاء وصفة جديدة أو عرض النسخ وإضافة نسخة جديدة (بند 24/25).
 * كل دفعة إنتاج تحتفظ بنسخة الوصفة التي استخدمها — النسخ الجديدة لا تغيّر القديمة.
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Save, Plus, Trash2, Info, Copy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { lookups, refreshLookups } from '@/services/lookups'
import { useAuthStore } from '@/app/authStore'
import { useToast } from '@/lib/toast'
import { formatQty } from '@/lib/money'
import { fmtDateTime } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select, Badge } from '@/components/ui/primitives'
import { QuantityInput, SearchSelect, type SearchSelectOption } from '@/components/ui/inputs'
import { Modal } from '@/components/ui/overlays'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states'
import type { Product, Recipe, RecipeItem, RecipeVersion, Unit } from '@/types'

interface RecipeItemRow {
  material_id: string | null
  quantity: number | null
  unit_id: string
}

interface VersionWithItems extends RecipeVersion {
  recipe_items: (RecipeItem & { products: { name: string } | null })[] | null
}

interface RecipeWithVersions extends Recipe {
  products: { name: string } | null
  recipe_versions: VersionWithItems[] | null
}

function emptyItem(): RecipeItemRow {
  return { material_id: null, quantity: null, unit_id: '' }
}

export default function RecipeDetail() {
  const params = useParams()
  const id: string | undefined = params.id
  const isNew = !id || id === 'new'

  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const has = useAuthStore((s) => s.has)
  const canManage = has('recipes.manage')

  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])

  // ----- حالة نموذج الوصفة الجديدة -----
  const [name, setName] = useState('')
  const [productId, setProductId] = useState<string | null>(null)
  const [outputQuantity, setOutputQuantity] = useState<number | null>(null)
  const [outputUnitId, setOutputUnitId] = useState('')
  const [items, setItems] = useState<RecipeItemRow[]>([emptyItem()])
  const [saving, setSaving] = useState(false)

  // ----- حالة نموذج النسخة الجديدة (Modal) -----
  const [modalOpen, setModalOpen] = useState(false)
  const [vQuantity, setVQuantity] = useState<number | null>(null)
  const [vUnitId, setVUnitId] = useState('')
  const [vItems, setVItems] = useState<RecipeItemRow[]>([emptyItem()])

  // ----- الوصفة الموجودة -----
  const { data: recipe, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['recipe', id],
    enabled: !isNew,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select('*, products(name), recipe_versions(*, recipe_items(*, products(name)))')
        .eq('id', id)
        .single()
      if (error) throw new Error(error.message)
      return data as unknown as RecipeWithVersions
    },
  })

  const unitById = useMemo(() => new Map(units.map((u: Unit) => [u.id, u])), [units])
  const materialById = useMemo(() => new Map(products.map((p: Product) => [p.id, p])), [products])

  const finishedProducts = useMemo(
    () => products.filter((p: Product) => p.active && p.item_type === 'FINISHED_PRODUCT'),
    [products],
  )
  const rawMaterials = useMemo(
    () => products.filter((p: Product) => p.active && p.item_type === 'RAW_MATERIAL'),
    [products],
  )

  // تعيين وحدة المخرجات تلقائياً على الوحدة الأساسية للمنتج
  useEffect(() => {
    if (!productId) return
    const p = finishedProducts.find((x) => x.id === productId)
    if (p && !outputUnitId) setOutputUnitId(p.base_unit_id)
  }, [productId, finishedProducts, outputUnitId])

  const versions = useMemo(
    () => (recipe?.recipe_versions ? [...recipe.recipe_versions].sort((a, b) => b.version_no - a.version_no) : []),
    [recipe],
  )
  const latest = versions[0]
  const nextVersionNo = versions.reduce((m, v) => Math.max(m, v.version_no), 0) + 1

  function openVersionModal() {
    setVQuantity(latest?.output_quantity ?? null)
    setVUnitId(latest?.output_unit_id ?? '')
    setVItems([emptyItem()])
    setModalOpen(true)
  }

  // ---------- حفظ وصفة جديدة ----------
  async function saveNew() {
    const businessId = useAuthStore.getState().profile?.business_id
    if (!businessId) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!name.trim()) { toast.error('اكتب اسم الوصفة.'); return }
    if (!productId) { toast.error('اختر المنتج النهائي.'); return }
    if (!outputQuantity || outputQuantity <= 0) { toast.error('أدخل كمية المخرجات (أكبر من صفر).'); return }
    if (!outputUnitId) { toast.error('اختر وحدة المخرجات.'); return }
    const cleanItems: { material_id: string; quantity: number; unit_id: string }[] = []
    for (const it of items) {
      if (!it.material_id) { toast.error('اختر المادة في كل السطور.'); return }
      if (!it.quantity || it.quantity <= 0) { toast.error('أدخل كمية أكبر من صفر لكل مادة.'); return }
      if (!it.unit_id) { toast.error('اختر وحدة كل مادة.'); return }
      cleanItems.push({ material_id: it.material_id, quantity: it.quantity, unit_id: it.unit_id })
    }

    setSaving(true)
    try {
      const { data: recipeRow, error: recipeErr } = await supabase
        .from('recipes')
        .insert({ business_id: businessId, product_id: productId, name: name.trim() })
        .select('id')
        .single()
      if (recipeErr) throw new Error(recipeErr.message)
      const recipeId = (recipeRow as { id: string }).id

      const { data: versionRow, error: versionErr } = await supabase
        .from('recipe_versions')
        .insert({
          business_id: businessId, recipe_id: recipeId,
          version_no: 1, output_quantity: outputQuantity, output_unit_id: outputUnitId,
        })
        .select('id')
        .single()
      if (versionErr) throw new Error(versionErr.message)
      const versionId = (versionRow as { id: string }).id

      const { error: itemsErr } = await supabase
        .from('recipe_items')
        .insert(cleanItems.map((it) => ({ recipe_version_id: versionId, material_id: it.material_id, quantity: it.quantity, unit_id: it.unit_id })))
      if (itemsErr) throw new Error(itemsErr.message)

      void refreshLookups()
      void qc.invalidateQueries({ queryKey: ['recipes'] })
      toast.success('تم إنشاء الوصفة')
      navigate('/recipes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الوصفة.')
    } finally {
      setSaving(false)
    }
  }

  // ---------- حفظ نسخة جديدة لوصفة موجودة ----------
  async function saveVersion() {
    if (!id) return
    const businessId = useAuthStore.getState().profile?.business_id
    if (!businessId) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!vQuantity || vQuantity <= 0) { toast.error('أدخل كمية المخرجات (أكبر من صفر).'); return }
    if (!vUnitId) { toast.error('اختر وحدة المخرجات.'); return }
    const cleanItems: { material_id: string; quantity: number; unit_id: string }[] = []
    for (const it of vItems) {
      if (!it.material_id) { toast.error('اختر المادة في كل السطور.'); return }
      if (!it.quantity || it.quantity <= 0) { toast.error('أدخل كمية أكبر من صفر لكل مادة.'); return }
      if (!it.unit_id) { toast.error('اختر وحدة كل مادة.'); return }
      cleanItems.push({ material_id: it.material_id, quantity: it.quantity, unit_id: it.unit_id })
    }

    setSaving(true)
    try {
      const { data: versionRow, error: versionErr } = await supabase
        .from('recipe_versions')
        .insert({
          business_id: businessId, recipe_id: id,
          version_no: nextVersionNo, output_quantity: vQuantity, output_unit_id: vUnitId,
        })
        .select('id')
        .single()
      if (versionErr) throw new Error(versionErr.message)
      const versionId = (versionRow as { id: string }).id

      const { error: itemsErr } = await supabase
        .from('recipe_items')
        .insert(cleanItems.map((it) => ({ recipe_version_id: versionId, material_id: it.material_id, quantity: it.quantity, unit_id: it.unit_id })))
      if (itemsErr) throw new Error(itemsErr.message)

      void refreshLookups()
      void qc.invalidateQueries({ queryKey: ['recipe', id] })
      void qc.invalidateQueries({ queryKey: ['recipes'] })
      toast.success(`تم إنشاء النسخة v${nextVersionNo}`)
      setModalOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ النسخة.')
    } finally {
      setSaving(false)
    }
  }

  // ================= وصفة جديدة =================
  if (isNew) {
    if (!canManage) {
      return (
        <div className="pb-4">
          <PageHeader title="وصفة جديدة" backTo="/recipes" />
          <Card>
            <EmptyState title="لا توجد صلاحية" message="ليس لديك صلاحية لإدارة الوصفات — تواصل مع المدير." />
          </Card>
        </div>
      )
    }
    return (
      <div className="pb-4">
        <PageHeader
          title="وصفة جديدة"
          subtitle="المكونات وكمية المخرجات — النسخة الأولى v1"
          backTo="/recipes"
          action={<Button onClick={() => void saveNew()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
        />

        <Card className="mb-3 space-y-3 p-4">
          <Field label="اسم الوصفة" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: وصفة خبز عربي قياسي" />
          </Field>

          <Field label="المنتج" required>
            <Select value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)}>
              <option value="">اختر المنتج النهائي...</option>
              {finishedProducts.map((p: Product) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="كمية المخرجات" required>
              <QuantityInput value={outputQuantity} onChange={setOutputQuantity} />
            </Field>
            <Field label="وحدة المخرجات" required>
              <Select value={outputUnitId} onChange={(e) => setOutputUnitId(e.target.value)}>
                <option value="">اختر الوحدة...</option>
                {units.map((u: Unit) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <p className="mb-2 px-1 text-xs font-bold text-stone-500">المواد الخام (<span className="tabular-nums">{items.length}</span>)</p>
        <ItemsEditor rows={items} onChange={setItems} materials={rawMaterials} units={units} />

        <Card className="mt-3 p-4">
          <Button className="w-full" size="lg" loading={saving} onClick={() => void saveNew()} icon={<Save className="size-5" />}>
            حفظ الوصفة
          </Button>
        </Card>
      </div>
    )
  }

  // ================= وصفة موجودة =================
  return (
    <div className="pb-4">
      <PageHeader
        title={recipe?.name ?? 'الوصفة'}
        subtitle={recipe ? `المنتج: ${recipe.products?.name ?? '—'}` : ''}
        backTo="/recipes"
        action={canManage ? <Button onClick={openVersionModal} icon={<Copy className="size-4" />}>نسخة جديدة</Button> : undefined}
      />

      {isLoading ? (
        <Card><LoadingState /></Card>
      ) : isError || !recipe ? (
        <Card>
          <ErrorState
            message={error instanceof Error ? error.message : 'تعذر تحميل الوصفة.'}
            onRetry={() => void refetch()}
          />
        </Card>
      ) : (
        <>
          <Card className="mb-3 flex items-center gap-3 border-info-200 bg-info-50 p-3.5">
            <Info className="size-5 shrink-0 text-info-600" />
            <p className="text-xs font-bold leading-relaxed text-info-800">
              الإنتاج القديم يحتفظ بنسخة الوصفة التي استخدمها (بند 25).
            </p>
          </Card>

          {versions.length === 0 ? (
            <Card>
              <EmptyState
                title="لا توجد نسخ بعد"
                message="أضف نسخة أولى بتحديد كمية المخرجات والمواد الخام."
                action={canManage ? <Button onClick={openVersionModal} icon={<Plus className="size-4" />}>نسخة جديدة</Button> : undefined}
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {versions.map((v) => (
                <Card key={v.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={v.id === latest?.id ? 'primary' : 'neutral'}>النسخة v{v.version_no}</Badge>
                      {v.id === latest?.id && <Badge tone="success">الأحدث</Badge>}
                    </div>
                    <span className="shrink-0 text-2xs text-stone-400">{fmtDateTime(v.created_at)}</span>
                  </div>
                  <p className="mt-2.5 text-xs font-bold text-stone-700">
                    المخرجات:{' '}
                    <span className="tabular-nums">{formatQty(v.output_quantity)}</span>{' '}
                    <span className="font-bold text-stone-400">{unitById.get(v.output_unit_id)?.symbol ?? ''}</span>
                  </p>
                  <div className="mt-3 space-y-1.5 border-t border-stone-100 pt-3">
                    {(v.recipe_items ?? []).map((it) => (
                      <div key={it.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate font-bold text-stone-700">
                          {it.products?.name ?? materialById.get(it.material_id)?.name ?? '—'}
                        </span>
                        <span className="shrink-0 tabular-nums text-stone-500">
                          {formatQty(it.quantity)} {unitById.get(it.unit_id)?.symbol ?? ''}
                        </span>
                      </div>
                    ))}
                    {(v.recipe_items ?? []).length === 0 && (
                      <p className="text-2xs text-stone-400">لا توجد مواد في هذه النسخة.</p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* نموذج النسخة الجديدة */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`نسخة جديدة — v${nextVersionNo}`} wide>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="كمية المخرجات" required>
              <QuantityInput value={vQuantity} onChange={setVQuantity} />
            </Field>
            <Field label="وحدة المخرجات" required>
              <Select value={vUnitId} onChange={(e) => setVUnitId(e.target.value)}>
                <option value="">اختر الوحدة...</option>
                {units.map((u: Unit) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <ItemsEditor rows={vItems} onChange={setVItems} materials={rawMaterials} units={units} />
          <Button className="w-full" size="lg" loading={saving} onClick={() => void saveVersion()} icon={<Save className="size-5" />}>
            حفظ النسخة
          </Button>
        </div>
      </Modal>
    </div>
  )
}

/** محرر بنود المواد — مشترك بين نموذج الوصفة الجديدة ونموذج النسخة الجديدة */
function ItemsEditor({ rows, onChange, materials, units }: {
  rows: RecipeItemRow[]
  onChange: (rows: RecipeItemRow[]) => void
  materials: Product[]
  units: Unit[]
}) {
  const materialOptions: SearchSelectOption[] = useMemo(
    () => materials.map((p) => ({ value: p.id, label: p.name, sublabel: p.code })),
    [materials],
  )

  function updateRow(idx: number, patch: Partial<RecipeItemRow>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function selectMaterial(idx: number, value: string | null) {
    onChange(
      rows.map((r, i) => {
        if (i !== idx) return r
        const p = materials.find((m) => m.id === value)
        // تعيين وحدة المادة تلقائياً على وحدها الأساسية
        return { ...r, material_id: value, unit_id: p ? p.base_unit_id : r.unit_id }
      }),
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <Card key={idx} className="space-y-2.5 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs font-bold text-stone-400">مادة {idx + 1}</span>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, i) => i !== idx))}
              className="rounded-lg p-1.5 text-stone-300 transition hover:bg-danger-50 hover:text-danger-600"
              aria-label="حذف المادة"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <SearchSelect
            options={materialOptions}
            value={row.material_id}
            onChange={(v) => selectMaterial(idx, v)}
            placeholder="اختر المادة الخام..."
            emptyText="لا توجد مواد خام"
          />
          <div className="grid grid-cols-2 gap-2">
            <Field label="الكمية" required>
              <QuantityInput value={row.quantity} onChange={(v) => updateRow(idx, { quantity: v })} />
            </Field>
            <Field label="الوحدة" required>
              <Select value={row.unit_id} onChange={(e) => updateRow(idx, { unit_id: e.target.value })}>
                <option value="">اختر...</option>
                {units.map((u: Unit) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      ))}
      <Button
        variant="outline"
        size="sm"
        icon={<Plus className="size-4" />}
        onClick={() => onChange([...rows, emptyItem()])}
      >
        إضافة مادة
      </Button>
    </div>
  )
}
