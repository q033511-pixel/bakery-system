/**
 * Dexie — IndexedDB schema (بند 40/41/132):
 * - v1: pending_ops + cache_* (كاش العمل أوفلاين)
 * - v2: الوضع المحلي الكامل — كل جداول النظام تُخزَّن على هذا الجهاز فقط
 *   (شخص واحد، بيانات محلية، لا خادم سحابي — بند 40/132)
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

/** صف محلي عام — الأعمدة مطابقة لترحيلات SQL (0001_schema.sql) */
export type LocalRow = Record<string, unknown> & { id: string }

class BakeryDB extends Dexie {
  // v1 — طابور المزامنة والكاش
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

  // v2 — الجداول المحلية الكاملة (مطابقة لأسماء Postgres)
  businesses!: Table<LocalRow, string>
  profiles!: Table<LocalRow, string>
  branches!: Table<LocalRow, string>
  warehouses!: Table<LocalRow, string>
  units!: Table<LocalRow, string>
  unit_conversions!: Table<LocalRow, string>
  product_categories!: Table<LocalRow, string>
  products!: Table<LocalRow, string>
  customers!: Table<LocalRow, string>
  suppliers!: Table<LocalRow, string>
  employees!: Table<LocalRow, string>
  recipes!: Table<LocalRow, string>
  recipe_versions!: Table<LocalRow, string>
  recipe_items!: Table<LocalRow, string>
  inventory_movements!: Table<LocalRow, string>
  inventory_adjustments!: Table<LocalRow, string>
  waste_records!: Table<LocalRow, string>
  transfers!: Table<LocalRow, string>
  transfer_items!: Table<LocalRow, string>
  purchases!: Table<LocalRow, string>
  purchase_items!: Table<LocalRow, string>
  supplier_payments!: Table<LocalRow, string>
  sales!: Table<LocalRow, string>
  sale_items!: Table<LocalRow, string>
  customer_payments!: Table<LocalRow, string>
  production_batches!: Table<LocalRow, string>
  production_consumption!: Table<LocalRow, string>
  expense_categories!: Table<LocalRow, string>
  expenses!: Table<LocalRow, string>
  cash_accounts!: Table<LocalRow, string>
  cash_transactions!: Table<LocalRow, string>
  vehicles!: Table<LocalRow, string>
  drivers!: Table<LocalRow, string>
  distribution_loads!: Table<LocalRow, string>
  distribution_items!: Table<LocalRow, string>
  distribution_deliveries!: Table<LocalRow, string>
  distribution_returns!: Table<LocalRow, string>
  distribution_settlements!: Table<LocalRow, string>
  audit_logs!: Table<LocalRow, string>
  app_settings!: Table<LocalRow, string>
  doc_sequences!: Table<LocalRow, [string, string, number]>
  processed_operations!: Table<LocalRow, string>

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
    // v2: الجداول المحلية الكاملة — الفهرسة الدنيا فقط؛ التصفية تتم في الذاكرة
    // (بيانات مخبز واحد على جهاز واحد = أحجام صغيرة)
    this.version(2).stores({
      businesses: 'id',
      profiles: 'id, business_id',
      branches: 'id, business_id',
      warehouses: 'id, business_id',
      units: 'id, business_id',
      unit_conversions: 'id, business_id',
      product_categories: 'id, business_id',
      products: 'id, business_id, code',
      customers: 'id, business_id, code',
      suppliers: 'id, business_id, code',
      employees: 'id, business_id',
      recipes: 'id, business_id, product_id',
      recipe_versions: 'id, business_id, recipe_id',
      recipe_items: 'id, recipe_version_id',
      inventory_movements: 'id, business_id, item_id, warehouse_id, operation_id, reference_id',
      inventory_adjustments: 'id, business_id, &operation_id',
      waste_records: 'id, business_id, &operation_id',
      transfers: 'id, business_id, &operation_id',
      transfer_items: 'id, transfer_id',
      purchases: 'id, business_id, &operation_id, supplier_id',
      purchase_items: 'id, purchase_id',
      supplier_payments: 'id, business_id, &operation_id, supplier_id',
      sales: 'id, business_id, &operation_id, customer_id, load_id',
      sale_items: 'id, sale_id',
      customer_payments: 'id, business_id, &operation_id, customer_id',
      production_batches: 'id, business_id, &operation_id',
      production_consumption: 'id, batch_id',
      expense_categories: 'id, business_id',
      expenses: 'id, business_id, &operation_id',
      cash_accounts: 'id, business_id',
      cash_transactions: 'id, business_id, cash_account_id, operation_id, reference_id',
      vehicles: 'id, business_id',
      drivers: 'id, business_id',
      distribution_loads: 'id, business_id, &operation_id, vehicle_id',
      distribution_items: 'id, load_id',
      distribution_deliveries: 'id, business_id, &operation_id, load_id, product_id',
      distribution_returns: 'id, business_id, &operation_id, load_id, product_id',
      distribution_settlements: 'id, business_id, &operation_id, load_id',
      audit_logs: 'id, business_id',
      app_settings: 'business_id',
      doc_sequences: '[business_id+prefix+seq_year], business_id',
      processed_operations: 'operation_id, business_id',
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

// ---------- meta helpers (الجلسة المحلية) ----------
export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await db.cache_meta.get(key)
  return row ? (row.value as T) : null
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.cache_meta.put({ key, value, updated_at: new Date().toISOString() })
}

export async function deleteMeta(key: string): Promise<void> {
  await db.cache_meta.delete(key)
}
