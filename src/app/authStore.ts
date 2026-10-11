/** Auth store — الملف الشخصي والنشاط وحالة تهيئة الجهاز (وضع محلي أحادي المستخدم) */
import { create } from 'zustand'
import type { Profile, Business } from '@/types'
import { can, canAny, type Permission } from '@/lib/permissions'
import { lookups } from '@/services/lookups'
import { db } from '@/db/db'

interface AuthStore {
  profile: Profile | null
  business: Business | null
  loaded: boolean
  /** هل هذا الجهاز مُهيأ (نشاط تجاري موجود)؟ — يحدد: معالج الإعداد أم شاشة القفل */
  hasBusiness: boolean
  setProfile: (p: Profile | null) => void
  setBusiness: (b: Business | null) => void
  setLoaded: (v: boolean) => void
  setHasBusiness: (v: boolean) => void
  has: (perm: Permission) => boolean
  hasAny: (perms: Permission[]) => boolean
  currencySymbol: () => string
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  profile: null,
  business: null,
  loaded: false,
  hasBusiness: false,
  setProfile: (p) => set({ profile: p }),
  setBusiness: (b) => set({ business: b }),
  setLoaded: (v) => set({ loaded: v }),
  setHasBusiness: (v) => set({ hasBusiness: v }),
  has: (perm) => can(get().profile?.role, perm),
  hasAny: (perms) => canAny(get().profile?.role, perms),
  currencySymbol: () => get().business?.currency_symbol ?? '₪',
}))

/** تحميل الجلسة المحلية + النشاط + مؤشر التهيئة */
export async function loadAuthState(): Promise<Profile | null> {
  const { getSessionProfile } = await import('@/services/auth')
  const { refreshLookups } = await import('@/services/lookups')
  const profile = await getSessionProfile()
  const store = useAuthStore.getState()
  // مؤشر التهيئة يُحسب من القاعدة مباشرة — حتى بلا جلسة (يحدد الإعداد مقابل القفل)
  const bizCount = await db.businesses.count().catch(() => 0)
  store.setHasBusiness(bizCount > 0)
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
