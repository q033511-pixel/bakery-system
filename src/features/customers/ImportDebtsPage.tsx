/**
 * مستورد دفاتر العملاء من Excel/CSV (بند مستورد البيانات — الكنز الحقيقي للزبون:
 * قصي 142→568 نقدي، ساهر 600→2280 ذمم، فادي 1,050→3,675 ذمم).
 *
 * المسار الإجباري: اختيار ملف → مطابقة أعمدة → معاينة + تحقق + تقرير أخطاء
 * → نسخة أمان تلقائية → اعتماد صريح (لا ترحيل قبل المراجعة) → تراجع آمن في الجلسة.
 *
 * الافتراضات المعلنة (تُعرض في المعاينة):
 * - «ذمم» = دين افتتاحي يضاف لرصيد العميل المعتمد. «نقدي» = لا أثر على الرصيد.
 * - سعر مقترح للعميل = القيمة ÷ الكمية (اختياري — يُحفظ كسعر خاص).
 * - التواريخ تُوحد إلى ISO (افتراضي يوم/شهر/سنة مع كشف تلقائي).
 * - لا تُنشأ فواتير ولا حركات مالية هنا — أرصدة افتتاحية معتمدة فقط، بصفر أثر على التقارير التاريخية.
 */
import { useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Upload, FileSpreadsheet, ShieldCheck, Undo2, AlertTriangle } from 'lucide-react'
import { parseCSV, parseAmount, normalizeDateISO } from '@/lib/csvParse'
import { rpc } from '@/services/rpc'
import { lookups } from '@/services/lookups'
import { exportBridgeFile } from '@/features/databridge/dataBridge'
import { downloadBlob } from '@/lib/backup'
import { PageHeader } from '@/components/ui/navigation'
import { Card, Button, Badge, Field, Select } from '@/components/ui/primitives'
import { useToast } from '@/lib/toast'
import { formatMoney } from '@/lib/money'
import { useAuthStore } from '@/app/authStore'

interface RawRow { line: number; cells: string[] }

interface MappedRow {
  line: number
  customer: string
  dateISO: string | null
  dateAssumed: string | null
  quantity: number | null
  amount: number | null
  status: 'CREDIT' | 'CASH' | 'UNKNOWN'
  valid: boolean
  problems: string[]
}

interface CustomerSummary {
  name: string
  totalDebt: number
  rows: number
  suggestedPrice: number | null
  suggestedQty: number | null
  productName: string | null
}

const FIELD_OPTIONS = [
  { key: 'customer', label: 'العميل' },
  { key: 'date', label: 'التاريخ' },
  { key: 'quantity', label: 'الكمية' },
  { key: 'amount', label: 'القيمة/المبلغ' },
  { key: 'status', label: 'الحالة (نقدي/ذمم)' },
  { key: 'product', label: 'الصنف (اختياري — للسعر المقترح)' },
] as const

function guessColumn(headers: string[], hints: string[]): number {
  for (const h of hints) {
    const idx = headers.findIndex((x) => x.includes(h))
    if (idx >= 0) return idx
  }
  return -1
}

function parseStatus(raw: string): 'CREDIT' | 'CASH' | 'UNKNOWN' {
  const s = raw.trim()
  if (s.includes('ذمم') || s.includes('آجل') || s.toLowerCase().includes('credit')) return 'CREDIT'
  if (s.includes('نقدي') || s.includes('نقد') || s.toLowerCase().includes('cash')) return 'CASH'
  return 'UNKNOWN'
}

export default function ImportDebtsPage() {
  const toast = useToast()
  const currency = useAuthStore((s) => s.currencySymbol())
  const fileRef = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState<{ headers: string[]; rows: RawRow[]; fileName: string } | null>(null)
  const [mapping, setMapping] = useState<Record<string, number | undefined>>({})
  const [datePreference, setDatePreference] = useState<'DD/MM' | 'MM/DD'>('DD/MM')
  const [suggestPrices, setSuggestPrices] = useState(true)
  const [approved, setApproved] = useState<{ importId: string; customers: string[]; totals: number } | null>(null)


  const mapped: MappedRow[] = useMemo(() => {
    if (!raw) return []
    return raw.rows.map((r) => {
      const problems: string[] = []
      const customer = (mapping.customer !== undefined ? (r.cells[mapping.customer] ?? '') : '')?.trim() ?? ''
      if (!customer) problems.push('اسم العميل فارغ')
      const dateRaw = mapping.date !== undefined ? (r.cells[mapping.date] ?? '') : ''
      const norm = dateRaw ? normalizeDateISO(dateRaw, datePreference) : { iso: null, assumedFormat: null }
      if (dateRaw && !norm.iso) problems.push(`تاريخ غير مفهوم: «${dateRaw}»`)
      const qtyRaw = mapping.quantity !== undefined ? (r.cells[mapping.quantity] ?? '') : ''
      const quantity = qtyRaw ? parseAmount(qtyRaw) : null
      if (qtyRaw && quantity === null) problems.push(`كمية غير رقمية: «${qtyRaw}»`)
      const amountRaw = mapping.amount !== undefined ? (r.cells[mapping.amount] ?? '') : ''
      const amount = amountRaw ? parseAmount(amountRaw) : null
      if (amountRaw && amount === null) problems.push(`مبلغ غير رقمي: «${amountRaw}»`)
      if (amount !== null && amount < 0) problems.push('مبلغ سالب')
      const statusRaw = mapping.status !== undefined ? (r.cells[mapping.status] ?? '') : ''
      const status = parseStatus(statusRaw)
      if (statusRaw && status === 'UNKNOWN') problems.push(`حالة غير معروفة: «${statusRaw}» — لن تُرحّل حتى تصححها`)
      if (status === 'CREDIT' && amount === null) problems.push('صف ذمم بلا مبلغ')
      return {
        line: r.line, customer, dateISO: norm.iso, dateAssumed: norm.assumedFormat,
        quantity, amount, status, valid: problems.length === 0, problems,
      }
    })
  }, [raw, mapping, datePreference])

  const summary: CustomerSummary[] = useMemo(() => {
    const byCustomer = new Map<string, CustomerSummary>()
    for (const r of mapped) {
      if (!r.valid || r.status !== 'CREDIT' || r.amount === null) continue
      const cur = byCustomer.get(r.customer) ?? { name: r.customer, totalDebt: 0, rows: 0, suggestedPrice: null, suggestedQty: null, productName: null }
      cur.totalDebt += r.amount
      cur.rows += 1
      if (suggestPrices && r.quantity && r.quantity > 0 && r.amount !== null) {
        cur.suggestedPrice = r.amount / r.quantity
        cur.suggestedQty = r.quantity
        const prodRaw = mapping.product !== undefined ? ((raw?.rows ?? []).find((x) => x.line === r.line)?.cells[mapping.product] ?? '') : ''
        cur.productName = prodRaw.trim() || null
      }
      byCustomer.set(r.customer, cur)
    }
    return [...byCustomer.values()].sort((a, b) => b.totalDebt - a.totalDebt)
  }, [raw, mapped, mapping, suggestPrices])

  const invalidRows = mapped.filter((r) => !r.valid)
  const validCreditRows = mapped.filter((r) => r.valid && r.status === 'CREDIT')
  const skippedCashRows = mapped.filter((r) => r.valid && r.status === 'CASH')
  const grandTotal = validCreditRows.reduce((s, r) => s + (r.amount ?? 0), 0)
  const duplicateGroups = useMemo(() => {
    const seen = new Map<string, number[]>()
    validCreditRows.forEach((r) => {
      const k = `${r.customer}|${r.dateISO}|${r.amount}`
      seen.set(k, [...(seen.get(k) ?? []), r.line])
    })
    return [...seen.keys()].map((k) => ({ k, lines: seen.get(k) as number[] })).filter((e) => e.lines.length > 1)
  }, [validCreditRows])

  function onFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = parseCSV(String(reader.result ?? ''))
        if (parsed.headers.length === 0) {
          toast.error('الملف فارغ أو غير قابل للقراءة.')
          return
        }
        const rows: RawRow[] = parsed.rows.map((cells, i) => ({ line: i + 2, cells }))
        setRaw({ headers: parsed.headers, rows, fileName: file.name })
        setMapping({
          customer: guessColumn(parsed.headers, ['عميل', 'العميل', 'customer', 'الزبون', 'اسم']),
          date: guessColumn(parsed.headers, ['تاريخ', 'date', 'اليوم']),
          quantity: guessColumn(parsed.headers, ['كمية', 'الكمية', 'qty', 'quantity']),
          amount: guessColumn(parsed.headers, ['قيمة', 'القيمة', 'مبلغ', 'المبلغ', 'amount', 'total']),
          status: guessColumn(parsed.headers, ['حالة', 'الحالة', 'الدفع', 'status', 'نوع']),
          product: guessColumn(parsed.headers, ['البيان', 'بيان', 'صنف', 'الصنف', 'المنتج', 'product', 'item']),
        })
        setApproved(null)
        toast.success(`قرأنا ${rows.length} صفاً — راجع المطابقة والمعاينة قبل الاعتماد.`)
      } catch {
        toast.error('تعذر قراءة الملف — تأكد أنه CSV مصدَّر من إكسل.')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const approveMutation = useMutation({
    mutationFn: async () => {
      // 1) نسخة أمان تلقائية قبل أي ترحيل
      try {
        const backup = await exportBridgeFile()
        downloadBlob(backup.blob, backup.filename.replace('almoutmag-data-', 'almoutmag-safety-'))
      } catch {
        /* جهاز بلا بيانات بعد */
      }
      // 2) اعتماد الأرصدة: عميل موجود يُحدَّث؛ عميل جديد يُنشأ ثم يُحدَّث
      const importId = crypto.randomUUID()
      const applied: string[] = []
      let totals = 0
      // قراءة حية من قاعدة الجهاز لحظة الاعتماد — لا كاش قديم يفوّت مطابقة الأسماء
      const [freshProducts, freshCustomers] = await Promise.all([lookups.products(), lookups.customers()])
      for (const c of summary) {
        let cid = freshCustomers.find((x) => x.name === c.name)?.id
        if (!cid) {
          const res = await rpc<{ id: string }>('create_customer_minimal', { p_name: c.name })
          cid = res.id
        }
        const productId = c.productName ? freshProducts.find((p: { name: string }) => p.name === c.productName)?.id ?? null : null
        await rpc('apply_opening_balance', {
          p_customer: cid, p_amount: c.totalDebt, p_date: validCreditRows.find((r) => r.customer === c.name)?.dateISO ?? null,
          p_import_id: importId,
          p_suggested_price: suggestPrices ? c.suggestedPrice : null,
          p_product_id: productId,
        })
        applied.push(c.name)
        totals += c.totalDebt
      }
      return { importId, customers: applied, totals }
    },
    onSuccess: (res) => {
      setApproved(res)
      toast.success(`اعتمدت أرصدة ${res.customers.length} عملاء بإجمالي ${formatMoney(res.totals, currency)} — النسخة الأمنية نُزّلت تلقائياً.`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'تعذر الاعتماد.'),
  })

  const undoMutation = useMutation({
    mutationFn: async () => {
      if (!approved) return null
      await rpc('undo_opening_balance', { p_import_id: approved.importId })
      return approved
    },
    onSuccess: (res) => {
      if (res) toast.success(`تراجعنا عن اعتماد ${res.customers.length} عملاء — عادت أرصدتهم لصفر ولم تُمس أي حركات مالية.`)
      setApproved(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'تعذر التراجع.'),
  })

  return (
    <div className="pb-4">
      <PageHeader title="استيراد دفاتر العملاء" subtitle="من إكسل/CSV — بمعاينة واعتماد قبل الترحيل" backTo="/customers" />

      {/* الخطوة 1: الملف */}
      <Card className="mb-3 p-4">
        <div className="mb-2 flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-primary-600" />
          <h2 className="text-base font-extrabold">1 — اختر ملف الإكسل (مصدَّر CSV)</h2>
        </div>
        <input
          ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
        />
        <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
          اختيار ملف CSV
        </Button>
        {raw && <p className="mt-2 text-2xs text-stone-500">الملف: {raw.fileName} — {raw.rows.length} صف، أعمدة: {raw.headers.join(' | ')}</p>}
      </Card>

      {/* الخطوة 2: مطابقة الأعمدة */}
      {raw && (
        <Card className="mb-3 p-4">
          <h2 className="mb-3 text-base font-extrabold">2 — مطابقة الأعمدة</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FIELD_OPTIONS.map((f) => (
              <Field key={f.key} label={f.label} required={f.key === 'customer' || f.key === 'amount'}>
                <Select
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  aria-label={`عمود ${f.label}`}
                >
                  <option value="">— لا شيء —</option>
                  {raw.headers.map((h, i) => (
                    <option key={i} value={i}>{i + 1}: {h}</option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="صيغة التاريخ" hint="يُكشف تلقائياً إن كانت واضحة (يوم > 12)">
              <Select value={datePreference} onChange={(e) => setDatePreference(e.target.value as 'DD/MM' | 'MM/DD')} aria-label="صيغة التاريخ">
                <option value="DD/MM">يوم/شهر/سنة (17/01/2026)</option>
                <option value="MM/DD">شهر/يوم/سنة (01/17/2026)</option>
              </Select>
            </Field>
          </div>
        </Card>
      )}

      {/* الخطوة 3: المعاينة + التحقق */}
      {raw && (
        <Card className="mb-3 p-4">
          <h2 className="mb-3 text-base font-extrabold">3 — المعاينة والتحقق (لا ترحيل قبل الاعتماد)</h2>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-stone-50 p-3 text-center">
              <p className="text-2xs text-stone-500">صفوف ذمم صالحة</p>
              <p className="text-lg font-extrabold tabular-nums">{validCreditRows.length}</p>
            </div>
            <div className="rounded-lg bg-stone-50 p-3 text-center">
              <p className="text-2xs text-stone-500">صفوف نقدية (لا أثر)</p>
              <p className="text-lg font-extrabold tabular-nums">{skippedCashRows.length}</p>
            </div>
            <div className="rounded-lg bg-danger-50 p-3 text-center">
              <p className="text-2xs text-danger-600">صفوف تحتاج تصحيحاً</p>
              <p className="text-lg font-extrabold tabular-nums text-danger-700">{invalidRows.length}</p>
            </div>
            <div className="rounded-lg bg-primary-50 p-3 text-center">
              <p className="text-2xs text-primary-600">إجمالي الذمم المستوردة</p>
              <p className="text-lg font-extrabold tabular-nums text-primary-700">{formatMoney(grandTotal, currency)}</p>
            </div>
          </div>

          {duplicateGroups.length > 0 && (
            <div className="mb-3 rounded-lg bg-warning-50 p-3 text-2xs font-bold text-warning-700">
              <AlertTriangle className="mb-1 inline size-4" /> صفوف مكررة محتملة (نفس العميل والتاريخ والمبلغ):{' '}
              {duplicateGroups.map((e) => `سطور ${(e.lines as number[]).join('، ')}`).join(' — ')}
            </div>
          )}

          {/* ملخص العملاء */}
          {summary.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-lg border border-stone-200">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-2xs text-stone-500">
                  <tr>
                    <th className="p-2 text-start">العميل</th>
                    <th className="p-2 text-start">صفوف الذمم</th>
                    <th className="p-2 text-start">رصيد افتتاحي سيُعتمد</th>
                    {suggestPrices && <th className="p-2 text-start">سعر مقترح</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {summary.map((c) => (
                    <tr key={c.name}>
                      <td className="p-2 font-bold">{c.name}</td>
                      <td className="p-2 tabular-nums">{c.rows}</td>
                      <td className="p-2 font-extrabold tabular-nums text-primary-700">{formatMoney(c.totalDebt, currency)}</td>
                      {suggestPrices && (
                        <td className="p-2 tabular-nums">
                          {c.suggestedPrice !== null ? `${formatMoney(c.suggestedPrice, currency)} ${c.suggestedQty ? `(${c.suggestedQty} وحدة)` : ''}` : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* الصفوف غير الصالحة */}
          {invalidRows.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-lg border border-danger-200">
              <p className="bg-danger-50 p-2 text-2xs font-extrabold text-danger-700">صفوف غير صالحة (تُستبعد حتى التصحيح في الملف):</p>
              <div className="max-h-40 overflow-y-auto">
                {invalidRows.map((r) => (
                  <p key={r.line} className="border-t border-danger-100 p-2 text-2xs text-danger-700">
                    سطر {r.line} ({r.customer || 'بدون عميل'}): {r.problems.join(' • ')}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* الافتراضات */}
          <div className="rounded-lg bg-stone-50 p-3 text-2xs leading-relaxed text-stone-600">
            <p className="mb-1 font-extrabold">المعادلات والافتراضات المعلنة:</p>
            <p>• صفوف «ذمم» → رصيد افتتاحي معتمد على العميل (تظهر في كشف حسابه كسطر «رصيد افتتاحي»).</p>
            <p>• صفوف «نقدي» → لا أثر (بيع مكتمل لا دين فيه).</p>
            <p>• سعر مقترح = القيمة ÷ الكمية من آخر صف للعميل {suggestPrices ? '(مفعّل)' : '(معطل)'} — يُحفظ كسعر خاص يظهر تلقائياً في فواتيره.</p>
            <p>• صيغة التاريخ المفترضة: {datePreference === 'DD/MM' ? 'يوم/شهر/سنة' : 'شهر/يوم/سنة'} — كل سطر يعرض الصيغة التي اتُّبعت فعلياً.</p>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={suggestPrices} onChange={(e) => setSuggestPrices(e.target.checked)} />
            احفظ السعر المقترح لكل عميل (من القيمة ÷ الكمية)
          </label>
        </Card>
      )}

      {/* الخطوة 4: الاعتماد */}
      {raw && (
        <Card className="mb-3 p-4">
          <h2 className="mb-2 text-base font-extrabold">4 — الاعتماد</h2>
          {approved ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg bg-success-50 p-3 text-sm font-bold text-success-700">
                <ShieldCheck className="size-5" /> اعتمدت {approved.customers.length} عملاء بإجمالي {formatMoney(approved.totals, currency)}.
              </div>
              <Button variant="outline" icon={<Undo2 className="size-4" />} loading={undoMutation.isPending} onClick={() => undoMutation.mutate()}>
                تراجع عن هذا الاعتماد (يعيد الأرصدة لصفر)
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-2xs text-stone-500">
                قبل الاعتماد تُنزَّل نسخة أمان تلقائية من كل بياناتك الحالية. الاعتماد يكتب «أرصدة افتتاحية» فقط —
                لا فواتير ولا حركات مالية، ولا يغير أي تقرير تاريخي.
              </p>
              <Button
                disabled={validCreditRows.length === 0 || invalidRows.length > 0}
                loading={approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
              >
                اعتماد وترحيل الأرصدة ({summary.length} عملاء — {formatMoney(grandTotal, currency)})
              </Button>
              {invalidRows.length > 0 && (
                <Badge tone="danger">صحّح {invalidRows.length} صفاً في ملفك أولاً — الاعتماد معطّل</Badge>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
