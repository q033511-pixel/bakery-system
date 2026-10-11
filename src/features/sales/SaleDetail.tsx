/**
 * تفاصيل فاتورة البيع (بند 20/38): الأصناف والإجماليات وتكلفة المواد،
 * وإلغاء البيع (VOID) بصلاحية وسبب إلزامي — الإلغاء يعكس الحركات على الخادم.
 * فواتير قناة التوزيع لا تُلغى مباشرة — تُعالج عبر تسوية الحمولة (بند 31).
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Ban, Info, ShieldAlert, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { salesService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { useAuthStore } from '@/app/authStore'
import { formatMoney, sumMoney } from '@/lib/money'
import { fmtDateTime } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, StatusBadge } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlays'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Sale, SaleItem } from '@/types'

type SaleRow = Omit<Sale, 'items'> & {
  customers: { name: string } | null
  sale_items: (SaleItem & { products: { name: string } | null; units: { symbol: string } | null })[] | null
}

export default function SaleDetail() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const queryClient = useQueryClient()
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)
  const business = useAuthStore((s) => s.business)

  const [voidOpen, setVoidOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sale', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('*, customers(name), sale_items(*, products(name), units(symbol))')
        .eq('id', id as string)
        .single()
      if (error) throw new Error(error.message)
      return data as unknown as SaleRow
    },
  })

  async function submitVoid() {
    if (!id) return
    if (reason.trim().length < 3) {
      toast.error('اكتب سبب الإلغاء (3 أحرف على الأقل).')
      return
    }
    setSaving(true)
    try {
      await salesService.void(id, reason.trim())
      toast.success('تم إلغاء البيع وعكس حركاته.')
      setVoidOpen(false)
      setReason('')
      void queryClient.invalidateQueries({ queryKey: ['sale', id] })
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إلغاء الفاتورة.')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <LoadingState label="جارٍ تحميل الفاتورة..." />
  if (isError || !data) {
    return <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل الفاتورة.'} />
  }

  const items = data.sale_items ?? []
  const itemsSum = sumMoney(items.map((i) => i.total))
  const isDistribution = data.channel === 'DISTRIBUTION'
  const canVoid = has('sales.void') && data.status === 'CONFIRMED' && !isDistribution
  const canPrint = data.status === 'CONFIRMED'

  const printReceipt = () => {
    document.body.classList.add('printing-receipt')
    window.print()
    setTimeout(() => document.body.classList.remove('printing-receipt'), 600)
  }

  return (
    <div className="pb-4">
      <div className="print-hide">
      <PageHeader
        title={`فاتورة ${data.doc_number}`}
        subtitle={fmtDateTime(data.created_at)}
        backTo="/sales"
        action={
          <div className="flex gap-2">
            {canPrint && (
              <Button variant="outline" icon={<Printer className="size-4" />} onClick={printReceipt}>
                طباعة
              </Button>
            )}
            {canVoid && (
              <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setVoidOpen(true)}>
                إلغاء البيع
              </Button>
            )}
          </div>
        }
      />

      {/* لافتات الحالة */}
      {data.status === 'VOIDED' && (
        <Card className="mb-3 flex items-center gap-3 border-danger-200 bg-danger-50 p-3.5">
          <ShieldAlert className="size-5 shrink-0 text-danger-600" />
          <p className="text-xs font-bold leading-relaxed text-danger-800">
            هذه الفاتورة ملغاة — عُكست حركات المخزون والصندوق تلقائياً ولا تؤثر على الأرصدة.
          </p>
        </Card>
      )}
      {isDistribution && (
        <Card className="mb-3 flex items-center gap-3 border-info-200 bg-info-50 p-3.5">
          <Info className="size-5 shrink-0 text-info-600" />
          <p className="text-xs font-bold leading-relaxed text-info-800">
            فاتورة توزيع — مرتبطة بحمولة، الإلغاء عبر تسوية الحمولة.
          </p>
        </Card>
      )}

      {/* بيانات عامة */}
      <Card className="mb-3 grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <InfoCell label="العميل" value={data.customers?.name ?? 'عميل نقدي'} />
        <InfoCell label="تاريخ البيع" value={fmtDateTime(data.sale_date)} />
        <InfoCell label="نوع الدفع" value={<StatusBadge status={data.payment_type} />} />
        <InfoCell label="الحالة" value={<StatusBadge status={data.status} />} />
      </Card>

      {/* الأصناف */}
      <Card className="mb-3 overflow-hidden">
        <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-stone-800">أصناف الفاتورة</h2>
        <DataTable
          rows={items}
          keyOf={(r) => r.id}
          emptyTitle="لا توجد أصناف"
          columns={[
            { key: 'product', header: 'صنف', render: (r) => <span className="font-bold text-stone-800">{r.products?.name ?? '—'}</span> },
            { key: 'qty', header: 'كمية', className: 'tabular-nums', render: (r) => r.quantity },
            { key: 'unit', header: 'وحدة', render: (r) => r.units?.symbol ?? '—' },
            { key: 'price', header: 'سعر', className: 'tabular-nums', render: (r) => formatMoney(r.unit_price, currency) },
            { key: 'total', header: 'إجمالي', className: 'font-bold tabular-nums', render: (r) => formatMoney(r.total, currency) },
          ]}
        />
      </Card>

      {/* الإجماليات */}
      <Card className="space-y-2.5 p-4">
        <TotalRow label="المجموع" value={formatMoney(itemsSum, currency)} />
        <TotalRow label="الخصم" value={formatMoney(data.discount, currency)} />
        <TotalRow label="الإجمالي" value={formatMoney(data.total, currency)} strong />
        <div className="border-t border-stone-200 pt-2.5">
          <TotalRow label="تكلفة المواد" value={formatMoney(data.cost_total, currency)} />
        </div>
        {data.notes && (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-2xs leading-relaxed text-stone-500">{data.notes}</p>
        )}
      </Card>

      {/* مودال الإلغاء */}
      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="إلغاء البيع">
        <p className="mb-3 text-xs leading-relaxed text-stone-500">
          سيُعكس إجمالي الفاتورة من الصندوق (إن كان نقدياً) وتُعاد الكميات للمخزون. لا يمكن التراجع.
        </p>
        <Field label="سبب الإلغاء" required hint="3 أحرف على الأقل — يُسجل في سجل التدقيق">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: خطأ في التسجيل"
            autoFocus
          />
        </Field>
        <div className="mt-5 flex gap-2">
          <Button variant="danger" className="flex-1" loading={saving} onClick={() => void submitVoid()}>
            تأكيد الإلغاء
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setVoidOpen(false)} disabled={saving}>
            تراجع
          </Button>
        </div>
      </Modal>
      </div>{/* /print-hide */}

      {/* ===== وصل الطباعة — يظهر فقط عند الطباعة ===== */}
      <div className="print-area hidden" aria-hidden="true">
        <div style={{ fontFamily: 'Cairo, Tahoma, sans-serif', direction: 'rtl' }}>
          <div style={{ textAlign: 'center', borderBottom: '2px dashed #999', paddingBottom: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{business?.name ?? 'فاتورة بيع'}</div>
            {business?.phone && <div style={{ fontSize: 11, direction: 'ltr' }}>{business.phone}</div>}
            {business?.address && <div style={{ fontSize: 11 }}>{business.address}</div>}
            <div style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>فاتورة بيع</div>
          </div>
          <table style={{ width: '100%', fontSize: 11, marginBottom: 6 }}>
            <tbody>
              <tr>
                <td>رقم الفاتورة: <b>{data.doc_number}</b></td>
                <td>التاريخ: <b>{fmtDateTime(data.created_at)}</b></td>
              </tr>
              <tr>
                <td>العميل: <b>{data.customers?.name ?? 'عميل نقدي'}</b></td>
                <td>الدفع: <b>{data.payment_type === 'CASH' ? 'نقدي' : 'آجل'}</b></td>
              </tr>
            </tbody>
          </table>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #333' }}>
                <th style={{ textAlign: 'right', padding: '3px 2px' }}>الصنف</th>
                <th style={{ padding: '3px 2px' }}>كمية</th>
                <th style={{ padding: '3px 2px' }}>سعر</th>
                <th style={{ textAlign: 'left', padding: '3px 2px' }}>إجمالي</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} style={{ borderBottom: '1px dotted #ccc' }}>
                  <td style={{ padding: '3px 2px' }}>{i.products?.name ?? '—'}</td>
                  <td style={{ padding: '3px 2px', textAlign: 'center' }}>{i.quantity} {i.units?.symbol ?? ''}</td>
                  <td style={{ padding: '3px 2px', textAlign: 'center' }}>{formatMoney(i.unit_price, currency)}</td>
                  <td style={{ padding: '3px 2px', textAlign: 'left' }}>{formatMoney(i.total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>المجموع</span><b>{formatMoney(itemsSum, currency)}</b>
            </div>
            {data.discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>الخصم</span><b>−{formatMoney(data.discount, currency)}</b>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #333', marginTop: 4, paddingTop: 4, fontSize: 16, fontWeight: 900 }}>
              <span>الإجمالي</span><span>{formatMoney(data.total, currency)}</span>
            </div>
          </div>
          {data.notes && <p style={{ fontSize: 10, marginTop: 6 }}>ملاحظات: {data.notes}</p>}
          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 11, borderTop: '2px dashed #999', paddingTop: 6 }}>
            شكراً لتعاملكم معنا — نتشرف بخدمتكم دائماً
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-bold text-stone-400">{label}</p>
      <p className="mt-0.5 text-sm font-extrabold text-stone-900">{value}</p>
    </div>
  )
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-bold text-stone-500">{label}</span>
      <span className={`tabular-nums ${strong ? 'text-lg font-extrabold text-primary-700' : 'font-extrabold text-stone-900'}`}>
        {value}
      </span>
    </div>
  )
}
