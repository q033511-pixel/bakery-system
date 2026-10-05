/** PageHeader + FilterBar + QuickAction (بند 121/124) */
import type { ReactNode } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

export function PageHeader({ title, subtitle, backTo, action }: {
  title: string; subtitle?: string; backTo?: string; action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-1">
        {backTo && (
          <Link to={backTo} className="mt-0.5 rounded-lg p-1.5 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800" aria-label="رجوع">
            <ChevronRight className="size-5" />
          </Link>
        )}
        <div>
          <h1 className="text-lg font-extrabold text-stone-900 sm:text-xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-3 shadow-card">
      {children}
    </div>
  )
}

export interface QuickActionDef {
  label: string
  to: string
  icon: ReactNode
  color?: string
  permission?: boolean
}

export function QuickActions({ actions }: { actions: QuickActionDef[] }) {
  const visible = actions.filter((a) => a.permission !== false)
  if (visible.length === 0) return null
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      {visible.map((a) => (
        <Link
          key={a.label}
          to={a.to}
          className={`flex flex-col items-center gap-1.5 rounded-xl border border-stone-200 bg-white p-3 text-center shadow-card transition active:scale-[.97] hover:border-primary-300 hover:bg-primary-50/40 ${a.color ?? ''}`}
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary-600 text-white">{a.icon}</span>
          <span className="text-2xs font-bold text-stone-700">{a.label}</span>
        </Link>
      ))}
    </div>
  )
}

export function AddButton({ to, label, onClick }: { to?: string; label: string; onClick?: () => void }) {
  if (to) {
    return (
      <Link
        to={to}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-primary-700 active:bg-primary-800"
      >
        <Plus className="size-4" /> {label}
      </Link>
    )
  }
  return (
    <button
      onClick={onClick}
      className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-primary-700 active:bg-primary-800"
    >
      <Plus className="size-4" /> {label}
    </button>
  )
}
