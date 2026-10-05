-- ============================================================================
-- 0001_schema.sql — نظام إدارة المخبز: الجداول والقيود والفهارس
-- From empty database to full schema. PostgreSQL 15+ / Supabase.
-- المبادئ: كل رصيد يُحسب من الحركات، operation_id فريد لكل عملية،
-- لا حذف للعمليات المالية (VOID فقط)، numeric للأموال وليس float.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
do $$ begin
  create type user_role as enum (
    'OWNER','ADMIN','ACCOUNTANT','SALES','WAREHOUSE','PRODUCTION','DISTRIBUTOR','VIEWER','PENDING'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_type as enum ('RAW_MATERIAL','FINISHED_PRODUCT','PACKAGING');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('CASH','BANK_TRANSFER','CHECK','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_type as enum ('CASH','CREDIT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type doc_status as enum ('DRAFT','CONFIRMED','CANCELLED','VOIDED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type movement_type as enum (
    'PURCHASE_IN','PURCHASE_RETURN_OUT',
    'PRODUCTION_CONSUMPTION_OUT','PRODUCTION_IN',
    'SALE_OUT','SALE_RETURN_IN',
    'WASTE_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT',
    'TRANSFER_IN','TRANSFER_OUT',
    'DISTRIBUTION_LOAD_OUT','DISTRIBUTION_RETURN_IN'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type load_status as enum ('OPEN','IN_PROGRESS','SETTLED');
exception when duplicate_object then null; end $$;

-- ---------- Core / identity ----------
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'ILS',
  currency_symbol text not null default '₪',
  timezone text not null default 'Asia/Jerusalem',
  allow_negative_stock boolean not null default false,
  invoice_prefix text not null default 'INV',
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null,
  full_name text,
  phone text,
  role user_role not null default 'PENDING',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_profiles_business on profiles(business_id);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  address text,
  active boolean not null default true
);

create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  kind text not null default 'MAIN',  -- MAIN | RAW | FINISHED | BRANCH | DISTRIBUTION
  is_default boolean not null default false,
  active boolean not null default true
);
create index if not exists idx_warehouses_business on warehouses(business_id);

-- ---------- Units ----------
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  symbol text not null,
  is_base boolean not null default false
);
create index if not exists idx_units_business on units(business_id);

create table if not exists unit_conversions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  from_unit_id uuid not null references units(id) on delete cascade,
  to_unit_id uuid not null references units(id) on delete cascade,
  factor numeric(14,6) not null check (factor > 0),
  unique (business_id, from_unit_id, to_unit_id)
);

-- ---------- Products ----------
create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  notes text
);
create index if not exists idx_product_categories_business on product_categories(business_id);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  item_type item_type not null,
  category_id uuid references product_categories(id) on delete set null,
  base_unit_id uuid not null references units(id),
  sales_unit_id uuid references units(id),
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  default_cost numeric(14,2) not null default 0 check (default_cost >= 0),
  avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0),
  last_purchase_cost numeric(14,4),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code)
);
create index if not exists idx_products_business on products(business_id);
create index if not exists idx_products_type on products(business_id, item_type);

-- ---------- Parties ----------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  phone text,
  area text,
  salesperson text,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  payment_terms_days integer not null default 0,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code)
);
create index if not exists idx_customers_business on customers(business_id);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  phone text,
  address text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code)
);
create index if not exists idx_suppliers_business on suppliers(business_id);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text,
  role text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_employees_business on employees(business_id);

-- ---------- Recipes (بند 24/25: versioning) ----------
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_recipes_business on recipes(business_id);

create table if not exists recipe_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  version_no integer not null,
  output_quantity numeric(14,3) not null check (output_quantity > 0),
  output_unit_id uuid not null references units(id),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (recipe_id, version_no)
);

create table if not exists recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references recipe_versions(id) on delete cascade,
  material_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id)
);
create index if not exists idx_recipe_items_version on recipe_items(recipe_version_id);

-- ---------- Inventory ledger (الجدول المحوري — بند 12) ----------
create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  item_id uuid not null references products(id),
  item_type item_type not null,
  warehouse_id uuid not null references warehouses(id),
  movement_type movement_type not null,
  quantity numeric(14,3) not null check (quantity > 0), -- دائماً موجبة؛ الاتجاه من نوع الحركة
  input_quantity numeric(14,3) not null,                -- الكمية كما أدخلها المستخدم
  input_unit_id uuid references units(id),
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,2) not null default 0,
  reference_type text,
  reference_id uuid,
  operation_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_mov_item_wh on inventory_movements(business_id, item_id, warehouse_id);
create index if not exists idx_mov_created on inventory_movements(business_id, created_at desc);
create index if not exists idx_mov_operation on inventory_movements(operation_id);
create index if not exists idx_mov_reference on inventory_movements(reference_type, reference_id);

create table if not exists inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  direction text not null check (direction in ('IN','OUT')),
  quantity numeric(14,3) not null check (quantity > 0),
  reason text not null,
  adjusted_at date not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_adj_business on inventory_adjustments(business_id, adjusted_at desc);

create table if not exists waste_records (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  quantity numeric(14,3) not null check (quantity > 0),
  reason text not null,
  wasted_at date not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_waste_business on waste_records(business_id, wasted_at desc);

create table if not exists transfers (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  from_warehouse_id uuid not null references warehouses(id),
  to_warehouse_id uuid not null references warehouses(id),
  transfer_date date not null,
  status doc_status not null default 'CONFIRMED',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_transfers_business on transfers(business_id, transfer_date desc);

create table if not exists transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references transfers(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id)
);

-- ---------- Purchases (بند 14) ----------
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  warehouse_id uuid not null references warehouses(id),
  purchase_date date not null,
  invoice_number text,
  payment_type payment_type not null default 'CREDIT',
  payment_method payment_method,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0,
  status doc_status not null default 'CONFIRMED',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id, doc_number)
);
create index if not exists idx_purchases_business on purchases(business_id, purchase_date desc);
create index if not exists idx_purchases_supplier on purchases(supplier_id);

create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  total numeric(14,2) not null default 0
);
create index if not exists idx_purchase_items_purchase on purchase_items(purchase_id);

create table if not exists supplier_payments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  payment_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method payment_method not null default 'CASH',
  cash_account_id uuid,
  reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_supplier_payments on supplier_payments(business_id, supplier_id, payment_date desc);

-- ---------- Sales (بند 16) ----------
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id),
  warehouse_id uuid not null references warehouses(id),
  sale_date date not null,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  payment_type payment_type not null default 'CASH',
  payment_method payment_method,
  status doc_status not null default 'CONFIRMED',
  channel text not null default 'DIRECT' check (channel in ('DIRECT','DISTRIBUTION')),
  load_id uuid,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id, doc_number)
);
create index if not exists idx_sales_business on sales(business_id, sale_date desc);
create index if not exists idx_sales_customer on sales(customer_id);
create index if not exists idx_sales_status on sales(business_id, status);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  total numeric(14,2) not null default 0
);
create index if not exists idx_sale_items_sale on sale_items(sale_id);

create table if not exists customer_payments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id),
  payment_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method payment_method not null default 'CASH',
  cash_account_id uuid,
  reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_customer_payments on customer_payments(business_id, customer_id, payment_date desc);

-- ---------- Production (بند 23) ----------
create table if not exists production_batches (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  recipe_version_id uuid references recipe_versions(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id),
  batch_date date not null,
  shift text,
  material_cost numeric(14,2) not null default 0,
  status doc_status not null default 'CONFIRMED',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_production_business on production_batches(business_id, batch_date desc);

create table if not exists production_consumption (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references production_batches(id) on delete cascade,
  material_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id),
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,2) not null default 0
);
create index if not exists idx_production_consumption_batch on production_consumption(batch_id);

-- ---------- Expenses (بند 32) ----------
create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null
);
create index if not exists idx_expense_categories_business on expense_categories(business_id);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  category_id uuid not null references expense_categories(id),
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null,
  payment_method payment_method not null default 'CASH',
  cash_account_id uuid,
  description text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_expenses_business on expenses(business_id, expense_date desc);

-- ---------- Cash (بند 22) ----------
create table if not exists cash_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  kind text not null default 'CASH', -- CASH | BANK | OTHER
  is_default boolean not null default false,
  active boolean not null default true
);
create index if not exists idx_cash_accounts_business on cash_accounts(business_id);

create table if not exists cash_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  cash_account_id uuid not null references cash_accounts(id),
  direction text not null check (direction in ('IN','OUT')),
  amount numeric(14,2) not null check (amount > 0),
  reference_type text,
  reference_id uuid,
  operation_id uuid,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_cash_tx_business on cash_transactions(business_id, created_at desc);
create index if not exists idx_cash_tx_account on cash_transactions(cash_account_id);
create index if not exists idx_cash_tx_operation on cash_transactions(operation_id);

-- ---------- Distribution (بند 29-31) ----------
create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  plate text,
  active boolean not null default true,
  notes text
);
create index if not exists idx_vehicles_business on vehicles(business_id);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text,
  active boolean not null default true,
  notes text
);
create index if not exists idx_drivers_business on drivers(business_id);

create table if not exists distribution_loads (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id),
  driver_id uuid references drivers(id),
  distributor_id uuid references employees(id),
  warehouse_id uuid not null references warehouses(id),
  load_date date not null,
  status load_status not null default 'OPEN',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_loads_business on distribution_loads(business_id, load_date desc);
create index if not exists idx_loads_status on distribution_loads(business_id, status);

create table if not exists distribution_items (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references distribution_loads(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id)
);
create index if not exists idx_distribution_items_load on distribution_items(load_id);

create table if not exists distribution_deliveries (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  load_id uuid not null references distribution_loads(id),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id),
  product_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  total numeric(14,2) not null default 0,
  payment_type payment_type not null default 'CASH',
  delivery_date date not null,
  sale_id uuid references sales(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_deliveries_load on distribution_deliveries(load_id);

create table if not exists distribution_returns (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  load_id uuid not null references distribution_loads(id),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_id uuid not null references units(id),
  reason text,
  return_date date not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_dist_returns_load on distribution_returns(load_id);

create table if not exists distribution_settlements (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  doc_number text not null,
  load_id uuid not null unique references distribution_loads(id),
  business_id uuid not null references businesses(id) on delete cascade,
  settlement_date date not null,
  loaded_qty numeric(14,3) not null,
  sold_qty numeric(14,3) not null,
  returned_qty numeric(14,3) not null,
  waste_qty numeric(14,3) not null default 0,
  unaccounted_qty numeric(14,3) not null default 0,
  cash_collected numeric(14,2) not null default 0,
  credit_total numeric(14,2) not null default 0,
  cash_expected numeric(14,2) not null default 0,
  cash_variance numeric(14,2) not null default 0,
  variance_note text,
  product_breakdown jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- Audit & settings (بند 37/69) ----------
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references auth.users(id),
  user_email text,
  operation text not null,
  entity text not null,
  entity_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_business on audit_logs(business_id, created_at desc);
create index if not exists idx_audit_entity on audit_logs(entity, entity_id);

create table if not exists app_settings (
  business_id uuid primary key references businesses(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  setup_code text,
  setup_code_used boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------- Doc numbering (بند 70) ----------
create table if not exists doc_sequences (
  business_id uuid not null references businesses(id) on delete cascade,
  prefix text not null,
  seq_year integer not null,
  last_no integer not null default 0,
  primary key (business_id, prefix, seq_year)
);

-- ---------- Sync metadata (server side, بند 133) ----------
create table if not exists processed_operations (
  operation_id uuid primary key,
  operation_type text not null,
  business_id uuid not null references businesses(id) on delete cascade,
  processed_by uuid references auth.users(id),
  processed_at timestamptz not null default now()
);
create index if not exists idx_processed_ops_business on processed_operations(business_id, processed_at desc);
