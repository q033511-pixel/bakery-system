/**
 * AppShell — التنقل التكيفي (بند 49):
 * - الموبايل: Bottom Navigation (الرئيسية/المبيعات/المخزون/المزيد) + زر بيع سريع عائم
 * - سطح المكتب: Sidebar ثابت + شريط علوي
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, Package, MoreHorizontal, Home,
  Users, Truck, FileText, Settings, Factory, Wallet, ReceiptText, RefreshCw, LogOut, Plus, ScrollText,
} from 'lucide-react'
import { useAuthStore } from './authStore'
import { useSyncStore, drainQueue } from '@/services/sync/syncEngine'
import { SyncStatusBadge } from '@/components/ui/states'
import { signOut } from '@/services/auth'
import { ROLE_LABELS } from '@/lib/permissions'

const MAIN_TABS = [
  { to: '/', label: 'الرئيسية', icon: Home },
  { to: '/sales', label: 'المبيعات', icon: ShoppingCart },
  { to: '/inventory', label: 'المخزون', icon: Package },
] as const

const MORE_ITEMS = [
  { to: '/purchases', label: 'المشتريات', icon: ReceiptText, perm: 'purchases.view' as const },
  { to: '/production', label: 'الإنتاج', icon: Factory, perm: 'production.view' as const },
  { to: '/distribution', label: 'التوزيع', icon: Truck, perm: 'distribution.view' as const },
  { to: '/customers', label: 'العملاء', icon: Users, perm: 'customers.view' as const },
  { to: '/suppliers', label: 'الموردون', icon: Users, perm: 'suppliers.view' as const },
  { to: '/expenses', label: 'المصروفات', icon: Wallet, perm: 'expenses.view' as const },
  { to: '/cash', label: 'الصندوق', icon: Wallet, perm: 'cash.view' as const },
  { to: '/reports', label: 'التقارير', icon: FileText, perm: 'reports.view' as const },
  { to: '/audit', label: 'سجل التدقيق', icon: ScrollText, perm: 'audit.view' as const },
  { to: '/sync', label: 'المزامنة', icon: RefreshCw, perm: null },
  { to: '/settings', label: 'الإعدادات', icon: Settings, perm: 'settings.manage' as const },
]

function Sidebar({ onSignOut }: { onSignOut: () => void }) {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const has = useAuthStore((s) => s.has)
  const location = useLocation()

  return (
    <aside className="fixed inset-y-0 right-0 z-30 hidden w-60 flex-col border-l border-stone-800 bg-stone-900 md:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary-600 font-extrabold text-white">خ</div>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-white">{business?.name ?? 'نظام المخبز'}</p>
          <p className="text-2xs text-stone-400">{profile ? ROLE_LABELS[profile.role] : ''}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4 scrollbar-thin" aria-label="التنقل الرئيسي">
        <SidebarLink to="/" icon={<LayoutDashboard className="size-4" />} label="لوحة التحكم" active={location.pathname === '/'} />
        <p className="px-3 pb-1 pt-4 text-2xs font-bold uppercase tracking-wide text-stone-500">التشغيل</p>
        {MORE_ITEMS.filter((m) => !m.perm || has(m.perm)).map((m) => (
          <SidebarLink key={m.to} to={m.to} icon={<m.icon className="size-4" />} label={m.label} />
        ))}
      </nav>

      <div className="border-t border-stone-800 p-3">
        <button
          onClick={onSignOut}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold text-stone-400 transition hover:bg-stone-800 hover:text-white"
        >
          <LogOut className="size-4" /> تسجيل الخروج
        </button>
      </div>
    </aside>
  )
}

function SidebarLink({ to, icon, label, active }: { to: string; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
        active ? 'bg-primary-600 text-white' : 'text-stone-300 hover:bg-stone-800 hover:text-white'
      }`}
    >
      {icon}
      {label}
    </NavLink>
  )
}

function TopBar() {
  const { online, syncing } = useSyncStore()
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-stone-200 bg-white/90 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-2">
        <SyncStatusBadge />
        {online && !syncing && (
          <button onClick={() => void drainQueue()} className="hidden rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 sm:block" aria-label="مزامنة الآن">
            <RefreshCw className="size-4" />
          </button>
        )}
      </div>
      <MobileSignOut />
    </header>
  )
}

function MobileSignOut() {
  const signOutNow = async () => { await signOut(); window.location.hash = '#/login'; window.location.reload() }
  return (
    <button onClick={() => void signOutNow()} className="rounded-lg p-2 text-stone-400 transition hover:bg-stone-100 md:hidden" aria-label="تسجيل الخروج">
      <LogOut className="size-5" />
    </button>
  )
}

function BottomNav() {
  const location = useLocation()
  const isMoreActive = MORE_ITEMS.some((m) => location.pathname.startsWith(m.to))
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="التنقل السفلي">
      <div className="grid grid-cols-4">
        {MAIN_TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2.5 text-2xs font-bold transition ${isActive ? 'text-primary-700' : 'text-stone-400'}`
            }
          >
            <t.icon className="size-5" />
            {t.label}
          </NavLink>
        ))}
        <NavLink
          to="/more"
          className={`flex flex-col items-center gap-0.5 py-2.5 text-2xs font-bold transition ${isMoreActive ? 'text-primary-700' : 'text-stone-400'}`}
        >
          <MoreHorizontal className="size-5" />
          المزيد
        </NavLink>
      </div>
    </nav>
  )
}

function QuickSaleFab() {
  const location = useLocation()
  if (location.pathname === '/sale/new') return null
  return (
    <NavLink
      to="/sale/new"
      aria-label="بيع سريع"
      className="fixed bottom-20 left-4 z-30 flex size-14 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-fab transition active:scale-95 hover:bg-primary-700 md:hidden"
    >
      <Plus className="size-7" />
    </NavLink>
  )
}

export default function AppShell() {
  const setProfile = useAuthStore((s) => s.setProfile)
  const handleSignOut = async () => {
    await signOut()
    setProfile(null)
    window.location.hash = '#/login'
    window.location.reload()
  }

  return (
    <div className="min-h-screen">
      <Sidebar onSignOut={() => void handleSignOut()} />
      <div className="md:mr-60">
        <TopBar />
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 md:px-6 md:pb-10">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      <QuickSaleFab />
    </div>
  )
}
