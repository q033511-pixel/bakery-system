/**
 * Auth service — الوضع المحلي أحادي المستخدم (طلب الزبون):
 * لا بريد ولا كلمة مرور ولا حسابات — معلومات أساسية مرة واحدة عند التهيئة
 * ثم رمز سري من 4 أرقام يفتح النظام في كل مرة.
 * الملف الشخصي والبيانات كلها في Dexie/IndexedDB على هذا الجهاز فقط.
 */
import { db } from '@/db/db'
import { rpc } from '@/services/rpc'
import { uuid, nowIso, setCtx, saveSession, clearSession } from '@/lib/local/context'
import { changePin, setPin, setUnlocked, lockNow, verifyPin } from '@/lib/pin'
import type { Profile } from '@/types'

export interface AuthState {
  profile: Profile | null
  loaded: boolean
}

/** الملف الشخصي للمالك من الجلسة المحلية الحالية (بلا شبكة — كل شيء محلي) */
export async function getSessionProfile(): Promise<Profile | null> {
  const { restoreContext, getCtx } = await import('@/lib/local/context')
  const logged = await restoreContext()
  const userId = getCtx().userId
  if (!logged || !userId) return null
  const row = await db.profiles.get(userId)
  if (!row) return null
  const profile = row as unknown as Profile
  await db.cache_meta.put({
    key: 'me', value: profile, updated_at: new Date().toISOString(),
  })
  return profile
}

/** إيجاد صف المالك (مستخدم واحد لكل جهاز) */
async function findOwner(): Promise<Record<string, unknown> | null> {
  const profiles = await db.profiles.toArray()
  return profiles.find((p) => p.role === 'OWNER') ?? null
}

function ctxFromOwner(o: Record<string, unknown>): {
  userId: string; email: string | null; businessId: string | null; role: string; fullName: string
} {
  return {
    userId: String(o.id),
    email: typeof o.email === 'string' ? o.email : null,
    businessId: typeof o.business_id === 'string' ? o.business_id : null,
    role: typeof o.role === 'string' ? o.role : 'OWNER',
    fullName: typeof o.full_name === 'string' ? o.full_name : '',
  }
}

/**
 * تهيئة النظام من الصفر — خطوة واحدة بلا حسابات:
 * ينشئ المالك + النشاط التجاري (بكل الافتراضيات) + الرمز السري، ويفك القفل مباشرة.
 */
export async function setupLocalSystem(p: {
  businessName: string
  fullName: string
  phone: string
  pin: string
}): Promise<{ business_id: string }> {
  if (p.businessName.trim().length < 2) throw new Error('أدخل اسم المخبز (حرفان على الأقل).')

  // جهاز مُهيأ مسبقاً؟ منع إعادة التهيئة فوق بيانات قائمة
  const owner = await findOwner()
  if (owner && typeof owner.business_id === 'string' && owner.business_id) {
    throw new Error('هذا الجهاز مُهيأ مسبقاً — افتح النظام بالرمز السري.')
  }

  const now = nowIso()
  let ownerId: string
  if (owner) {
    // مالك بلا نشاط (تهيئة غير مكتملة) — نُكمل على نفس الصف
    ownerId = String(owner.id)
    await db.profiles.update(ownerId, {
      full_name: p.fullName.trim() || (typeof owner.full_name === 'string' ? owner.full_name : ''),
      phone: p.phone.trim() || null,
      updated_at: now,
    })
  } else {
    ownerId = uuid()
    await db.profiles.put({
      id: ownerId,
      email: null,
      full_name: p.fullName.trim(),
      phone: p.phone.trim() || null,
      role: 'OWNER',
      active: true,
      business_id: null,
      created_at: now,
      updated_at: now,
    })
  }

  saveSession(ownerId)
  setCtx({ userId: ownerId, email: null, businessId: null, role: 'OWNER', fullName: p.fullName.trim() })

  const res = await bootstrapBusiness('LOCAL', p.businessName.trim(), p.fullName.trim() || null, p.phone.trim() || null)
  await setPin(p.pin)
  setUnlocked()
  return res
}

/** دخول بالرمز السري — يعيد true إذا صح الرمز ويجلس المالك ويفتح القفل */
export async function signInWithPin(pin: string): Promise<boolean> {
  if (!(await verifyPin(pin))) return false
  const owner = await findOwner()
  if (!owner) throw new Error('لا يوجد مالك على هذا الجهاز — أعد التهيئة.')
  await saveSession(String(owner.id))
  setCtx(ctxFromOwner(owner))
  setUnlocked()
  return true
}

/**
 * تعيين رمز لمرة واحدة (ترحيل الأجهزة المُهيأة سابقاً بلا رمز)
 * ثم فتح الجلسة مباشرة.
 */
export async function setPinFirstTime(pin: string): Promise<void> {
  await setPin(pin)
  const owner = await findOwner()
  if (owner) {
    await saveSession(String(owner.id))
    setCtx(ctxFromOwner(owner))
  }
  setUnlocked()
}

/** تغيير الرمز من الإعدادات — يتطلب الرمز الحالي */
export async function changePinCode(current: string, next: string): Promise<void> {
  const ok = await changePin(current, next)
  if (!ok) throw new Error('الرمز الحالي غير صحيح.')
}

/** تهيئة النشاط التجاري (عملية bootstrap الأصلية — وحدات ومستودعات وصندوق وفئات) */
export async function bootstrapBusiness(
  setupCode: string, businessName: string, fullName: string | null, phone: string | null,
): Promise<{ business_id: string }> {
  const res = await rpc<{ business_id: string }>('bootstrap_business', {
    p_setup_code: setupCode,
    p_business_name: businessName,
    p_full_name: fullName,
    p_phone: phone || null,
  })
  return res
}

/** قفل النظام — بياناتك تبقى على الجهاز، والرمز مطلوب للعودة */
export async function lockApp(): Promise<void> {
  lockNow()
}

/** مسح الجلسة فقط (للاستخدام الداخلي عند إعادة التهيئة) */
export async function clearLocalSession(): Promise<void> {
  await clearSession()
}
