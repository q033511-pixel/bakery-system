-- ============================================================================
-- 0003_rls.sql — Row Level Security على كل الجداول (بند 35/114)
-- - قراءة: أعضاء النشاط فقط
-- - كتابة البيانات المالية: عبر RPCs فقط (لا سياسات INSERT/UPDATE مباشرة)
-- - البيانات الرئيسية: حسب الصلاحية
-- - system_setup: بلا سياسات — لا يُقرأ من العميل إطلاقاً
-- ============================================================================

alter table businesses enable row level security;
alter table profiles enable row level security;
alter table branches enable row level security;
alter table warehouses enable row level security;
alter table units enable row level security;
alter table unit_conversions enable row level security;
alter table product_categories enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table suppliers enable row level security;
alter table employees enable row level security;
alter table recipes enable row level security;
alter table recipe_versions enable row level security;
alter table recipe_items enable row level security;
alter table inventory_movements enable row level security;
alter table inventory_adjustments enable row level security;
alter table waste_records enable row level security;
alter table transfers enable row level security;
alter table transfer_items enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table supplier_payments enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table customer_payments enable row level security;
alter table production_batches enable row level security;
alter table production_consumption enable row level security;
alter table expenses enable row level security;
alter table expense_categories enable row level security;
alter table cash_accounts enable row level security;
alter table cash_transactions enable row level security;
alter table vehicles enable row level security;
alter table drivers enable row level security;
alter table distribution_loads enable row level security;
alter table distribution_items enable row level security;
alter table distribution_deliveries enable row level security;
alter table distribution_returns enable row level security;
alter table distribution_settlements enable row level security;
alter table audit_logs enable row level security;
alter table app_settings enable row level security;
alter table doc_sequences enable row level security;
alter table processed_operations enable row level security;
alter table system_setup enable row level security;

-- ---------- businesses: قراءة النشاط الخاص فقط، بلا كتابة مباشرة (عبر RPC) ----------
create policy businesses_select on businesses
for select to authenticated using (id = get_my_business_id());

-- ---------- profiles: صفّي الخاص + زملاء النشاط، بلا كتابة مباشرة (عبر RPC) ----------
create policy profiles_select on profiles
for select to authenticated
using (id = auth.uid() or business_id = get_my_business_id());

-- ---------- system_setup: بلا أي سياسة — محجوب تماماً عن العملاء ----------

-- ============================================================================
-- البيانات الرئيسية — قراءة للأعضاء، كتابة حسب الصلاحية
-- ============================================================================
create policy units_select on units
for select to authenticated using (business_id = get_my_business_id());
create policy units_insert on units
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('settings.manage'));
create policy units_update on units
for update to authenticated using (business_id = get_my_business_id() and has_perm('settings.manage'))
with check (business_id = get_my_business_id());
create policy units_delete on units
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy unit_conversions_select on unit_conversions
for select to authenticated using (business_id = get_my_business_id());
create policy unit_conversions_insert on unit_conversions
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('settings.manage'));
create policy unit_conversions_delete on unit_conversions
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy product_categories_select on product_categories
for select to authenticated using (business_id = get_my_business_id());
create policy product_categories_insert on product_categories
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('settings.manage'));
create policy product_categories_update on product_categories
for update to authenticated using (business_id = get_my_business_id() and has_perm('settings.manage'))
with check (business_id = get_my_business_id());
create policy product_categories_delete on product_categories
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy products_select on products
for select to authenticated using (business_id = get_my_business_id());
create policy products_insert on products
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('products.manage'));
create policy products_update on products
for update to authenticated using (business_id = get_my_business_id() and has_perm('products.manage'))
with check (business_id = get_my_business_id());
create policy products_delete on products
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy customers_select on customers
for select to authenticated using (business_id = get_my_business_id());
create policy customers_insert on customers
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('customers.manage'));
create policy customers_update on customers
for update to authenticated using (business_id = get_my_business_id() and has_perm('customers.manage'))
with check (business_id = get_my_business_id());
create policy customers_delete on customers
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy suppliers_select on suppliers
for select to authenticated using (business_id = get_my_business_id());
create policy suppliers_insert on suppliers
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('suppliers.manage'));
create policy suppliers_update on suppliers
for update to authenticated using (business_id = get_my_business_id() and has_perm('suppliers.manage'))
with check (business_id = get_my_business_id());
create policy suppliers_delete on suppliers
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy employees_select on employees
for select to authenticated using (business_id = get_my_business_id());
create policy employees_insert on employees
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('settings.manage'));
create policy employees_update on employees
for update to authenticated using (business_id = get_my_business_id() and has_perm('settings.manage'))
with check (business_id = get_my_business_id());
create policy employees_delete on employees
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy warehouses_select on warehouses
for select to authenticated using (business_id = get_my_business_id());
create policy warehouses_insert on warehouses
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('settings.manage'));
create policy warehouses_update on warehouses
for update to authenticated using (business_id = get_my_business_id() and has_perm('settings.manage'))
with check (business_id = get_my_business_id());
create policy warehouses_delete on warehouses
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy expense_categories_select on expense_categories
for select to authenticated using (business_id = get_my_business_id());
create policy expense_categories_insert on expense_categories
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('settings.manage'));
create policy expense_categories_update on expense_categories
for update to authenticated using (business_id = get_my_business_id() and has_perm('settings.manage'))
with check (business_id = get_my_business_id());
create policy expense_categories_delete on expense_categories
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy cash_accounts_select on cash_accounts
for select to authenticated using (business_id = get_my_business_id());
create policy cash_accounts_insert on cash_accounts
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('settings.manage'));
create policy cash_accounts_update on cash_accounts
for update to authenticated using (business_id = get_my_business_id() and has_perm('settings.manage'))
with check (business_id = get_my_business_id());
create policy cash_accounts_delete on cash_accounts
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy vehicles_select on vehicles
for select to authenticated using (business_id = get_my_business_id());
create policy vehicles_insert on vehicles
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('distribution.manage'));
create policy vehicles_update on vehicles
for update to authenticated using (business_id = get_my_business_id() and has_perm('distribution.manage'))
with check (business_id = get_my_business_id());
create policy vehicles_delete on vehicles
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy drivers_select on drivers
for select to authenticated using (business_id = get_my_business_id());
create policy drivers_insert on drivers
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('distribution.manage'));
create policy drivers_update on drivers
for update to authenticated using (business_id = get_my_business_id() and has_perm('distribution.manage'))
with check (business_id = get_my_business_id());
create policy drivers_delete on drivers
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy recipes_select on recipes
for select to authenticated using (business_id = get_my_business_id());
create policy recipes_insert on recipes
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('recipes.manage'));
create policy recipes_update on recipes
for update to authenticated using (business_id = get_my_business_id() and has_perm('recipes.manage'))
with check (business_id = get_my_business_id());
create policy recipes_delete on recipes
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy recipe_versions_select on recipe_versions
for select to authenticated using (business_id = get_my_business_id());
create policy recipe_versions_insert on recipe_versions
for insert to authenticated with check (business_id = get_my_business_id() and has_perm('recipes.manage'));
create policy recipe_versions_update on recipe_versions
for update to authenticated using (business_id = get_my_business_id() and has_perm('recipes.manage'))
with check (business_id = get_my_business_id());
create policy recipe_versions_delete on recipe_versions
for delete to authenticated using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

create policy recipe_items_select on recipe_items
for select to authenticated using (
  exists(select 1 from recipe_versions rv where rv.id = recipe_items.recipe_version_id and rv.business_id = get_my_business_id()));
create policy recipe_items_insert on recipe_items
for insert to authenticated with check (
  exists(select 1 from recipe_versions rv where rv.id = recipe_items.recipe_version_id and rv.business_id = get_my_business_id())
  and has_perm('recipes.manage'));
create policy recipe_items_delete on recipe_items
for delete to authenticated using (
  exists(select 1 from recipe_versions rv where rv.id = recipe_items.recipe_version_id and rv.business_id = get_my_business_id())
  and get_my_role() in ('OWNER','ADMIN'));

-- ============================================================================
-- الجداول المالية والتشغيلية — قراءة فقط للعملاء، الكتابة عبر RPCs حصراً
-- ============================================================================
create policy inventory_movements_select on inventory_movements
for select to authenticated using (business_id = get_my_business_id());

create policy inventory_adjustments_select on inventory_adjustments
for select to authenticated using (business_id = get_my_business_id());

create policy waste_records_select on waste_records
for select to authenticated using (business_id = get_my_business_id());

create policy transfers_select on transfers
for select to authenticated using (business_id = get_my_business_id());
create policy transfer_items_select on transfer_items
for select to authenticated using (
  exists(select 1 from transfers t where t.id = transfer_items.transfer_id and t.business_id = get_my_business_id()));

create policy purchases_select on purchases
for select to authenticated using (business_id = get_my_business_id());
create policy purchase_items_select on purchase_items
for select to authenticated using (
  exists(select 1 from purchases p where p.id = purchase_items.purchase_id and p.business_id = get_my_business_id()));

create policy supplier_payments_select on supplier_payments
for select to authenticated using (business_id = get_my_business_id());

create policy sales_select on sales
for select to authenticated using (business_id = get_my_business_id());
create policy sale_items_select on sale_items
for select to authenticated using (
  exists(select 1 from sales s where s.id = sale_items.sale_id and s.business_id = get_my_business_id()));

create policy customer_payments_select on customer_payments
for select to authenticated using (business_id = get_my_business_id());

create policy production_batches_select on production_batches
for select to authenticated using (business_id = get_my_business_id());
create policy production_consumption_select on production_consumption
for select to authenticated using (
  exists(select 1 from production_batches b where b.id = production_consumption.batch_id and b.business_id = get_my_business_id()));

create policy expenses_select on expenses
for select to authenticated using (business_id = get_my_business_id());

create policy cash_transactions_select on cash_transactions
for select to authenticated using (business_id = get_my_business_id());

create policy distribution_loads_select on distribution_loads
for select to authenticated using (business_id = get_my_business_id());
create policy distribution_items_select on distribution_items
for select to authenticated using (
  exists(select 1 from distribution_loads l where l.id = distribution_items.load_id and l.business_id = get_my_business_id()));
create policy distribution_deliveries_select on distribution_deliveries
for select to authenticated using (business_id = get_my_business_id());
create policy distribution_returns_select on distribution_returns
for select to authenticated using (business_id = get_my_business_id());
create policy distribution_settlements_select on distribution_settlements
for select to authenticated using (business_id = get_my_business_id());

-- سجل التدقيق: قراءة للمالك/المدير/المحاسب فقط (بند 37)
create policy audit_logs_select on audit_logs
for select to authenticated using (business_id = get_my_business_id() and has_perm('audit.view'));

-- الإعدادات: قراءة فقط (تحديث عبر RPC)
create policy app_settings_select on app_settings
for select to authenticated using (business_id = get_my_business_id());

create policy doc_sequences_select on doc_sequences
for select to authenticated using (business_id = get_my_business_id());

create policy processed_operations_select on processed_operations
for select to authenticated using (business_id = get_my_business_id());

create policy branches_select on branches
for select to authenticated using (business_id = get_my_business_id());
