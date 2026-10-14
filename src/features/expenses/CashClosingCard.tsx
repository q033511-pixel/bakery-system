/**
 * إقفال الصندوق اليومي (بند الصندوق والحسابات):
 * يعرض: رصيد بداية اليوم + الداخل + الخارج + المتوقع، والمستخدم يدخل المعدود الفعلي،
 * والفرق = المعدود − المتوقع — أي فرق يتطلب سبباً مكتوباً (لا إقفال صامت بفرق مجهول).
 * الإقفال فريد لكل (حساب، يوم) — والمحصلة تُخزن وتظهر في سجل الإقفالات.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/services/rpc'
import { useAuthStore } from '@/app/authStore'
import { formatMoney } from '@/lib/money'
import { todayISO } from '@/lib/dates'
import { Card, Button, Field, Input, Textarea, Badge, Select } from '@/components/ui/primitives'
import { useToast } from '@/lib/toast'
import { Lock, ClipboardCheck } from 'lucide-react'

interface CashBalanceRow { account_id: string; name: string; kind?: string | null; balance: number }
interface ClosingRow {
  id: string; closing_date: string; account_name?: string; opening_balance: number
  total_in: number; total_out: number; expected_balance: number
  counted_balance: number; variance: number; notes: string | null
}

export default function CashClosingCard() {
  const currency = useAuthStore((s) => s.currencySymbol())
  const toast = useToast()
  const qc = useQueryClient()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')

  const balancesQ = useQuery({
    queryKey: ['cash-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_cash_balances').select('*')
      if (error) throw new Error(error.message)
      return data as unknown as CashBalanceRow[]
    },
  })
  const balances = balancesQ.data ?? []
  const selectedId = accountId ?? balances.find((b) => b.kind !== 'BANK')?.account_id ?? balances[0]?.account_id ?? null
  const selected = balances.find((b) => b.account_id === selectedId) ?? null

  // المتوقع محسوب مباشرة من الرصيد الحالي (بداية + داخل − خارج لليوم = الرصيد الآن)
  const expected = selected?.balance ?? 0
  const countedNum = counted.trim() === '' ? null : Number(counted)
  const variance = countedNum === null || Number.isNaN(countedNum) ? null : countedNum - expected

  const closingsQ = useQuery({
    queryKey: ['cash-closings'],
    queryFn: async () => {
      const rows = await rpc<ClosingRow[]>('get_cash_closings', {})
      return rows ?? []
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      return rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_cash_closing', {
        p_payload: {
          operation_id: crypto.randomUUID(),
          cash_account_id: selectedId,
          closing_date: todayISO(),
          counted_balance: countedNum,
          notes: notes.trim() === '' ? null : notes.trim(),
        },
      })
    },
    onSuccess: () => {
      toast.success('تم إقفال الصندوق لهذا اليوم وتسجيل الفرق إن وجد.')
      setCounted('')
      setNotes('')
      void qc.invalidateQueries({ queryKey: ['cash-closings'] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ الإقفال.')
    },
  })

  const accountLabel = (id: string) => balances.find((b) => b.account_id === id)?.name ?? '—'
  const closings = useMemo(() => (closingsQ.data ?? []).slice(0, 7), [closingsQ.data])
  const varianceBadge = (v: number) => {
    if (Math.abs(v) < 0.01) return <Badge tone="success">مطابق</Badge>
    return <Badge tone={v > 0 ? 'info' : 'danger'}>{v > 0 ? 'زيادة' : 'نقص'} {formatMoney(Math.abs(v), currency)}</Badge>
  }

  return (
    <Card className="mb-3 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Lock className="size-5 text-primary-600" />
        <h2 className="text-base font-extrabold">إقفال اليوم للصندوق</h2>
      </div>

      {balances.length === 0 ? (
        <p className="text-sm text-stone-500">لا توجد حسابات صندوق بعد.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="حساب الصندوق">
            <Select
              value={selectedId ?? ''}
              onChange={(e) => setAccountId(e.target.value)}
              aria-label="حساب الصندوق"
            >
              {balances.map((b) => (
                <option key={b.account_id} value={b.account_id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="الرصيد المتوقع الآن">
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-extrabold tabular-nums">
              {formatMoney(expected, currency)}
            </div>
          </Field>
          <Field label="المبلغ الفعلي المعدود">
            <Input
              type="number" inputMode="decimal" step="0.01" min="0"
              value={counted} onChange={(e) => setCounted(e.target.value)}
              placeholder="عدّ النقد يدوياً"
              aria-label="المبلغ الفعلي المعدود"
            />
          </Field>
          <Field label="الفرق">
            <div className={`rounded-lg border px-3 py-2.5 text-sm font-extrabold tabular-nums ${
              variance === null ? 'border-stone-200 bg-stone-50 text-stone-400'
                : Math.abs(variance) < 0.01 ? 'border-success-200 bg-success-50 text-success-700'
                : 'border-danger-200 bg-danger-50 text-danger-700'
            }`}>
              {variance === null ? '—' : (variance > 0 ? '+' : '') + formatMoney(variance, currency)}
            </div>
          </Field>
        </div>
      )}

      {variance !== null && Math.abs(variance) >= 0.01 && (
        <Textarea
          className="mt-3"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="سبب الفرق (إلزامي عند وجود فرق) — مثال: فكة أعطيت للزبون لم تسجل"
          aria-label="سبب الفرق"
        />
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-2xs text-stone-500">الإقفال مرة واحدة لكل حساب في اليوم — الفروق تُوثق باسمك في سجل التدقيق.</p>
        <Button
          icon={<ClipboardCheck className="size-4" />}
          loading={saveMutation.isPending}
          disabled={!selectedId || countedNum === null || Number.isNaN(countedNum)}
          onClick={() => saveMutation.mutate()}
        >
          حفظ الإقفال
        </Button>
      </div>

      {closings.length > 0 && (
        <div className="mt-4 border-t border-stone-100 pt-3">
          <h3 className="mb-2 text-xs font-bold text-stone-500">آخر الإقفالات</h3>
          <div className="space-y-1.5">
            {closings.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs">
                <span className="font-bold tabular-nums">{c.closing_date}</span>
                <span className="text-stone-500">{accountLabel(String((c as unknown as Record<string, unknown>).cash_account_id ?? ''))}</span>
                <span className="tabular-nums">متوقع {formatMoney(c.expected_balance, currency)}</span>
                <span className="tabular-nums">معدود {formatMoney(c.counted_balance, currency)}</span>
                {varianceBadge(c.variance)}
                {c.notes && <span className="text-stone-500">— {c.notes}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
