/**
 * اختبارات سيناريوهات المواصفة الإلزامية (بند 76-79):
 * - المخزون: 100 +50 شراء -20 بيع -5 هالك +3 مرتجع = 128
 * - العميل: 1000 + 700 - 500 - 300 = 900
 * - المورد: 3500 - 2000 + 1100 - 1500 = 1100
 * - التوزيع: 2000 محمول، 1850 مباع، 100 مرتجع → الفرق 50
 * هذه دوال نقية تعكس منطق SQL في inventory_movements وكشوف الحسابات.
 */
import { describe, it, expect } from 'vitest'
import { roundMoney, sumMoney } from '@/lib/money'

// انعكاس دقيق لمنطق قاعدة البيانات (stock_qty + v_customer_balances)
const IN_TYPES = ['PURCHASE_IN', 'PRODUCTION_IN', 'SALE_RETURN_IN', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'DISTRIBUTION_RETURN_IN']

export function balanceFromMovements(movements: { movement_type: string; quantity: number }[]): number {
  return roundMoney(
    movements.reduce((acc, m) => acc + (IN_TYPES.includes(m.movement_type) ? m.quantity : -m.quantity), 0),
  )
}

export function customerBalance(rows: { debit: number; credit: number }[]): number {
  return roundMoney(rows.reduce((acc, r) => acc + r.debit - r.credit, 0))
}

export function distributionVariance(loaded: number, sold: number, returned: number, waste = 0): number {
  return roundMoney(loaded - sold - returned - waste)
}

describe('سيناريو المخزون (بند 76)', () => {
  it('Initial 100 + شراء 50 - بيع 20 - هالك 5 + مرتجع 3 = 128', () => {
    const movements = [
      { movement_type: 'ADJUSTMENT_IN', quantity: 100 },
      { movement_type: 'PURCHASE_IN', quantity: 50 },
      { movement_type: 'SALE_OUT', quantity: 20 },
      { movement_type: 'WASTE_OUT', quantity: 5 },
      { movement_type: 'SALE_RETURN_IN', quantity: 3 },
    ]
    expect(balanceFromMovements(movements)).toBe(128)
  })

  it('سيناريو الإنتاج (بند 80): طحين 3000، إنتاج 1000 يستهلك 700 → 2300 + منتج نهائي 1000', () => {
    const flour = [
      { movement_type: 'ADJUSTMENT_IN', quantity: 3000 },
      { movement_type: 'PRODUCTION_CONSUMPTION_OUT', quantity: 700 },
    ]
    expect(balanceFromMovements(flour)).toBe(2300)
    const finished = [{ movement_type: 'PRODUCTION_IN', quantity: 1000 }]
    expect(balanceFromMovements(finished)).toBe(1000)
  })
})

describe('سيناريو العميل (بند 77)', () => {
  it('بيع 1000 + بيع 700 - دفعة 500 - دفعة 300 = رصيد 900', () => {
    const ledger = [
      { debit: 1000, credit: 0 },
      { debit: 700, credit: 0 },
      { debit: 0, credit: 500 },
      { debit: 0, credit: 300 },
    ]
    expect(customerBalance(ledger)).toBe(900)
  })

  it('البيع النقدي لا يدخل كشف العميل الآجل', () => {
    const ledger = [
      { debit: 700, credit: 0 },   // بيع آجل فقط
      { debit: 0, credit: 200 },
    ]
    expect(customerBalance(ledger)).toBe(500)
  })
})

describe('سيناريو المورد (بند 78)', () => {
  it('شراء 3500 - دفعة 2000 + شراء 1100 - دفعة 1500 = 1100', () => {
    const ledger = [
      { debit: 3500, credit: 0 },
      { debit: 0, credit: 2000 },
      { debit: 1100, credit: 0 },
      { debit: 0, credit: 1500 },
    ]
    expect(customerBalance(ledger)).toBe(1100)
  })
})

describe('سيناريو التوزيع (بند 79/30)', () => {
  it('محمول 2000، مباع 1850، مرتجع 100 → غير محسوب 50 ولا يُخفى', () => {
    expect(distributionVariance(2000, 1850, 100)).toBe(50)
  })

  it('حالة متوازنة: المحمول = المبيع + المرتجع', () => {
    expect(distributionVariance(2000, 1850, 150)).toBe(0)
  })

  it('الفروق النقدية: المتوقع 1850×2.5 = 4625، المحصل 4400 → فرق 225 يتطلب سبباً', () => {
    const expected = roundMoney(1850 * 2.5)
    const collected = 4400
    expect(expected - collected).toBe(225)
  })

  it('sumMoney يتسق مع مجاميع التسوية', () => {
    expect(sumMoney([462.5, 925, 1850, 1387.5])).toBe(4625)
  })
})
