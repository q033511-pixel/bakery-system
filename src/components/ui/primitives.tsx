/** عناصر الواجهة الأساسية — أزرار لمس كبيرة، وضوح أرقام، حالات بصرية (بند 48/84/121) */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'

// ---------- Button ----------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-l from-primary-600 to-primary-500 text-white hover:from-primary-700 hover:to-primary-600 active:from-primary-800 active:to-primary-700 shadow-sm shadow-primary-600/25',
  secondary: 'bg-stone-800 text-white hover:bg-stone-900 active:bg-black shadow-sm',
  ghost: 'bg-transparent text-stone-700 hover:bg-stone-100 active:bg-stone-200',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800 shadow-sm shadow-danger-600/25',
  success: 'bg-success-600 text-white hover:bg-success-700 active:bg-success-800 shadow-sm shadow-success-600/25',
  outline: 'border border-stone-300 bg-white text-stone-800 hover:border-primary-300 hover:bg-primary-50/50 active:bg-primary-100/60',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-13 px-6 text-base gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center rounded-xl font-bold transition-all duration-150
        active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

// ---------- Input / Textarea ----------
export const inputBaseClass =
  'w-full rounded-lg border border-stone-300 bg-white px-3 text-stone-900 placeholder:text-stone-400 transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:bg-stone-100 disabled:text-stone-500'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', type = 'text', ...rest }, ref,
) {
  return <input ref={ref} type={type} className={`${inputBaseClass} h-11 ${className}`} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className = '', rows = 3, ...rest }, ref,
) {
  return <textarea ref={ref} rows={rows} className={`${inputBaseClass} py-2.5 ${className}`} {...rest} />
})

// ---------- Select ----------
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = '', children, ...rest }, ref,
) {
  return (
    <select ref={ref} className={`${inputBaseClass} h-11 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2378716c%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[position:left_0.75rem_center] bg-no-repeat pl-9 ${className}`} {...rest}>
      {children}
    </select>
  )
})

// ---------- Field ----------
export function Field({ label, required, error, children, hint }: {
  label: string; required?: boolean; error?: string | null; children: ReactNode; hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-bold text-stone-700">
        {label}
        {required && <span className="text-danger-600">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-2xs text-stone-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-semibold text-danger-600">{error}</span>}
    </label>
  )
}

// ---------- Card ----------
export function Card({ children, className = '', hover = false }: { children: ReactNode; className?: string; hover?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-stone-200 bg-white shadow-card transition-all duration-200 ${
        hover ? 'hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card-lg' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

// ---------- Badge ----------
type BadgeTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'primary'
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-stone-100 text-stone-700',
  success: 'bg-success-50 text-success-700',
  danger: 'bg-danger-50 text-danger-700',
  warning: 'bg-warning-50 text-warning-700',
  info: 'bg-info-50 text-info-700',
  primary: 'bg-primary-50 text-primary-700',
}

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-2xs font-bold ${TONES[tone]} ${className}`}>{children}</span>
}

const STATUS_MAP: Record<string, { tone: BadgeTone; label: string }> = {
  CONFIRMED: { tone: 'success', label: 'مؤكد' },
  DRAFT: { tone: 'neutral', label: 'مسودة' },
  VOIDED: { tone: 'danger', label: 'ملغى' },
  CANCELLED: { tone: 'danger', label: 'ملغي' },
  CASH: { tone: 'success', label: 'نقدي' },
  CREDIT: { tone: 'warning', label: 'آجل' },
  PENDING: { tone: 'warning', label: 'بانتظار المزامنة' },
  SYNCED: { tone: 'success', label: 'متزامن' },
  FAILED: { tone: 'danger', label: 'فشل' },
  OPEN: { tone: 'info', label: 'مفتوحة' },
  IN_PROGRESS: { tone: 'warning', label: 'قيد التنفيذ' },
  SETTLED: { tone: 'success', label: 'مُسوّاة' },
  DIRECT: { tone: 'neutral', label: 'مباشر' },
  DISTRIBUTION: { tone: 'info', label: 'توزيع' },
  RAW_MATERIAL: { tone: 'info', label: 'مادة خام' },
  FINISHED_PRODUCT: { tone: 'primary', label: 'منتج نهائي' },
  PACKAGING: { tone: 'neutral', label: 'تغليف' },
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const conf = STATUS_MAP[status] ?? { tone: 'neutral' as BadgeTone, label: status }
  return <Badge tone={conf.tone}>{label ?? conf.label}</Badge>
}

// ---------- StatCard ----------
const STAT_TONES = {
  default: { text: 'text-stone-900', wash: 'bg-stone-100 text-stone-600' },
  success: { text: 'text-success-700', wash: 'bg-success-50 text-success-600' },
  danger: { text: 'text-danger-700', wash: 'bg-danger-50 text-danger-600' },
  warning: { text: 'text-warning-700', wash: 'bg-warning-50 text-warning-600' },
  primary: { text: 'text-primary-700', wash: 'bg-primary-50 text-primary-600' },
} as const

export function StatCard({ title, value, sub, tone = 'default', icon, trend }: {
  title: string; value: string; sub?: string; tone?: 'default' | 'success' | 'danger' | 'warning' | 'primary'; icon?: ReactNode
  trend?: { dir: 'up' | 'down'; label: string }
}) {
  const t = STAT_TONES[tone]
  return (
    <Card hover className="flex items-center gap-3 p-4">
      {icon && <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${t.wash}`}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-stone-500">{title}</p>
        <p className={`truncate text-lg font-extrabold tabular-nums ${t.text}`}>{value}</p>
        {(sub || trend) && (
          <p className="flex items-center gap-1 truncate text-2xs text-stone-400">
            {trend && (
              <span className={`inline-flex items-center gap-0.5 font-bold ${trend.dir === 'up' ? 'text-success-600' : 'text-danger-500'}`}>
                <svg viewBox="0 0 12 12" className="size-2.5 fill-current" aria-hidden="true">
                  {trend.dir === 'up' ? <path d="M6 2l4 5H2z" /> : <path d="M6 10L2 5h8z" />}
                </svg>
                {trend.label}
              </span>
            )}
            {sub}
          </p>
        )}
      </div>
    </Card>
  )
}

// ---------- Skeleton ----------
export function Skeleton({ className = '', shimmer = true }: { className?: string; shimmer?: boolean }) {
  return <div className={`${shimmer ? 'skeleton-shimmer' : 'animate-pulse bg-stone-200/70'} rounded-lg ${className}`} />
}

// ---------- MiniBars — رسم بياني مصغر SVG خالص ----------
export interface MiniBarPoint {
  label: string
  value: number
  highlight?: boolean
}

export function MiniBars({ points, height = 96, format }: {
  points: MiniBarPoint[]; height?: number; format?: (v: number) => string
}) {
  const max = Math.max(...points.map((p) => p.value), 1)
  return (
    <div className="flex items-end justify-between gap-1.5" style={{ height }} role="img" aria-label="مخطط المبيعات">
      {points.map((p, i) => {
        const h = Math.max((p.value / max) * (height - 26), p.value > 0 ? 6 : 3)
        return (
          <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-1" style={{ height }}>
            <span className="text-center text-2xs font-bold tabular-nums text-stone-500 opacity-0 transition-opacity group-hover:opacity-100">
              {format ? format(p.value) : p.value}
            </span>
            <div
              className={`bar-grow w-full max-w-8 rounded-t-md transition-colors ${
                p.highlight
                  ? 'bg-gradient-to-t from-primary-600 to-primary-400'
                  : 'bg-gradient-to-t from-primary-200 to-primary-100 group-hover:from-primary-300 group-hover:to-primary-200'
              }`}
              style={{ height: h, animationDelay: `${i * 60}ms` }}
            />
            <span className={`truncate text-2xs ${p.highlight ? 'font-extrabold text-primary-700' : 'text-stone-400'}`}>
              {p.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
