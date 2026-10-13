/**
 * اختبار ناقل البيانات — الجسر بين الأجهزة:
 * تصدير → التعديل على «الجهاز الآخر» → استيراد (استبدال) → مطابقة كاملة
 * + التحقق: الجلسة والرمز السري لا يُلمسان، وملف المالك يُعاد ربطه بالنشاط المستورد
 * + رفض الملفات الغريبة برسالة عربية واضحة
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db, setMeta, getMeta } from '@/db/db'
import {
  BridgeError, BRIDGE_TABLES, DEVICE_LOCAL_TABLES, currentDataSummary,
  exportBridgeFile, importBridgeFile, inspectBridgeFile,
} from './dataBridge'

async function seed(): Promise<{ businessId: string; ownerId: string }> {
  const businessId = crypto.randomUUID()
  const ownerId = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.businesses.put({
    id: businessId, name: 'مخبز النور', currency: 'ILS', currency_symbol: '₪',
    timezone: 'Asia/Jerusalem', created_at: now, updated_at: now,
  } as never)
  await db.profiles.put({
    id: ownerId, email: 'owner@local', full_name: 'المالك', phone: null,
    role: 'OWNER', active: true, business_id: businessId,
    local_password: 'hash', created_at: now, updated_at: now,
  } as never)
  await db.products.bulkPut([
    { id: crypto.randomUUID(), business_id: businessId, code: 'P-0001', name: 'طحين', item_type: 'RAW_MATERIAL', sale_price: 0, active: true, created_at: now, updated_at: now },
    { id: crypto.randomUUID(), business_id: businessId, code: 'P-0002', name: 'خبز', item_type: 'FINISHED_PRODUCT', sale_price: 2, active: true, created_at: now, updated_at: now },
  ] as never[])
  await db.customers.bulkPut([
    { id: crypto.randomUUID(), business_id: businessId, code: 'C-0001', name: 'أبو أحمد', active: true, created_at: now, updated_at: now },
  ] as never[])
  await db.sales.bulkPut([
    { id: crypto.randomUUID(), business_id: businessId, doc_number: 'INV-000001', total: 20, status: 'COMPLETED', created_at: now, updated_at: now },
  ] as never[])
  await setMeta('local_session', { userId: ownerId })
  return { businessId, ownerId }
}

function fileFrom(json: string): File {
  return new File([json], 'almoutmag-data-test.json', { type: 'application/json' })
}

describe('ناقل البيانات', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('التصدير يغطي كل جداول النشاط ويستثني الجلسة والرمز السري', async () => {
    await seed()
    const res = await exportBridgeFile()
    expect(res.meta.magic).toBe('almoutmag-bridge')
    expect(res.meta.business_name).toBe('مخبز النور')
    expect(res.filename).toMatch(/^almoutmag-data-\d{8}-\d{4}\.json$/)
    const parsed = JSON.parse(await res.blob.text()) as { tables: Record<string, unknown[]> }
    for (const t of BRIDGE_TABLES) expect(t in parsed.tables, `جدول ${t} مفقود من التصدير`).toBe(true)
    for (const t of DEVICE_LOCAL_TABLES) expect(t in parsed.tables).toBe(false)
    expect(parsed.tables.products).toHaveLength(2)
    expect(parsed.tables.customers).toHaveLength(1)
    // لا كلمة مرور ولا جلسة داخل الملف
    const raw = await res.blob.text()
    expect(raw).not.toContain('local_password')
    expect(raw).not.toContain('local_session')
  })

  it('الاستيراد يستبدل بيانات الجهاز بالكامل ويعيد ربط المالك ولا يلمس الجلسة', async () => {
    const { businessId } = await seed()
    const res = await exportBridgeFile()

    // «الجهاز الآخر»: بيانات مختلفة — نشاط آخر وسجل جديد أُضيف بعد التصدير
    await db.delete()
    await db.open()
    const now = new Date().toISOString()
    const otherOwner = crypto.randomUUID()
    const otherBusiness = crypto.randomUUID()
    await db.businesses.put({ id: otherBusiness, name: 'مخبز آخر', created_at: now, updated_at: now } as never)
    await db.profiles.put({
      id: otherOwner, email: 'o@l', full_name: '', phone: null, role: 'OWNER', active: true,
      business_id: otherBusiness, local_password: 'h2', created_at: now, updated_at: now,
    } as never)
    await db.customers.bulkPut([
      { id: crypto.randomUUID(), business_id: otherBusiness, code: 'C-9001', name: 'عميل زائد', active: true, created_at: now, updated_at: now },
    ] as never[])
    await setMeta('local_session', { userId: otherOwner })

    const file = fileFrom(await res.blob.text())
    const summary = await inspectBridgeFile(file)
    expect(summary.meta.business_id).toBe(businessId)
    expect(summary.keyCounts.products).toBe(2)

    const result = await importBridgeFile(file)
    expect(result.businessName).toBe('مخبز النور')

    // بيانات «الجهاز الآخر» استُبدلت بالكامل ببيانات الملف
    expect(await db.businesses.count()).toBe(1)
    expect(((await db.businesses.toArray())[0])?.name).toBe('مخبز النور')
    expect((await db.customers.toArray()).some((c) => c.name === 'عميل زائد')).toBe(false)
    expect(await db.customers.count()).toBe(1)
    expect(await db.products.count()).toBe(2)
    expect(await db.sales.count()).toBe(1)

    // إعادة الربط: مالك الجهاز صار على النشاط المستورد (role غير مفهرس — فلترة بالذاكرة)
    const owner = (await db.profiles.toArray()).find((p) => p.role === 'OWNER')
    expect(owner?.business_id).toBe(businessId)
    expect(owner?.id).toBe(otherOwner)

    // الجلسة لم تُلمس — المستخدم ما زال داخل النظام برمزه المحلي
    const session = await getMeta<{ userId: string }>('local_session')
    expect(session?.userId).toBe(otherOwner)
    expect(businessId).toBeTruthy()
  })

  it('الملفات الغريبة تُرفض برسالة عربية واضحة', async () => {
    await expect(inspectBridgeFile(fileFrom('{"hello":"world"}'))).rejects.toBeInstanceOf(BridgeError)
    await expect(inspectBridgeFile(fileFrom('not json at all'))).rejects.toBeInstanceOf(BridgeError)
    await expect(inspectBridgeFile(fileFrom('{"meta":{"magic":"other"},"tables":{}}'))).rejects.toBeInstanceOf(BridgeError)
    await expect(inspectBridgeFile(fileFrom(JSON.stringify({ meta: { magic: 'almoutmag-bridge', format: 99 }, tables: {} })))).rejects.toBeInstanceOf(BridgeError)
  })

  it('ملخص الجهاز الحالي يعكس الأرقام الفعلية', async () => {
    const { businessId } = await seed()
    const s = await currentDataSummary()
    expect(s.businessId).toBe(businessId)
    expect(s.businessName).toBe('مخبز النور')
    expect(s.counts.products).toBe(2)
    expect(s.counts.customers).toBe(1)
    expect(s.total).toBeGreaterThan(0)
  })
})
