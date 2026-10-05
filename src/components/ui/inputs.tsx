/** حقول متخصصة: مال، كمية، تاريخ، بحث اختيار — مع تحقق آمن (بند 122/123) */
import { useMemo, useRef, useState, type InputHTMLAttributes } from 'react'
import { Search, X, ChevronDown } from 'lucide-react'
import { formatMoney, parsePositive } from '@/lib/money'
import { inputBaseClass } from './primitives'

// ---------- MoneyInput ----------
export interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  value: number | null
  onChange: (v: number | null) => void
  currencySymbol?: string
}

export function MoneyInput({ value, onChange, currencySymbol = '₪', className = '', ...rest }: MoneyInputProps) {
  const [raw, setRaw] = useState(value !== null ? String(value) : '')
  return (
    <div className="relative">
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        dir="ltr"
        value={raw}
        onChange={(e) => {
          const v = e.target.value
          if (v === '' || /^[\d.]*$/.test(v)) {
            setRaw(v)
            onChange(v === '' ? null : parsePositive(v))
          }
        }}
        onBlur={() => {
          if (raw !== '') setRaw(String(value ?? ''))
        }}
        className={`${inputBaseClass} h-11 pl-14 text-left font-bold tabular-nums ${className}`}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-bold text-stone-400">{currencySymbol}</span>
    </div>
  )
}

// ---------- QuantityInput ----------
export interface QuantityInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  value: number | null
  onChange: (v: number | null) => void
  unit?: string
  allowDecimal?: boolean
}

export function QuantityInput({ value, onChange, unit, allowDecimal = true, className = '', ...rest }: QuantityInputProps) {
  const [raw, setRaw] = useState(value !== null ? String(value) : '')
  return (
    <div className="relative">
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        dir="ltr"
        value={raw}
        onChange={(e) => {
          const v = e.target.value
          const pattern = allowDecimal ? /^[\d.]*$/ : /^\d*$/
          if (v === '' || pattern.test(v)) {
            setRaw(v)
            const n = Number(v)
            onChange(v === '' || Number.isNaN(n) ? null : n)
          }
        }}
        onBlur={() => { if (raw !== '') setRaw(String(value ?? '')) }}
        className={`${inputBaseClass} h-11 ${unit ? 'pl-16' : ''} text-left font-bold tabular-nums ${className}`}
      />
      {unit && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-bold text-stone-400">{unit}</span>}
    </div>
  )
}

// ---------- DateInput ----------
export function DateInput({ value, onChange, className = '', ...rest }: {
  value: string; onChange: (v: string) => void; className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'>) {
  return (
    <input
      {...rest}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputBaseClass} h-11 font-bold tabular-nums ${className}`}
    />
  )
}

// ---------- SearchSelect (combobox) ----------
export interface SearchSelectOption {
  value: string
  label: string
  sublabel?: string
}

export function SearchSelect({ options, value, onChange, placeholder = 'ابحث...', emptyText = 'لا نتائج', disabled }: {
  options: SearchSelectOption[]
  value: string | null
  onChange: (v: string | null) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, 30)
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q)).slice(0, 30)
  }, [options, query])

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(!open); setQuery('') }}
        className={`${inputBaseClass} flex h-11 items-center justify-between text-start ${disabled ? 'opacity-60' : ''}`}
      >
        <span className={selected ? 'font-bold' : 'text-stone-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-stone-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full rounded-xl border border-stone-200 bg-white shadow-lg">
            <div className="relative border-b border-stone-100 p-2">
              <Search className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="h-10 w-full rounded-lg bg-stone-50 pr-10 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-stone-400">{emptyText}</p>}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-start text-sm transition hover:bg-stone-50 ${o.value === value ? 'bg-primary-50 text-primary-800' : 'text-stone-800'}`}
                >
                  <span className="font-bold">{o.label}</span>
                  {o.sublabel && <span className="text-2xs text-stone-400">{o.sublabel}</span>}
                </button>
              ))}
            </div>
            {value && (
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false) }}
                className="flex w-full items-center justify-center gap-1 border-t border-stone-100 py-2.5 text-xs font-bold text-danger-600 hover:bg-danger-50"
              >
                <X className="size-3.5" /> مسح الاختيار
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- Money display helper ----------
export function Money({ value, symbol = '₪', className = '' }: { value: number | null | undefined; symbol?: string; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatMoney(value, symbol)}</span>
}
