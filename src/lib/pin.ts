/**
 * نظام الرمز السري (PIN) — قفل النظام برمز من 4 أرقام (طلب الزبون):
 * - لا بريد ولا كلمة مرور ولا حسابات — جهاز واحد ومستخدم واحد.
 * - الرمز يُخزَّن مجزّأً SHA-256 مع salt عشوائي — لا يُخزَّن أبداً نصاً صريحاً.
 * - فك القفل يبقى سارياً خلال جلسة المتصفح الحالية فقط (sessionStorage):
 *   إغلاق التطبيق أو تحديث الصفحة يعيد شاشة القفل تلقائياً.
 * - قفل تلقائي اختياري بعد فترة خمول (افتراضي 15 دقيقة، 0 = معطل).
 */
import { sha256Hex } from '@/lib/local/adapter'

const PIN_HASH_KEY = 'bakery.pin_hash'
const PIN_SALT_KEY = 'bakery.pin_salt'
const UNLOCK_KEY = 'bakery.unlocked'
export const AUTOLOCK_KEY = 'bakery.autolock_minutes'

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

/** هل الرمز مضبوط على هذا الجهاز؟ */
export function hasPin(): boolean {
  return localStorage.getItem(PIN_HASH_KEY) !== null && localStorage.getItem(PIN_SALT_KEY) !== null
}

/** تعيين الرمز (أو تغييره) — salt ثابت لكل جهاز يُنشأ عند أول تعيين */
export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('الرمز يجب أن يكون 4 أرقام.')
  let salt = localStorage.getItem(PIN_SALT_KEY)
  if (!salt) {
    salt = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    localStorage.setItem(PIN_SALT_KEY, salt)
  }
  localStorage.setItem(PIN_HASH_KEY, await sha256Hex(`${salt}:${pin}`))
}

/** التحقق من الرمز */
export async function verifyPin(pin: string): Promise<boolean> {
  const salt = localStorage.getItem(PIN_SALT_KEY)
  const stored = localStorage.getItem(PIN_HASH_KEY)
  if (!salt || !stored) return false
  return (await sha256Hex(`${salt}:${pin}`)) === stored
}

/** تغيير الرمز — يتطلب الرمز الحالي الصحيح. يعيد false إذا كان الحالي خاطئاً */
export async function changePin(currentPin: string, newPin: string): Promise<boolean> {
  if (!(await verifyPin(currentPin))) return false
  await setPin(newPin)
  return true
}

/** مسح الرمز نهائياً (استرداد نسيت الرمز) */
export function clearPin(): void {
  localStorage.removeItem(PIN_HASH_KEY)
  localStorage.removeItem(PIN_SALT_KEY)
}

// ---------- فك القفل / القفل (جلسة المتصفح الحالية فقط) ----------

/** هل الجلسة الحالية مفتوحة؟ */
export function isUnlocked(): boolean {
  return sessionStorage.getItem(UNLOCK_KEY) === '1'
}

/** فتح القفل لهذه الجلسة */
export function setUnlocked(): void {
  sessionStorage.setItem(UNLOCK_KEY, '1')
}

/** قفل النظام فوراً */
export function lockNow(): void {
  sessionStorage.removeItem(UNLOCK_KEY)
}

// ---------- القفل التلقائي بعد الخمول ----------

/** دقائق الخمول قبل القفل التلقائي — 0 = معطل (افتراضي 15) */
export function getAutoLockMinutes(): number {
  const raw = localStorage.getItem(AUTOLOCK_KEY)
  const n = raw === null ? 15 : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 15
}

export function setAutoLockMinutes(min: number): void {
  localStorage.setItem(AUTOLOCK_KEY, String(min))
}
