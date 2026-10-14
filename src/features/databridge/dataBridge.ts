/**
 * ناقل البيانات — الجسر بين نسخة الموقع ونسخة سطح المكتب (بند البيانات الأسلس):
 *
 * الفكرة: ملف JSON واحد يحمل كل بيانات المخبز — يُصدَّر من أي جهاز ويُستورد على أي جهاز.
 * - لا حسابات ولا خدمات خارجية ولا بريد — الملف يُنقل بواتساب/فلاشة/بريد كما يشاء المستخدم
 * - الجلسة والرمز السري محليان لكل جهاز ولا يخرجان أبداً في الملف (لا profiles ولا cache_meta)
 * - الاستيراد «استبدال» واعٍ: نسخة أمان تلقائية قبل التنفيذ + إعادة ربط تلقائية لملف الجهاز
 *   بالنشاط المستورد (business_id) حتى تعمل كل الشاشات فوراً بعد إعادة التحميل
 *
 * لماذا لا مزامنة سحابية الآن؟ (قرار مبني على بحث):
 * - Dexie Cloud يتطلب حساباً ودخول OTP بالبريد (المستخدم رفض البريد أصلاً) واشتراكاً للتجاوز 100MB
 * - Supabase المجاني يتوقف بعد أسبوع خمول ويتطلب إدارة مشروع ومفاتيح
 * - «آخر تصدير هو الأحدث» نموذج بسيط يفهمه المستخدم غير التقني دون تعارضات مخفية
 */
import { db } from '@/db/db'
import { downloadBlob } from '@/lib/backup'

/** إصدار التطبيق — يُختم في ملف النقل للتشخيص (تُحدَّث عند كل إصدار) */
export const APP_VERSION = '8.2.0'

/** الجداول التشغيلية/التعريفية — تُصدَّر وتُستبدل عند الاستيراد */
export const BRIDGE_TABLES = [
  'businesses', 'branches', 'warehouses', 'units', 'unit_conversions',
  'product_categories', 'products', 'customers', 'suppliers', 'employees',
  'recipes', 'recipe_versions', 'recipe_items', 'inventory_movements',
  'inventory_adjustments', 'waste_records', 'transfers', 'transfer_items',
  'purchases', 'purchase_items', 'supplier_payments', 'sales', 'sale_items',
  'customer_payments', 'production_batches', 'production_consumption',
  'expense_categories', 'expenses', 'cash_accounts', 'cash_transactions',
  'vehicles', 'drivers', 'distribution_loads', 'distribution_items',
  'distribution_deliveries', 'distribution_returns', 'distribution_settlements',
  'audit_logs', 'app_settings', 'doc_sequences', 'processed_operations',
] as const

export type BridgeTable = (typeof BRIDGE_TABLES)[number]

/** الجداول المحلية للجهاز — لا تُلمس إطلاقاً (الجلسة + الرمز + الطابور + الكاش) */
export const DEVICE_LOCAL_TABLES = ['profiles', 'cache_meta', 'pending_ops'] as const

const BRIDGE_MAGIC = 'almoutmag-bridge'
const BRIDGE_FORMAT = 1

export interface BridgeMeta {
  magic: string
  format: number
  app_version: string
  exported_at: string
  business_id: string
  business_name: string
  counts: Record<string, number>
}

export interface BridgeFile {
  meta: BridgeMeta
  tables: Record<string, Record<string, unknown>[]>
}

export interface ExportResult {
  blob: Blob
  filename: string
  meta: BridgeMeta
}

export interface FileSummary {
  meta: BridgeMeta
  totalRecords: number
  keyCounts: { products: number; customers: number; suppliers: number; sales: number; purchases: number }
}

/** الخطأ المتوقع من المستخدم (ملف تالف/غريب) — رسالة عربية واضحة */
export class BridgeError extends Error {}

/** ملخص بيانات الجهاز الحالي — يساعد المستخدم يعرف أي جهاز أحدث */
export async function currentDataSummary(): Promise<{
  businessName: string
  businessId: string | null
  counts: Record<string, number>
  total: number
}> {
  const business = (await db.businesses.toArray())[0]
  const counts: Record<string, number> = {}
  let total = 0
  for (const t of BRIDGE_TABLES) {
    const c = await db.table(t).count()
    counts[t] = c
    total += c
  }
  return {
    businessName: (business?.name as string) ?? '—',
    businessId: (business?.id as string) ?? null,
    counts,
    total,
  }
}

/** تصدير كل بيانات المخبز إلى ملف JSON جاهز للتنزيل */
export async function exportBridgeFile(): Promise<ExportResult> {
  const summary = await currentDataSummary()
  if (!summary.businessId) throw new BridgeError('لا توجد بيانات نشاط لتصديرها بعد.')

  const tables: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}
  for (const t of BRIDGE_TABLES) {
    const rows = await db.table(t).toArray()
    tables[t] = rows
    counts[t] = rows.length
  }

  const meta: BridgeMeta = {
    magic: BRIDGE_MAGIC,
    format: BRIDGE_FORMAT,
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    business_id: summary.businessId,
    business_name: summary.businessName,
    counts,
  }

  const payload = JSON.stringify({ meta, tables }, null, 0)
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return {
    blob: new Blob([payload], { type: 'application/json' }),
    filename: `almoutmag-data-${stamp}.json`,
    meta,
  }
}

/** تنزيل نصي آمن — مشترك مع مركز النسخ الاحتياطية (يعمل على الويب وفي Electron) */
export { downloadBlob }

/** قراءة الملف وفحصه دون تعديل أي شيء — لعرض ما بداخله قبل القرار */
export async function inspectBridgeFile(file: File): Promise<FileSummary> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new BridgeError('الملف ليس ملف بيانات صالح (JSON غير سليم).')
  }
  const obj = parsed as Partial<BridgeFile>
  if (obj?.meta?.magic !== BRIDGE_MAGIC || typeof obj.tables !== 'object' || obj.tables === null) {
    throw new BridgeError('هذا الملف ليس ملف ناقل بيانات صادراً من النظام.')
  }
  if (obj.meta.format !== BRIDGE_FORMAT) {
    throw new BridgeError('إصدار الملف غير مدعوم — حدّث التطبيق إلى أحدث نسخة ثم أعد المحاولة.')
  }
  const tables = obj.tables as Record<string, Record<string, unknown>[]>
  const totalRecords = Object.values(tables).reduce((s, rows) => s + (Array.isArray(rows) ? rows.length : 0), 0)
  const n = (t: string) => (Array.isArray(tables[t]) ? tables[t].length : 0)
  return {
    meta: obj.meta as BridgeMeta,
    totalRecords,
    keyCounts: {
      products: n('products'),
      customers: n('customers'),
      suppliers: n('suppliers'),
      sales: n('sales'),
      purchases: n('purchases'),
    },
  }
}

/**
 * الاستيراد — استبدال واعٍ مع أمان كامل:
 * 1) يُصدَّر ملف أمان تلقائياً من بيانات الجهاز الحالية (لا يفقد المستخدم شيئاً أبداً)
 * 2) معاملة واحدة: مسح 41 جدولاً + إدخال بيانات الملف
 * 3) إعادة ربط مالك هذا الجهاز بالنشاط المستورد + مسح الكاش
 * لا نلمس: profiles / cache_meta / pending_ops (الجلسة والرمز السري يبقيان كما هما)
 */
export async function importBridgeFile(
  file: File,
  hooks?: { onPhase?: (phase: 'backup' | 'import' | 'relink') => void },
): Promise<{ businessName: string; importedRecords: number }> {
  const summary = await inspectBridgeFile(file)
  const tables = (JSON.parse(await file.text()) as BridgeFile).tables

  hooks?.onPhase?.('backup')
  // نسخة الأمان — إن فشل شيء لاحقاً يملك المستخدم ملف استرجاع فوري
  try {
    const backup = await exportBridgeFile()
    downloadBlob(backup.blob, backup.filename.replace('almoutmag-data-', 'almoutmag-safety-'))
  } catch {
    /* جهاز بلا بيانات بعد — لا نسخة أمان مطلوبة */
  }

  hooks?.onPhase?.('import')
  const importedBusinessId = summary.meta.business_id
  const tableRefs = BRIDGE_TABLES.map((t) => db.table(t))

  await db.transaction('rw', tableRefs, async () => {
    for (const t of BRIDGE_TABLES) await db.table(t).clear()
    for (const t of BRIDGE_TABLES) {
      const rows = tables[t]
      if (Array.isArray(rows) && rows.length > 0) await db.table(t).bulkAdd(rows as never[])
    }
  })

  hooks?.onPhase?.('relink')
  // إعادة ربط مالك هذا الجهاز بالنشاط المستورد (الجلسة تبقى كما هي)
  // role غير مفهرس عمداً — الفلترة في الذاكرة (نفس نمط adapter.findOwner)
  const owner = (await db.profiles.toArray()).find((p) => p.role === 'OWNER')
  if (owner) await db.profiles.update(owner.id as string, { business_id: importedBusinessId } as never)

  // مسح الكاش حتى تُبنى القوائم من البيانات الجديدة فوراً
  const cacheTables = db.tables.filter((t) => t.name.startsWith('cache_') && t.name !== 'cache_meta')
  for (const t of cacheTables) await t.clear()

  return { businessName: summary.meta.business_name, importedRecords: summary.totalRecords }
}
