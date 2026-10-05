/** أدوات التاريخ والتوقيت (بند 63/144) — دعم timezone من الإعدادات */
import { format, parseISO, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'

export type DateRangePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom'

export interface DateRange {
  from: string // yyyy-MM-dd
  to: string   // yyyy-MM-dd
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function nowISO(): string {
  return new Date().toISOString()
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = typeof iso === 'string' ? parseISO(iso) : iso
    return format(d, 'yyyy-MM-dd')
  } catch {
    return '—'
  }
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = parseISO(iso)
    return format(d, 'yyyy-MM-dd HH:mm')
  } catch {
    return '—'
  }
}

export function rangeFor(preset: DateRangePreset, custom?: DateRange): DateRange {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { from: format(now, 'yyyy-MM-dd'), to: format(now, 'yyyy-MM-dd') }
    case 'yesterday': {
      const y = subDays(now, 1)
      return { from: format(y, 'yyyy-MM-dd'), to: format(y, 'yyyy-MM-dd') }
    }
    case 'this_week': {
      // week starts Saturday (Arabic convention)
      return {
        from: format(startOfWeek(now, { weekStartsOn: 6 }), 'yyyy-MM-dd'),
        to: format(endOfWeek(now, { weekStartsOn: 6 }), 'yyyy-MM-dd'),
      }
    }
    case 'this_month':
      return {
        from: format(startOfMonth(now), 'yyyy-MM-dd'),
        to: format(endOfMonth(now), 'yyyy-MM-dd'),
      }
    case 'custom':
      return custom ?? { from: format(startOfDay(now), 'yyyy-MM-dd'), to: format(endOfDay(now), 'yyyy-MM-dd') }
  }
}

/** حدود يوم كامل للاستعلام (toISOString بالتوقيت المحلي للنظام) */
export function dayBounds(dateStr: string): { start: string; end: string } {
  const d = parseISO(dateStr)
  return { start: format(startOfDay(d), "yyyy-MM-dd'T'00:00:00"), end: format(endOfDay(d), "yyyy-MM-dd'T'23:59:59") }
}
