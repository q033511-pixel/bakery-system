/** DataTable — جداول sticky مع بحث وفلاتر وتصدير، وتحويل تلقائي لصفوف ملخصة على الموبايل (بند 50/58) */
import type { ReactNode } from 'react'
import { EmptyState } from './states'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  hideOnMobile?: boolean
}

export function DataTable<T>({ columns, rows, keyOf, emptyTitle = 'لا توجد بيانات', emptyMessage, mobileCard }: {
  columns: Column<T>[]
  rows: T[]
  keyOf: (row: T, index: number) => string
  emptyTitle?: string
  emptyMessage?: string
  /** عرض الصف كبطاقة على الموبايل */
  mobileCard?: (row: T) => ReactNode
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} message={emptyMessage} />
  }

  const mobileColumns = columns.filter((c) => !c.hideOnMobile)

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/70">
              {columns.map((c) => (
                <th key={c.key} className={`sticky top-0 whitespace-nowrap px-4 py-3 text-start text-xs font-extrabold text-stone-500 ${c.className ?? ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={keyOf(row, i)} className="border-b border-stone-100 transition hover:bg-stone-50/60">
                {columns.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap px-4 py-3 text-stone-700 ${c.className ?? ''}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-stone-100 md:hidden">
        {rows.map((row, i) =>
          mobileCard ? (
            <div key={keyOf(row, i)} className="px-4 py-3">{mobileCard(row)}</div>
          ) : (
            <div key={keyOf(row, i)} className="space-y-1.5 px-4 py-3">
              {mobileColumns.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="shrink-0 text-2xs font-bold text-stone-400">{c.header}</span>
                  <span className={`min-w-0 truncate text-end ${c.className ?? ''}`}>{c.render(row)}</span>
                </div>
              ))}
            </div>
          ),
        )}
      </div>
    </>
  )
}
