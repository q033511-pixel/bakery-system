/**
 * اختبارات نظام الرمز السري (PIN) — بديل تسجيل الدخول المعقد (طلب الزبون):
 * تعيين/تحقق/تغيير + قفل الجلسة + تهيئة كاملة بلا بريد (setupLocalSystem)
 * + دخول بالرمز (signInWithPin) + ترحيل جهاز قديم (setPinFirstTime).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'

// ---------- polyfill تخزين المتصفح لبيئة node ----------
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null }
  setItem(k: string, v: string): void { this.m.set(k, String(v)) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
  key(i: number): string | null { return Array.from(this.m.keys())[i] ?? null }
  get length(): number { return this.m.size }
}
const g = globalThis as unknown as Record<string, unknown>
if (!g.localStorage) g.localStorage = new MemStorage()
if (!g.sessionStorage) g.sessionStorage = new MemStorage()

import { db } from '@/db/db'
import {
  setPin, verifyPin, changePin, clearPin, hasPin,
  isUnlocked, setUnlocked, lockNow, isValidPin,
} from '@/lib/pin'
import {
  setupLocalSystem, signInWithPin, setPinFirstTime, getSessionProfile,
} from '@/services/auth'
import { getCtx } from '@/lib/local/context'

beforeEach(async () => {
  for (const t of db.tables) await t.clear()
  ;(g.localStorage as MemStorage).clear()
  ;(g.sessionStorage as MemStorage).clear()
})

describe('الرمز السري: تعيين وتحقق وتغيير', () => {
  it('تعيين رمز والتحقق به — الصحيح ينجح والخاطئ يفشل', async () => {
    expect(hasPin()).toBe(false)
    expect(isValidPin('1234')).toBe(true)
    expect(isValidPin('12')).toBe(false)
    expect(isValidPin('abcd')).toBe(false)

    await setPin('1234')
    expect(hasPin()).toBe(true)
    expect(await verifyPin('1234')).toBe(true)
    expect(await verifyPin('9999')).toBe(false)
    expect(await verifyPin('123')).toBe(false)
  })

  it('تغيير الرمز يتطلب الرمز الحالي الصحيح', async () => {
    await setPin('1111')
    expect(await changePin('0000', '2222')).toBe(false)
    expect(await verifyPin('1111')).toBe(true)
    expect(await changePin('1111', '2222')).toBe(true)
    expect(await verifyPin('1111')).toBe(false)
    expect(await verifyPin('2222')).toBe(true)
  })

  it('قفل الجلسة: فتح ثم قفل — والحالة تُقرأ صحيحة', () => {
    expect(isUnlocked()).toBe(false)
    setUnlocked()
    expect(isUnlocked()).toBe(true)
    lockNow()
    expect(isUnlocked()).toBe(false)
  })

  it('مسح الرمز يعيد الجهاز لحالة بلا رمز', async () => {
    await setPin('4321')
    clearPin()
    expect(hasPin()).toBe(false)
    expect(await verifyPin('4321')).toBe(false)
  })
})

describe('التهيئة والدخول بالرمز — بلا بريد ولا كلمة مرور', () => {
  it('setupLocalSystem ينشئ مالكاً ونشاطاً ورمزاً ويفتح القفل', async () => {
    const out = await setupLocalSystem({ businessName: 'مخبز النور', fullName: 'أحمد', phone: '0599', pin: '1357' })
    expect(out.business_id).toBeTruthy()
    expect(getCtx().role).toBe('OWNER')
    expect(getCtx().businessId).toBe(out.business_id)
    expect(hasPin()).toBe(true)
    expect(await verifyPin('1357')).toBe(true)
    expect(isUnlocked()).toBe(true)

    const profile = await getSessionProfile()
    expect(profile).not.toBeNull()
    expect(profile?.business_id).toBe(out.business_id)

    // منع إعادة التهيئة فوق نظام قائم
    await expect(setupLocalSystem({ businessName: 'مخبز آخر', fullName: '', phone: '', pin: '2468' }))
      .rejects.toThrow('هذا الجهاز مُهيأ مسبقاً')
    // الرمز القديم لم يتغير
    expect(await verifyPin('1357')).toBe(true)
  })

  it('signInWithPin: رمز خاطئ يرفض دون جلسة، وصحيح يجلس المالك ويفتح', async () => {
    await setupLocalSystem({ businessName: 'مخبز الجنة', fullName: 'المالك', phone: '', pin: '9999' })
    lockNow()

    expect(await signInWithPin('1111')).toBe(false)
    expect(isUnlocked()).toBe(false)

    expect(await signInWithPin('9999')).toBe(true)
    expect(isUnlocked()).toBe(true)
    const profile = await getSessionProfile()
    expect(profile?.role).toBe('OWNER')
    expect(profile?.business_id).toBeTruthy()
  })

  it('setPinFirstTime: ترحيل جهاز مُهيأ بإصدار قديم بلا رمز', async () => {
    // محاكاة جهاز قديم: مالك + نشاط موجودان دون رمز
    await setupLocalSystem({ businessName: 'مخبز قديم', fullName: '', phone: '', pin: '1111' })
    clearPin()
    lockNow()
    expect(hasPin()).toBe(false)

    await setPinFirstTime('7777')
    expect(hasPin()).toBe(true)
    expect(await verifyPin('7777')).toBe(true)
    expect(isUnlocked()).toBe(true)
    const profile = await getSessionProfile()
    expect(profile?.business_id).toBeTruthy()
  })
})
