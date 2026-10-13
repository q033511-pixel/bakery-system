/** صفحة "المزيد" — قائمة كاملة للوحدات على الموبايل (بند 49) + تثبيت التطبيق على التلفون */
import { Link } from 'react-router-dom'
import {
  ReceiptText, Factory, Truck, Users, Wallet, FileText, Settings,
  ScrollText, Package, ChevronLeft, Car, HardDrive, Smartphone, ArrowLeftRight,
} from 'lucide-react'
import { useAuthStore } from './authStore'

const ITEMS = [
  { to: '/purchases', label: 'المشتريات', desc: 'فواتير الشراء والدفعات', icon: ReceiptText, perm: 'purchases.view' },
  { to: '/production', label: 'الإنتاج والوصفات', desc: 'دفعات الإنتاج ووصفات التصنيع', icon: Factory, perm: 'production.view' },
  { to: '/distribution', label: 'التوزيع', desc: 'الحمولات والمرتجعات والتسويات', icon: Truck, perm: 'distribution.view' },
  { to: '/vehicles', label: 'السيارات والموزعون', desc: 'إدارة الأسطول والسائقين', icon: Car, perm: 'distribution.manage' },
  { to: '/customers', label: 'العملاء', desc: 'الأرصدة وكشوف الحساب', icon: Users, perm: 'customers.view' },
  { to: '/suppliers', label: 'الموردون', desc: 'المستحقات وكشوف الحساب', icon: Users, perm: 'suppliers.view' },
  { to: '/products', label: 'المنتجات والمواد', desc: 'الأصناف والأسعار والتكاليف', icon: Package, perm: null },
  { to: '/expenses', label: 'المصروفات', desc: 'تسجيل وتصنيف المصروفات', icon: Wallet, perm: 'expenses.view' },
  { to: '/cash', label: 'الصندوق', desc: 'الحسابات والحركة المالية', icon: Wallet, perm: 'cash.view' },
  { to: '/reports', label: 'التقارير', desc: '11 تقريراً مع تصدير CSV', icon: FileText, perm: 'reports.view' },
  { to: '/audit', label: 'سجل التدقيق', desc: 'كل التغييرات الحساسة', icon: ScrollText, perm: 'audit.view' },
  { to: '/settings/backup', label: 'النسخ الاحتياطية', desc: 'تصدير واستعادة بياناتك — مهم جداً', icon: HardDrive, perm: null },
  { to: '/databridge', label: 'ناقل البيانات', desc: 'نقل بياناتك بين الموقع والتطبيق بملف واحد', icon: ArrowLeftRight, perm: null },
  { to: '/settings', label: 'الإعدادات والأمان', desc: 'النشاط والرمز السري والوحدات', icon: Settings, perm: 'settings.manage' },
] as const

export default function MorePage() {
  const has = useAuthStore((s) => s.has)
  const visible = ITEMS.filter((i) => !i.perm || has(i.perm as never))

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-extrabold text-stone-900">المزيد</h1>
      </div>

      {/* ثبّته على تلفونك — PWA */}
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary-200 bg-gradient-to-l from-primary-50 to-white p-4 shadow-card">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
          <Smartphone className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-stone-900">ثبّته على تلفونك — يعمل كتطبيق</h2>
          <p className="mt-1 text-2xs leading-relaxed text-stone-600">
            افتح هذا الموقع من متصفح التلفون، ثم من قائمة المتصفح اختر
            <b> «إضافة إلى الشاشة الرئيسية» </b>
            (آيفون: مشاركة ← Add to Home Screen). سيعمل كتطبيق مستقل وبنفس الرمز السري،
            وبياناته محفوظة على التلفون.
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        {visible.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-card transition active:scale-[.99] hover:border-primary-300"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
              <item.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-stone-900">{item.label}</span>
              <span className="block truncate text-2xs text-stone-500">{item.desc}</span>
            </span>
            <ChevronLeft className="size-4 shrink-0 text-stone-300" />
          </Link>
        ))}
      </div>
    </div>
  )
}
