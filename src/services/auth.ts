/**
 * Auth service (بند 67/68) — جلسة، دخول، خروج، تهيئة أول مالك.
 * الملف الشخصي يُخزن في Dexie للعمل أوفلاين (قراءة فقط).
 */
import { supabase } from '@/lib/supabase'
import { db } from '@/db/db'
import { rpc } from '@/services/rpc'
import { clearAllCache } from '@/db/db'
import type { Profile } from '@/types'

export interface AuthState {
  profile: Profile | null
  loaded: boolean
}

export async function getSessionProfile(): Promise<Profile | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return null
  // حاول الشبكة أولاً ثم الكاش المحلي
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
    if (error) throw error
    if (data) {
      const profile = data as Profile
      await db.cache_meta.put({
        key: 'me', value: profile, updated_at: new Date().toISOString(),
      })
      return profile
    }
    return null
  } catch {
    const cached = await db.cache_meta.get('me')
    return (cached?.value as Profile) ?? null
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
      throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة.')
    }
    if (msg.includes('email not confirmed')) {
      throw new Error('لم يتم تأكيد البريد الإلكتروني بعد.')
    }
    throw new Error('تعذر تسجيل الدخول — تحقق من البيانات والاتصال.')
  }
}

export async function signUp(email: string, password: string, fullName: string): Promise<{ needsEmailConfirm: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('already registered')) throw new Error('هذا البريد مسجل مسبقاً — سجّل الدخول.')
    if (msg.includes('password')) throw new Error('كلمة المرور قصيرة — استخدم 6 أحرف على الأقل.')
    throw new Error('تعذر إنشاء الحساب — حاول مجدداً.')
  }
  return { needsEmailConfirm: !data.session }
}

export async function bootstrapBusiness(
  setupCode: string, businessName: string, fullName: string | null, phone: string | null,
): Promise<{ business_id: string }> {
  return rpc('bootstrap_business', {
    p_setup_code: setupCode,
    p_business_name: businessName,
    p_full_name: fullName,
    p_phone: phone || null,
  })
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
  await clearAllCache()
  await db.cache_meta.clear()
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) throw new Error('تعذر إرسال رابط إعادة التعيين — تحقق من البريد والاتصال.')
}
