/**
 * Money & quantity helpers — أمان الأرقام المالية (بند 61/122).
 * كل الأموال numeric، والجمع/الطرح يجرى بالسنت (2 منازل) لتجنب أخطاء الفاصلة العائمة.
 */

export const CURRENCY_FALLBACK = '₪'

export function formatMoney(value: number | null | undefined, symbol = CURRENCY_FALLBACK): string {
  const n = Number(value ?? 0)
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${formatted} ${symbol}`
}

export function formatQty(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  const isInt = Number.isInteger(n)
  return n.toLocaleString('en-US', {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: 3,
  })
}

/** تحويل آمن من إدخال نصي إلى رقم موجب */
export function parsePositive(input: string): number | null {
  if (input.includes('-')) return null
  const cleaned = input.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** تقريب مالي: منزلتان، نصف للأعلى لتجنب 0.145 → 0.14 */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** جمع مالي آمن */
export function sumMoney(values: number[]): number {
  return roundMoney(values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100)
}

export function lineTotal(qty: number, price: number): number {
  return roundMoney(qty * price)
}

/** تطبيع كمية: حتى 3 منازل عشرية (بند 123) */
export function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
