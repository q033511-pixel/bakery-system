/**
 * المُحوِّل المحلي (بند 40/132) — يحاكي واجهة supabase-js (PostgREST) فوق Dexie/IndexedDB.
 * الوضع المحلي الكامل: مستخدم واحد، البيانات على هذا الجهاز فقط.
 *
 * التصميم:
 * - from(table|view): باني استعلام thenable بنمط { data, error } — كل التصفية/الترتيب
 *   تتم في الذاكرة بعد db.table(t).toArray() (بيانات مخبز واحد على جهاز واحد = صغيرة).
 * - select متداخل: علاقة أب←ابن (belongs-to: FK على الصف الأب) تُضمَّن كائناً واحداً أو null،
 *   وعلاقة ابن←أب (has-many: جدول جمع فيه FK = مفرد الأب + _id) تُضمَّن مصفوفة. التداخل يعمل
 *   recursياً (مثال: recipe_versions(*, recipe_items(*, products(name)))).
 * - Views محسوبة (0004_views.sql): v_cash_balances، v_stock، v_customer_balances،
 *   v_supplier_balances — تُحسب لحظياً من الجداول المحلية وتدعم نفس الفلاتر/الترتيب.
 * - auth محلي: جلسة عبر cache_meta (saveSession/restoreContext) + مالك واحد بكلمة مرور
 *   مُجزأة SHA-256 (بادئة ثابتة قبل التجزئة لتفادي hashes عامة).
 * - rpc(fn, params): يغلّف callRpc بخطأ بنمط PostgREST { message, code }.
 */

import { db, type LocalRow } from '@/db/db'
import {
  LocalDbError,
  clearSession,
  getCtx,
  nowIso,
  restoreContext,
  saveSession,
  setCtx,
  uuid,
  type LocalContext,
} from './context'
import { callRpc } from './rpc'

// ============================================================================
// أنواع عامة (بلا any — Record<string, unknown> وgenerics فقط)
// ============================================================================

/**
 * صف استعلام عام — يطابق سلوك supabase-js الحقيقي حيث data يُفسر حرّاً في مواقع
 * الاستدعاء (casts إلى أنواع الكيانات). يُبقي كل ملفات الميزات دون تعديل.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type QueryRow = any

/** خطأ بنمط PostgREST */
export interface PostgrestErrorLike {
  message: string
  code: string
}

/** رد PostgREST: مصفوفة صفوف (select عادي) */
export type QueryRowsResult = { data: QueryRow[] | null; error: PostgrestErrorLike | null }

/** رد PostgREST: سطر واحد (بعد single/maybeSingle) */
export type QuerySingleResult = { data: QueryRow | null; error: PostgrestErrorLike | null }

/** نتيجة داخلية موحّدة — تُفسَّر حسب النمط عند الإرجاع */
type RawResult = { data: unknown; error: PostgrestErrorLike | null }

/** باني سطر واحد: بعد single()/maybeSingle() تنتهي السلسلة بالانتظار فقط */
export type QuerySingleBuilder = PromiseLike<QuerySingleResult>

// ============================================================================
// الجداول والـ Views المعروفة
// ============================================================================

/** جداول Dexie v2 (مطابقة لترحيل 0001) */
const KNOWN_TABLES = new Set<string>([
  'businesses', 'profiles', 'branches', 'warehouses', 'units', 'unit_conversions',
  'product_categories', 'products', 'customers', 'suppliers', 'employees', 'recipes',
  'recipe_versions', 'recipe_items', 'inventory_movements', 'inventory_adjustments',
  'waste_records', 'transfers', 'transfer_items', 'purchases', 'purchase_items',
  'supplier_payments', 'sales', 'sale_items', 'customer_payments', 'production_batches',
  'production_consumption', 'expense_categories', 'expenses', 'cash_accounts',
  'cash_transactions', 'vehicles', 'drivers', 'distribution_loads', 'distribution_items',
  'distribution_deliveries', 'distribution_returns', 'distribution_settlements',
  'audit_logs', 'app_settings', 'doc_sequences', 'processed_operations',
])

/** Views محسوبة (0004_views.sql) — قراءة فقط */
const VIEWS = new Set<string>([
  'v_cash_balances', 'v_stock', 'v_customer_balances', 'v_supplier_balances',
])

// ============================================================================
// خريطة العلاقات
// ============================================================================

/** علاقات ابن←أب (has-many): جدول الابن + عمود FK في الابن + جدول الأب */
const HAS_MANY: { child: string; fk: string; parent: string }[] = [
  { child: 'sale_items', fk: 'sale_id', parent: 'sales' },
  { child: 'purchase_items', fk: 'purchase_id', parent: 'purchases' },
  { child: 'recipe_versions', fk: 'recipe_id', parent: 'recipes' },
  { child: 'recipe_items', fk: 'recipe_version_id', parent: 'recipe_versions' },
  { child: 'distribution_items', fk: 'load_id', parent: 'distribution_loads' },
  { child: 'distribution_deliveries', fk: 'load_id', parent: 'distribution_loads' },
  { child: 'distribution_returns', fk: 'load_id', parent: 'distribution_loads' },
  { child: 'distribution_settlements', fk: 'load_id', parent: 'distribution_loads' },
  { child: 'production_consumption', fk: 'batch_id', parent: 'production_batches' },
  { child: 'transfer_items', fk: 'transfer_id', parent: 'transfers' },
]

/** علاقات أب←ابن (belongs-to): اسم الجدول العلائقي → عمود FK على الصف الأب */
const BELONGS_FK: Record<string, string> = {
  customers: 'customer_id',
  suppliers: 'supplier_id',
  products: 'product_id',
  units: 'unit_id',
  warehouses: 'warehouse_id',
  vehicles: 'vehicle_id',
  drivers: 'driver_id',
  employees: 'employee_id',
  branches: 'branch_id',
  recipes: 'recipe_id',
  recipe_versions: 'recipe_version_id',
  product_categories: 'category_id',
  expense_categories: 'category_id',
  cash_accounts: 'cash_account_id',
  businesses: 'business_id', // عمود عادي في الصفوف — لا يُضمَّن إلا بطلب صريح في select
}

/** استثناءات إلزامية: (جدول الأب.اسم العلاقة) → عمود FK الفعلي */
const BELONGS_EXCEPTIONS: Record<string, string> = {
  'recipe_items.products': 'material_id', // مادة الوصفة عبر material_id وليس product_id
  'sales.distribution_loads': 'load_id', // الحمولة المرتبطة بالبيع
}

function hasManyOf(table: string, rel: string): { child: string; fk: string } | null {
  const hit = HAS_MANY.find((h) => h.parent === table && h.child === rel)
  return hit ? { child: hit.child, fk: hit.fk } : null
}

function belongsFkOf(table: string, rel: string): string {
  return BELONGS_EXCEPTIONS[`${table}.${rel}`] ?? BELONGS_FK[rel] ?? `${rel}_id`
}

// ============================================================================
// تحليل نص select — أعمدة + علاقات متداخلة
// ============================================================================

type SelectPart =
  | { kind: 'col'; name: string; alias: string | null }
  | { kind: 'rel'; name: string; alias: string | null; sub: SelectSpec }

interface SelectSpec {
  parts: SelectPart[]
}

/** فصل على الفواصل العلوية فقط (احترام الأقواس المتداخلة والمسافات/الأسطر) */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      const t = cur.trim()
      if (t) parts.push(t)
      cur = ''
    } else {
      cur += ch
    }
  }
  const last = cur.trim()
  if (last) parts.push(last)
  return parts
}

function parseSelect(text: string): SelectSpec {
  return { parts: splitTopLevel(text).map(parsePart).filter((p): p is SelectPart => p !== null) }
}

function parsePart(token: string): SelectPart | null {
  let alias: string | null = null
  let rest = token.trim()
  // دعم الاسم المستعار: alias:column أو alias:rel(...)
  const colonIdx = rest.indexOf(':')
  if (colonIdx > 0 && /^[\w]+$/.test(rest.slice(0, colonIdx))) {
    alias = rest.slice(0, colonIdx)
    rest = rest.slice(colonIdx + 1).trim()
  }
  // علاقة: rel(sub-select)
  const openIdx = rest.indexOf('(')
  if (openIdx > 0 && rest.endsWith(')')) {
    const name = rest.slice(0, openIdx).trim()
    const inner = rest.slice(openIdx + 1, rest.length - 1)
    return { kind: 'rel', name, alias, sub: parseSelect(inner) }
  }
  // عمود عادي (أو *)
  if (!/^[\w*]+$/.test(rest)) return null // تجاهل أجزاء غير مدعومة (casts نادرة)
  return { kind: 'col', name: rest, alias }
}

// ============================================================================
// مقارنة وتصفية وترتيب (كلها في الذاكرة)
// ============================================================================

type Filter =
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; field: string; value: unknown }
  | { op: 'in'; field: string; values: unknown[] }
  | { op: 'ilike'; field: string; pattern: string }

interface OrderSpec {
  field: string
  ascending: boolean
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}

/**
 * مقارنة عامة: أرقام رقمياً، وسلاسل نصياً (مقارنة نصية آمنة لـ ISO/تواريخ YYYY-MM-DD)،
 * وقيم true/false كأرقام.
 */
function cmpValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return boolNum(a) - boolNum(b)
  }
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function boolNum(v: unknown): number {
  if (typeof v === 'boolean') return v ? 1 : 0
  return Number(v ?? 0)
}

/** ilike: نمط % كحرف بدل أي شيء، غير حساس لحالة الأحرف */
function ilikeRegExp(pattern: string): RegExp {
  const body = pattern
    .split('%')
    .map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`, 'i')
}

function matchesFilter(row: QueryRow, f: Filter): boolean {
  const v = row[f.field]
  switch (f.op) {
    case 'eq':
      return valuesEqual(v, f.value)
    case 'neq':
      return !valuesEqual(v, f.value)
    case 'in':
      return f.values.some((x) => valuesEqual(v, x))
    case 'ilike':
      return v == null ? false : ilikeRegExp(f.pattern).test(String(v))
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      if (v == null || f.value == null) return false
      {
        const c = cmpValues(v, f.value)
        return f.op === 'gte' ? c >= 0 : f.op === 'lte' ? c <= 0 : f.op === 'gt' ? c > 0 : c < 0
      }
  }
}

function matchesFilters(row: QueryRow, filters: Filter[]): boolean {
  return filters.every((f) => matchesFilter(row, f))
}

/** ترتيب متعدد المستويات — القيم الفارغة دائماً في النهاية */
function compareByOrders(a: QueryRow, b: QueryRow, orders: OrderSpec[]): number {
  for (const o of orders) {
    const av = a[o.field]
    const bv = b[o.field]
    const aNull = av == null
    const bNull = bv == null
    if (aNull && bNull) continue
    if (aNull) return 1
    if (bNull) return -1
    const c = cmpValues(av, bv)
    if (c !== 0) return o.ascending === false ? -c : c
  }
  return 0
}

// ============================================================================
// Views محسوبة — انعكاس حرفي لـ 0004_views.sql
// ============================================================================

const IN_TYPES = [
  'PURCHASE_IN', 'PRODUCTION_IN', 'SALE_RETURN_IN',
  'ADJUSTMENT_IN', 'TRANSFER_IN', 'DISTRIBUTION_RETURN_IN',
]

async function computeView(view: string): Promise<QueryRow[]> {
  switch (view) {
    case 'v_cash_balances':
      return computeCashBalances()
    case 'v_stock':
      return computeStockView()
    case 'v_customer_balances':
      return computeCustomerBalances()
    case 'v_supplier_balances':
      return computeSupplierBalances()
    default:
      throw new LocalDbError(`العرض غير معروف محلياً: ${view}`, '42P01')
  }
}

/** v_cash_balances: رصيد كل صندوق = Σ(IN) - Σ(OUT) */
async function computeCashBalances(): Promise<QueryRow[]> {
  const accounts = await db.cash_accounts.toArray()
  const txs = await db.cash_transactions.toArray()
  const net = new Map<string, number>()
  for (const t of txs) {
    const acc = t.cash_account_id != null ? String(t.cash_account_id) : ''
    if (!acc) continue
    const amount = Number(t.amount ?? 0)
    const delta = t.direction === 'IN' ? amount : -amount
    net.set(acc, (net.get(acc) ?? 0) + delta)
  }
  return accounts.map((a) => ({
    account_id: String(a.id),
    business_id: a.business_id ?? null,
    name: a.name ?? null,
    kind: a.kind ?? null,
    balance: net.get(String(a.id)) ?? 0,
  }))
}

/** v_stock: مجموع الكميات لكل (صنف، مستودع) من حركات المخزون + بيانات الصنف */
async function computeStockView(): Promise<QueryRow[]> {
  const movements = await db.inventory_movements.toArray()
  const products = await db.products.toArray()
  const productById = new Map<string, LocalRow>()
  for (const p of products) productById.set(String(p.id), p)
  const groups = new Map<string, QueryRow>()
  for (const m of movements) {
    const product = productById.get(String(m.item_id ?? ''))
    if (!product) continue // join داخلي مع products كما في SQL
    const key = `${String(m.business_id ?? '')}|${String(m.item_id ?? '')}|${String(m.warehouse_id ?? '')}`
    let g = groups.get(key)
    if (!g) {
      g = {
        business_id: m.business_id ?? null,
        item_id: m.item_id ?? null,
        warehouse_id: m.warehouse_id ?? null,
        code: product.code ?? null,
        name: product.name ?? null,
        item_type: product.item_type ?? null,
        qty: 0,
        avg_cost: Number(product.avg_cost ?? 0),
        stock_value: 0,
        min_stock: product.min_stock ?? null,
        base_unit_id: product.base_unit_id ?? null,
      }
      groups.set(key, g)
    }
    const qty = Number(m.quantity ?? 0)
    const sign = IN_TYPES.includes(String(m.movement_type)) ? 1 : -1
    g.qty = Number(g.qty ?? 0) + sign * qty
  }
  const rows: QueryRow[] = []
  for (const g of groups.values()) {
    g.stock_value = Number(g.qty ?? 0) * Number(g.avg_cost ?? 0)
    rows.push(g)
  }
  return rows
}

/** v_customer_balances: مبيعات آجلة مؤكدة - مدفوعات العميل */
async function computeCustomerBalances(): Promise<QueryRow[]> {
  const [customers, sales, payments] = await Promise.all([
    db.customers.toArray(),
    db.sales.toArray(),
    db.customer_payments.toArray(),
  ])
  const credit = new Map<string, number>()
  for (const s of sales) {
    if (s.status !== 'CONFIRMED' || s.payment_type !== 'CREDIT') continue
    const cid = s.customer_id != null ? String(s.customer_id) : ''
    if (!cid) continue
    credit.set(cid, (credit.get(cid) ?? 0) + Number(s.total ?? 0))
  }
  const paid = new Map<string, number>()
  for (const p of payments) {
    const cid = p.customer_id != null ? String(p.customer_id) : ''
    if (!cid) continue
    paid.set(cid, (paid.get(cid) ?? 0) + Number(p.amount ?? 0))
  }
  return customers.map((c) => {
    const totalSales = credit.get(String(c.id)) ?? 0
    return {
      customer_id: String(c.id),
      business_id: c.business_id ?? null,
      code: c.code ?? null,
      name: c.name ?? null,
      total_sales: totalSales,
      balance: totalSales - (paid.get(String(c.id)) ?? 0),
    }
  })
}

/** v_supplier_balances: مشتريات آجلة مؤكدة - مدفوعات المورد */
async function computeSupplierBalances(): Promise<QueryRow[]> {
  const [suppliers, purchases, payments] = await Promise.all([
    db.suppliers.toArray(),
    db.purchases.toArray(),
    db.supplier_payments.toArray(),
  ])
  const credit = new Map<string, number>()
  for (const p of purchases) {
    if (p.status !== 'CONFIRMED' || p.payment_type !== 'CREDIT') continue
    const sid = p.supplier_id != null ? String(p.supplier_id) : ''
    if (!sid) continue
    credit.set(sid, (credit.get(sid) ?? 0) + Number(p.total ?? 0))
  }
  const paid = new Map<string, number>()
  for (const p of payments) {
    const sid = p.supplier_id != null ? String(p.supplier_id) : ''
    if (!sid) continue
    paid.set(sid, (paid.get(sid) ?? 0) + Number(p.amount ?? 0))
  }
  return suppliers.map((s) => {
    const totalPurchases = credit.get(String(s.id)) ?? 0
    return {
      supplier_id: String(s.id),
      business_id: s.business_id ?? null,
      code: s.code ?? null,
      name: s.name ?? null,
      total_purchases: totalPurchases,
      balance: totalPurchases - (paid.get(String(s.id)) ?? 0),
    }
  })
}

// ============================================================================
// تحميل مصدر الصفوف (جدول أو view محسوب)
// ============================================================================

async function loadSource(table: string): Promise<QueryRow[]> {
  if (VIEWS.has(table)) return computeView(table)
  if (!KNOWN_TABLES.has(table)) {
    throw new LocalDbError(`الجدول أو العرض غير موجود في قاعدة البيانات المحلية: ${table}`, '42P01')
  }
  const rows = await db.table(table).toArray()
  return rows as QueryRow[]
}

// ============================================================================
// الإسقاط والتضمين — select متداخل recursي
// ============================================================================

async function applySelect(rows: QueryRow[], spec: SelectSpec | null, table: string): Promise<QueryRow[]> {
  if (!spec) return rows
  const columns = spec.parts.filter((p): p is Extract<SelectPart, { kind: 'col' }> => p.kind === 'col')
  const relations = spec.parts.filter((p): p is Extract<SelectPart, { kind: 'rel' }> => p.kind === 'rel')
  const hasStar = columns.some((c) => c.name === '*')

  // جلب بيانات العلاقات مسبقاً (دفعة واحدة لكل علاقة — البيانات صغيرة)
  const childMaps = new Map<string, Map<string, QueryRow[]>>()
  const parentMaps = new Map<string, Map<string, QueryRow>>()
  for (const rel of relations) {
    const hm = hasManyOf(table, rel.name)
    if (hm) {
      const childRows = await loadSource(hm.child)
      const byParent = new Map<string, QueryRow[]>()
      for (const cr of childRows) {
        const pid = cr[hm.fk]
        if (pid == null) continue
        const k = String(pid)
        const arr = byParent.get(k)
        if (arr) arr.push(cr)
        else byParent.set(k, [cr])
      }
      childMaps.set(rel.name, byParent)
    } else {
      if (!KNOWN_TABLES.has(rel.name)) {
        throw new LocalDbError(`علاقة غير معروفة: ${table}.${rel.name}`, 'PGRST200')
      }
      const fkCol = belongsFkOf(table, rel.name)
      const ids: string[] = []
      for (const row of rows) {
        const fv = row[fkCol]
        if (fv != null) {
          const k = String(fv)
          if (!ids.includes(k)) ids.push(k)
        }
      }
      const parentRows = await db.table(rel.name).bulkGet(ids)
      const byId = new Map<string, QueryRow>()
      for (let i = 0; i < ids.length; i++) {
        const pr = parentRows[i]
        if (pr) byId.set(ids[i] as string, pr as QueryRow)
      }
      parentMaps.set(rel.name, byId)
    }
  }

  const out: QueryRow[] = []
  for (const row of rows) {
    const rec: QueryRow = {}
    // الأعمدة المطلوبة صراحةً
    for (const col of columns) {
      if (col.name === '*') continue
      const key = col.alias ?? col.name
      if (col.name in row) rec[key] = row[col.name]
    }
    // * = كل الأعمدة ثم تُضاف العلاقات فوقها
    if (hasStar) {
      for (const k of Object.keys(row)) {
        if (!(k in rec)) rec[k] = row[k]
      }
    }
    // العلاقات: ابن ← مصفوفة، أب ← كائن أو null
    for (const rel of relations) {
      const key = rel.alias ?? rel.name
      if (childMaps.has(rel.name)) {
        const byParent = childMaps.get(rel.name)
        const children = (row.id != null ? byParent?.get(String(row.id)) : undefined) ?? []
        rec[key] = await applySelect(children, rel.sub, rel.name)
      } else {
        const byId = parentMaps.get(rel.name)
        const fkCol = belongsFkOf(table, rel.name)
        const fv = row[fkCol]
        const parent = fv != null ? (byId?.get(String(fv)) ?? null) : null
        if (parent) {
          const projected = await applySelect([parent], rel.sub, rel.name)
          rec[key] = projected[0] ?? null
        } else {
          rec[key] = null
        }
      }
    }
    out.push(rec)
  }
  return out
}

// ============================================================================
// باني الاستعلام — thenable بنمط PostgREST
// ============================================================================

type Mutation =
  | { kind: 'insert'; values: QueryRow[] }
  | { kind: 'update'; patch: QueryRow }
  | { kind: 'delete' }

export class QueryBuilder implements PromiseLike<QueryRowsResult> {
  private readonly tableName: string
  private selectSpec: SelectSpec | null = null
  private filters: Filter[] = []
  private orders: OrderSpec[] = []
  private limitCount: number | null = null
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'
  private mutation: Mutation | null = null

  constructor(table: string) {
    this.tableName = table
  }

  // ----- بناء الاستعلام -----
  select(columns?: string): this {
    this.selectSpec = parseSelect(columns ?? '*')
    return this
  }

  eq(field: string, value: unknown): this {
    this.filters.push({ op: 'eq', field, value })
    return this
  }

  neq(field: string, value: unknown): this {
    this.filters.push({ op: 'neq', field, value })
    return this
  }

  gt(field: string, value: unknown): this {
    this.filters.push({ op: 'gt', field, value })
    return this
  }

  gte(field: string, value: unknown): this {
    this.filters.push({ op: 'gte', field, value })
    return this
  }

  lt(field: string, value: unknown): this {
    this.filters.push({ op: 'lt', field, value })
    return this
  }

  lte(field: string, value: unknown): this {
    this.filters.push({ op: 'lte', field, value })
    return this
  }

  in(field: string, values: unknown[]): this {
    this.filters.push({ op: 'in', field, values })
    return this
  }

  ilike(field: string, pattern: string): this {
    this.filters.push({ op: 'ilike', field, pattern })
    return this
  }

  order(field: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ field, ascending: opts?.ascending !== false })
    return this
  }

  limit(count: number): this {
    this.limitCount = count
    return this
  }

  single(): QuerySingleBuilder {
    this.mode = 'single'
    return this as unknown as QuerySingleBuilder
  }

  maybeSingle(): QuerySingleBuilder {
    this.mode = 'maybeSingle'
    return this as unknown as QuerySingleBuilder
  }

  // ----- الكتابة -----
  insert(values: QueryRow | QueryRow[]): this {
    this.mutation = { kind: 'insert', values: Array.isArray(values) ? values : [values] }
    return this
  }

  update(patch: QueryRow): this {
    this.mutation = { kind: 'update', patch }
    return this
  }

  delete(): this {
    this.mutation = { kind: 'delete' }
    return this
  }

  // ----- thenable -----
  then<TResult1 = QueryRowsResult, TResult2 = never>(
    onfulfilled?: ((value: QueryRowsResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execRaw().then((res) => {
      const value = res as QueryRowsResult
      return onfulfilled ? onfulfilled(value) : (value as unknown as TResult1)
    }, onrejected)
  }

  // ----- التنفيذ -----
  private async execRaw(): Promise<RawResult> {
    try {
      return await this.run()
    } catch (err) {
      if (err instanceof LocalDbError) {
        return { data: null, error: { message: err.message, code: err.code } }
      }
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : String(err), code: 'XX000' },
      }
    }
  }

  private async run(): Promise<RawResult> {
    if (this.mutation) return this.runMutation()
    const rows = await loadSource(this.tableName)
    return this.finalize(rows.filter((r) => matchesFilters(r, this.filters)))
  }

  /** ترتيب → حد → إسقاط/تضمين → single/maybeSingle */
  private async finalize(rows: QueryRow[]): Promise<RawResult> {
    const ordered = [...rows].sort((a, b) => compareByOrders(a, b, this.orders))
    const limited = this.limitCount != null ? ordered.slice(0, this.limitCount) : ordered
    const projected = await applySelect(limited, this.selectSpec, this.tableName)
    if (this.mode === 'single') {
      const first = projected[0]
      if (first == null) {
        return { data: null, error: { message: 'لم يتم العثور على السجل.', code: 'PGRST116' } }
      }
      return { data: first, error: null }
    }
    if (this.mode === 'maybeSingle') {
      return { data: projected[0] ?? null, error: null }
    }
    return { data: projected, error: null }
  }

  private async runMutation(): Promise<RawResult> {
    const m = this.mutation
    if (!m) return { data: null, error: null }
    if (VIEWS.has(this.tableName)) {
      return {
        data: null,
        error: { message: 'العرض (view) للقراءة فقط — لا يمكن التعديل عليه.', code: '42501' },
      }
    }
    if (!KNOWN_TABLES.has(this.tableName)) {
      return {
        data: null,
        error: { message: `الجدول غير موجود محلياً: ${this.tableName}`, code: '42P01' },
      }
    }
    const table = db.table(this.tableName)

    if (m.kind === 'insert') {
      const prepared: QueryRow[] = m.values.map((v) => ({
        ...v,
        id: typeof v.id === 'string' && v.id ? v.id : uuid(),
        created_at: typeof v.created_at === 'string' && v.created_at ? v.created_at : nowIso(),
        updated_at: typeof v.updated_at === 'string' && v.updated_at ? v.updated_at : nowIso(),
      }))
      if (prepared.length > 0) await table.bulkPut(prepared as LocalRow[])
      if (!this.selectSpec) return { data: null, error: null }
      return this.finalize(prepared)
    }

    // تحديث/حذف: على الصفوف المطابقة للفلاتر
    const all = await loadSource(this.tableName)
    const matched = all.filter((r) => matchesFilters(r, this.filters))

    if (m.kind === 'update') {
      const updated: QueryRow[] = matched.map((r) => ({ ...r, ...m.patch, updated_at: nowIso() }))
      if (updated.length > 0) await table.bulkPut(updated as LocalRow[])
      if (!this.selectSpec) return { data: null, error: null }
      return this.finalize(updated)
    }

    // delete
    const ids = matched.map((r) => String(r.id))
    if (ids.length > 0) await table.bulkDelete(ids)
    if (!this.selectSpec) return { data: null, error: null }
    return this.finalize(matched)
  }
}

/** نقطة الدخول المطابقة لـ supabase.from(...) */
export function from(table: string): QueryBuilder {
  return new QueryBuilder(table)
}

// ============================================================================
// auth المحلي — جلسة على الجهاز + مالك واحد
// ============================================================================

export interface AuthUserLike {
  id: string
  email: string
}

export interface AuthSessionLike {
  user: AuthUserLike
}

export interface AuthData {
  user: AuthUserLike | null
  session: AuthSessionLike | null
}

export interface AuthResponse {
  data: AuthData
  error: PostgrestErrorLike | null
}

const PASSWORD_PREFIX = 'bakery-local$'

/** SHA-256 hex مع بادئة ثابتة قبل التجزئة (تفادي hashes عامة) */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(`${PASSWORD_PREFIX}${input}`)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // سياق غير آمن (بلا crypto.subtle) — تجزئة بديلة ثابتة تكفي للتمييز المحلي
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (const byte of data) {
    h1 = Math.imul((h1 ^ byte) >>> 0, 0x01000193) >>> 0
    h2 = (h2 + Math.imul(byte + 1, h1)) >>> 0
  }
  return `fb${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

function ctxFromProfile(p: QueryRow): LocalContext {
  return {
    userId: String(p.id),
    email: typeof p.email === 'string' ? p.email : null,
    businessId: typeof p.business_id === 'string' ? p.business_id : null,
    role: typeof p.role === 'string' ? p.role : 'PENDING',
    fullName: typeof p.full_name === 'string' ? p.full_name : '',
  }
}

function createOwnerRow(email: string, passwordHash: string, fullName: string): LocalRow {
  const now = nowIso()
  return {
    id: uuid(),
    email,
    full_name: fullName,
    phone: null,
    role: 'OWNER',
    active: true,
    business_id: null,
    local_password: passwordHash,
    created_at: now,
    updated_at: now,
  }
}

async function findOwner(): Promise<LocalRow | null> {
  const profiles = await db.profiles.toArray()
  return profiles.find((p) => p.role === 'OWNER') ?? null
}

export const auth = {
  /** الجلسة المحلية الحالية — عبر restoreContext() */
  async getSession(): Promise<{ data: { session: AuthSessionLike | null }; error: PostgrestErrorLike | null }> {
    const logged = await restoreContext()
    const userId = getCtx().userId
    const session = logged && userId ? { user: { id: userId, email: getCtx().email ?? '' } } : null
    return { data: { session }, error: null }
  },

  /** دخول المالك — إن لم يوجد مالك يُهيأ تلقائياً (جهاز مستخدم واحد) */
  async signInWithPassword(creds: { email: string; password: string }): Promise<AuthResponse> {
    const owner = await findOwner()
    const hash = await sha256Hex(creds.password)
    if (!owner) {
      const row = createOwnerRow(creds.email, hash, '')
      await db.profiles.put(row)
      await saveSession(row.id)
      setCtx(ctxFromProfile(row))
      const user: AuthUserLike = { id: row.id, email: creds.email }
      return { data: { user, session: { user } }, error: null }
    }
    if (owner.local_password !== hash) {
      return {
        data: { user: null, session: null },
        error: {
          message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
          code: 'invalid_credentials',
        },
      }
    }
    // جهاز شخص واحد: المهم كلمة المرور الصحيحة — البريد قد يختلف عن المخزن
    const email = typeof owner.email === 'string' ? owner.email : creds.email
    await saveSession(owner.id)
    setCtx(ctxFromProfile(owner))
    const user: AuthUserLike = { id: owner.id, email }
    return { data: { user, session: { user } }, error: null }
  },

  /** تهيئة المالك أول مرة — يرفض إن وُجد مالك سابق */
  async signUp(creds: {
    email: string
    password: string
    options?: { data?: Record<string, unknown> }
  }): Promise<AuthResponse> {
    const owner = await findOwner()
    if (owner) {
      return {
        data: { user: null, session: null },
        error: { message: 'هذا الجهاز مُهيأ لمستخدم واحد بالفعل.', code: 'user_already_exists' },
      }
    }
    const optName = creds.options?.data?.full_name
    const fullName = typeof optName === 'string' ? optName : ''
    const hash = await sha256Hex(creds.password)
    const row = createOwnerRow(creds.email, hash, fullName)
    await db.profiles.put(row)
    await saveSession(row.id)
    setCtx(ctxFromProfile(row))
    const user: AuthUserLike = { id: row.id, email: creds.email }
    return { data: { user, session: { user } }, error: null }
  },

  async signOut(): Promise<{ error: PostgrestErrorLike | null }> {
    await clearSession()
    return { error: null }
  },

  async resetPasswordForEmail(_email?: string): Promise<{ data: null; error: PostgrestErrorLike | null }> {
    return {
      data: null,
      error: {
        message: 'الوضع المحلي يعمل على هذا الجهاز — لا إعادة تعيين عبر البريد. سجل الدخول بكلمة مرورك.',
        code: 'local_mode',
      },
    }
  },
}

// ============================================================================
// rpc — يغلّف callRpc بخطأ بنمط PostgREST
// ============================================================================

export async function rpc(
  fnName: string,
  params: Record<string, unknown>,
): Promise<{ data: unknown; error: PostgrestErrorLike | null }> {
  try {
    return { data: await callRpc(fnName, params), error: null }
  } catch (err) {
    if (err instanceof LocalDbError) {
      return { data: null, error: { message: err.message, code: err.code } }
    }
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err), code: 'XX000' },
    }
  }
}

// ============================================================================
// التصدير
// ============================================================================

export const adapter = { from, rpc, auth }
