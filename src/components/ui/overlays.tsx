/** الطبقات العلوية: Modal / Drawer / ConfirmDialog (بند 107/121) */
import { useEffect, type ReactNode } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { Button } from './primitives'

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-stone-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-5 py-4">
          <h2 className="text-base font-extrabold text-stone-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700" aria-label="إغلاق">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

/** Drawer سفلي للموبايل (details drawer — بند 50) */
export function Drawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {children}
    </Modal>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'تأكيد', danger, loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void
  title: string; message: string; confirmLabel?: string; danger?: boolean; loading?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex items-start gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-danger-50 text-danger-600' : 'bg-warning-50 text-warning-600'}`}>
          <AlertTriangle className="size-5" />
        </div>
        <p className="pt-1.5 text-sm leading-relaxed text-stone-700">{message}</p>
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
          إلغاء
        </Button>
      </div>
    </Modal>
  )
}
