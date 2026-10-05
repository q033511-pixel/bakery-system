/**
 * Domain types — مصدر الحقيقة الوحيد لأنواع النطاق (بند 103)
 * Strong types: no `any` in business logic. DTOs mirror DB rows via sql types below.
 */

// ---------- Enums (mirror DB enums) ----------
export type UserRole =
  | 'OWNER'
  | 'ADMIN'
  | 'ACCOUNTANT'
  | 'SALES'
  | 'WAREHOUSE'
  | 'PRODUCTION'
  | 'DISTRIBUTOR'
  | 'VIEWER'
  | 'PENDING'

export type ItemType = 'RAW_MATERIAL' | 'FINISHED_PRODUCT' | 'PACKAGING'

export type MovementType =
  | 'PURCHASE_IN'
  | 'PURCHASE_RETURN_OUT'
  | 'PRODUCTION_CONSUMPTION_OUT'
  | 'PRODUCTION_IN'
  | 'SALE_OUT'
  | 'SALE_RETURN_IN'
  | 'WASTE_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'DISTRIBUTION_LOAD_OUT'
  | 'DISTRIBUTION_RETURN_IN'

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'OTHER'

export type PaymentType = 'CASH' | 'CREDIT'

export type DocStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'VOIDED'

export type SyncStatusLocal = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED'

export type CashDirection = 'IN' | 'OUT'

export type LoadStatus = 'OPEN' | 'IN_PROGRESS' | 'SETTLED'

// ---------- Identity ----------
export interface Profile {
  id: string
  business_id: string | null
  full_name: string | null
  phone: string | null
  role: UserRole
  active: boolean
  created_at: string
  updated_at: string
}

export interface Business {
  id: string
  name: string
  currency: string
  currency_symbol: string
  timezone: string
  allow_negative_stock: boolean
  invoice_prefix: string
  created_at: string
}

// ---------- Master data ----------
export interface Unit {
  id: string
  business_id: string
  name: string
  symbol: string
  is_base: boolean
  created_at: string
}

/** conversion: from_unit qty * factor = to_unit qty (e.g. 1 كيس = factor 50 → كغ) */
export interface UnitConversion {
  id: string
  business_id: string
  from_unit_id: string
  to_unit_id: string
  factor: number
}

export interface ProductCategory {
  id: string
  business_id: string
  name: string
  notes: string | null
}

export interface Product {
  id: string
  business_id: string
  code: string
  name: string
  item_type: ItemType
  category_id: string | null
  base_unit_id: string
  sales_unit_id: string | null
  sale_price: number
  default_cost: number
  avg_cost: number
  last_purchase_cost: number | null
  min_stock: number
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  business_id: string
  code: string
  name: string
  phone: string | null
  area: string | null
  salesperson: string | null
  credit_limit: number
  payment_terms_days: number
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  business_id: string
  code: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface Employee {
  id: string
  business_id: string
  name: string
  phone: string | null
  role: string | null
  active: boolean
  notes: string | null
  created_at: string
}

export interface Warehouse {
  id: string
  business_id: string
  name: string
  kind: string
  is_default: boolean
  active: boolean
}

// ---------- Recipes ----------
export interface Recipe {
  id: string
  business_id: string
  product_id: string
  name: string
  notes: string | null
  created_at: string
}

export interface RecipeVersion {
  id: string
  business_id: string
  recipe_id: string
  version_no: number
  output_quantity: number
  output_unit_id: string
  notes: string | null
  created_by: string | null
  created_at: string
  items?: RecipeItem[]
}

export interface RecipeItem {
  id: string
  recipe_version_id: string
  material_id: string
  quantity: number
  unit_id: string
}

// ---------- Purchases ----------
export interface Purchase {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  supplier_id: string
  warehouse_id: string
  purchase_date: string
  invoice_number: string | null
  payment_type: PaymentType
  payment_method: PaymentMethod | null
  subtotal: number
  discount: number
  total: number
  status: DocStatus
  notes: string | null
  created_by: string
  created_at: string
  items?: PurchaseItem[]
  supplier_name?: string
}

export interface PurchaseItem {
  id: string
  purchase_id: string
  product_id: string
  quantity: number
  unit_id: string
  unit_price: number
  total: number
  product_name?: string
  unit_symbol?: string
}

export interface SupplierPayment {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  supplier_id: string
  payment_date: string
  amount: number
  payment_method: PaymentMethod
  cash_account_id: string | null
  reference: string | null
  notes: string | null
  created_by: string
  created_at: string
  supplier_name?: string
}

// ---------- Sales ----------
export interface Sale {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  customer_id: string | null
  warehouse_id: string
  sale_date: string
  subtotal: number
  discount: number
  total: number
  cost_total: number
  payment_type: PaymentType
  payment_method: PaymentMethod | null
  status: DocStatus
  channel: 'DIRECT' | 'DISTRIBUTION'
  notes: string | null
  created_by: string
  created_at: string
  items?: SaleItem[]
  customer_name?: string | null
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string
  quantity: number
  unit_id: string
  unit_price: number
  total: number
  product_name?: string
  unit_symbol?: string
}

export interface CustomerPayment {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  customer_id: string
  payment_date: string
  amount: number
  payment_method: PaymentMethod
  cash_account_id: string | null
  reference: string | null
  notes: string | null
  created_by: string
  created_at: string
  customer_name?: string
}

// ---------- Inventory ----------
export interface InventoryMovement {
  id: string
  business_id: string
  item_id: string
  item_type: ItemType
  warehouse_id: string
  movement_type: MovementType
  quantity: number
  unit_cost: number
  total_cost: number
  reference_type: string | null
  reference_id: string | null
  operation_id: string | null
  created_by: string | null
  created_at: string
  item_name?: string
  warehouse_name?: string
}

export interface InventoryAdjustment {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  product_id: string
  warehouse_id: string
  direction: 'IN' | 'OUT'
  quantity: number
  reason: string
  adjusted_at: string
  notes: string | null
  created_by: string
  created_at: string
}

export interface WasteRecord {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  product_id: string
  warehouse_id: string
  quantity: number
  reason: string
  wasted_at: string
  notes: string | null
  created_by: string
  created_at: string
}

export interface StockRow {
  product_id: string
  code: string
  name: string
  item_type: ItemType
  unit_symbol: string
  warehouse_id: string
  warehouse_name: string
  qty: number
  avg_cost: number
  stock_value: number
  min_stock: number
  low: boolean
}

// ---------- Production ----------
export interface ProductionBatch {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  product_id: string
  warehouse_id: string
  recipe_version_id: string | null
  quantity: number
  unit_id: string
  batch_date: string
  shift: string | null
  material_cost: number
  status: DocStatus
  notes: string | null
  created_by: string
  created_at: string
  product_name?: string
  consumption?: ProductionConsumption[]
}

export interface ProductionConsumption {
  id: string
  batch_id: string
  material_id: string
  quantity: number
  unit_id: string
  unit_cost: number
  total_cost: number
  material_name?: string
}

// ---------- Expenses / Cash ----------
export interface ExpenseCategory {
  id: string
  business_id: string
  name: string
}

export interface Expense {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  category_id: string
  amount: number
  expense_date: string
  payment_method: PaymentMethod
  cash_account_id: string | null
  description: string | null
  notes: string | null
  created_by: string
  created_at: string
  category_name?: string
}

export interface CashAccount {
  id: string
  business_id: string
  name: string
  kind: string
  active: boolean
  is_default: boolean
}

export interface CashTransaction {
  id: string
  business_id: string
  cash_account_id: string
  direction: CashDirection
  amount: number
  reference_type: string | null
  reference_id: string | null
  operation_id: string | null
  description: string | null
  created_by: string | null
  created_at: string
}

// ---------- Distribution ----------
export interface Vehicle {
  id: string
  business_id: string
  code: string
  name: string
  plate: string | null
  active: boolean
  notes: string | null
}

export interface Driver {
  id: string
  business_id: string
  name: string
  phone: string | null
  active: boolean
  notes: string | null
}

export interface DistributionLoad {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  vehicle_id: string
  driver_id: string | null
  distributor_id: string | null
  warehouse_id: string
  load_date: string
  status: LoadStatus
  notes: string | null
  created_by: string
  created_at: string
  items?: DistributionItem[]
  vehicle_name?: string
  driver_name?: string | null
}

export interface DistributionItem {
  id: string
  load_id: string
  product_id: string
  quantity: number
  unit_id: string
  product_name?: string
  unit_symbol?: string
}

export interface DistributionDelivery {
  id: string
  operation_id: string
  load_id: string
  customer_id: string
  product_id: string
  quantity: number
  unit_id: string
  unit_price: number
  total: number
  payment_type: PaymentType
  delivery_date: string
  business_id: string
  created_by: string
  created_at: string
  customer_name?: string
  product_name?: string
}

export interface DistributionReturn {
  id: string
  operation_id: string
  load_id: string
  product_id: string
  quantity: number
  unit_id: string
  reason: string | null
  return_date: string
  business_id: string
  created_by: string
  created_at: string
  product_name?: string
}

export interface DistributionSettlement {
  id: string
  operation_id: string
  doc_number: string
  load_id: string
  business_id: string
  settlement_date: string
  loaded_qty: number
  sold_qty: number
  returned_qty: number
  waste_qty: number
  unaccounted_qty: number
  cash_collected: number
  credit_total: number
  cash_expected: number
  cash_variance: number
  variance_note: string | null
  created_by: string
  created_at: string
}

// ---------- Transfers ----------
export interface Transfer {
  id: string
  operation_id: string
  doc_number: string
  business_id: string
  from_warehouse_id: string
  to_warehouse_id: string
  transfer_date: string
  status: DocStatus
  notes: string | null
  created_by: string
  created_at: string
  items?: TransferItem[]
}

export interface TransferItem {
  id: string
  transfer_id: string
  product_id: string
  quantity: number
  unit_id: string
  product_name?: string
}

// ---------- Ledger ----------
export interface LedgerRow {
  date: string
  type: string
  reference: string
  debit: number
  credit: number
  balance: number
  notes: string | null
}

// ---------- Audit ----------
export interface AuditLog {
  id: string
  business_id: string
  user_id: string | null
  user_email: string | null
  operation: string
  entity: string
  entity_id: string | null
  action: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  created_at: string
}

// ---------- Settings ----------
export interface AppSettings {
  business_id: string
  currency: string
  currency_symbol: string
  timezone: string
  allow_negative_stock: boolean
  doc_prefixes: Record<string, string>
  payment_methods: PaymentMethod[]
  setup_code_used: boolean
  [key: string]: unknown
}

// ---------- Offline sync ----------
export interface PendingOp {
  id?: number
  operation_id: string
  type: string
  payload: Record<string, unknown>
  status: SyncStatusLocal
  attempts: number
  last_error: string | null
  created_at: string
  synced_at: string | null
  summary: string
}

// ---------- RPC payloads (single source for client + server) ----------
export interface SaleLineInput {
  product_id: string
  quantity: number
  unit_id: string
  unit_price: number
}

export interface CreateSaleInput {
  operation_id: string
  customer_id: string | null
  warehouse_id: string
  sale_date: string
  items: SaleLineInput[]
  discount: number
  payment_type: PaymentType
  payment_method: PaymentMethod | null
  notes: string | null
}

export interface CreatePurchaseInput {
  operation_id: string
  supplier_id: string
  warehouse_id: string
  purchase_date: string
  invoice_number: string | null
  items: { product_id: string; quantity: number; unit_id: string; unit_price: number }[]
  discount: number
  payment_type: PaymentType
  payment_method: PaymentMethod | null
  notes: string | null
}

export interface CreatePaymentInput {
  operation_id: string
  party_id: string
  payment_date: string
  amount: number
  payment_method: PaymentMethod
  cash_account_id: string | null
  reference: string | null
  notes: string | null
}

export interface CreateProductionInput {
  operation_id: string
  product_id: string
  warehouse_id: string
  recipe_version_id: string | null
  quantity: number
  unit_id: string
  batch_date: string
  shift: string | null
  notes: string | null
}

export interface CreateExpenseInput {
  operation_id: string
  category_id: string
  amount: number
  expense_date: string
  payment_method: PaymentMethod
  cash_account_id: string | null
  description: string | null
  notes: string | null
}

export interface CreateLoadInput {
  operation_id: string
  vehicle_id: string
  driver_id: string | null
  distributor_id: string | null
  warehouse_id: string
  load_date: string
  items: { product_id: string; quantity: number; unit_id: string }[]
  notes: string | null
}

export interface CreateTransferInput {
  operation_id: string
  from_warehouse_id: string
  to_warehouse_id: string
  transfer_date: string
  items: { product_id: string; quantity: number; unit_id: string }[]
  notes: string | null
}

// ---------- Dashboard ----------
export interface DashboardSummary {
  sales_today: number
  collections_today: number
  purchases_today: number
  production_today: number
  expenses_today: number
  customer_receivables: number
  supplier_payables: number
  inventory_value: number
  low_stock_count: number
  pending_sync_count: number
  distribution_open_loads: number
  customers_count: number
  products_count: number
  sales_today_count: number
  cash_balance: number
}
