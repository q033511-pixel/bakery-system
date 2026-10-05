/**
 * السيارات والموزعون/السائقون (بند 29): إدارة أسطول التوزيع — إضافة وتفعيل/تعطيل.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/lib/toast'
import { useAuthStore } from '@/app/authStore'
import { PageHeader } from '@/components/ui/navigation'
import { Button, Card, Field, Input, StatusBadge } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlays'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui/states'
import type { Driver, Vehicle } from '@/types'

export default function VehiclesPage() {
  const toast = useToast()
  const has = useAuthStore((s) => s.has)
  const profile = useAuthStore((s) => s.profile)
  const queryClient = useQueryClient()
  const canManage = has('distribution.manage')

  const [vehicleOpen, setVehicleOpen] = useState(false)
  const [driverOpen, setDriverOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [vCode, setVCode] = useState('')
  const [vName, setVName] = useState('')
  const [vPlate, setVPlate] = useState('')
  const [dName, setDName] = useState('')
  const [dPhone, setDPhone] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const vehiclesQ = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').order('name')
      if (error) throw new Error(error.message)
      return data as Vehicle[]
    },
  })
  const driversQ = useQuery({
    queryKey: ['drivers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('drivers').select('*').order('name')
      if (error) throw new Error(error.message)
      return data as Driver[]
    },
  })

  async function addVehicle() {
    if (!profile?.business_id) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!vCode.trim()) { toast.error('أدخل رمز السيارة.'); return }
    if (!vName.trim()) { toast.error('أدخل اسم السيارة.'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('vehicles').insert({
        business_id: profile.business_id,
        code: vCode.trim(),
        name: vName.trim(),
        plate: vPlate.trim() || null,
        active: true,
      })
      if (error) throw new Error(error.message)
      toast.success('تمت إضافة السيارة.')
      setVehicleOpen(false); setVCode(''); setVName(''); setVPlate('')
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ السيارة.')
    } finally {
      setSaving(false)
    }
  }

  async function addDriver() {
    if (!profile?.business_id) { toast.error('لا يوجد نشاط مرتبط بحسابك.'); return }
    if (!dName.trim()) { toast.error('أدخل اسم السائق.'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('drivers').insert({
        business_id: profile.business_id,
        name: dName.trim(),
        phone: dPhone.trim() || null,
        active: true,
      })
      if (error) throw new Error(error.message)
      toast.success('تمت إضافة السائق.')
      setDriverOpen(false); setDName(''); setDPhone('')
      void queryClient.invalidateQueries({ queryKey: ['drivers'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ السائق.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(table: 'vehicles' | 'drivers', row: { id: string; active: boolean; name: string }) {
    if (!canManage) return
    setTogglingId(row.id)
    try {
      const { error } = await supabase.from(table).update({ active: !row.active }).eq('id', row.id)
      if (error) throw new Error(error.message)
      toast.success(!row.active ? `تم تفعيل «${row.name}».` : `تم تعطيل «${row.name}».`)
      void queryClient.invalidateQueries({ queryKey: [table] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث الحالة.')
    } finally {
      setTogglingId(null)
    }
  }

  function ActiveToggle({ table, row }: { table: 'vehicles' | 'drivers'; row: { id: string; active: boolean; name: string } }) {
    if (!canManage) return <StatusBadge status={row.active ? 'CONFIRMED' : 'CANCELLED'} label={row.active ? 'نشط' : 'معطل'} />
    return (
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={row.active}
          disabled={togglingId === row.id}
          onChange={() => void toggleActive(table, row)}
          className="size-4 accent-primary-600"
          aria-label={row.active ? 'تعطيل' : 'تفعيل'}
        />
        <span className={`text-2xs font-bold ${row.active ? 'text-success-700' : 'text-stone-400'}`}>
          {togglingId === row.id ? '...' : row.active ? 'نشط' : 'معطل'}
        </span>
      </label>
    )
  }

  return (
    <div className="pb-4">
      <PageHeader
        title="السيارات والموزعون"
        subtitle="أسطول التوزيع والسائقون"
        backTo="/more"
      />

      {/* ---------- السيارات ---------- */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
            <Car className="size-4 text-primary-700" /> السيارات
          </h2>
          {canManage && <Button size="sm" onClick={() => setVehicleOpen(true)}>إضافة سيارة</Button>}
        </div>
        {vehiclesQ.isLoading ? (
          <LoadingState label="جارٍ التحميل..." />
        ) : vehiclesQ.isError ? (
          <ErrorState message={vehiclesQ.error instanceof Error ? vehiclesQ.error.message : 'تعذر تحميل السيارات.'} onRetry={() => void vehiclesQ.refetch()} />
        ) : (
          <DataTable
            rows={vehiclesQ.data ?? []}
            keyOf={(r) => r.id}
            emptyTitle="لا توجد سيارات"
            emptyMessage="أضف سيارة لبدء الحمولات."
            columns={[
              { key: 'code', header: 'الرمز', render: (r) => <span className="font-bold tabular-nums">{r.code}</span> },
              { key: 'name', header: 'الاسم', render: (r) => <span className="font-bold text-stone-800">{r.name}</span> },
              { key: 'plate', header: 'اللوحة', render: (r) => r.plate ?? '—' },
              { key: 'active', header: 'الحالة', render: (r) => <ActiveToggle table="vehicles" row={r} /> },
            ]}
          />
        )}
      </Card>

      {/* ---------- الموزعون/السائقون ---------- */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-stone-800">
            <UserPlus className="size-4 text-primary-700" /> موزعون / سائقون
          </h2>
          {canManage && <Button size="sm" onClick={() => setDriverOpen(true)}>إضافة سائق</Button>}
        </div>
        {driversQ.isLoading ? (
          <LoadingState label="جارٍ التحميل..." />
        ) : driversQ.isError ? (
          <ErrorState message={driversQ.error instanceof Error ? driversQ.error.message : 'تعذر تحميل السائقين.'} onRetry={() => void driversQ.refetch()} />
        ) : (
          <DataTable
            rows={driversQ.data ?? []}
            keyOf={(r) => r.id}
            emptyTitle="لا يوجد سائقون"
            emptyMessage="أضف سائقاً لربطه بالحمولات."
            columns={[
              { key: 'name', header: 'الاسم', render: (r) => <span className="font-bold text-stone-800">{r.name}</span> },
              { key: 'phone', header: 'الهاتف', className: 'tabular-nums', render: (r) => r.phone ?? '—' },
              { key: 'active', header: 'الحالة', render: (r) => <ActiveToggle table="drivers" row={r} /> },
            ]}
          />
        )}
      </Card>

      {/* مودال إضافة سيارة */}
      <Modal open={vehicleOpen} onClose={() => setVehicleOpen(false)} title="إضافة سيارة">
        <div className="space-y-3">
          <Field label="الرمز" required hint="مثل: V1 / TRK-01">
            <Input value={vCode} onChange={(e) => setVCode(e.target.value)} placeholder="رمز السيارة" autoFocus />
          </Field>
          <Field label="الاسم" required>
            <Input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="مثال: سيارة الخبز الصغير" />
          </Field>
          <Field label="رقم اللوحة" hint="اختياري">
            <Input value={vPlate} onChange={(e) => setVPlate(e.target.value)} placeholder="رقم اللوحة" />
          </Field>
          <Button className="w-full" loading={saving} onClick={() => void addVehicle()}>حفظ السيارة</Button>
        </div>
      </Modal>

      {/* مودال إضافة سائق */}
      <Modal open={driverOpen} onClose={() => setDriverOpen(false)} title="إضافة سائق / موزع">
        <div className="space-y-3">
          <Field label="الاسم" required>
            <Input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="اسم السائق" autoFocus />
          </Field>
          <Field label="الهاتف" hint="اختياري">
            <Input value={dPhone} onChange={(e) => setDPhone(e.target.value)} type="tel" dir="ltr" placeholder="0599..." className="text-left" />
          </Field>
          <Button className="w-full" loading={saving} onClick={() => void addDriver()}>حفظ السائق</Button>
        </div>
      </Modal>
    </div>
  )
}
