/** اختبار الحسابات المالية — مبادئ بند 122/61 */
import { describe, it, expect } from 'vitest'
import { formatMoney, parsePositive, roundMoney, sumMoney, lineTotal } from '@/lib/money'

describe('money', () => {
  it('formatMoney يعرض منزلتين مع الرمز', () => {
    expect(formatMoney(125, '₪')).toBe('125.00 ₪')
    expect(formatMoney(1250.5, '₪')).toBe('1,250.50 ₪')
    expect(formatMoney(null, '₪')).toBe('0.00 ₪')
  })

  it('parsePositive يرفض القيم غير الموجبة', () => {
    expect(parsePositive('10')).toBe(10)
    expect(parsePositive('10.5')).toBe(10.5)
    expect(parsePositive('0')).toBeNull()
    expect(parsePositive('-5')).toBeNull()
    expect(parsePositive('abc')).toBeNull()
    expect(parsePositive('')).toBeNull()
  })

  it('roundMoney يتجنب أخطاء الفاصلة العائمة', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    expect(roundMoney(50 * 2.5)).toBe(125)
  })

  it('sumMoney يجمع بدقة السنت', () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6)
    expect(sumMoney([1000, 700, -500, -300])).toBe(900)
  })

  it('lineTotal = كمية × سعر', () => {
    expect(lineTotal(50, 2.5)).toBe(125)
    expect(lineTotal(3.5, 1.2)).toBe(4.2)
  })
})
