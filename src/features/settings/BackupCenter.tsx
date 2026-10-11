/**
 * مركز النسخ الاحتياطية — قلب أمان الوضع المحلي (بند 40/132):
 * كل البيانات على هذا الجهاز فقط → النسخة الاحتياطية هي التأمين الوحيد.
 * تصدير JSON كامل لكل الجداول + استيراد/استعادة + تصفير المصنع + مؤشر التخزين.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card } from '@/components/ui/primitives'
import { ConfirmDialog } from '@/components/ui/overlays'
import { useToast } from '@/lib/toast'
import { db } from '@/db/db'
import { fmtDateTime } from '@/lib/dates'
import {
  exportBackupFile, parseBackup, restoreBackup, wipeAllData, lastBackupAt, type BackupFile,
} from '@/lib/backup'
import {
  Download, Upload, HardDrive, Trash2, Database,
  FileJson, Info, CheckCircle2,
} from 'lucide-react'

const KEY_TABLES = [
  'sales', 'sale_items', 'purchases', 'purchase_items', 'products', 'customers',
  'suppliers', 'customer_payments', 'supplier_payments', 'expenses', 'inventory_movements',
  'production_batches', 'recipes', 'businesses', 'audit_logs',
] as const

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`
}

export default function BackupCenter() {
  const toast = useToast()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [totalRows, setTotalRows] = useState(0)
  const [storage, setStorage] = useState<{ used: string; quota: string } | null>(null)
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [confirmImport, setConfirmImport] = useState<BackupFile | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLastBackup(lastBackupAt())
    void navigator.storage?.estimate?.().then((est) => {
      setStorage({
        used: humanSize(est.usage ?? 0),
        quota: humanSize(est.quota ?? 0),
      })
    }).catch(() => setStorage(null))
  }, [])

  const refreshCounts = useCallback(async () => {
    const names = db.tables.map((t) => t.name)
    const entries: [string, number][] = []
    let total = 0
    for (const n of names) {
      const c = await db.table(n).count()
      entries.push([n, c])
      total += c
    }
    setCounts(Object.fromEntries(entries))
    setTotalRows(total)
  }, [])

  useEffect(() => { void refreshCounts() }, [refreshCounts])

  // ---------- التصدير ----------
  const doExport = async () => {
    setExporting(true)
    try {
      await exportBackupFile()
      const now = lastBackupAt()
      setLastBackup(now)
      toast.success('تم تنزيل النسخة الاحتياطية — احتفظ بها في مكان آمن')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إنشاء النسخة الاحتياطية.')
    } finally {
      setExporting(false)
    }
  }

  // ---------- الاستيراد ----------
  const onPickFile = async (file: File) => {
    try {
      setImportBusy(true)
      const parsed = parseBackup(await file.text())
      if (!parsed) {
        toast.error('الملف ليس نسخة احتياطية صالحة لهذا النظام.')
        return
      }
      setConfirmImport(parsed)
    } catch {
      toast.error('تعذر قراءة الملف — تأكد أنه ملف نسخة احتياطية JSON.')
    } finally {
      setImportBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const doImport = async (backup: BackupFile) => {
    setImportBusy(true)
    try {
      await restoreBackup(backup)
      toast.success('تمت الاستعادة بنجاح — جارٍ إعادة التحميل...')
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      setImportBusy(false)
      toast.error(e instanceof Error ? e.message : 'فشل الاستيراد — تأكد من سلامة الملف.')
    }
  }

  // ---------- التصفير ----------
  const doWipe = async () => {
    try {
      await wipeAllData()
      toast.success('تم مسح كل البيانات — إعادة التحميل...')
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التصفير.')
    }
  }

  const dismissReminder = () => {
    localStorage.setItem('bakery.backup_reminder_dismissed', String(Date.now()))
    toast.info('سنذكّرك بالنسخة الاحتياطية بعد أسبوع.')
  }

  return (
    <div className="space-y-4">
      <PageHeader title="مركز النسخ الاحتياطية" subtitle="بياناتك على هذا الجهاز — النسخة الاحتياطية هي تأمينك الوحيد" backTo="/settings" />

      {/* الحالة الحالية */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
            <Database className="size-4 text-primary-600" /> حالة قاعدة البيانات المحلية
          </h2>
          <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-2xs font-extrabold tabular-nums text-stone-600">
            {totalRows.toLocaleString('ar-EG')} صف
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {KEY_TABLES.map((name) => (
            <div key={name} className="rounded-lg bg-surface-50 px-2 py-2 text-center">
              <p className="truncate text-2xs font-bold text-stone-500">{tableLabel(name)}</p>
              <p className="text-sm font-extrabold tabular-nums text-stone-900">{(counts[name] ?? 0).toLocaleString('ar-EG')}</p>
            </div>
          ))}
        </div>
        {storage && (
          <p className="mt-3 flex items-center gap-1.5 text-2xs text-stone-500">
            <HardDrive className="size-3.5" /> المساحة المستخدمة: <b className="tabular-nums">{storage.used}</b> من {storage.quota}
          </p>
        )}
        {lastBackup && (
          <p className="mt-1.5 flex items-center gap-1.5 text-2xs font-bold text-success-700">
            <CheckCircle2 className="size-3.5" /> آخر نسخة احتياطية: {fmtDateTime(lastBackup)}
          </p>
        )}
      </Card>

      {/* التصدير */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-600">
            <Download className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-extrabold text-stone-900">تصدير نسخة احتياطية كاملة</h3>
            <p className="mt-1 text-2xs leading-relaxed text-stone-500">
              ملف JSON واحد يشمل كل شيء: الفواتير والمخزون والعملاء والإعدادات. احفظه على فلاشة أو بريدك الإلكتروني أسبوعياً على الأقل.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="success" loading={exporting} icon={<FileJson className="size-4" />} onClick={() => void doExport()}>
                تنزيل النسخة الآن
              </Button>
              {!lastBackup && (
                <button onClick={dismissReminder} className="text-2xs font-bold text-stone-400 hover:underline">
                  ذكّرني لاحقاً
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* الاستيراد */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info-50 text-info-600">
            <Upload className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-extrabold text-stone-900">استعادة من نسخة احتياطية</h3>
            <p className="mt-1 text-2xs leading-relaxed text-stone-500">
              عند تغيير الجهاز أو بعد أي مشكلة — اختر ملف النسخة وسيُستبدل محتوى هذا الجهاز بمحتواها بالكامل.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f) }}
            />
            <Button variant="outline" className="mt-3" loading={importBusy} icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
              اختيار ملف النسخة...
            </Button>
          </div>
        </div>
      </Card>

      {/* معلومة أمان */}
      <Card className="flex items-start gap-3 border-info-200 bg-info-50/60 p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-info-600" />
        <p className="text-2xs leading-relaxed text-info-900">
          <b>نصيحة احترافية:</b> انسخ ملفات النسخ الاحتياطية إلى مكان خارج الجهاز (فلاشة USB أو بريد إلكتروني).
          ملف النسخة يبقى صالحاً للأبد ويمكن استعادته على أي جهاز عليه هذا النظام.
        </p>
      </Card>

      {/* منطقة الخطر */}
      <Card className="border-danger-200 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger-50 text-danger-600">
            <Trash2 className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-extrabold text-danger-700">منطقة الخطر — تصفير المصنع</h3>
            <p className="mt-1 text-2xs leading-relaxed text-stone-500">
              مسح كل البيانات نهائياً من هذا الجهاز والعودة لحالة أول تشغيل. لا يمكن التراجع — تأكد من وجود نسخة احتياطية أولاً.
            </p>
            <Button variant="danger" className="mt-3" onClick={() => setConfirmWipe(true)}>
              مسح كل البيانات...
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={!!confirmImport}
        onClose={() => setConfirmImport(null)}
        onConfirm={() => confirmImport && void doImport(confirmImport)}
        loading={importBusy}
        danger
        title="استعادة النسخة الاحتياطية؟"
        message={`سيتم استبدال كل بيانات هذا الجهاز بمحتوى النسخة (${fmtDateTime(confirmImport?.exported_at ?? '')}). هذا الإجراء لا يمكن التراجع عنه.`}
        confirmLabel="نعم، استعادة"
      />

      <ConfirmDialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        onConfirm={() => void doWipe()}
        danger
        title="مسح كل البيانات نهائياً؟"
        message="ستفقد كل الفواتير والمخزون والحسابات على هذا الجهاز. إذا لم تكن لديك نسخة احتياطية فلن يكون هناك أي استرجاع."
        confirmLabel="نعم، امسح كل شيء"
      />
    </div>
  )
}

function tableLabel(name: string): string {
  const labels: Record<string, string> = {
    sales: 'فواتير البيع', sale_items: 'بنود البيع', purchases: 'المشتريات', purchase_items: 'بنود الشراء',
    products: 'المنتجات', customers: 'العملاء', suppliers: 'الموردون', customer_payments: 'تحصيلات',
    supplier_payments: 'دفعات الموردين', expenses: 'المصروفات', inventory_movements: 'حركات المخزون',
    production_batches: 'دفعات الإنتاج', recipes: 'الوصفات', businesses: 'النشاط', audit_logs: 'سجل التدقيق',
  }
  return labels[name] ?? name
}
