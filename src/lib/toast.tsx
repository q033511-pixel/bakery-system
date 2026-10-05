/**
 * Toast system (بند 106/108) — إشعارات نجاح/خطأ/انتظار مع حالة أوفلاين واضحة.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, CloudOff, X } from 'lucide-react'

export type ToastKind = 'success' | 'error' | 'info' | 'offline'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastContextValue {
  toast: (kind: ToastKind, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  offline: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const KIND_STYLE: Record<ToastKind, { bg: string; icon: ReactNode }> = {
  success: { bg: 'bg-success-600', icon: <CheckCircle2 className="size-5 shrink-0" /> },
  error: { bg: 'bg-danger-600', icon: <AlertCircle className="size-5 shrink-0" /> },
  info: { bg: 'bg-stone-800', icon: <Info className="size-5 shrink-0" /> },
  offline: { bg: 'bg-stone-700', icon: <CloudOff className="size-5 shrink-0" /> },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = ++counter.current
    setItems((prev) => [...prev.slice(-3), { id, kind, message }])
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, kind === 'error' ? 6000 : 3500)
  }, [])

  const value: ToastContextValue = {
    toast,
    success: (m) => toast('success', m),
    error: (m) => toast('error', m),
    info: (m) => toast('info', m),
    offline: (m) => toast('offline', m),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed inset-x-3 top-3 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:left-4 sm:w-96" role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${KIND_STYLE[t.kind].bg} animate-[slideIn_.2s_ease-out]`}
          >
            <span className="mt-0.5">{KIND_STYLE[t.kind].icon}</span>
            <p className="flex-1 leading-relaxed">{t.message}</p>
            <button
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="rounded p-0.5 opacity-70 transition hover:opacity-100"
              aria-label="إغلاق"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
