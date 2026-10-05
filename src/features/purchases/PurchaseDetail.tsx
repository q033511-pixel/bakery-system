/** تفاصيل فاتورة شراء + إلغاء الفاتورة VOID (بند 21/105) */
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/app/authStore'
import { purchasesService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { formatMoney, formatQty } from '@/lib/money'
import { fmtDate } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Card, Button, StatusBadge, Field, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlays'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Purchase, PurchaseItem } from '@/types'

type PurchaseDetailRow = Purchase & {
  suppliers: { name: string } | null
  purchase_items: (PurchaseItem & { products: { name: string } | null; units: { symbol: string } | null })[]
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'نقدي',
  BANK_TRANSFER: 'حوالة',
  CHECK: 'شيك',
  OTHER: 'أخرى',
}

export default function PurchaseDetail() {
  const { id } = useParams()
  const toast = useToast()
  const qc = useQueryClient()
  const currency = useAuthStore((s) => s.currencySymbol())
  const has = useAuthStore((s) => s.has)

  const [voidOpen, setVoidOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [voiding, setVoiding] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['purchase', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchases')
        .select('*, suppliers(name), purchase_items(*, products(name), units(symbol))')
        .eq('id', id ?? '')
        .single()
      if (error) throw new Error(error.message)
      return data as unknown as PurchaseDetailRow
    },
  })

  async function confirmVoid() {
    if (reason.trim().length < 3) {
      toast.error('اكتب سبب الإلغاء — 3 أحرف على الأقل.')
      return
    }
    setVoiding(true)
    try {
      await purchasesService.void(id ?? '', reason.trim())
      toast.success('تم إلغاء الفاتورة وعكس حركاتها.')
      setVoidOpen(false)
      setReason('')
      void qc.invalidateQueries({ queryKey: ['purchase', id] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء إلغاء الفاتورة.')
    } finally {
      setVoiding(false)
    }
  }

  if (isLoading) return <LoadingState />
  if (isError || !data) {
    return (
      <div>
        <PageHeader title="فاتورة الشراء" backTo="/purchases" />
        <Card>
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل الفاتورة.'} onRetry={() => void refetch()} />
        </Card>
      </div>
    )
  }

  const canVoid = has('purchases.void') && data.status === 'CONFIRMED'

  return (
    <div className="pb-4">
      <PageHeader
        title={`فاتورة شراء ${data.doc_number}`}
        {...(data.suppliers?.name ? { subtitle: data.suppliers.name } : {})}
        backTo="/purchases"
        action={canVoid ? (
          <Button variant="danger" onClick={() => setVoidOpen(true)} icon={<Ban className="size-4" />}>
            إلغاء الفاتورة (VOID)
          </Button>
        ) : undefined}
      />

      {data.status === 'VOIDED' && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-warning-50 px-4 py-3 text-sm font-bold text-warning-700">
          <AlertTriangle className="size-4 shrink-0" />
          هذه الفاتورة ملغاة ولم تُحتسب من المخزون.
        </div>
      )}

      {/* بيانات الفاتورة */}
      <Card className="mb-3 grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
        <Info label="المورد" value={data.suppliers?.name ?? '—'} />
        <Info label="التاريخ" value={fmtDate(data.purchase_date)} />
        <Info label="فاتورة المورد" value={data.invoice_number ?? '—'} />
        <Info label="طريقة الدفع" value={data.payment_method ? METHOD_LABELS[data.payment_method] ?? data.payment_method : '—'} />
        <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <span className="text-2xs font-bold text-stone-400">الحالة</span>
          <StatusBadge status={data.status} />
          <StatusBadge status={data.payment_type} />
        </div>
      </Card>

      {/* الأصناف */}
      <Card className="mb-3 overflow-hidden">
        <p className="border-b border-stone-100 p-3 text-sm font-extrabold text-stone-800">أصناف الفاتورة</p>
        <DataTable
          rows={data.purchase_items ?? []}
          keyOf={(it) => it.id}
          emptyTitle="لا توجد أصناف في هذه الفاتورة"
          columns={[
            { key: 'product', header: 'صنف', render: (it) => <span className="font-bold">{it.products?.name ?? '—'}</span> },
            { key: 'qty', header: 'كمية', className: 'tabular-nums', render: (it) => formatQty(it.quantity) },
            { key: 'unit', header: 'وحدة', render: (it) => it.units?.symbol ?? '—' },
            { key: 'price', header: 'سعر', className: 'tabular-nums', render: (it) => formatMoney(it.unit_price, currency) },
            { key: 'total', header: 'إجمالي', className: 'font-bold tabular-nums', render: (it) => formatMoney(it.total, currency) },
          ]}
          mobileCard={(it) => (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold">{it.products?.name ?? '—'}</p>
                <p className="text-2xs tabular-nums text-stone-400">{formatQty(it.quantity)} {it.units?.symbol ?? ''} × {formatMoney(it.unit_price, currency)}</p>
              </div>
              <span className="text-sm font-extrabold tabular-nums">{formatMoney(it.total, currency)}</span>
            </div>
          )}
        />
      </Card>

      {/* الإجماليات */}
      <Card className="space-y-2.5 p-4">
        <Row label="المجموع" value={formatMoney(data.subtotal, currency)} />
        <Row label="الخصم" value={formatMoney(data.discount, currency)} />
        <div className="flex items-center justify-between border-t border-stone-200 pt-2.5">
          <span className="text-sm font-extrabold text-stone-900">الإجمالي</span>
          <span className="text-lg font-extrabold tabular-nums text-primary-700">{formatMoney(data.total, currency)}</span>
        </div>
        {data.notes && <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">ملاحظات: {data.notes}</p>}
      </Card>

      {/* تأكيد الإلغاء مع سبب إلزامي */}
      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="إلغاء الفاتورة (VOID)">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-600">
            <AlertTriangle className="size-5" />
          </div>
          <p className="pt-1.5 text-sm leading-relaxed text-stone-700">
            سيتم إلغاء الفاتورة وعكس حركات المخزون والصندوق المرتبطة بها. هذا الإجراء لا يمكن التراجع عنه.
          </p>
        </div>
        <div className="mt-4">
          <Field label="سبب الإلغاء" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: خطأ في الفاتورة من المورد"
              autoFocus
            />
          </Field>
          {reason.trim().length > 0 && reason.trim().length < 3 && (
            <p className="mt-1 text-xs font-semibold text-danger-600">السبب قصير — اكتب 3 أحرف على الأقل.</p>
          )}
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="danger" className="flex-1" onClick={() => void confirmVoid()} loading={voiding}>
            تأكيد الإلغاء
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setVoidOpen(false)} disabled={voiding}>
            رجوع
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs font-bold text-stone-400">{label}</p>
      <p className="truncate text-sm font-extrabold text-stone-900">{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-bold text-stone-500">{label}</span>
      <span className="font-extrabold tabular-nums text-stone-900">{value}</span>
    </div>
  )
}
