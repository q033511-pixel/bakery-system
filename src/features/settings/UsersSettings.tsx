/**
 * إدارة المستخدمين (بند 34/68): أعضاء النشاط (تفعيل/تعطيل) وطلبات التفعيل المعلقة
 * (تعيين دور من ASSIGNABLE_ROLES عبر assign_user_role). المحمي بصلاحية users.manage.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/services/rpc'
import { useToast } from '@/lib/toast'
import { useAuthStore } from '@/app/authStore'
import { ROLE_LABELS, ASSIGNABLE_ROLES } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/navigation'
import { Badge, Button, Card, Select } from '@/components/ui/primitives'
import { DataTable } from '@/components/ui/DataTable'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states'
import type { Profile, UserRole } from '@/types'

type Tone = 'success' | 'info' | 'danger' | 'primary' | 'warning' | 'neutral'

const ROLE_TONES: Record<UserRole, Tone> = {
  OWNER: 'primary',
  ADMIN: 'info',
  ACCOUNTANT: 'primary',
  SALES: 'success',
  WAREHOUSE: 'neutral',
  PRODUCTION: 'neutral',
  DISTRIBUTOR: 'warning',
  VIEWER: 'neutral',
  PENDING: 'warning',
}

function RoleBadge({ role }: { role: UserRole }) {
  return <Badge tone={ROLE_TONES[role] ?? 'neutral'}>{ROLE_LABELS[role] ?? role}</Badge>
}

export default function UsersSettings() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const has = useAuthStore((s) => s.has)
  const me = useAuthStore((s) => s.profile)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['users'],
    enabled: has('users.manage'),
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at')
      if (error) throw new Error(error.message)
      return data as Profile[]
    },
  })

  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [roleChoice, setRoleChoice] = useState<Record<string, UserRole>>({})

  if (!has('users.manage')) {
    return <EmptyState title="ليس لديك صلاحية إدارة المستخدمين." message="تواصل مع مدير النظام لمنحك صلاحية users.manage." />
  }

  const rows = data ?? []
  const members = rows.filter((r) => r.role !== 'PENDING')
  const pending = rows.filter((r) => r.role === 'PENDING')

  async function toggleActive(p: Profile) {
    if (me?.id === p.id) { toast.info('لا يمكنك تعطيل حسابك الحالي.'); return }
    setTogglingId(p.id)
    try {
      const { error } = await supabase.from('profiles').update({ active: !p.active }).eq('id', p.id)
      if (error) throw new Error(error.message)
      toast.success(!p.active ? `تم تفعيل «${p.full_name ?? 'المستخدم'}».` : `تم تعطيل «${p.full_name ?? 'المستخدم'}».`)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث حالة المستخدم.')
    } finally {
      setTogglingId(null)
    }
  }

  async function assignRole(p: Profile) {
    const role = roleChoice[p.id]
    if (!role) { toast.error('اختر دوراً للمستخدم.'); return }
    setAssigningId(p.id)
    try {
      await rpc('assign_user_role', { p_user_id: p.id, p_role: role })
      toast.success('تم تعيين الدور وتفعيل المستخدم.')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تعيين الدور.')
    } finally {
      setAssigningId(null)
    }
  }

  return (
    <div className="pb-4">
      <PageHeader title="المستخدمون" subtitle="أعضاء النشاط وطلبات التفعيل" backTo="/settings" />

      <Card className="mb-3 flex items-center gap-3 border-info-200 bg-info-50 p-3.5">
        <Info className="size-5 shrink-0 text-info-600" />
        <p className="text-xs font-bold leading-relaxed text-info-800">
          المستخدمون الجدد يسجلون من شاشة الدخول ثم يظهر لهم طلب التفعيل هنا.
        </p>
      </Card>

      {isLoading ? (
        <LoadingState label="جارٍ تحميل المستخدمين..." />
      ) : isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل المستخدمين.'} onRetry={() => void refetch()} />
      ) : (
        <>
          {/* أعضاء النشاط */}
          <Card className="mb-4 overflow-hidden">
            <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-stone-800">أعضاء النشاط</h2>
            <DataTable
              rows={members}
              keyOf={(r) => r.id}
              emptyTitle="لا يوجد أعضاء"
              columns={[
                { key: 'name', header: 'الاسم', render: (r) => <span className="font-bold text-stone-800">{r.full_name ?? '—'}</span> },
                { key: 'id', header: 'المعرّف', render: (r) => <span dir="ltr" className="text-2xs text-stone-400">{r.id.slice(0, 8)}…</span>, hideOnMobile: true },
                { key: 'role', header: 'الدور', render: (r) => <RoleBadge role={r.role} /> },
                {
                  key: 'active', header: 'الحالة',
                  render: (r) => (
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.active}
                        disabled={togglingId === r.id || r.id === me?.id || r.role === 'OWNER'}
                        onChange={() => void toggleActive(r)}
                        className="size-4 accent-primary-600"
                        aria-label={r.active ? 'تعطيل' : 'تفعيل'}
                      />
                      <span className={`text-2xs font-bold ${r.active ? 'text-success-700' : 'text-stone-400'}`}>
                        {togglingId === r.id ? '...' : r.active ? 'نشط' : 'معطل'}
                      </span>
                    </label>
                  ),
                },
              ]}
            />
          </Card>

          {/* بانتظار التفعيل */}
          <Card className="overflow-hidden">
            <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-extrabold text-stone-800">
              بانتظار التفعيل {pending.length > 0 && <span className="text-warning-600">({pending.length})</span>}
            </h2>
            {pending.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-stone-400">لا توجد طلبات تفعيل معلقة.</p>
            ) : (
              <div className="divide-y divide-stone-100">
                {pending.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-stone-800">{p.full_name ?? 'مستخدم جديد'}</p>
                      <p dir="ltr" className="text-2xs text-stone-400">{p.id.slice(0, 8)}…</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={roleChoice[p.id] ?? ''}
                        onChange={(e) => setRoleChoice((prev) => ({ ...prev, [p.id]: e.target.value as UserRole }))}
                        className="h-10 w-40 text-xs"
                        aria-label="اختيار الدور"
                      >
                        <option value="">اختر الدور...</option>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        loading={assigningId === p.id}
                        disabled={!roleChoice[p.id]}
                        onClick={() => void assignRole(p)}
                      >
                        تفعيل
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
