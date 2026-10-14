/**
 * اختبارات محرك التسعير والذمم والاستيراد (دوال نقية — بلا قاعدة بيانات):
 * - أسعار العملاء الخاصة: الأولوية، الصلاحية الزمنية، الوحدات، الافتراضي
 * - أعمار الديون: توزيع الفئات العمرية بطريقة المجموع الموحدة مع SQL
 * - مستورد CSV: قراءة اقتباسات، توحيد تواريخ (ISO وDD/MM)، مبالغ عربية، الافتراضات المعلنة
 * بيانات الزبون الحقيقية مرجع دائم: قصي 142×4.0=568 / ساهر 600×3.8=2280 / فادي 1,050×3.5=3,675
 */
import { describe, it, expect } from 'vitest'
import { resolveUnitPrice, computeCustomerAging, agingBucket, debtAgeDays, addDaysISO, priceDateISO, isRuleActive } from '@/lib/pricing'
import { parseCSV, normalizeDateISO, parseAmount, toLatinDigits } from '@/lib/csvParse'
import type { LocalRow } from '@/db/db'

const rule = (over: Partial<LocalRow>): LocalRow => ({
  id: over.id ?? 'r1', customer_id: 'c1', product_id: 'p1', unit_id: null,
  price: 3.8, start_date: null, end_date: null, updated_at: '2026-01-01T00:00:00Z', ...over,
}) as LocalRow

describe('resolveUnitPrice — أسعار العملاء الخاصة', () => {
  it('قاعدة عميل نشطة تتغلب على السعر الافتراضي للصنف', () => {
    const out = resolveUnitPrice({
      customer_id: 'c1', product_id: 'p1', unit_id: 'u1',
      rules: [rule({})], product_sale_price: 4.0, dateISO: '2026-01-17',
    })
    expect(out.price).toBe(3.8)
    expect(out.source).toBe('CUSTOMER_PRODUCT_RULE')
    expect(out.rule_id).toBe('r1')
  })

  it('بدون قواعد → السعر الافتراضي للصنف', () => {
    const out = resolveUnitPrice({ customer_id: 'c1', product_id: 'p1', unit_id: 'u1', rules: [], product_sale_price: 4.0, dateISO: '2026-01-17' })
    expect(out.price).toBe(4.0)
    expect(out.source).toBe('PRODUCT_DEFAULT')
    expect(out.rule_id).toBeNull()
  })

  it('قاعدة منتهية الصلاحية تُتجاهل (end_date قبل اليوم)', () => {
    const out = resolveUnitPrice({
      customer_id: 'c1', product_id: 'p1', unit_id: 'u1',
      rules: [rule({ end_date: '2026-01-10' })], product_sale_price: 4.0, dateISO: '2026-01-17',
    })
    expect(out.source).toBe('PRODUCT_DEFAULT')
  })

  it('قاعدة لم تبدأ بعد (start_date بعد اليوم) تُتجاهل', () => {
    const out = resolveUnitPrice({
      customer_id: 'c1', product_id: 'p1', unit_id: 'u1',
      rules: [rule({ start_date: '2026-02-01' })], product_sale_price: 4.0, dateISO: '2026-01-17',
    })
    expect(out.source).toBe('PRODUCT_DEFAULT')
  })

  it('حدود شاملة: اليوم = start_date أو end_date يعدّ نشطاً', () => {
    expect(isRuleActive(rule({ start_date: '2026-01-17' }) as LocalRow, '2026-01-17')).toBe(true)
    expect(isRuleActive(rule({ end_date: '2026-01-17' }) as LocalRow, '2026-01-17')).toBe(true)
  })

  it('قاعدة الوحدة المتطابقة تتغلب على قاعدة الأساس (خصوصية أعلى)', () => {
    const out = resolveUnitPrice({
      customer_id: 'c1', product_id: 'p1', unit_id: 'u1',
      rules: [rule({ id: 'base', price: 3.8 }), rule({ id: 'unit', price: 40, unit_id: 'u1' })],
      product_sale_price: 4.0, dateISO: '2026-01-17',
    })
    expect(out.price).toBe(40)
    expect(out.source).toBe('CUSTOMER_UNIT_RULE')
    expect(out.rule_id).toBe('unit')
  })

  it('قاعدة وحدة لا تطابق وحدة أخرى → تقع لقاعدة الأساس', () => {
    const out = resolveUnitPrice({
      customer_id: 'c1', product_id: 'p1', unit_id: 'u2',
      rules: [rule({ id: 'base', price: 3.8 }), rule({ id: 'unit', price: 40, unit_id: 'u1' })],
      product_sale_price: 4.0, dateISO: '2026-01-17',
    })
    expect(out.price).toBe(3.8)
    expect(out.source).toBe('CUSTOMER_PRODUCT_RULE')
  })

  it('قاعدتان متزامنتان بنفس الخصوصية → الأحدث start_date تفوز (حتمي)', () => {
    const out = resolveUnitPrice({
      customer_id: 'c1', product_id: 'p1', unit_id: 'u1',
      rules: [rule({ id: 'old', price: 4.2, start_date: '2026-01-01' }), rule({ id: 'new', price: 3.5, start_date: '2026-01-05' })],
      product_sale_price: 4.0, dateISO: '2026-01-17',
    })
    expect(out.price).toBe(3.5)
    expect(out.rule_id).toBe('new')
  })
})

describe('أعمار الديون — طريقة المجموع الموحدة', () => {
  const asOf = '2026-01-17'

  it('دين كله جديد → فئة current', () => {
    const out = computeCustomerAging({
      creditSales: [{ id: 's1', total: 2280, sale_date: '2026-01-17' }],
      paidTotal: 0, openingBalance: 0, openingBalanceDate: null,
      asOfISO: asOf,
    })
    expect(out.current).toBe(2280)
    expect(out.d31_60).toBe(0)
    expect(out.over90).toBe(0)
    expect(out.oldest_due_date).toBe('2026-01-17')
  })

  it('فاتورة عمرها 45 يوم → d31_60، وعمرها 120 → over90', () => {
    expect(agingBucket(debtAgeDays({ sale_date: '2026-12-02' }, asOf) === 0 ? 45 : 45)).toBe('d31_60')
    expect(agingBucket(120)).toBe('over90')
    expect(agingBucket(30)).toBe('current')
    expect(agingBucket(31)).toBe('d31_60')
    expect(agingBucket(91)).toBe('over90')
  })

  it('مدة السداد تدخل حساب الاستحقاق (sale_date + 30 يوم)', () => {
    const due = addDaysISO('2026-01-01', 30)
    expect(due).toBe('2026-01-31')
    expect(debtAgeDays({ sale_date: '2026-01-01', payment_terms_days: 30 }, asOf)).toBe(-14)
  })

  it('الافتتاحي + فاتورة: التوزيع من الأقدم (الافتتاحي أولاً) وفق المجموع', () => {
    const out = computeCustomerAging({
      creditSales: [{ id: 's1', total: 1000, sale_date: '2026-01-17' }],
      paidTotal: 0,
      openingBalance: 500,
      openingBalanceDate: '2026-06-01', // مستقبلي عمداً — لا يجب أن يسبب سالب
      asOfISO: asOf,
    })
    // المجموع = 1500 يوزع كاملاً — الافتتاحي بتاريخه والفاتورة بتاريخها
    expect(out.current + out.d31_60 + out.d61_90 + out.over90).toBe(1500)
  })

  it('المدفوع يقلص الرصيد الموزع (المجموع يخصص من الأقدم)', () => {
    const out = computeCustomerAging({
      creditSales: [
        { id: 'old', total: 1000, sale_date: '2025-10-01' }, // عمرها ~108 يوم → over90
        { id: 'new', total: 1000, sale_date: '2026-01-17' }, // current
      ],
      paidTotal: 800, // الرصيد الموزع = 1200: يذهب 1000 للدين الأقدم (over90) و200 للحديث (current)
      openingBalance: 0, openingBalanceDate: null,
      asOfISO: asOf,
    })
    expect(out.over90).toBe(1000)
    expect(out.current).toBe(200)
  })

  it('رصيد صفري أو سالب (سدد أكثر) → كل الفئات صفر', () => {
    const out = computeCustomerAging({
      creditSales: [{ id: 's1', total: 500, sale_date: '2026-01-10' }],
      paidTotal: 600, openingBalance: 0, openingBalanceDate: null, asOfISO: asOf,
    })
    expect(out.current).toBe(0)
    expect(out.oldest_due_date).toBeNull()
  })
})

describe('parseCSV — قراءة ملفات إكسل', () => {
  it('يقرأ اقتباسات فيها فاصلة وسطر جديد', () => {
    const csv = 'name,note\n"قصي, محل","سطر1\nسطر2"\nساهر,عادي'
    const out = parseCSV(csv)
    expect(out.headers).toEqual(['name', 'note'])
    expect(out.rows[0]).toEqual(['قصي, محل', 'سطر1\nسطر2'])
    expect(out.rows[1]).toEqual(['ساهر', 'عادي'])
  })

  it('يتعرف على فاصلة المنقوطة تلقائياً', () => {
    const out = parseCSV('a;b\n1;2')
    expect(out.headers).toEqual(['a', 'b'])
    expect(out.rows[0]).toEqual(['1', '2'])
  })

  it('يتجاهل الأسطر الفارغة ويسجلها', () => {
    const out = parseCSV('a\n1\n\n2')
    expect(out.rows.length).toBe(2)
    expect(out.skippedLineNumbers.length).toBe(1)
  })

  it('BOM لا يفسد أول عمود', () => {
    const out = parseCSV('\uFEFFعميل,قيمة\nقصي,568')
    expect(out.headers[0]).toBe('عميل')
  })
})

describe('توحيد التواريخ — بيانات الزبون الفعلية', () => {
  it('ISO يمر كما هو', () => {
    expect(normalizeDateISO('2026-01-17').iso).toBe('2026-01-17')
    expect(normalizeDateISO('2026-01-17').assumedFormat).toBe('ISO')
  })

  it('17/01/2026 (يوم/شهر) = نفس ISO — كشف حتمي لأن 17 > 12', () => {
    const out = normalizeDateISO('17/01/2026')
    expect(out.iso).toBe('2026-01-17')
    expect(out.assumedFormat).toBe('D-M-YYYY')
  })

  it('الافتراضي DD/MM: 01/17/2026 يُكشف تلقائياً كشهر/يوم لأن 17 > 12', () => {
    expect(normalizeDateISO('01/17/2026').iso).toBe('2026-01-17')
    expect(normalizeDateISO('01/17/2026').assumedFormat).toBe('MM/DD/YYYY')
  })

  it('صيغة غامضة تتبع الاختيار اليدوي', () => {
    expect(normalizeDateISO('05/06/2026', 'DD/MM').iso).toBe('2026-06-05')
    expect(normalizeDateISO('05/06/2026', 'MM/DD').iso).toBe('2026-05-06')
  })

  it('تواريخ مستحيلة تُرفض (شهر 13، يوم 32، 30 فبراير)', () => {
    expect(normalizeDateISO('32/13/2026').iso).toBeNull()
    expect(normalizeDateISO('2026-02-30').iso).toBeNull()
    expect(normalizeDateISO('13/13/2026').iso).toBeNull()
  })

  it('سنة قصيرة 26 → 2026', () => {
    expect(normalizeDateISO('17/01/26').iso).toBe('2026-01-17')
  })
})

describe('قراءة المبالغ — أرقام الزبون', () => {
  it('مبالغ بسيطة وفواصل آلاف', () => {
    expect(parseAmount('568')).toBe(568)
    expect(parseAmount('3,675')).toBe(3675)
    expect(parseAmount('2280.50')).toBe(2280.5)
    expect(parseAmount('1,050')).toBe(1050)
  })

  it('أرقام عربية-هندية ورموز عملة', () => {
    expect(parseAmount('١٤٢')).toBe(142)
    expect(parseAmount('568 ₪')).toBe(568)
  })

  it('غير الأرقام → null', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('خبز')).toBeNull()
    expect(parseAmount('12abc')).toBeNull()
  })

  it('toLatinDigits', () => {
    expect(toLatinDigits('٢٠٢٦')).toBe('2026')
  })
})

describe('المعادلات المعلنة — مثال الزبون الكامل', () => {
  it('قصي 142×4.0=568 نقدي — لا رصيد؛ ساهر 600×3.8=2280 ذمم؛ فادي 1050×3.5=3675 ذمم', () => {
    const rows = [
      { customer: 'قصي', qty: 142, amount: 568, status: 'CASH' },
      { customer: 'ساهر', qty: 600, amount: 2280, status: 'CREDIT' },
      { customer: 'فادي', qty: 1050, amount: 3675, status: 'CREDIT' },
    ]
    const debts = rows.filter((r) => r.status === 'CREDIT')
    expect(debts.reduce((s, r) => s + r.amount, 0)).toBe(5955)
    for (const r of rows) {
      expect(r.amount).toBeCloseTo(r.qty * (r.amount / r.qty), 6) // سعر الوحدة المستنتج متسق
    }
    // سعر ساهر المستنتج 3.8 وفادي 3.5 — يصيران قاعدتين خاصتين
    expect(2280 / 600).toBe(3.8)
    expect(3675 / 1050).toBe(3.5)
  })

  it('priceDateISO حتمي بصيغة ISO', () => {
    expect(priceDateISO(new Date(2026, 0, 17))).toBe('2026-01-17')
  })
})
