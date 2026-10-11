/**
 * QuickAddPartyModal — إضافة سريعة لمورد أو عميل من داخل أي نموذج (فاتورة الشراء، البيع السريع، توزيع).
 * الفكرة: لا طريق مسدود — إذا لم يكن هناك مورد/عميل يضيفه المستخدم فوراً دون مغادرة النموذج،
 * ويُختار تلقائياً بعد إنشائه. تعمل محلياً 100% عبر المحول المحلي + تحديث الكاش فوراً.
 */
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { refreshLookups } from '@/services/lookups'
import { useAuthStore } from '@/app/authStore'
import { useToast } from '@/lib/toast'
import { Button, Field, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlays'

export type PartyKind = 'supplier' | 'customer'

export function QuickAddPartyModal({ kind, open, onClose, onCreated }: {
  kind: PartyKind
  open: boolean
  onClose: () => void
  /** يُستدعى بمعرّف العنصر الجديد — مثالياً لاختياره فوراً في النموذج الأصلي */
  onCreated: (id: string) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  const label = kind === 'supplier' ? 'المورد' : 'العميل'
  const title = kind === 'supplier' ? 'إضافة مورد جديد' : 'إضافة عميل جديد'

  function reset() { setName(''); setPhone('') }

  async function save() {
    if (name.trim() === '') { toast.error(`اكتب اسم ${label} أولاً.`); return }
    setSaving(true)
    try {
      const businessId = useAuthStore.getState().profile?.business_id
      if (!businessId) throw new Error('لا يوجد نشاط مسجل — أعد فتح النظام.')
      const code = (kind === 'supplier' ? 'SU-' : 'CU-') + Date.now().toString(36).toUpperCase()
      const row = kind === 'supplier'
        ? { business_id: businessId, code, name: name.trim(), phone: phone.trim() || null }
        : { business_id: businessId, code, name: name.trim(), phone: phone.trim() || null }
      const { data, error } = await supabase
        .from(kind === 'supplier' ? 'suppliers' : 'customers')
        .insert(row)
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      const newId = (data as { id: string } | null)?.id
      if (!newId) throw new Error('تعذر تأكيد إنشاء السجل.')
      await refreshLookups()
      toast.success(`تمت إضافة ${label} — ${name.trim()}`)
      reset()
      onClose()
      onCreated(newId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `تعذر إضافة ${label}.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title={title}>
      <div className="space-y-3">
        <Field label={`اسم ${label}`} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'supplier' ? 'مثال: مطحنة الحسن' : 'مثال: أبو أحمد'}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void save() }}
          />
        </Field>
        <Field label="الهاتف" hint={`اختياري — يظهر بجانب اسم ${label} في القوائم`}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09XX XXX XXX"
            dir="ltr"
            className="text-left"
            inputMode="tel"
            onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void save() }}
          />
        </Field>
        <p className="rounded-lg bg-primary-50 px-3 py-2 text-2xs font-bold leading-5 text-primary-800">
          سيتم اختيار {label} الجديد تلقائياً بعد الإضافة — دون مغادرة النموذج الحالي.
        </p>
        <div className="flex gap-2">
          <Button className="flex-1" loading={saving} onClick={() => void save()}>إضافة واختيار</Button>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>إلغاء</Button>
        </div>
      </div>
    </Modal>
  )
}
