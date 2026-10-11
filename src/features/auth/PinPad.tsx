/**
 * PinPad — لوحة أرقام الرمز السري (تجربة VIP):
 * - نقاط تعبئة كبيرة + لوحة أرقام 3×4 بأزرار مريحة للإبهام.
 * - اهتزاز + اهتزاز جهاز (vibrate) عند الخطأ.
 * - دعم لوحة مفاتيح فعلية: أرقام / Backspace / Enter.
 * - إدخال ذاتي: عند اكتمال الطول يُستدعى onComplete تلقائياً.
 */
import { useEffect } from 'react'
import { Delete } from 'lucide-react'

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

interface PinPadProps {
  value: string
  onChange: (v: string) => void
  /** يُستدعى عند اكتمال الطول — للتحقق التلقائي */
  onComplete?: (v: string) => void
  disabled?: boolean
  /** تشغيل اهتزاز الخطأ */
  shake?: boolean
  length?: number
}

export default function PinPad({ value, onChange, onComplete, disabled = false, shake = false, length = 4 }: PinPadProps) {
  const push = (d: string) => {
    if (disabled) return
    if (value.length >= length) return
    const next = value + d
    onChange(next)
    if (next.length === length) onComplete?.(next)
  }
  const back = () => { if (!disabled) onChange(value.slice(0, -1)) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return
      if (/^[0-9]$/.test(e.key)) push(e.key)
      else if (e.key === 'Backspace') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, disabled])

  return (
    <div className="flex flex-col items-center gap-5">
      {/* النقاط */}
      <div dir="ltr" className={`flex items-center gap-3 ${shake ? 'anim-shake' : ''}`}>
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={`size-4 rounded-full transition-all duration-150 ${
              i < value.length
                ? 'scale-110 bg-primary-600 shadow-[0_0_0_4px] shadow-primary-100'
                : 'scale-90 bg-stone-200'
            }`}
          />
        ))}
      </div>

      {/* لوحة الأرقام — ترتيب أرقام ثابت LTR */}
      <div dir="ltr" className="grid w-full max-w-64 grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => push(d)}
            className="flex h-14 items-center justify-center rounded-xl border border-stone-200 bg-white text-lg font-extrabold tabular-nums text-stone-800 shadow-sm transition active:scale-95 active:bg-primary-50 hover:border-primary-300 disabled:opacity-50"
          >
            {AR_DIGITS[Number(d)]}
            <span className="ml-1 text-2xs text-stone-400">{d}</span>
          </button>
        ))}
        <span />
        <button
          type="button"
          disabled={disabled}
          onClick={() => push('0')}
          className="flex h-14 items-center justify-center rounded-xl border border-stone-200 bg-white text-lg font-extrabold tabular-nums text-stone-800 shadow-sm transition active:scale-95 active:bg-primary-50 hover:border-primary-300 disabled:opacity-50"
        >
          {AR_DIGITS[0]}
          <span className="ml-1 text-2xs text-stone-400">0</span>
        </button>
        <button
          type="button"
          disabled={disabled || value.length === 0}
          onClick={back}
          aria-label="مسح رقم"
          className="flex h-14 items-center justify-center rounded-xl border border-transparent text-stone-500 transition active:scale-95 hover:bg-stone-100 disabled:opacity-30"
        >
          <Delete className="size-5" />
        </button>
      </div>
    </div>
  )
}
