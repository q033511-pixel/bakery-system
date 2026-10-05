/** Auth store — الملف الشخصي والحالة العامة للمستخدم الحالي */
import { create } from 'zustand'
import type { Profile, Business } from '@/types'
import { can, canAny, type Permission } from '@/lib/permissions'
import { lookups } from '@/services/lookups'

interface AuthStore {
  profile: Profile | null
  business: Business | null
  loaded: boolean
  setProfile: (p: Profile | null) => void
  setBusiness: (b: Business | null) => void
  setLoaded: (v: boolean) => void
  has: (perm: Permission) => boolean
  hasAny: (perms: Permission[]) => boolean
  currencySymbol: () => string
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  profile: null,
  business: null,
  loaded: false,
  setProfile: (p) => set({ profile: p }),
  setBusiness: (b) => set({ business: b }),
  setLoaded: (v) => set({ loaded: v }),
  has: (perm) => can(get().profile?.role, perm),
  hasAny: (perms) => canAny(get().profile?.role, perms),
  currencySymbol: () => get().business?.currency_symbol ?? '₪',
}))

/** تحميل الملف الشخصي + النشاط (شبكة ثم كاش) */
export async function loadAuthState(): Promise<Profile | null> {
  const { getSessionProfile } = await import('@/services/auth')
  const { refreshLookups } = await import('@/services/lookups')
  const profile = await getSessionProfile()
  const store = useAuthStore.getState()
  if (profile) {
    store.setProfile(profile)
    void refreshLookups().then(async () => {
      const businesses = await lookups.business()
      if (businesses.length > 0) store.setBusiness(businesses[0] ?? null)
    })
  }
  store.setLoaded(true)
  return profile
}
