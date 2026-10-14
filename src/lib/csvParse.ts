/**
 * قراءة ملفات CSV/Excel-المصدَّرة كـCSV + توحيد الصيغ — لمستورد دفاتر العملاء.
 *
 * المبدأ (بند مستورد البيانات): لا تفسير صامت — كل افتراض يُعرض على المستخدم في المعاينة:
 * - التواريخ: ISO (2026-01-17) أو DD/MM/YYYY (17/01/2026) — الافتراضي يوم/شهر/سنة مع كشف تلقائي
 *   للحالات الصريحة (سنة أولاً). MM/DD/YYYY خيار يدوي صريح فقط.
 * - الأرقام: فواصل آلاف (1,050)، أرقام عربية-هندية (١٢٣)، رموز عملة تُساقط.
 * - الكشف التفريغي بين DD/MM وMM/DD: إذا لم يكن أول مكوّن يومًا ممكنًا (>12) نفسره شهراً ونعلّم السطر.
 */

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  /** أسطر تجاوزت حد الأعمدة أو فارغة تماماً */
  skippedLineNumbers: number[]
}

/** قراءة نص CSV: BOM، اقتباسات مع فواصل داخلية، CRLF/LF، فواصل ; أو , تلقائياً */
export function parseCSV(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '')
  // اختيار الفاصل: الأول الذي يظهر في أول سطر غير فارغ أكثر
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const commaCount = (firstLine.match(/,/g) ?? []).length
  const semiCount = (firstLine.match(/;/g) ?? []).length
  const sep = semiCount > commaCount ? ';' : ','

  const rows: string[][] = []
  const skippedLineNumbers: number[] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  let lineNo = 1

  const pushField = () => {
    cur.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    if (cur.length === 1 && (cur[0] ?? '').trim() === '') {
      skippedLineNumbers.push(lineNo)
    } else {
      rows.push(cur)
    }
    cur = []
  }

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === sep) {
      pushField()
    } else if (ch === '\r') {
      // يُعالج مع \n
    } else if (ch === '\n') {
      pushRow()
      lineNo++
    } else {
      field += ch
    }
  }
  if (field !== '' || cur.length > 0) pushRow()

  const headers = rows.length > 0 ? (rows[0] ?? []).map((h) => h.trim()) : []
  return { headers, rows: rows.slice(1), skippedLineNumbers }
}

/** الأرقام العربية-الهندية → لاتينية */
export function toLatinDigits(s: string): string {
  return s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
}

/** قراءة مبلغ: "1,050.50" / "١٠٥٠" / "3.5 ₪" → number | null */
export function parseAmount(raw: string): number | null {
  if (raw === null || raw === undefined) return null
  let s = toLatinDigits(String(raw)).trim()
  if (s === '') return null
  s = s.replace(/[₪$€£\s]/g, '')
  // 1,050.50 أو 1.050,50 — نفصل بالنقطة العشرية الأخيرة بعد إزالة الفواصل المتسقة
  const normalized = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export interface NormalizedDate {
  iso: string | null
  /** صيغ اتُّبعت حرفياً — تُعرض للمستخدم في المعاينة */
  assumedFormat: 'ISO' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'D-M-YYYY' | null
}

/**
 * توحيد تاريخ: ISO أولاً، ثم DD/MM/YYYY (الافتراضي) أو MM/DD/YYYY عند الطلب.
 * يوم >12 أو شهر >12 يكشفان الصيغة تلقائياً.
 */
export function normalizeDateISO(raw: string, prefer: 'DD/MM' | 'MM/DD' = 'DD/MM'): NormalizedDate {
  if (raw === null || raw === undefined) return { iso: null, assumedFormat: null }
  const s = toLatinDigits(String(raw)).trim()
  if (s === '') return { iso: null, assumedFormat: null }
  // ISO مباشرة
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    const iso = buildIso(Number(y), Number(m), Number(d))
    return { iso, assumedFormat: iso ? 'ISO' : null }
  }
  const parts = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (!parts) return { iso: null, assumedFormat: null }
  const a = Number(parts[1])
  const b = Number(parts[2])
  let y = Number(parts[3])
  if (y < 100) y += 2000
  // كشف تلقائي حاسم
  if (a > 12 && b <= 12) {
    const iso = buildIso(y, b, a)
    return { iso, assumedFormat: iso ? 'D-M-YYYY' : null }
  }
  if (b > 12 && a <= 12) {
    const iso = buildIso(y, a, b)
    return { iso, assumedFormat: iso ? 'MM/DD/YYYY' : null }
  }
  const [day, month] = prefer === 'DD/MM' ? [a, b] : [b, a]
  const iso = buildIso(y, month, day)
  return { iso, assumedFormat: iso ? (prefer === 'DD/MM' ? 'DD/MM/YYYY' : 'MM/DD/YYYY') : null }
}

function buildIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${y}-${p(m)}-${p(d)}`
}
