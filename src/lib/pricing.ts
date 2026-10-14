/**
 * محرك التسعير — أسعار خاصة لكل عميل (أولوية الزبون الأولى — بياناته الحقيقية:
 * قصي 4.0 / ساهر 3.8 / فادي 3.5 لنفس الصنف).
 *
 * قواعد الأولوية (مطابقة لـresolve_product_price في 0006_customer_pricing_debt.sql):
 * 1. قاعدة نشطة تطابق الوحدة نفسها (CUSTOMER_UNIT_RULE) — الأعلى
 * 2. قاعدة نشطة للصنف بلا وحدة محددة (CUSTOMER_PRODUCT_RULE)
 * 3. السعر الافتراضي للصنف (PRODUCT_DEFAULT)
 * بين قاعدتين بنفس الخصوصية: الأحدث start_date ثم الأحدث updated_at (حتمي).
 *
 * المبدأ المحاسبي: سعر الفاتورة يُنسخ داخل كل سطر — تعديل القواعد لاحقاً
 * لا يغيّر قيمة الفواتير التاريخية أبداً.
 */
import type { LocalRow } from '@/db/db'

export type PriceSource = 'CUSTOMER_UNIT_RULE' | 'CUSTOMER_PRODUCT_RULE' | 'PRODUCT_DEFAULT'

export interface ResolvedPrice {
  price: number
  source: PriceSource
  rule_id: string | null
}

/** اليوم بصيغة ISO (yyyy-mm-dd) — نفس businessToday المحلي */
export function priceDateISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** هل القاعدة نشطة في التاريخ؟ (حدود شاملة؛ null = مفتوح) */
export function isRuleActive(rule: LocalRow, dateISO: string): boolean {
  const start = typeof rule.start_date === 'string' ? rule.start_date : null
  const end = typeof rule.end_date === 'string' ? rule.end_date : null
  if (start !== null && dateISO < start) return false
  if (end !== null && dateISO > end) return false
  return true
}

/**
 * حل سعر وحدة لصنف لعميل معين.
 * rules: قواعد customer_products الخاصة بهذا (customer_id+product_id) فقط.
 */
export function resolveUnitPrice(args: {
  customer_id: string
  product_id: string
  unit_id: string | null
  rules: LocalRow[]
  product_sale_price: number
  dateISO?: string
}): ResolvedPrice {
  const dateISO = args.dateISO ?? priceDateISO()
  const matching = args.rules.filter((r) => {
    if (String(r.customer_id) !== args.customer_id) return false
    if (String(r.product_id) !== args.product_id) return false
    if (r.unit_id != null && args.unit_id !== null && String(r.unit_id) !== args.unit_id) return false
    if (r.unit_id != null && args.unit_id === null) return false
    return isRuleActive(r, dateISO)
  })
  // الأعلى خصوصية: قاعدة بوحدة محددة تطابق؛ ثم قاعدة الأساس
  const unitRule = matching
    .filter((r) => r.unit_id != null)
    .sort(byRulePriority)
    .at(0)
  if (unitRule) {
    return { price: Number(unitRule.price), source: 'CUSTOMER_UNIT_RULE', rule_id: String(unitRule.id) }
  }
  const baseRule = matching.filter((r) => r.unit_id == null).sort(byRulePriority).at(0)
  if (baseRule) {
    return { price: Number(baseRule.price), source: 'CUSTOMER_PRODUCT_RULE', rule_id: String(baseRule.id) }
  }
  return { price: args.product_sale_price, source: 'PRODUCT_DEFAULT', rule_id: null }
}

/** الترتيب الحتمي: الأحدث start_date (الافتتاح أولوية) ثم الأحدث updated_at ثم الأحدث id */
function byRulePriority(a: LocalRow, b: LocalRow): number {
  const sd = cmpStr(a.start_date, b.start_date)
  if (sd !== 0) return -sd
  const ud = cmpStr(a.updated_at, b.updated_at)
  if (ud !== 0) return -ud
  return String(b.id ?? '').localeCompare(String(a.id ?? ''))
}

function cmpStr(x: unknown, y: unknown): number {
  const a = typeof x === 'string' ? x : ''
  const b = typeof y === 'string' ? y : ''
  if (a === b) return 0
  return a > b ? 1 : -1
}

/** حساب عمر الدين بالأيام من تاريخ الاستحقاق (due_date أو sale_date + مدة السداد) */
export function debtAgeDays(args: { sale_date: string; due_date?: string | null; payment_terms_days?: number | null }, asOfISO: string): number {
  const due = args.due_date ?? addDaysISO(args.sale_date, args.payment_terms_days ?? 0)
  const ms = Date.parse(asOfISO) - Date.parse(due)
  return Math.floor(ms / 86_400_000)
}

/** تصنيف الفئة العمرية: 0-30 / 31-60 / 61-90 / 90+ */
export function agingBucket(ageDays: number): 'current' | 'd31_60' | 'd61_90' | 'over90' {
  if (ageDays <= 30) return 'current'
  if (ageDays <= 60) return 'd31_60'
  if (ageDays <= 90) return 'd61_90'
  return 'over90'
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return priceDateISO(d)
}

/**
 * أعمار ديون عميل واحد — الطريقة المعتمدة (موحّدة مع get_receivables_aging في SQL):
 * 1) الرصيد = الافتتاحي المعتمد + مجموع الفواتير الآجلة − المدفوع
 * 2) الديون = الافتتاحي (بتاريخه) + كل فاتورة آجلة بتاريخ استحقاقها (due_date أو sale_date + مدة السداد)
 * 3) نوزع الرصيد على الديون من الأقدم للأحدث (FIFO للمدفوع ضمنياً) — كل جزء يدخل فئته العمرية
 * النتيجة: أربع فئات (0-30/31-60/61-90/90+) + أقدم استحقاق.
 */
export function computeCustomerAging(args: {
  creditSales: { id: string; total: number; sale_date: string; due_date?: string | null }[]
  paidTotal: number
  openingBalance: number
  openingBalanceDate: string | null
  payment_terms_days?: number | null
  asOfISO?: string
}): { current: number; d31_60: number; d61_90: number; over90: number; oldest_due_date: string | null } {
  const asOf = args.asOfISO ?? priceDateISO()
  const buckets = { current: 0, d31_60: 0, d61_90: 0, over90: 0 }
  const opening = Math.max(args.openingBalance, 0)
  const totalDebt = opening + args.creditSales.reduce((s, x) => s + Math.max(x.total, 0), 0)
  let pool = totalDebt - Math.max(args.paidTotal, 0)
  if (pool <= 0) return { ...buckets, oldest_due_date: null }

  type Debt = { due: string; amount: number }
  const debts: Debt[] = []
  if (opening > 0) {
    debts.push({ due: args.openingBalanceDate ?? asOf, amount: opening })
  }
  for (const s of args.creditSales) {
    if (s.total <= 0) continue
    debts.push({ due: s.due_date ?? addDaysISO(s.sale_date, args.payment_terms_days ?? 0), amount: s.total })
  }
  debts.sort((a, b) => (a.due === b.due ? 0 : a.due < b.due ? -1 : 1))

  let oldest: string | null = null
  for (const d of debts) {
    if (pool <= 0) break
    const take = Math.min(pool, d.amount)
    if (take <= 0) continue
    if (oldest === null) oldest = d.due
    buckets[agingBucket(debtAgeDays({ sale_date: d.due }, asOf))] += take
    pool -= take
  }
  return { ...buckets, oldest_due_date: oldest }
}
