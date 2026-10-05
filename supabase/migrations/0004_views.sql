-- ============================================================================
-- 0004_views.sql — طبقة التقارير (بند 54/55/142): Views + RPCs مجمّعة
-- كل دالة تتحقق من النشاط التجاري صراحةً (security definer يتجاوز RLS).
-- ============================================================================

-- ---------- Views ----------
create or replace view v_stock as
select
  m.business_id,
  m.item_id,
  m.warehouse_id,
  p.code,
  p.name,
  p.item_type,
  coalesce(sum(case when m.movement_type in (
    'PURCHASE_IN','PRODUCTION_IN','SALE_RETURN_IN','ADJUSTMENT_IN','TRANSFER_IN','DISTRIBUTION_RETURN_IN'
  ) then m.quantity else -m.quantity end), 0) as qty,
  coalesce(p.avg_cost, 0) as avg_cost,
  coalesce(sum(case when m.movement_type in (
    'PURCHASE_IN','PRODUCTION_IN','SALE_RETURN_IN','ADJUSTMENT_IN','TRANSFER_IN','DISTRIBUTION_RETURN_IN'
  ) then m.quantity else -m.quantity end), 0) * coalesce(p.avg_cost, 0) as stock_value,
  p.min_stock,
  p.base_unit_id
from inventory_movements m
join products p on p.id = m.item_id
group by m.business_id, m.item_id, m.warehouse_id, p.code, p.name, p.item_type, p.avg_cost, p.min_stock, p.base_unit_id;

create or replace view v_customer_balances as
select
  c.business_id,
  c.id as customer_id,
  c.code,
  c.name,
  coalesce(s.credit_sales, 0) as total_sales,
  coalesce(s.credit_sales, 0) - coalesce(pay.paid, 0) as balance
from customers c
left join (
  select customer_id, sum(total) as credit_sales
  from sales where status = 'CONFIRMED' and payment_type = 'CREDIT'
  group by customer_id
) s on s.customer_id = c.id
left join (
  select customer_id, sum(amount) as paid
  from customer_payments group by customer_id
) pay on pay.customer_id = c.id;

create or replace view v_supplier_balances as
select
  su.business_id,
  su.id as supplier_id,
  su.code,
  su.name,
  coalesce(pu.credit_purchases, 0) as total_purchases,
  coalesce(pu.credit_purchases, 0) - coalesce(pay.paid, 0) as balance
from suppliers su
left join (
  select supplier_id, sum(total) as credit_purchases
  from purchases where status = 'CONFIRMED' and payment_type = 'CREDIT'
  group by supplier_id
) pu on pu.supplier_id = su.id
left join (
  select supplier_id, sum(amount) as paid
  from supplier_payments group by supplier_id
) pay on pay.supplier_id = su.id;

create or replace view v_cash_balances as
select
  a.business_id,
  a.id as account_id,
  a.name,
  a.kind,
  coalesce(sum(case when t.direction = 'IN' then t.amount else -t.amount end), 0) as balance
from cash_accounts a
left join cash_transactions t on t.cash_account_id = a.id
group by a.business_id, a.id, a.name, a.kind;

-- ============================================================================
-- تقارير — RPCs
-- ============================================================================
create or replace function get_sales_report(p_from date, p_to date, p_customer uuid default null)
returns table (
  id uuid, doc_number text, sale_date date, customer_name text, total numeric,
  cost_total numeric, payment_type payment_type, status doc_status, channel text
)
language sql stable security definer set search_path = public as $$
  select s.id, s.doc_number, s.sale_date, coalesce(c.name, 'عميل نقدي'), s.total,
    s.cost_total, s.payment_type, s.status, s.channel
  from sales s
  left join customers c on c.id = s.customer_id
  where s.business_id = get_my_business_id()
    and s.sale_date between p_from and p_to
    and (p_customer is null or s.customer_id = p_customer)
  order by s.sale_date desc, s.created_at desc
$$;

create or replace function get_sales_daily_summary(p_from date, p_to date)
returns table (day date, invoices bigint, total numeric, cash_total numeric, credit_total numeric, cost numeric)
language sql stable security definer set search_path = public as $$
  select s.sale_date as day, count(*) as invoices,
    sum(s.total), sum(case when s.payment_type = 'CASH' then s.total else 0 end),
    sum(case when s.payment_type = 'CREDIT' then s.total else 0 end), sum(s.cost_total)
  from sales s
  where s.business_id = get_my_business_id() and s.status = 'CONFIRMED'
    and s.sale_date between p_from and p_to
  group by s.sale_date order by s.sale_date desc
$$;

create or replace function get_purchases_report(p_from date, p_to date)
returns table (
  id uuid, doc_number text, purchase_date date, supplier_name text,
  invoice_number text, total numeric, payment_type payment_type, status doc_status
)
language sql stable security definer set search_path = public as $$
  select pu.id, pu.doc_number, pu.purchase_date, su.name, pu.invoice_number,
    pu.total, pu.payment_type, pu.status
  from purchases pu
  join suppliers su on su.id = pu.supplier_id
  where pu.business_id = get_my_business_id()
    and pu.purchase_date between p_from and p_to
  order by pu.purchase_date desc, pu.created_at desc
$$;

create or replace function get_inventory_report()
returns table (
  product_id uuid, code text, name text, item_type item_type, warehouse_name text,
  qty numeric, avg_cost numeric, stock_value numeric, min_stock numeric, low boolean
)
language sql stable security definer set search_path = public as $$
  select s.item_id, s.code, s.name, s.item_type, w.name,
    s.qty, s.avg_cost, round(s.stock_value, 2), s.min_stock,
    (s.min_stock > 0 and s.qty < s.min_stock)
  from v_stock s
  join warehouses w on w.id = s.warehouse_id
  where s.business_id = get_my_business_id()
  order by s.name, w.name
$$;

create or replace function get_movements_report(p_from date, p_to date, p_movement text default null)
returns table (
  id uuid, created_at timestamptz, item_name text, warehouse_name text,
  movement_type movement_type, quantity numeric, unit_cost numeric, total_cost numeric,
  reference_type text, doc_number text
)
language sql stable security definer set search_path = public as $$
  select m.id, m.created_at, p.name, w.name, m.movement_type, m.quantity, m.unit_cost,
    m.total_cost, m.reference_type,
    coalesce(s.doc_number, pu.doc_number, b.doc_number, a.doc_number, wr.doc_number, t.doc_number, l.doc_number)
  from inventory_movements m
  join products p on p.id = m.item_id
  join warehouses w on w.id = m.warehouse_id
  left join sales s on s.id = (case when m.reference_type = 'SALE' then m.reference_id end)
  left join purchases pu on pu.id = (case when m.reference_type = 'PURCHASE' then m.reference_id end)
  left join production_batches b on b.id = (case when m.reference_type = 'PRODUCTION' then m.reference_id end)
  left join inventory_adjustments a on a.id = (case when m.reference_type = 'ADJUSTMENT' then m.reference_id end)
  left join waste_records wr on wr.id = (case when m.reference_type = 'WASTE' then m.reference_id end)
  left join transfers t on t.id = (case when m.reference_type = 'TRANSFER' then m.reference_id end)
  left join distribution_loads l on l.id = (case when m.reference_type in ('DISTRIBUTION_LOAD','DISTRIBUTION_RETURN') then m.reference_id end)
  where m.business_id = get_my_business_id()
    and m.created_at >= p_from::timestamptz and m.created_at < (p_to + 1)::timestamptz
    and (p_movement is null or m.movement_type::text = p_movement)
  order by m.created_at desc
$$;

create or replace function get_production_report(p_from date, p_to date)
returns table (
  id uuid, doc_number text, batch_date date, product_name text, quantity numeric,
  unit_symbol text, material_cost numeric, shift text, recipe_version_no integer
)
language sql stable security definer set search_path = public as $$
  select b.id, b.doc_number, b.batch_date, p.name, b.quantity, u.symbol,
    b.material_cost, b.shift, rv.version_no
  from production_batches b
  join products p on p.id = b.product_id
  join units u on u.id = b.unit_id
  left join recipe_versions rv on rv.id = b.recipe_version_id
  where b.business_id = get_my_business_id() and b.status = 'CONFIRMED'
    and b.batch_date between p_from and p_to
  order by b.batch_date desc, b.created_at desc
$$;

create or replace function get_expenses_report(p_from date, p_to date)
returns table (category_name text, total numeric, cnt bigint)
language sql stable security definer set search_path = public as $$
  select ec.name, sum(e.amount), count(*)
  from expenses e
  join expense_categories ec on ec.id = e.category_id
  where e.business_id = get_my_business_id() and e.expense_date between p_from and p_to
  group by ec.name order by sum(e.amount) desc
$$;

create or replace function get_cash_report(p_from date, p_to date)
returns table (
  id uuid, created_at timestamptz, account_name text, direction text,
  amount numeric, description text, reference_type text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.created_at, a.name, t.direction, t.amount, t.description, t.reference_type
  from cash_transactions t
  join cash_accounts a on a.id = t.cash_account_id
  where t.business_id = get_my_business_id()
    and t.created_at >= p_from::timestamptz and t.created_at < (p_to + 1)::timestamptz
  order by t.created_at desc
$$;

create or replace function get_distribution_report(p_from date, p_to date)
returns table (
  id uuid, doc_number text, load_date date, vehicle_name text, driver_name text,
  status load_status, loaded_qty numeric, sold_qty numeric, returned_qty numeric,
  unaccounted_qty numeric, cash_collected numeric, cash_variance numeric
)
language sql stable security definer set search_path = public as $$
  select l.id, l.doc_number, l.load_date, v.name, d.name, l.status,
    coalesce(st.loaded_qty, 0), coalesce(st.sold_qty, 0), coalesce(st.returned_qty, 0),
    coalesce(st.unaccounted_qty, 0), coalesce(st.cash_collected, 0), coalesce(st.cash_variance, 0)
  from distribution_loads l
  join vehicles v on v.id = l.vehicle_id
  left join drivers d on d.id = l.driver_id
  left join distribution_settlements st on st.load_id = l.id
  where l.business_id = get_my_business_id() and l.load_date between p_from and p_to
  order by l.load_date desc, l.created_at desc
$$;

create or replace function get_customers_report()
returns table (customer_id uuid, code text, name text, phone text,
  total_sales numeric, balance numeric)
language sql stable security definer set search_path = public as $$
  select cb.customer_id, cb.code, cb.name, c.phone, cb.total_sales, round(cb.balance, 2)
  from v_customer_balances cb
  join customers c on c.id = cb.customer_id
  where cb.business_id = get_my_business_id()
  order by cb.balance desc
$$;

create or replace function get_suppliers_report()
returns table (supplier_id uuid, code text, name text, phone text,
  total_purchases numeric, balance numeric)
language sql stable security definer set search_path = public as $$
  select sb.supplier_id, sb.code, sb.name, s.phone, sb.total_purchases, round(sb.balance, 2)
  from v_supplier_balances sb
  join suppliers s on s.id = sb.supplier_id
  where sb.business_id = get_my_business_id()
  order by sb.balance desc
$$;

-- الربحية التقديرية (بند 113): إيراد - تكلفة مواد - مصاريف = نتيجة تقديرية
create or replace function get_profit_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_bid uuid; v_revenue numeric; v_material_cost numeric; v_expenses numeric; v_result numeric;
begin
  v_bid := get_my_business_id();
  if v_bid is null then return jsonb_build_object('error','no_business'); end if;
  select coalesce(sum(total),0) into v_revenue from sales
    where business_id = v_bid and status = 'CONFIRMED' and sale_date between p_from and p_to;
  select coalesce(sum(cost_total),0) into v_material_cost from sales
    where business_id = v_bid and status = 'CONFIRMED' and sale_date between p_from and p_to;
  select coalesce(sum(amount),0) into v_expenses from expenses
    where business_id = v_bid and expense_date between p_from and p_to;
  v_result := round(v_revenue - v_material_cost - v_expenses, 2);
  return jsonb_build_object(
    'revenue', round(v_revenue, 2),
    'material_cost', round(v_material_cost, 2),
    'expenses', round(v_expenses, 2),
    'estimated_result', v_result,
    'disclaimer', 'الأرباح تقديرية وتعتمد على اكتمال ودقة البيانات المدخلة — ليست نتيجة محاسبية نهائية.'
  );
end $$;

-- ============================================================================
-- كشوف الحسابات (بند 15/19): Date | Type | Reference | Debit | Credit | Balance
-- ============================================================================
create or replace function get_customer_statement(p_customer uuid, p_from date default null, p_to date default null)
returns table (date timestamptz, type text, reference text, debit numeric, credit numeric, balance numeric, notes text)
language sql stable security definer set search_path = public as $$
  select t.date, t.type, t.reference, t.debit, t.credit,
    sum(t.debit - t.credit) over (order by t.date, t.reference) as balance, t.notes
  from (
    select s.created_at as date, 'بيع آجل' as type, s.doc_number as reference,
      s.total as debit, 0::numeric as credit, s.notes
    from sales s
    join customers c on c.id = s.customer_id
    where s.customer_id = p_customer and s.business_id = get_my_business_id()
      and s.status = 'CONFIRMED' and s.payment_type = 'CREDIT'
      and (p_from is null or s.sale_date >= p_from) and (p_to is null or s.sale_date <= p_to)
    union all
    select cp.created_at, 'تحصيل', cp.doc_number, 0, cp.amount, cp.notes
    from customer_payments cp
    join customers c2 on c2.id = cp.customer_id
    where cp.customer_id = p_customer and cp.business_id = get_my_business_id()
      and (p_from is null or cp.payment_date >= p_from) and (p_to is null or cp.payment_date <= p_to)
  ) t
  order by t.date, t.reference
$$;

create or replace function get_supplier_statement(p_supplier uuid, p_from date default null, p_to date default null)
returns table (date timestamptz, type text, reference text, debit numeric, credit numeric, balance numeric, notes text)
language sql stable security definer set search_path = public as $$
  select t.date, t.type, t.reference, t.debit, t.credit,
    sum(t.debit - t.credit) over (order by t.date, t.reference) as balance, t.notes
  from (
    select pu.created_at as date, 'شراء آجل' as type, pu.doc_number as reference,
      pu.total as debit, 0::numeric as credit, pu.notes
    from purchases pu
    join suppliers su on su.id = pu.supplier_id
    where pu.supplier_id = p_supplier and pu.business_id = get_my_business_id()
      and pu.status = 'CONFIRMED' and pu.payment_type = 'CREDIT'
      and (p_from is null or pu.purchase_date >= p_from) and (p_to is null or pu.purchase_date <= p_to)
    union all
    select sp.created_at, 'دفعة', sp.doc_number, 0, sp.amount, sp.notes
    from supplier_payments sp
    join suppliers su2 on su2.id = sp.supplier_id
    where sp.supplier_id = p_supplier and sp.business_id = get_my_business_id()
      and (p_from is null or sp.payment_date >= p_from) and (p_to is null or sp.payment_date <= p_to)
  ) t
  order by t.date, t.reference
$$;

-- سجل التدقيق (بند 37)
create or replace function get_audit_logs(p_from date default null, p_to date default null, p_limit integer default 200)
returns table (
  id uuid, created_at timestamptz, user_email text, operation text,
  entity text, action text, entity_id uuid
)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, a.user_email, a.operation, a.entity, a.action, a.entity_id
  from audit_logs a
  where a.business_id = get_my_business_id()
    and (p_from is null or a.created_at >= p_from::timestamptz)
    and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
  order by a.created_at desc
  limit least(coalesce(p_limit, 200), 1000)
$$;

-- تحديث ملفي الشخصي (الاسم والهاتف فقط — لا يمكن للمستخدم تغيير دوره بنفسه)
create or replace function update_my_profile(p_full_name text, p_phone text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول.'; end if;
  update profiles set full_name = coalesce(p_full_name, full_name),
    phone = coalesce(p_phone, phone), updated_at = now()
  where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
