/**
 * ناقل البيانات — نقل بيانات المخبز بين نسخة الموقع ونسخة الويندوز بملف واحد.
 * التصدير: ملف JSON يحمل كل بيانات النشاط (بلا جلسة/رمز سري).
 * الاستيراد: نسخة أمان تلقائية أولاً ثم استبدال مع إعادة ربط تلقائية للنشاط.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Download, Upload, FileJson, ShieldCheck, ArrowLeftRight, Info, CheckCircle2, Loader2,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/navigation'
import { Badge, Button, Card } from '@/components/ui/primitives'
import { useToast } from '@/lib/toast'
import { useQueryClient } from '@tanstack/react-query'
import {
  BridgeError, APP_VERSION, currentDataSummary, downloadBlob, exportBridgeFile,
  importBridgeFile, inspectBridgeFile, type FileSummary,
} from './dataBridge'

export default function DataBridgePage() {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [current, setCurrent] = useState<Awaited<ReturnType<typeof currentDataSummary>> | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [phase, setPhase] = useState<'backup' | 'import' | 'relink' | null>(null)
  const [picked, setPicked] = useState<{ file: File; summary: FileSummary } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void currentDataSummary().then(setCurrent).catch(() => setCurrent(null))
  }, [])

  async function onExport() {
    setExporting(true)
    setError(null)
    try {
      const res = await exportBridgeFile()
      downloadBlob(res.blob, res.filename)
      toast.success(`تم تصدير البيانات: ${res.filename}`)
    } catch (e) {
      setError(e instanceof BridgeError ? e.message : 'تعذر التصدير — أعد المحاولة.')
    } finally {
      setExporting(false)
    }
  }

  async function onPickFile(f: File | undefined) {
    setError(null)
    setPicked(null)
    if (!f) return
    try {
      const summary = await inspectBridgeFile(f)
      setPicked({ file: f, summary })
    } catch (e) {
      setError(e instanceof BridgeError ? e.message : 'تعذر قراءة الملف.')
    }
  }

  async function onConfirmImport() {
    if (!picked) return
    setImporting(true)
    setError(null)
    try {
      const res = await importBridgeFile(picked.file, { onPhase: setPhase })
      // تنظيف كاش الذاكرة قبل إعادة التحميل حتى تُبنى الشاشات من البيانات الجديدة
      queryClient.clear()
      toast.success(`تم استيراد بيانات «${res.businessName}» — ${res.importedRecords} سجل`)
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setError(e instanceof BridgeError ? e.message : 'فشل الاستيراد — تأكد من الملف وأعد المحاولة.')
      setImporting(false)
      setPhase(null)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="ناقل البيانات"
        subtitle="انقل بيانات مخبزك بين نسخة الموقع ونسخة الويندوز بملف واحد"
        backTo="/more"
      />

      {/* شرح مبسط */}
      <Card className="mb-3 p-4">
        <div className="flex items-start gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <ArrowLeftRight className="size-5" />
          </span>
          <div className="min-w-0 space-y-1.5 text-xs leading-relaxed text-stone-600">
            <p className="font-extrabold text-stone-800">كيف تنقل بياناتك بين الموقع والتطبيق؟</p>
            <p>
              <b>1.</b> افتح هذه الصفحة على الجهاز الذي عملت عليه آخر شيء واضغط <b>«تصدير البيانات»</b>.
            </p>
            <p>
              <b>2.</b> انقل الملف الناتج للجهاز الآخر (واتساب لنفسك، فلاشة، بريد... كما تحب).
            </p>
            <p>
              <b>3.</b> افتح هذه الصفحة هناك واضغط <b>«استيراد البيانات»</b> واختر الملف —
              وبس هيك الجهازان يصيران يحملان نفس بياناتك.
            </p>
            <p className="rounded-lg bg-warning-50 px-2.5 py-1.5 font-bold text-warning-700">
              قاعدة ذهبية: آخر نسخة صدّرتها هي الأحدث. الاستيراد يستبدل بيانات هذا الجهاز
              ببيانات الملف — والنظام يأخذ نسخة أمان تلقائية قبل أي استيراد.
            </p>
          </div>
        </div>
      </Card>

      {/* بيانات هذا الجهاز الآن */}
      {current && (
        <Card className="mb-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-stone-800">بيانات هذا الجهاز الآن</h2>
            <Badge tone="info">الإصدار {APP_VERSION}</Badge>
          </div>
          <p className="text-xs text-stone-500">
            النشاط: <b className="text-stone-800">{current.businessName}</b>
            {' • '}{current.total.toLocaleString('ar-EG')} سجل إجمالاً
            {' • '}{current.counts.products} منتج
            {' • '}{current.counts.customers} عميل
            {' • '}{current.counts.suppliers} مورد
            {' • '}{current.counts.sales} فاتورة بيع
          </p>
        </Card>
      )}

      {/* التصدير */}
      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600">
              <Download className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-extrabold text-stone-900">تصدير البيانات</h2>
              <p className="text-2xs text-stone-500">ملف واحد بكل فواتيرك وعملائك ومخزونك — خذه معك لنقل البيانات أو كنسخة احتياطية</p>
            </div>
          </div>
          <Button icon={<FileJson className="size-4" />} loading={exporting} disabled={exporting} onClick={() => void onExport()}>
            تصدير البيانات
          </Button>
        </div>
      </Card>

      {/* الاستيراد */}
      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-600">
              <Upload className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-extrabold text-stone-900">استيراد البيانات</h2>
              <p className="text-2xs text-stone-500">استبدل بيانات هذا الجهاز ببيانات الملف — مع نسخة أمان تلقائية قبل التنفيذ</p>
            </div>
          </div>
          <Button variant="outline" icon={<Upload className="size-4" />} disabled={importing} onClick={() => fileInput.current?.click()}>
            اختيار ملف...
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0])
              e.currentTarget.value = ''
            }}
          />
        </div>

        {/* ملخص الملف المختار + تأكيد */}
        {picked && (
          <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-stone-800">
              <FileJson className="size-4 text-primary-600" /> {picked.file.name}
            </p>
            <p className="text-2xs leading-relaxed text-stone-600">
              نشاط الملف: <b>{picked.summary.meta.business_name}</b>
              {' • '}صدر في {new Date(picked.summary.meta.exported_at).toLocaleString('ar-EG')}
              {' • '}{picked.summary.totalRecords.toLocaleString('ar-EG')} سجل
              ({picked.summary.keyCounts.products} منتج، {picked.summary.keyCounts.customers} عميل،
              {' '}{picked.summary.keyCounts.sales} بيع، {picked.summary.keyCounts.purchases} شراء)
            </p>
            <p className="mt-1.5 flex items-center gap-1 text-2xs font-bold text-danger-600">
              <ShieldCheck className="size-3.5" />
              سيتم أولاً تنزيل نسخة أمان من بياناتك الحالية، ثم الاستبدال الكامل وإعادة تحميل الصفحة.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button
                variant="danger"
                icon={importing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                disabled={importing}
                onClick={() => void onConfirmImport()}
              >
                {phase === 'backup' ? 'جارٍ أخذ نسخة الأمان...'
                  : phase === 'import' ? 'جارٍ الاستبدال...'
                  : phase === 'relink' ? 'اللمسات الأخيرة...'
                  : 'تأكيد الاستيراد والاستبدال'}
              </Button>
              <Button variant="ghost" disabled={importing} onClick={() => setPicked(null)}>
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </Card>

      {error && (
        <Card className="border-danger-200 bg-danger-50 p-3">
          <p className="text-xs font-bold text-danger-700">{error}</p>
        </Card>
      )}

      {/* خصوصية */}
      <Card className="p-4">
        <div className="flex items-start gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
            <Info className="size-5" />
          </span>
          <p className="text-2xs leading-relaxed text-stone-500">
            ملف النقل يحمل بيانات النشاط فقط — <b>رمزك السري وجلستك لا يخرجان من جهازك أبداً</b>،
            وكل جهاز يحتفظ برمزه الخاص. النقل يتم بملف تملكه أنت — لا حسابات ولا خدمات سحابية ولا بريد.
          </p>
        </div>
      </Card>
    </div>
  )
}
