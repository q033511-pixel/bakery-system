/**
 * كشف حساب مورد (بند 16/19): شراء آجل (مدين) / دفعة (دائن) / الرصيد = مستحقات المورد.
 * كل الأرقام من get_supplier_statement() — لا حسابات وهمية.
 */
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { FileDown, HandCoins, TrendingUp, Scale } from 'lucide-react'
import { rpc } from '@/services/rpc'
import { lookups } from '@/services/lookups'
import { paymentsService } from '@/services/operations'
import { useAuthStore } from '@/app/authStore'
import { useToast } from '@/lib/toast'
import { formatMoney, roundMoney, sumMoney } from '@/lib/money'
import { fmtDateTime, todayISO } from '@/lib/dates'
import { exportCSV } from '@/lib/csv'
import { PageHeader } from '@/components/ui/navigation'
import { Card, StatCard, Field, Input, Select, Textarea, Button, StatusBadge, Skeleton } from '@/components/ui/primitives'
import { MoneyInput, DateInput } from '@/components/ui/inputs'
import { Modal } from '@/components/ui/overlays'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states'
import type { CashAccount, LedgerRow, PaymentMethod, Supplier } from '@/types'

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'نقدي',
  BANK_TRANSFER: 'حوالة بنكية',
  CHECK: 'شيك',
  OTHER: 'أخرى',
}

export default function SupplierDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const toast = useToast()
  const qc = useQueryClient()
  const currency = useAuthStore((s) => s.currencySymbol())
  const canPay = useAuthStore((s) => s.has('payments.manage'))

  // بيانات المورد من الكاش المحلي (تعمل أوفلاين)
  const supplierQ = useQuery({
    queryKey: ['suppliers-lookup'],
    queryFn: lookups.suppliers,
    staleTime: 5 * 60_000,
  })
  const supplier = useMemo<Supplier | undefined>(
    () => (supplierQ.data ?? []).find((s) => s.id === id),
    [supplierQ.data, id],
  )

  // كشف الحساب من الخادم
  const statementQ = useQuery({
    queryKey: ['supplier-statement', id],
    queryFn: () => rpc<LedgerRow[]>('get_supplier_statement', { p_supplier: id, p_from: null, p_to: null }),
    enabled: id !== '',
  })

  // الحسابات النقدية لنموذج الدفعة
  const cashAccountsQ = useQuery({
    queryKey: ['cash-accounts-lookup'],
    queryFn: lookups.cashAccounts,
    staleTime: 5 * 60_000,
  })

  const rows = useMemo(() => statementQ.data ?? [], [statementQ.data])
  const totals = useMemo(() => {
    const debit = sumMoney(rows.map((r) => r.debit))
    const credit = sumMoney(rows.map((r) => r.credit))
    return { debit, credit, balance: roundMoney(debit - credit) }
  }, [rows])

  // نموذج الدفعة
  const [payOpen, setPayOpen] = useState(false)
  const [amount, setAmount] = useState<number | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [paymentDate, setPaymentDate] = useState(todayISO())
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [cashAccountId, setCashAccountId] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  function openPaymentModal() {
    setAmount(null)
    setAmountError(null)
    setPaymentDate(todayISO())
    setPaymentMethod('CASH')
    setCashAccountId(null)
    setReference('')
    setNotes('')
    setPayOpen(true)
  }

  async function submitPayment() {
    if (!id) return
    if (!amount || amount <= 0) {
      setAmountError('أدخل مبلغاً أكبر من صفر.')
      return
    }
    setAmountError(null)
    setSaving(true)
    try {
      const res = await paymentsService.supplier({
        party_id: id,
        amount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        cash_account_id: cashAccountId,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      })
      if (res.offline) {
        toast.offline('تم حفظ الدفعة محلياً وسيتم مزامنتها عند عودة الإنترنت.')
      } else {
        toast.success(`تم تسجيل الدفعة بنجاح — ${res.doc_number}`)
      }
      setPayOpen(false)
      void qc.invalidateQueries({ queryKey: ['supplier-statement', id] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تسجيل الدفعة — حاول مجدداً.')
    } finally {
      setSaving(false)
    }
  }

  function exportStatement() {
    exportCSV(
      `supplier-statement-${supplier?.code ?? id}`,
      ['التاريخ', 'النوع', 'المرجع', 'مدين', 'دائن', 'الرصيد', 'ملاحظات'],
      rows.map((r) => [fmtDateTime(r.date), r.type, r.reference, r.debit, r.credit, r.balance, r.notes ?? '']),
    )
  }

  // رابط غير صالح
  if (!id) {
    return (
      <div>
        <PageHeader title="كشف حساب مورد" backTo="/suppliers" />
        <Card>
          <EmptyState
            title="لم يتم تحديد مورد"
            message="الرابط غير صالح — عد إلى قائمة الموردين واختر مورداً."
            action={<Link to="/suppliers" className="text-xs font-extrabold text-primary-700 hover:underline">العودة إلى الموردين</Link>}
          />
        </Card>
      </div>
    )
  }

  const headerSubtitle = [supplier?.phone, supplier?.address].filter(Boolean).join(' • ')

  return (
    <div>
      <PageHeader
        title={supplier?.name ?? 'كشف حساب مورد'}
        subtitle={headerSubtitle}
        backTo="/suppliers"
        action={canPay ? (
          <Button onClick={openPaymentModal} icon={<HandCoins className="size-4" />}>تسجيل دفعة</Button>
        ) : undefined}
      />

      {/* حالة المورد + الكود */}
      {supplierQ.isLoading ? (
        <Skeleton className="mb-3 h-6 w-44" />
      ) : supplier ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={supplier.active ? 'ACTIVE' : 'INACTIVE'} label={supplier.active ? 'نشط' : 'غير نشط'} />
          <span className="text-2xs font-bold text-stone-400">كود المورد: {supplier.code}</span>
        </div>
      ) : null}

      {/* بطاقات الملخص */}
      {statementQ.isLoading ? (
        <Card className="mb-3 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </Card>
      ) : statementQ.isError ? null : (
        <Card className="mb-3 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <StatCard title="إجمالي المشتريات (آجل)" value={formatMoney(totals.debit, currency)} icon={<TrendingUp className="size-5" />} />
          <StatCard title="إجمالي الدفعات" value={formatMoney(totals.credit, currency)} tone="success" icon={<HandCoins className="size-5" />} />
          <StatCard
            title="الرصيد (مستحقات المورد)"
            value={formatMoney(totals.balance, currency)}
            tone={totals.balance > 0 ? 'warning' : 'default'}
            sub={totals.balance > 0 ? 'مستحق للمورد' : 'لا مستحقات'}
            icon={<Scale className="size-5" />}
          />
        </Card>
      )}

      {/* كشف الحساب */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-stone-900">كشف الحساب</h2>
        <Button
          variant="outline"
          size="sm"
          icon={<FileDown className="size-4" />}
          onClick={exportStatement}
          disabled={rows.length === 0}
        >
          تصدير CSV
        </Button>
      </div>

      <Card className="overflow-hidden">
        {statementQ.isLoading ? (
          <LoadingState label="جارٍ تحميل كشف الحساب..." />
        ) : statementQ.isError ? (
          <ErrorState
            message={statementQ.error instanceof Error ? statementQ.error.message : 'تعذر تحميل كشف الحساب.'}
            onRetry={() => void statementQ.refetch()}
          />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r, i) => `${r.reference}-${i}`}
            emptyTitle="لا توجد حركات على هذا الحساب"
            emptyMessage="ستظهر المشتريات الآجلة والمدفوعات هنا بعد تسجيلها."
            columns={[
              { key: 'date', header: 'التاريخ', render: (r) => <span className="tabular-nums text-stone-500">{fmtDateTime(r.date)}</span>, hideOnMobile: true },
              { key: 'type', header: 'النوع', render: (r) => <span className="font-bold text-stone-900">{r.type}</span> },
              { key: 'reference', header: 'المرجع', render: (r) => <span className="font-bold tabular-nums">{r.reference}</span>, hideOnMobile: true },
              {
                key: 'debit', header: 'مدين', className: 'tabular-nums', render: (r) => (
                  r.debit ? <span className="font-bold text-stone-900">{formatMoney(r.debit, currency)}</span> : <span className="text-stone-300">—</span>
                ),
              },
              {
                key: 'credit', header: 'دائن', className: 'tabular-nums', render: (r) => (
                  r.credit ? <span className="font-bold text-success-700">{formatMoney(r.credit, currency)}</span> : <span className="text-stone-300">—</span>
                ),
              },
              {
                key: 'balance', header: 'الرصيد', className: 'tabular-nums', render: (r) => (
                  <span className={`font-extrabold ${r.balance > 0 ? 'text-warning-700' : 'text-stone-900'}`}>
                    {formatMoney(r.balance, currency)}
                  </span>
                ),
              },
            ]}
            mobileCard={(r) => (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold text-stone-900">{r.type}</span>
                  <span className="text-2xs tabular-nums text-stone-400">{fmtDateTime(r.date)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold tabular-nums text-stone-500">{r.reference}</span>
                  <span className="flex items-center gap-3 text-xs">
                    {r.debit > 0 && <span className="font-bold tabular-nums text-stone-900">{formatMoney(r.debit, currency)}</span>}
                    {r.credit > 0 && <span className="font-bold tabular-nums text-success-700">{formatMoney(r.credit, currency)}</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-stone-100 pt-1.5">
                  <span className="text-2xs font-bold text-stone-400">الرصيد</span>
                  <span className={`text-sm font-extrabold tabular-nums ${r.balance > 0 ? 'text-warning-700' : 'text-stone-900'}`}>
                    {formatMoney(r.balance, currency)}
                  </span>
                </div>
                {r.notes && <p className="text-2xs leading-relaxed text-stone-400">{r.notes}</p>}
              </div>
            )}
          />
        )}
      </Card>

      {/* تسجيل دفعة للمورد */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="تسجيل دفعة للمورد">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submitPayment() }}>
          <Field label="المبلغ" required error={amountError}>
            <MoneyInput value={amount} onChange={setAmount} currencySymbol={currency} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاريخ الدفعة">
              <DateInput value={paymentDate} onChange={setPaymentDate} />
            </Field>
            <Field label="طريقة الدفع" required>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="الحساب النقدي" hint="اختياري — لتأثير الدفعة على الصندوق">
            <Select value={cashAccountId ?? ''} onChange={(e) => setCashAccountId(e.target.value || null)}>
              <option value="">— بدون —</option>
              {(cashAccountsQ.data ?? []).filter((a: CashAccount) => a.active).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="المرجع" hint="اختياري — رقم الشيك أو الحوالة">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="ملاحظات">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1" loading={saving}>حفظ الدفعة</Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setPayOpen(false)} disabled={saving}>
              إلغاء
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
