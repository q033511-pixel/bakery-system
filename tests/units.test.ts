/** اختبار تحويل الوحدات (بند 11): 1 كيس = 50 كغ، 1 ربطة = 10 قطع */
import { describe, it, expect } from 'vitest'
import { buildConversionMap, convertQuantity, toBaseQty } from '@/lib/units'

const KG = 'kg'
const BAG = 'bag'
const GRAM = 'gram'
const PIECE = 'piece'
const BUNDLE = 'bundle'

function testMap() {
  return buildConversionMap([
    { from_unit_id: BAG, to_unit_id: KG, factor: 50 },
    { from_unit_id: GRAM, to_unit_id: KG, factor: 0.001 },
    { from_unit_id: BUNDLE, to_unit_id: PIECE, factor: 10 },
  ])
}

describe('unit conversions', () => {
  it('كيس → كغ بمعامل 50', () => {
    expect(convertQuantity(2, BAG, KG, testMap())).toBe(100)
  })

  it('كغ → كيس عكسي', () => {
    expect(convertQuantity(100, KG, BAG, testMap())).toBe(2)
  })

  it('غرام → كغ عبر سلسلة', () => {
    expect(convertQuantity(1500, GRAM, KG, testMap())).toBeCloseTo(1.5)
  })

  it('ربطة → قطعة = 10', () => {
    expect(convertQuantity(5, BUNDLE, PIECE, testMap())).toBe(50)
  })

  it('نفس الوحدة تُعاد كما هي', () => {
    expect(convertQuantity(7, KG, KG, testMap())).toBe(7)
  })

  it('وحدة غير مرتبطة تعيد null', () => {
    expect(convertQuantity(1, BAG, PIECE, testMap())).toBeNull()
  })

  it('toBaseQty يعيد الكمية كما هي عند غياب التحويل (سلوك متسامح)', () => {
    expect(toBaseQty(3, BAG, PIECE, testMap())).toBe(3)
    expect(toBaseQty(3, BAG, KG, testMap())).toBe(150)
  })
})
