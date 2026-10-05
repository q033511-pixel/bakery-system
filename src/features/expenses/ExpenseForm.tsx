/**
 * ExpenseForm — تسجيل مصروف جديد (بند 32): بند + مبلغ + طريقة دفع + صندوق.
 * المصروف النقدي يُسجّل حركة صندوق OUT تلقائياً على مستوى قاعدة البيانات.
 */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Info, Save, Receipt } from 'lucide-react'
import { lookups } from '@/services/lookups'
import { expensesService } from '@/services/operations'
import { useToast } from '@/lib/toast'
import { todayISO } from '@/lib/dates'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { DateInput, MoneyInput } from '@/components/ui/inputs'
import { useAuthStore } from '@/app/authStore'
import { METHOD_LABELS } from './ExpensesList'
import type { PaymentMethod } from '@/types'

export default function ExpenseForm() {
  const toast = useToast()
  const navigate = useNavigate()
  const currency = useAuthStore((s) => s.currencySymbol())

  const categoriesQ = useLiveQuery(async () => lookups.expenseCategories(), [])
  const cashAccountsQ = useLiveQuery(async () => lookups.cashAccounts(), [])
  const categories = useMemo(() => categoriesQ ?? [], [categoriesQ])
  const cashAccounts = useMemo(() => cashAccountsQ ?? [], [cashAccountsQ])

  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [expenseDate, setExpenseDate] = useState(todayISO())
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [cashAccountId, setCashAccountId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const defaultAccount = useMemo(() => cashAccounts.find((a) => a.is_default) ?? cashAccounts[0], [cashAccounts])

  async function save() {
    if (!categoryId) { toast.error('اختر بند المصروف.'); return }
    if (amount === null || amount <= 0) { toast.error('أدخل مبلغاً صحيحاً أكبر من صفر.'); return }

    setSaving(true)
    try {
      const res = await expensesService.create({
        category_id: categoryId,
        amount,
        expense_date: expenseDate,
        payment_method: paymentMethod,
        cash_account_id: paymentMethod === 'CASH' ? (cashAccountId ?? defaultAccount?.id ?? null) : null,
        description: description.trim() === '' ? null : description.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
      })
      if (res.offline) {
        toast.offline('تم حفظ المصروف محلياً وسيتم مزامنته عند عودة الإنترنت.')
      } else if (res.duplicate) {
        toast.info('هذه العملية مسجلة مسبقاً — لن يتم تكرارها.')
      } else {
        toast.success(`تم تسجيل المصروف بنجاح — ${res.doc_number}`)
      }
      window.setTimeout(() => navigate('/expenses'), 800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ المصروف.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="مصروف جديد"
        subtitle="سجّل مصروفات المخبز اليومية"
        backTo="/expenses"
        action={<Button onClick={() => void save()} loading={saving} icon={<Save className="size-4" />}>حفظ</Button>}
      />

      <div className="mb-3 flex items-center gap-2 rounded-xl bg-info-50 px-4 py-3 text-xs font-bold text-info-700">
        <Info className="size-4 shrink-0" />
        المصروف النقدي يخصم من الصندوق تلقائياً.
      </div>

      <Card className="mb-3 space-y-3 p-4">
        <Field label="بند المصروف" required>
          <Select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value === '' ? null : e.target.value)}>
            <option value="">اختر البند...</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المبلغ" required>
            <MoneyInput value={amount} onChange={setAmount} currencySymbol={currency} placeholder="0.00" aria-label="المبلغ" />
          </Field>
          <Field label="التاريخ" required>
            <DateInput value={expenseDate} onChange={setExpenseDate} className="w-full" aria-label="تاريخ المصروف" />
          </Field>
        </div>
        <Field label="طريقة الدفع" required>
          <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </Select>
        </Field>
        {paymentMethod === 'CASH' && (
          <Field label="الصندوق" hint="اختياري — الافتراضي هو الصندوق الرئيسي">
            <Select value={cashAccountId ?? defaultAccount?.id ?? ''} onChange={(e) => setCashAccountId(e.target.value === '' ? null : e.target.value)}>
              {cashAccounts.length === 0 && <option value="">لا توجد صناديق</option>}
              {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="الوصف" hint="اختياري — مثال: وقود سيارة التوزيع">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف مختصر للمصروف" />
        </Field>
        <Field label="ملاحظات" hint="اختياري">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="أي تفاصيل إضافية..." />
        </Field>
      </Card>

      <Button className="w-full" size="lg" loading={saving} onClick={() => void save()} icon={<Receipt className="size-5" />}>
        حفظ المصروف
      </Button>
    </div>
  )
}
