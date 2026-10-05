/**
 * Dexie — IndexedDB schema (بند 40/41/132):
 * - pending_ops: طابور العمليات غير المتزامنة (لا نفقّيها أبداً قبل تأكيد الخادم)
 * - cache_*: بيانات lookup الضرورية للعمل أوفلاين فقط
 * - لا نكاش أسرار ولا session tokens هنا (بند 131)
 */
import Dexie, { type Table } from 'dexie'
import type { PendingOp } from '@/types'

export interface CacheRow<T = Record<string, unknown>> {
  key: string
  data: T
  fetched_at: string
}

export interface MetaRow {
  key: string
  value: unknown
  updated_at: string
}

class BakeryDB extends Dexie {
  pending_ops!: Table<PendingOp, number>
  cache_business!: Table<CacheRow, string>
  cache_customers!: Table<CacheRow, string>
  cache_suppliers!: Table<CacheRow, string>
  cache_products!: Table<CacheRow, string>
  cache_units!: Table<CacheRow, string>
  cache_unit_conversions!: Table<CacheRow, string>
  cache_warehouses!: Table<CacheRow, string>
  cache_cash_accounts!: Table<CacheRow, string>
  cache_expense_categories!: Table<CacheRow, string>
  cache_employees!: Table<CacheRow, string>
  cache_vehicles!: Table<CacheRow, string>
  cache_drivers!: Table<CacheRow, string>
  cache_recipe_versions!: Table<CacheRow, string>
  cache_meta!: Table<MetaRow, string>

  constructor() {
    super('bakery_system')
    this.version(1).stores({
      pending_ops: '++id, &operation_id, status, created_at, type',
      cache_business: 'key',
      cache_customers: 'key',
      cache_suppliers: 'key',
      cache_products: 'key',
      cache_units: 'key',
      cache_unit_conversions: 'key',
      cache_warehouses: 'key',
      cache_cash_accounts: 'key',
      cache_expense_categories: 'key',
      cache_employees: 'key',
      cache_vehicles: 'key',
      cache_drivers: 'key',
      cache_recipe_versions: 'key',
      cache_meta: 'key',
    })
  }
}

export const db = new BakeryDB()

const CACHE_TABLES = [
  'cache_business', 'cache_customers', 'cache_suppliers', 'cache_products',
  'cache_units', 'cache_unit_conversions', 'cache_warehouses', 'cache_cash_accounts',
  'cache_expense_categories', 'cache_employees', 'cache_vehicles', 'cache_drivers',
  'cache_recipe_versions',
] as const

export type CacheTable = (typeof CACHE_TABLES)[number]

/** مسح كل الكاش (عند تسجيل الخروج أو تبديل الحساب) */
export async function clearAllCache(): Promise<void> {
  await Promise.all(CACHE_TABLES.map((t) => db.table(t).clear()))
}

export async function getPendingCount(): Promise<{ pending: number; failed: number }> {
  const [pending, failed] = await Promise.all([
    db.pending_ops.where('status').equals('PENDING').count(),
    db.pending_ops.where('status').equals('FAILED').count(),
  ])
  return { pending, failed }
}
