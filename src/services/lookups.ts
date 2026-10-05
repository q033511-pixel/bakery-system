/**
 * Lookups service — بيانات العمل الأساسية مع كاش IndexedDB (بند 41).
 * الواجهة تقرأ من الكاش فوراً (تعمل أوفلاين)، والتحديث من الخادم عند الاتصال.
 */
import { supabase } from '@/lib/supabase'
import { db } from '@/db/db'
import { isNetworkError } from '@/services/sync/syncEngine'
import type {
  Business, CashAccount, Customer, Driver, Employee, ExpenseCategory,
  Product, RecipeVersion, Supplier, Unit, UnitConversion, Vehicle, Warehouse,
} from '@/types'

type TableName =
  | 'cache_business' | 'cache_customers' | 'cache_suppliers' | 'cache_products'
  | 'cache_units' | 'cache_unit_conversions' | 'cache_warehouses'
  | 'cache_cash_accounts' | 'cache_expense_categories' | 'cache_employees'
  | 'cache_vehicles' | 'cache_drivers' | 'cache_recipe_versions'

async function fetchRemote<T>(table: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

/** سحب كل البيانات المرجعية وتحديث الكاش — يستدعى عند الاتصال/بعد كل عملية */
export async function refreshLookups(): Promise<void> {
  try {
    const [
      business, customers, suppliers, products, units, conversions, warehouses,
      cashAccounts, expenseCats, employees, vehicles, drivers, recipeVersions,
    ] = await Promise.all([
      fetchRemote<Business>('businesses'),
      fetchRemote<Customer>('customers'),
      fetchRemote<Supplier>('suppliers'),
      fetchRemote<Product>('products'),
      fetchRemote<Unit>('units'),
      fetchRemote<UnitConversion>('unit_conversions'),
      fetchRemote<Warehouse>('warehouses'),
      fetchRemote<CashAccount>('cash_accounts'),
      fetchRemote<ExpenseCategory>('expense_categories'),
      fetchRemote<Employee>('employees'),
      fetchRemote<Vehicle>('vehicles'),
      fetchRemote<Driver>('drivers'),
      fetchRemote<RecipeVersion>('recipe_versions'),
    ])

    const now = new Date().toISOString()
    const put = (table: TableName, rows: { key: string }[]) => db.table(table).clear().then(() => db.table(table).bulkPut(rows))

    await Promise.all([
      put('cache_business', business.map((b) => ({ key: b.id, data: b, fetched_at: now }))),
      put('cache_customers', customers.map((c) => ({ key: c.id, data: c, fetched_at: now }))),
      put('cache_suppliers', suppliers.map((s) => ({ key: s.id, data: s, fetched_at: now }))),
      put('cache_products', products.map((p) => ({ key: p.id, data: p, fetched_at: now }))),
      put('cache_units', units.map((u) => ({ key: u.id, data: u, fetched_at: now }))),
      put('cache_unit_conversions', conversions.map((c) => ({ key: c.id, data: c, fetched_at: now }))),
      put('cache_warehouses', warehouses.map((w) => ({ key: w.id, data: w, fetched_at: now }))),
      put('cache_cash_accounts', cashAccounts.map((c) => ({ key: c.id, data: c, fetched_at: now }))),
      put('cache_expense_categories', expenseCats.map((c) => ({ key: c.id, data: c, fetched_at: now }))),
      put('cache_employees', employees.map((e) => ({ key: e.id, data: e, fetched_at: now }))),
      put('cache_vehicles', vehicles.map((v) => ({ key: v.id, data: v, fetched_at: now }))),
      put('cache_drivers', drivers.map((d) => ({ key: d.id, data: d, fetched_at: now }))),
      put('cache_recipe_versions', recipeVersions.map((r) => ({ key: r.id, data: r, fetched_at: now }))),
    ])
  } catch (err) {
    if (!isNetworkError(err)) {
      console.warn('[lookups] refresh failed:', err instanceof Error ? err.message : err)
    }
  }
}

function getCacheRows<T>(table: TableName): () => Promise<T[]> {
  return async () => {
    const rows = (await db.table(table).toArray()) as { data: T }[]
    return rows.map((r) => r.data)
  }
}

export const lookups = {
  business: getCacheRows<Business>('cache_business'),
  customers: getCacheRows<Customer>('cache_customers'),
  suppliers: getCacheRows<Supplier>('cache_suppliers'),
  products: getCacheRows<Product>('cache_products'),
  units: getCacheRows<Unit>('cache_units'),
  unitConversions: getCacheRows<UnitConversion>('cache_unit_conversions'),
  warehouses: getCacheRows<Warehouse>('cache_warehouses'),
  cashAccounts: getCacheRows<CashAccount>('cache_cash_accounts'),
  expenseCategories: getCacheRows<ExpenseCategory>('cache_expense_categories'),
  employees: getCacheRows<Employee>('cache_employees'),
  vehicles: getCacheRows<Vehicle>('cache_vehicles'),
  drivers: getCacheRows<Driver>('cache_drivers'),
  recipeVersions: getCacheRows<RecipeVersion>('cache_recipe_versions'),
}
