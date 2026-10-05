/**
 * تفاصيل حمولة التوزيع (بند 29/30/31) — أغنى شاشة في النظام:
 * (أ) المحمولات (ب) المبيعات/التسليمات (ج) المرتجعات (د) معادلة المطابقة لكل صنف:
 *     المحمول = المبيع + المرتجع + الفرق
 * مع تسجيل بيع/مرتجع أثناء الجولة وتسوية الحمولة بقواعد الفروق (لا إغلاق بفروق غير مبررة).
 */
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useParams } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, ShoppingCart, Undo2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { lookups } from '@/services/lookups'
import { distributionService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { useAuthStore } from '@/app/authStore'
import { formatMoney, formatQty, roundMoney, roundQty, sumMoney } from '@/lib/money'
import { fmtDate, todayISO } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select, StatusBadge, Textarea } from '@/components/ui/primitives'
import { MoneyInput, QuantityInput, SearchSelect } from '@/components/ui/inputs'
import { Modal } from '@/components/ui/overlays'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { PaymentType, Product, Unit } from '@/types'

interface LoadItemRow {
  id: string; product_id: string; quantity: number; unit_id: string
  products: { name: string } | null; units: { symbol: string } | null
}
interface DeliveryRow {
  id: string; product_id: string; quantity: number; unit_price: number; total: number
  payment_type: string; delivery_date: string
  customers: { name: string } | null; products: { name: string } | null
}
interface ReturnRow {
  id: string; product_id: string; quantity: number; reason: string | null; return_date: string
  products: { name: string } | null
}
interface SettlementRow {
  id: string; doc_number: string; settlement_date: string
  loaded_qty: number; sold_qty: number; returned_qty: number; unaccounted_qty: number
  cash_collected: number; credit_total: number; cash_expected: number; cash_variance: number
  variance_note: string | null
}
interface LoadRow {
  id: string; doc_number: string; load_date: string; status: string; notes: string | null
  vehicles: { name: string } | null
  drivers: { name: string } | null
  distribution_items: LoadItemRow[] | null
  distribution_deliveries: DeliveryRow[] | null
  distribution_returns: ReturnRow[] | null
  distribution_settlements: SettlementRow[] | null
}

interface ReconRow {
  product_id: string
  name: string
  loaded: number
  sold: number
  returned: number
  unaccounted: number
}

export default function LoadDetail() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const queryClient = useQueryClient()
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)

  // بيانات مرجعية من الكاش المحلي (تعمل أوفلاين)
  const products = useLiveQuery(async () => lookups.products(), [], [])
  const units = useLiveQuery(async () => lookups.units(), [], [])
  const customers = useLiveQuery(async () => lookups.customers(), [], [])
  const productById = useMemo(() => new Map(products.map((p: Product) => [p.id, p])), [products])
  const unitById = useMemo(() => new Map(units.map((u: Unit) => [u.id, u])), [units])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['load', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('distribution_loads')
        .select(`*, vehicles(name), drivers(name), distribution_items(*, products(name), units(symbol)),
          distribution_deliveries(*, customers(name), products(name)), distribution_returns(*, products(name)),
          distribution_settlements(*)`)
        .eq('id', id as string)
        .single()
      if (error) throw new Error(error.message)
      return data as unknown as LoadRow
    },
  })

  const items = useMemo(() => data?.distribution_items ?? [], [data])
  const deliveries = useMemo(() => data?.distribution_deliveries ?? [], [data])
  const returns = useMemo(() => data?.distribution_returns ?? [], [data])
  const settlement = data?.distribution_settlements?.[0] ?? null
  const isSettled = data?.status === 'SETTLED'

  // معادلة المطابقة لكل صنف: المحمول = المبيع + المرتجع + الفرق
  const recon: ReconRow[] = useMemo(() => {
    const ids: string[] = []
    for (const i of items) if (!ids.includes(i.product_id)) ids.push(i.product_id)
    return ids.map((pid) => {
      const loaded = roundQty(items.filter((i) => i.product_id === pid).reduce((a, i) => a + i.quantity, 0))
      const sold = roundQty(deliveries.filter((d) => d.product_id === pid).reduce((a, d) => a + d.quantity, 0))
      const returned = roundQty(returns.filter((r) => r.product_id === pid).reduce((a, r) => a + r.quantity, 0))
      const name = items.find((i) => i.product_id === pid)?.products?.name
        ?? deliveries.find((d) => d.product_id === pid)?.products?.name
        ?? returns.find((r) => r.product_id === pid)?.products?.name ?? '—'
      return { product_id: pid, name, loaded, sold, returned, unaccounted: roundQty(loaded - sold - returned) }
    })
  }, [items, deliveries, returns])

  const cashExpected = useMemo(
    () => sumMoney(deliveries.filter((d) => d.payment_type === 'CASH').map((d) => d.total)),
    [deliveries],
  )
  const creditTotal = useMemo(
    () => sumMoney(deliveries.filter((d) => d.payment_type === 'CREDIT').map((d) => d.total)),
    [deliveries],
  )
  const hasQtyMismatch = recon.some((r) => r.unaccounted !== 0)

  // ----- حالة المودالات -----
  const [deliverOpen, setDeliverOpen] = useState(false)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [deliveryProductId, setDeliveryProductId] = useState<string | null>(null)
  const [deliveryQty, setDeliveryQty] = useState<number | null>(null)
  const [unitPrice, setUnitPrice] = useState<number | null>(null)
  const [paymentType, setPaymentType] = useState<PaymentType>('CASH')
  const [busy, setBusy] = useState(false)

  const [returnOpen, setReturnOpen] = useState(false)
  const [returnProductId, setReturnProductId] = useState<string | null>(null)
  const [returnQty, setReturnQty] = useState<number | null>(null)
  const [returnReason, setReturnReason] = useState('')

  const [settleOpen, setSettleOpen] = useState(false)
  const [cashCollected, setCashCollected] = useState<number | null>(null)
  const [varianceNote, setVarianceNote] = useState('')

  const cashVariance = roundMoney(cashExpected - (cashCollected ?? 0))
  const needNote = hasQtyMismatch || cashVariance !== 0
  const noteValid = varianceNote.trim().length >= 3

  const customerOptions = useMemo(
    () => customers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, sublabel: c.phone ?? c.area ?? '' })),
    [customers],
  )
  const loadProductOptions = useMemo(
    () => recon.map((r) => ({ value: r.product_id, label: r.name, sublabel: `متبقي على السيارة: ${formatQty(roundQty(r.loaded - r.sold - r.returned))}` })),
    [recon],
  )

  function resolveUnitId(pid: string | null): string {
    if (!pid) return ''
    const p = productById.get(pid)
    const unitId = p?.sales_unit_id ?? p?.base_unit_id
    if (unitId) return unitId
    return items.find((i) => i.product_id === pid)?.unit_id ?? ''
  }

  function unitSymbol(pid: string | null): string {
    const uid = resolveUnitId(pid)
    return uid ? unitById.get(uid)?.symbol ?? '' : ''
  }

  function openDeliver() {
    setCustomerId(null); setDeliveryProductId(null); setDeliveryQty(null)
    setUnitPrice(null); setPaymentType('CASH')
    setDeliverOpen(true)
  }

  function openReturn() {
    setReturnProductId(null); setReturnQty(null); setReturnReason('')
    setReturnOpen(true)
  }

  function openSettle() {
    setCashCollected(cashExpected)
    setVarianceNote('')
    setSettleOpen(true)
  }

  function pickDeliveryProduct(pid: string | null) {
    setDeliveryProductId(pid)
    const p = pid ? productById.get(pid) : undefined
    setUnitPrice(p?.sale_price ?? 0)
  }

  async function afterOp() {
    void queryClient.invalidateQueries({ queryKey: ['load', id] })
    void queryClient.invalidateQueries({ queryKey: ['loads'] })
    void queryClient.invalidateQueries({ queryKey: ['sales'] })
  }

  async function submitDeliver() {
    if (!id) return
    if (!customerId) { toast.error('اختر عميلاً.'); return }
    if (!deliveryProductId) { toast.error('اختر صنفاً من محمولات الحمولة.'); return }
    if ((deliveryQty ?? 0) <= 0) { toast.error('الكمية يجب أن تكون أكبر من صفر.'); return }
    const unitId = resolveUnitId(deliveryProductId)
    if (!unitId) { toast.error('تعذر تحديد وحدة البيع للصنف.'); return }

    setBusy(true)
    try {
      const res = await distributionService.deliver({
        load_id: id,
        customer_id: customerId,
        product_id: deliveryProductId,
        quantity: deliveryQty as number,
        unit_id: unitId,
        unit_price: unitPrice ?? 0,
        payment_type: paymentType,
        delivery_date: todayISO(),
      })
      if (res.offline) toast.offline('تم حفظ البيع محلياً وستتم مزامنته عند عودة الإنترنت.')
      else if (res.duplicate) toast.info('هذه العملية مسجلة مسبقاً — لن يتم تكرارها.')
      else toast.success(`تم تسجيل البيع — ${res.doc_number}`)
      setDeliverOpen(false)
      await afterOp()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تسجيل البيع.')
    } finally {
      setBusy(false)
    }
  }

  async function submitReturn() {
    if (!id) return
    if (!returnProductId) { toast.error('اختر صنفاً من محمولات الحمولة.'); return }
    if ((returnQty ?? 0) <= 0) { toast.error('الكمية يجب أن تكون أكبر من صفر.'); return }
    const unitId = items.find((i) => i.product_id === returnProductId)?.unit_id ?? resolveUnitId(returnProductId)
    if (!unitId) { toast.error('تعذر تحديد وحدة الصنف.'); return }

    setBusy(true)
    try {
      const res = await distributionService.returnGoods({
        load_id: id,
        product_id: returnProductId,
        quantity: returnQty as number,
        unit_id: unitId,
        reason: returnReason.trim() || null,
        return_date: todayISO(),
      })
      if (res.offline) toast.offline('تم حفظ المرتجع محلياً وستتم مزامنته عند عودة الإنترنت.')
      else if (res.duplicate) toast.info('هذه العملية مسجلة مسبقاً — لن يتم تكرارها.')
      else toast.success('تم تسجيل المرتجع وإرجاع الكمية للمستودع.')
      setReturnOpen(false)
      await afterOp()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تسجيل المرتجع.')
    } finally {
      setBusy(false)
    }
  }

  async function submitSettle() {
    if (!id) return
    if (needNote && !noteValid) {
      toast.error('سجل سبب الفرق قبل التسوية (3 أحرف على الأقل).')
      return
    }
    setBusy(true)
    try {
      const res = await distributionService.settle(id, cashCollected ?? 0, noteValid ? varianceNote.trim() : null)
      toast.success(`تمت التسوية — ${res.doc_number}`)
      setSettleOpen(false)
      await afterOp()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إتمام التسوية.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <LoadingState label="جارٍ تحميل الحمولة..." />
  if (isError || !data) {
    return <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل الحمولة.'} />
  }

  const notSettledYet = !isSettled

  return (
    <div className="pb-4">
      <PageHeader
        title={`حمولة ${data.doc_number}`}
        subtitle={`${data.vehicles?.name ?? '—'} • ${data.drivers?.name ?? 'بدون سائق'} • ${fmtDate(data.load_date)}`}
        backTo="/distribution"
        action={<StatusBadge status={data.status} />}
      />

      {/* أزرار العمل أثناء الجولة */}
      {notSettledYet && (
        <Card className="mb-3 flex flex-wrap gap-2 p-3">
          {has('distribution.manage') && (
            <>
              <Button icon={<ShoppingCart className="size-4" />} onClick={openDeliver}>تسجيل بيع</Button>
              <Button variant="outline" icon={<Undo2 className="size-4" />} onClick={openReturn}>تسجيل مرتجع</Button>
            </>
          )}
          {has('distribution.settle') && (
            <Button variant="success" icon={<BadgeCheck className="size-4" />} onClick={openSettle}>تسوية الحمولة</Button>
          )}
        </Card>
      )}

      {/* (أ) المحمولات */}
      <Card className="mb-3 overflow-hidden">
        <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-stone-800">المحمولات</h2>
        <DataTable
          rows={items}
          keyOf={(r) => r.id}
          emptyTitle="لا توجد محمولات"
          columns={[
            { key: 'product', header: 'صنف', render: (r) => <span className="font-bold text-stone-800">{r.products?.name ?? '—'}</span> },
            { key: 'qty', header: 'كمية', className: 'tabular-nums', render: (r) => formatQty(r.quantity) },
            { key: 'unit', header: 'وحدة', render: (r) => r.units?.symbol ?? '—' },
          ]}
        />
      </Card>

      {/* (ب) المبيعات/التسليمات */}
      <Card className="mb-3 overflow-hidden">
        <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-stone-800">المبيعات / التسليمات</h2>
        <DataTable
          rows={deliveries}
          keyOf={(r) => r.id}
          emptyTitle="لا توجد مبيعات بعد"
          emptyMessage="سجّل بيعاً من أزرار الجولة أعلاه."
          columns={[
            { key: 'customer', header: 'عميل', render: (r) => <span className="font-bold text-stone-800">{r.customers?.name ?? '—'}</span> },
            { key: 'product', header: 'صنف', render: (r) => r.products?.name ?? '—' },
            { key: 'qty', header: 'كمية', className: 'tabular-nums', render: (r) => formatQty(r.quantity) },
            { key: 'price', header: 'سعر', className: 'tabular-nums', render: (r) => formatMoney(r.unit_price, currency) },
            { key: 'total', header: 'إجمالي', className: 'font-bold tabular-nums', render: (r) => formatMoney(r.total, currency) },
            { key: 'payment', header: 'الدفع', render: (r) => <StatusBadge status={r.payment_type} /> },
            { key: 'date', header: 'التاريخ', render: (r) => fmtDate(r.delivery_date), hideOnMobile: true },
          ]}
        />
      </Card>

      {/* (ج) المرتجعات */}
      <Card className="mb-3 overflow-hidden">
        <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-stone-800">المرتجعات</h2>
        <DataTable
          rows={returns}
          keyOf={(r) => r.id}
          emptyTitle="لا توجد مرتجعات"
          columns={[
            { key: 'product', header: 'صنف', render: (r) => <span className="font-bold text-stone-800">{r.products?.name ?? '—'}</span> },
            { key: 'qty', header: 'كمية', className: 'tabular-nums', render: (r) => formatQty(r.quantity) },
            { key: 'reason', header: 'السبب', render: (r) => r.reason ?? '—' },
            { key: 'date', header: 'التاريخ', render: (r) => fmtDate(r.return_date) },
          ]}
        />
      </Card>

      {/* (د) معادلة المطابقة */}
      <Card className="mb-3 overflow-hidden">
        <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-stone-800">
          معادلة المطابقة — المحمول = المبيع + المرتجع + الفرق
        </h2>
        {recon.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-stone-400">لا توجد أصناف للمطابقة.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {recon.map((r) => (
              <div key={r.product_id} className="grid grid-cols-5 items-center gap-2 px-4 py-3 text-center">
                <p className="col-span-5 truncate text-start text-xs font-extrabold text-stone-800 sm:col-span-1">{r.name}</p>
                <ReconCell label="المحمول" value={formatQty(r.loaded)} />
                <ReconCell label="المبيع" value={formatQty(r.sold)} tone="success" />
                <ReconCell label="المرتجع" value={formatQty(r.returned)} tone="warning" />
                <ReconCell label="الفرق" value={formatQty(r.unaccounted)} tone={r.unaccounted !== 0 ? 'danger' : undefined} />
              </div>
            ))}
            {hasQtyMismatch && (
              <p className="flex items-center gap-2 bg-danger-50 px-4 py-2.5 text-2xs font-bold text-danger-700">
                <AlertTriangle className="size-4 shrink-0" />
                يوجد فرق كمية غير مبرر — يجب تفسيره بمرتجع أو تسجيل سبب عند التسوية.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* كارت التسوية بعد الإقفال */}
      {isSettled && settlement && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <h2 className="text-sm font-extrabold text-stone-800">تسوية الحمولة {settlement.doc_number}</h2>
            <StatusBadge status="SETTLED" />
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <Cell label="المحمول" value={formatQty(settlement.loaded_qty)} />
            <Cell label="المبيع" value={formatQty(settlement.sold_qty)} />
            <Cell label="المرتجع" value={formatQty(settlement.returned_qty)} />
            <Cell label="غير مفسّر" value={formatQty(settlement.unaccounted_qty)} danger={settlement.unaccounted_qty !== 0} />
            <Cell label="النقد المتوقع" value={formatMoney(settlement.cash_expected, currency)} />
            <Cell label="النقد المحصّل" value={formatMoney(settlement.cash_collected, currency)} />
            <Cell label="فرق النقد" value={formatMoney(settlement.cash_variance, currency)} danger={settlement.cash_variance !== 0} />
            <Cell label="مبيع آجل" value={formatMoney(settlement.credit_total, currency)} />
          </div>
          <div className="border-t border-stone-100 px-4 py-3">
            <p className="text-2xs font-bold text-stone-400">سبب الفروق</p>
            <p className="mt-0.5 text-xs text-stone-700">{settlement.variance_note ?? 'لا يوجد — تمت التسوية دون فروق.'}</p>
          </div>
          {data.notes && (
            <p className="border-t border-stone-100 px-4 py-3 text-2xs text-stone-500">ملاحظات الحمولة: {data.notes}</p>
          )}
        </Card>
      )}

      {/* مودال تسجيل بيع */}
      <Modal open={deliverOpen} onClose={() => setDeliverOpen(false)} title="تسجيل بيع من الحمولة">
        <div className="space-y-3">
          <Field label="العميل" required>
            <SearchSelect options={customerOptions} value={customerId} onChange={setCustomerId} placeholder="اختر عميلاً..." emptyText="لا يوجد عملاء" />
          </Field>
          <Field label="الصنف (من المحمولات)" required>
            <Select value={deliveryProductId ?? ''} onChange={(e) => pickDeliveryProduct(e.target.value || null)}>
              <option value="">اختر صنفاً...</option>
              {loadProductOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الكمية" required>
              <QuantityInput value={deliveryQty} onChange={setDeliveryQty} unit={unitSymbol(deliveryProductId)} placeholder="0" />
            </Field>
            <Field label="سعر الوحدة" required>
              <MoneyInput value={unitPrice} onChange={setUnitPrice} currencySymbol={currency} />
            </Field>
          </div>
          <Field label="نوع الدفع" required>
            <div className="grid grid-cols-2 gap-2">
              <PayToggle active={paymentType === 'CASH'} onClick={() => setPaymentType('CASH')} label="نقدي" />
              <PayToggle active={paymentType === 'CREDIT'} onClick={() => setPaymentType('CREDIT')} label="آجل" />
            </div>
          </Field>
          <div className="flex justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm">
            <span className="font-bold text-stone-500">إجمالي السطر</span>
            <span className="font-extrabold tabular-nums text-stone-900">{formatMoney((deliveryQty ?? 0) * (unitPrice ?? 0), currency)}</span>
          </div>
          <Button className="w-full" loading={busy} onClick={() => void submitDeliver()} icon={<ShoppingCart className="size-4" />}>
            حفظ البيع
          </Button>
        </div>
      </Modal>

      {/* مودال تسجيل مرتجع */}
      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="تسجيل مرتجع إلى الحمولة">
        <div className="space-y-3">
          <Field label="الصنف (من المحمولات)" required>
            <Select value={returnProductId ?? ''} onChange={(e) => setReturnProductId(e.target.value || null)}>
              <option value="">اختر صنفاً...</option>
              {loadProductOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="الكمية" required>
            <QuantityInput value={returnQty} onChange={setReturnQty} unit={unitSymbol(returnProductId)} placeholder="0" />
          </Field>
          <Field label="السبب" hint="اختياري — مثال: لم يُباع / تالف">
            <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="سبب الإرجاع..." />
          </Field>
          <Button className="w-full" variant="outline" loading={busy} onClick={() => void submitReturn()} icon={<Undo2 className="size-4" />}>
            حفظ المرتجع
          </Button>
        </div>
      </Modal>

      {/* مودال تسوية الحمولة */}
      <Modal open={settleOpen} onClose={() => setSettleOpen(false)} title="تسوية الحمولة">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-stone-50 p-3 text-center">
            <div>
              <p className="text-2xs font-bold text-stone-400">النقد المتوقع</p>
              <p className="text-sm font-extrabold tabular-nums text-stone-900">{formatMoney(cashExpected, currency)}</p>
            </div>
            <div>
              <p className="text-2xs font-bold text-stone-400">المبيع الآجل</p>
              <p className="text-sm font-extrabold tabular-nums text-stone-900">{formatMoney(creditTotal, currency)}</p>
            </div>
          </div>
          <Field label="النقد المحصّل فعلياً" required>
            <MoneyInput value={cashCollected} onChange={setCashCollected} currencySymbol={currency} />
          </Field>
          {(needNote || cashVariance !== 0) && (
            <div className="space-y-1.5">
              {hasQtyMismatch && (
                <p className="flex items-start gap-1.5 rounded-lg bg-danger-50 px-3 py-2 text-2xs font-bold leading-relaxed text-danger-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  يوجد فرق كمية غير مبرر ({formatQty(roundQty(recon.reduce((a, r) => a + r.unaccounted, 0)))}) — سجّل سببه قبل التسوية.
                </p>
              )}
              {cashVariance !== 0 && (
                <p className="flex items-start gap-1.5 rounded-lg bg-danger-50 px-3 py-2 text-2xs font-bold leading-relaxed text-danger-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  فرق نقدي {formatMoney(cashVariance, currency)} — سجّل سببه قبل التسوية.
                </p>
              )}
            </div>
          )}
          <Field label="ملاحظة الفروق" required={needNote} hint={needNote ? 'إلزامية عند وجود أي فرق (3 أحرف على الأقل)' : 'اختيارية'}>
            <Textarea
              value={varianceNote}
              onChange={(e) => setVarianceNote(e.target.value)}
              placeholder="سبب الفروق إن وجدت..."
              rows={2}
            />
          </Field>
          <Button
            className="w-full" variant="success" loading={busy}
            disabled={needNote && !noteValid}
            onClick={() => void submitSettle()} icon={<BadgeCheck className="size-4" />}
          >
            إتمام التسوية
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function ReconCell({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' | 'danger' | undefined }) {
  const cls = tone === 'danger' ? 'text-danger-600'
    : tone === 'success' ? 'text-success-700'
    : tone === 'warning' ? 'text-warning-700'
    : 'text-stone-900'
  return (
    <div>
      <p className="text-2xs font-bold text-stone-400">{label}</p>
      <p className={`text-sm font-extrabold tabular-nums ${cls}`}>{value}</p>
    </div>
  )
}

function Cell({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <p className="text-2xs font-bold text-stone-400">{label}</p>
      <p className={`text-sm font-extrabold tabular-nums ${danger ? 'text-danger-600' : 'text-stone-900'}`}>{value}</p>
    </div>
  )
}

function PayToggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 items-center justify-center rounded-lg border text-xs font-extrabold transition ${
        active ? 'border-primary-600 bg-primary-600 text-white' : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
      }`}
    >
      {label}
    </button>
  )
}
