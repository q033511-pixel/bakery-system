/**
 * عمليات النسخ الاحتياطية المشتركة — قلب أمان الوضع المحلي (بند 40/132):
 * - تصدير JSON كامل لكل جداول Dexie
 * - استعادة من ملف نسخة
 * - تصفير كامل (يُستخدم أيضاً في استرداد «نسيت الرمز» من شاشة القفل)
 * يستهلكها مركز النسخ الاحتياطية وشاشة القفل — مصدر واحد للحقيقة.
 */
import { db } from '@/db/db'

const BACKUP_KEY = 'bakery.last_backup'
export const BACKUP_SHAPE = { app: 'almoutmag-bakery', kind: 'full-backup' } as const

export interface BackupFile {
  app: string
  kind: string
  schema_version: number
  exported_at: string
  tables: Record<string, Record<string, unknown>[]>
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** بناء حمولة النسخة الكاملة من كل الجداول */
export async function createBackupPayload(): Promise<BackupFile> {
  const tables: Record<string, Record<string, unknown>[]> = {}
  for (const t of db.tables) {
    tables[t.name] = await t.toArray()
  }
  return {
    ...BACKUP_SHAPE,
    schema_version: db.verno,
    exported_at: new Date().toISOString(),
    tables,
  }
}

/** تصدير نسخة احتياطية كاملة وتنزيلها + تسجيل وقت آخر نسخة */
export async function exportBackupFile(): Promise<void> {
  const payload = await createBackupPayload()
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  downloadBlob(blob, `almoutmag-backup-${stamp()}.json`)
  localStorage.setItem(BACKUP_KEY, new Date().toISOString())
}

/** قراءة وقت آخر نسخة احتياطية (أو null) */
export function lastBackupAt(): string | null {
  return localStorage.getItem(BACKUP_KEY)
}

/** تحميل ملف نصي والتحقق من أنه نسخة صالحة — null إذا كان غير صالح */
export function parseBackup(text: string): BackupFile | null {
  try {
    const parsed = JSON.parse(text) as BackupFile
    if (
      parsed?.app === BACKUP_SHAPE.app &&
      parsed?.kind === BACKUP_SHAPE.kind &&
      typeof parsed?.tables === 'object' &&
      parsed.tables
    ) return parsed
    return null
  } catch {
    return null
  }
}

/** استعادة كاملة — تستبدل كل محتوى القاعدة بمحتوى النسخة */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) {
      await t.clear()
      const rows = backup.tables[t.name]
      if (Array.isArray(rows) && rows.length > 0) await t.bulkPut(rows)
    }
  })
}

/** مسح كل البيانات نهائياً (تصفير مصنع — يستخدم أيضاً في استرداد الرمز المنسي):
 *  يعيد الجهاز لحالة أول تشغيل — يشمل مسح الرمز السري والجلسة المحلية. */
export async function wipeAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear()
  })
  localStorage.removeItem(BACKUP_KEY)
  localStorage.removeItem('bakery.backup_reminder_dismissed')
  const { clearPin, lockNow } = await import('@/lib/pin')
  clearPin()
  lockNow()
  const { clearSession } = await import('@/lib/local/context')
  await clearSession()
}
