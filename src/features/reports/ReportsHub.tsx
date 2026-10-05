/**
 * مركز التقارير (بند 54/55): شبكة بطاقات التقارير — كل بطاقة تفتح تقريراً مع فلاتر وتصدير CSV.
 */
import { Link } from 'react-router-dom'
import {
  ShoppingCart, CalendarDays, ReceiptText, Package, ArrowLeftRight, Factory,
  Users, UserCheck, TrendingDown, Wallet, Truck, TrendingUp, ScrollText, ChevronLeft,
} from 'lucide-react'
import { useAuthStore } from '@/app/authStore'
import { EmptyState } from '@/components/ui/states'

interface ReportCard {
  reportId: string
  title: string
  desc: string
  icon: React.ReactNode
}

const REPORTS: ReportCard[] = [
  { reportId: 'sales', title: 'المبيعات', desc: 'الفواتير والإجماليات والتكلفة', icon: <ShoppingCart className="size-5" /> },
  { reportId: 'sales_daily', title: 'ملخص المبيعات اليومي', desc: 'إجمالي كل يوم: نقدي وآجل', icon: <CalendarDays className="size-5" /> },
  { reportId: 'purchases', title: 'المشتريات', desc: 'فواتير الشراء من الموردين', icon: <ReceiptText className="size-5" /> },
  { reportId: 'inventory', title: 'المخزون', desc: 'الأرصدة وقيمة المخزون', icon: <Package className="size-5" /> },
  { reportId: 'movements', title: 'حركات المخزون', desc: 'كل الإدخالات والإخراجات', icon: <ArrowLeftRight className="size-5" /> },
  { reportId: 'production', title: 'الإنتاج', desc: 'دفعات الإنتاج وتكلفة المواد', icon: <Factory className="size-5" /> },
  { reportId: 'customers', title: 'أرصدة العملاء', desc: 'المبيعات والمستحقات', icon: <Users className="size-5" /> },
  { reportId: 'suppliers', title: 'أرصدة الموردين', desc: 'المشتريات والمستحقات', icon: <UserCheck className="size-5" /> },
  { reportId: 'expenses', title: 'المصروفات', desc: 'مجاميع المصروفات حسب الفئة', icon: <TrendingDown className="size-5" /> },
  { reportId: 'cash', title: 'حركة الصندوق', desc: 'كل القبض والصرف', icon: <Wallet className="size-5" /> },
  { reportId: 'distribution', title: 'التوزيع', desc: 'الحمولات والتسويات والفروق', icon: <Truck className="size-5" /> },
  { reportId: 'profit', title: 'الربحية التقديرية', desc: 'إيراد − تكلفة مواد − مصاريف', icon: <TrendingUp className="size-5" /> },
  { reportId: 'audit', title: 'سجل التدقيق', desc: 'كل التغييرات الحساسة', icon: <ScrollText className="size-5" /> },
]

export default function ReportsHub() {
  const has = useAuthStore((s) => s.has)

  if (!has('reports.view')) {
    return <EmptyState title="ليس لديك صلاحية عرض التقارير." message="تواصل مع مدير النظام لمنحك صلاحية reports.view." />
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-extrabold text-stone-900 sm:text-xl">التقارير</h1>
        <p className="mt-0.5 text-xs text-stone-500">تقارير تشغيلية ومالية مع فلاتر تاريخ وتصدير CSV</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {REPORTS.map((r) => (
          <Link
            key={r.reportId}
            to={`/reports/${r.reportId}`}
            className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3.5 shadow-card transition active:scale-[.99] hover:border-primary-300 hover:bg-primary-50/30"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
              {r.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold text-stone-900">{r.title}</span>
              <span className="block truncate text-2xs text-stone-500">{r.desc}</span>
            </span>
            <ChevronLeft className="size-4 shrink-0 text-stone-300" />
          </Link>
        ))}
      </div>
    </div>
  )
}
