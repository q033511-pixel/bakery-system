/** عناصر الواجهة الأساسية — أزرار لمس كبيرة، وضوح أرقام، حالات بصرية (بند 48/84/121) */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'

// ---------- Button ----------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-sm',
  secondary: 'bg-stone-800 text-white hover:bg-stone-900 active:bg-black shadow-sm',
  ghost: 'bg-transparent text-stone-700 hover:bg-stone-100 active:bg-stone-200',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800 shadow-sm',
  success: 'bg-success-600 text-white hover:bg-success-700 active:bg-success-800 shadow-sm',
  outline: 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 active:bg-stone-100',
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
      className={`inline-flex select-none items-center justify-center rounded-lg font-bold transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
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
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200 bg-white shadow-card ${className}`}>{children}</div>
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
export function StatCard({ title, value, sub, tone = 'default', icon }: {
  title: string; value: string; sub?: string; tone?: 'default' | 'success' | 'danger' | 'warning' | 'primary'; icon?: ReactNode
}) {
  const toneClass = {
    default: 'text-stone-900',
    success: 'text-success-700',
    danger: 'text-danger-700',
    warning: 'text-warning-700',
    primary: 'text-primary-700',
  }[tone]
  return (
    <Card className="flex items-center gap-3 p-4">
      {icon && <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-stone-500">{title}</p>
        <p className={`truncate text-lg font-extrabold tabular-nums ${toneClass}`}>{value}</p>
        {sub && <p className="truncate text-2xs text-stone-400">{sub}</p>}
      </div>
    </Card>
  )
}

// ---------- Skeleton ----------
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-stone-200/70 ${className}`} />
}
