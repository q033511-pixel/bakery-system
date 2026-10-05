-- ============================================================================
-- 0002_functions.sql — دوال المساعدة + RPCs المعاملية
-- كل عملية مالية = معاملة ذرية واحدة (بند 44) + operation_id idempotent (بند 39)
-- + فحص صلاحيات داخل قاعدة البيانات (بند 34/35) + audit (بند 37)
-- ============================================================================

-- ---------- system_setup: رمز تهيئة أول مالك (بند 68) ----------
create table if not exists system_setup (
  id integer primary key check (id = 1),
  setup_code text not null,
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
insert into system_setup(id, setup_code)
values (1, 'BAKERY-SETUP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
on conflict (id) do nothing;

-- ---------- helpers: identity & permissions ----------
create or replace function get_my_business_id()
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_bid uuid;
begin
  if auth.uid() is null then return null; end if;
  select business_id into v_bid from profiles where id = auth.uid();
  return v_bid;
end $$;

create or replace function get_my_role()
returns user_role
language plpgsql stable security definer set search_path = public as $$
declare v_role user_role;
begin
  if auth.uid() is null then return null; end if;
  select role into v_role from profiles where id = auth.uid();
  return coalesce(v_role, 'PENDING');
end $$;

-- مصفوفة الصلاحيات — يجب أن تطابق src/lib/permissions.ts
create or replace function role_has_perm(p_role user_role, p_perm text)
returns boolean
language plpgsql immutable as $$
declare
  reads text[] := array['sales.view','purchases.view','customers.view','suppliers.view',
    'payments.view','inventory.view','production.view','expenses.view','cash.view',
    'distribution.view','reports.view'];
  accountant text[] := array['payments.manage','expenses.manage','inventory.adjust','audit.view','settings.manage'];
  sales_perms text[] := array['sales.manage','customers.manage','payments.manage','products.manage'];
  warehouse_perms text[] := array['inventory.adjust','inventory.transfer','inventory.waste','purchases.manage','products.manage'];
  production_perms text[] := array['production.manage','recipes.manage','products.manage','inventory.waste'];
  distributor_perms text[] := array['distribution.manage','customers.manage','payments.manage'];
begin
  if p_role is null then return false; end if;
  if p_role in ('OWNER','ADMIN') then return true; end if;
  if p_role = 'VIEWER' then return p_perm = any(reads); end if;
  case p_role
    when 'ACCOUNTANT' then return p_perm = any(reads) or p_perm = any(accountant);
    when 'SALES' then return p_perm = any(reads) or p_perm = any(sales_perms);
    when 'WAREHOUSE' then return p_perm = any(reads) or p_perm = any(warehouse_perms);
    when 'PRODUCTION' then return p_perm = any(reads) or p_perm = any(production_perms);
    when 'DISTRIBUTOR' then return p_perm = any(reads) or p_perm = any(distributor_perms);
    else return false;
  end case;
end $$;

create or replace function has_perm(p_perm text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return role_has_perm(get_my_role(), p_perm);
end $$;

create or replace function assert_perm(p_perm text)
returns void
language plpgsql stable as $$
begin
  if not has_perm(p_perm) then
    raise exception 'ليس لديك صلاحية لتنفيذ هذه العملية (%).', p_perm using errcode = '42501';
  end if;
end $$;

create or replace function assert_business()
returns uuid
language plpgsql stable as $$
declare v_bid uuid;
begin
  v_bid := get_my_business_id();
  if v_bid is null then
    raise exception 'حسابك غير مرتبط بنشاط تجاري. اتصل بالمدير لتفعيل حسابك.' using errcode = 'P0001';
  end if;
  return v_bid;
end $$;

-- ---------- helpers: dates, audit, doc numbers, units, stock ----------
create or replace function business_today()
returns date
language plpgsql stable security definer set search_path = public as $$
declare v_tz text;
begin
  select timezone into v_tz from businesses where id = get_my_business_id();
  return (now() at time zone coalesce(v_tz, 'UTC'))::date;
end $$;

create or replace function audit(
  p_operation text, p_entity text, p_entity_id uuid, p_action text,
  p_before jsonb default null, p_after jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs(business_id, user_id, user_email, operation, entity, entity_id, action, before_data, after_data)
  values (
    get_my_business_id(), auth.uid(),
    (select email from auth.users where id = auth.uid()),
    p_operation, p_entity, p_entity_id, p_action, p_before, p_after
  );
end $$;

create or replace function next_doc_number(p_prefix text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_year integer; v_no integer;
begin
  v_bid := assert_business();
  v_year := extract(year from business_today())::integer;
  insert into doc_sequences(business_id, prefix, seq_year, last_no)
  values (v_bid, p_prefix, v_year, 1)
  on conflict (business_id, prefix, seq_year)
  do update set last_no = doc_sequences.last_no + 1
  returning last_no into v_no;
  return p_prefix || '-' || v_year::text || '-' || lpad(v_no::text, 6, '0');
end $$;

create or replace function register_op(p_operation_id uuid, p_type text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_operation_id is null then
    raise exception 'operation_id مطلوب لكل عملية (منع التكرار).';
  end if;
  insert into processed_operations(operation_id, operation_type, business_id, processed_by)
  values (p_operation_id, p_type, get_my_business_id(), auth.uid())
  on conflict (operation_id) do nothing;
  return found;
end $$;

create or replace function convert_qty_to_base(p_item uuid, p_unit uuid, p_qty numeric)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_base uuid; v_bid uuid; v_factor numeric;
begin
  select base_unit_id, business_id into v_base, v_bid from products where id = p_item;
  if v_base is null then raise exception 'الصنف غير موجود.'; end if;
  if p_unit = v_base then return round(p_qty, 3); end if;
  select factor into v_factor from unit_conversions
   where business_id = v_bid and from_unit_id = p_unit and to_unit_id = v_base;
  if v_factor is null then
    raise exception 'لا يوجد تحويل من الوحدة المختارة إلى الوحدة الأساسية للصنف. أضف تحويل الوحدة أولاً.';
  end if;
  return round(p_qty * v_factor, 3);
end $$;

create or replace function stock_qty(p_item uuid, p_warehouse uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((
    select sum(case when movement_type in (
      'PURCHASE_IN','PRODUCTION_IN','SALE_RETURN_IN','ADJUSTMENT_IN','TRANSFER_IN','DISTRIBUTION_RETURN_IN'
    ) then quantity else -quantity end)
    from inventory_movements
    where business_id = get_my_business_id() and item_id = p_item and warehouse_id = p_warehouse
  ), 0);
end $$;

create or replace function assert_stock_available(
  p_item uuid, p_warehouse uuid, p_base_qty numeric
) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_avail numeric; v_allow_neg boolean;
begin
  select allow_negative_stock into v_allow_neg from businesses where id = get_my_business_id();
  if coalesce(v_allow_neg, false) then return; end if;
  v_avail := stock_qty(p_item, p_warehouse);
  if v_avail < p_base_qty then
    raise exception 'الكمية المطلوبة أكبر من الرصيد المتاح. المتاح: %', v_avail
      using errcode = 'P0001';
  end if;
end $$;

create or replace function get_default_cash_account()
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from cash_accounts
  where business_id = get_my_business_id() and active
  order by is_default desc, created_at asc limit 1;
  return v_id;
end $$;

-- updated_at trigger
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated before update on products
for each row execute function touch_updated_at();
drop trigger if exists trg_customers_updated on customers;
create trigger trg_customers_updated before update on customers
for each row execute function touch_updated_at();
drop trigger if exists trg_suppliers_updated on suppliers;
create trigger trg_suppliers_updated before update on suppliers
for each row execute function touch_updated_at();

-- ---------- new auth user → profile PENDING ----------
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), 'PENDING')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ============================================================================
-- BOOTSTRAP — تهيئة النظام وأول مالك (بند 68)
-- ============================================================================
create or replace function bootstrap_business(
  p_setup_code text,
  p_business_name text,
  p_full_name text default null,
  p_phone text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_bid uuid; v_setup record;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'يجب تسجيل الدخول أولاً.'; end if;
  if exists(select 1 from profiles where id = v_uid and business_id is not null) then
    raise exception 'حسابك مرتبط بنشاط تجاري بالفعل.';
  end if;
  if exists(select 1 from profiles where role = 'OWNER') then
    raise exception 'النظام مهيأ مسبقاً. اتصل بمدير النظام لإضافة مستخدمين.';
  end if;
  select * into v_setup from system_setup where id = 1;
  if v_setup is null or v_setup.used or upper(trim(p_setup_code)) <> upper(trim(v_setup.setup_code)) then
    raise exception 'رمز التهيئة غير صحيح أو مستخدم مسبقاً.';
  end if;

  insert into businesses(name) values (p_business_name) returning id into v_bid;
  insert into app_settings(business_id, setup_code_used) values (v_bid, true);

  -- وحدات افتراضية
  insert into units(business_id, name, symbol, is_base) values
    (v_bid,'كيلوغرام','كغ',true),(v_bid,'غرام','غ',false),
    (v_bid,'لتر','ل',true),(v_bid,'مليلتر','مل',false),
    (v_bid,'قطعة','قطعة',true),(v_bid,'ربطة','ربطة',false),
    (v_bid,'كيس','كيس',false),(v_bid,'كرتونة','كرتونة',false),
    (v_bid,'صندوق','صندوق',false);
  -- تحويلات افتراضية
  insert into unit_conversions(business_id, from_unit_id, to_unit_id, factor)
  select v_bid, u1.id, u2.id, x.factor from (values
    ('كيس','كغ',50::numeric),('غ','كغ',0.001),('مل','ل',0.001),('ربطة','قطعة',10)
  ) as x(from_sym, to_sym, factor)
  join units u1 on u1.business_id = v_bid and u1.symbol = x.from_sym
  join units u2 on u2.business_id = v_bid and u2.symbol = x.to_sym;

  -- مستودعات
  insert into warehouses(business_id, name, kind, is_default) values
    (v_bid,'مخزن المواد الخام','RAW',false),
    (v_bid,'مخزن المنتجات الجاهزة','FINISHED',true);

  -- صندوق
  insert into cash_accounts(business_id, name, kind, is_default)
  values (v_bid,'الصندوق الرئيسي','CASH',true);

  -- فئات المصروفات
  insert into expense_categories(business_id, name) values
    (v_bid,'كهرباء'),(v_bid,'ماء'),(v_bid,'ديزل ووقود'),(v_bid,'رواتب'),
    (v_bid,'صيانة'),(v_bid,'إيجار'),(v_bid,'نقل'),(v_bid,'مواد تغليف'),(v_bid,'أخرى');

  -- فئات المنتجات
  insert into product_categories(business_id, name) values
    (v_bid,'خبز'),(v_bid,'معجنات'),(v_bid,'كعك'),(v_bid,'مواد خام'),(v_bid,'تغليف');

  update profiles set business_id = v_bid, role = 'OWNER',
    full_name = coalesce(p_full_name, full_name), phone = coalesce(p_phone, phone)
   where id = v_uid;

  update system_setup set used = true, used_at = now() where id = 1;

  insert into audit_logs(business_id, user_id, user_email, operation, entity, entity_id, action, after_data)
  values (v_bid, v_uid, (select email from auth.users where id = v_uid),
    'BOOTSTRAP','business', v_bid, 'CREATE', jsonb_build_object('name', p_business_name));

  return jsonb_build_object('business_id', v_bid);
end $$;

-- ============================================================================
-- SALES (بند 16/51)
-- ============================================================================
create or replace function create_sale(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bid uuid; v_op uuid; v_sale_id uuid; v_doc text;
  v_customer uuid; v_warehouse uuid; v_sale_date date;
  v_discount numeric; v_pay_type payment_type; v_pay_method payment_method;
  v_subtotal numeric := 0; v_total numeric; v_cost numeric := 0;
  v_allow_neg boolean; v_line numeric; v_base_qty numeric; v_avg numeric;
  r record; v_dup_id uuid; v_dup_doc text; v_cash_acc uuid;
begin
  v_bid := assert_business();
  assert_perm('sales.manage');

  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'SALE') then
    select id, doc_number into v_dup_id, v_dup_doc from sales where operation_id = v_op;
    return jsonb_build_object('id', v_dup_id, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;

  select allow_negative_stock into v_allow_neg from businesses where id = v_bid;
  v_customer := nullif(p_payload->>'customer_id','')::uuid;
  v_warehouse := (p_payload->>'warehouse_id')::uuid;
  v_sale_date := coalesce(nullif(p_payload->>'sale_date','')::date, business_today());
  v_discount := coalesce((p_payload->>'discount')::numeric, 0);
  v_pay_type := coalesce(nullif(p_payload->>'payment_type','')::payment_type, 'CASH');
  v_pay_method := nullif(p_payload->>'payment_method','')::payment_method;

  if v_warehouse is null then raise exception 'اختر المستودع.'; end if;
  if not exists(select 1 from warehouses where id = v_warehouse and business_id = v_bid) then
    raise exception 'المستودع غير صحيح.';
  end if;
  if v_customer is not null and not exists(select 1 from customers where id = v_customer and business_id = v_bid and active) then
    raise exception 'العميل غير موجود أو غير مفعّل.';
  end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb)) = 0 then
    raise exception 'أضف صنفاً واحداً على الأقل.';
  end if;

  -- التحقق من الأصناف والمخزون (بند 17)
  for r in select * from jsonb_to_recordset(p_payload->'items') as x(product_id uuid, quantity numeric, unit_id uuid, unit_price numeric) loop
    if r.quantity is null or r.quantity <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر.'; end if;
    if r.unit_price is null or r.unit_price < 0 then raise exception 'السعر غير صحيح.'; end if;
    if not exists(select 1 from products where id = r.product_id and business_id = v_bid and active) then
      raise exception 'صنف غير موجود أو غير مفعّل في الفاتورة.';
    end if;
    v_line := round(r.quantity * r.unit_price, 2);
    v_subtotal := v_subtotal + v_line;
    v_base_qty := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    select avg_cost into v_avg from products where id = r.product_id;
    v_cost := v_cost + round(v_base_qty * coalesce(v_avg,0), 2);
    if not coalesce(v_allow_neg, false) then
      perform assert_stock_available(r.product_id, v_warehouse, v_base_qty);
    end if;
  end loop;

  if v_discount > v_subtotal then raise exception 'الخصم أكبر من إجمالي الفاتورة.'; end if;
  v_total := v_subtotal - v_discount;
  v_doc := next_doc_number('SAL');

  insert into sales(operation_id, doc_number, business_id, customer_id, warehouse_id,
    sale_date, subtotal, discount, total, cost_total, payment_type, payment_method, status, channel)
  values (v_op, v_doc, v_bid, v_customer, v_warehouse, v_sale_date,
    v_subtotal, v_discount, v_total, v_cost, v_pay_type, v_pay_method, 'CONFIRMED', 'DIRECT')
  returning id into v_sale_id;

  for r in select * from jsonb_to_recordset(p_payload->'items') as x(product_id uuid, quantity numeric, unit_id uuid, unit_price numeric) loop
    insert into sale_items(sale_id, product_id, quantity, unit_id, unit_price, total)
    values (v_sale_id, r.product_id, r.quantity, r.unit_id, r.unit_price, round(r.quantity * r.unit_price, 2));
    v_base_qty := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    select avg_cost into v_avg from products where id = r.product_id;
    insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
      quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
    values (v_bid, r.product_id, (select item_type from products where id = r.product_id), v_warehouse, 'SALE_OUT',
      v_base_qty, r.quantity, r.unit_id, coalesce(v_avg,0), round(v_base_qty * coalesce(v_avg,0), 2),
      'SALE', v_sale_id, v_op, auth.uid());
  end loop;

  if v_pay_type = 'CASH' then
    v_cash_acc := coalesce(nullif(p_payload->>'cash_account_id','')::uuid, get_default_cash_account());
    if v_cash_acc is not null then
      insert into cash_transactions(business_id, cash_account_id, direction, amount,
        reference_type, reference_id, operation_id, description, created_by)
      values (v_bid, v_cash_acc, 'IN', v_total, 'SALE', v_sale_id, v_op, 'بيع نقدي ' || v_doc, auth.uid());
    end if;
  end if;

  perform audit('CREATE_SALE','sale', v_sale_id, 'CREATE', null,
    jsonb_build_object('doc_number', v_doc, 'total', v_total, 'payment_type', v_pay_type));

  return jsonb_build_object('id', v_sale_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

-- إلغاء بيع (بند 38: VOID بدل الحذف)
create or replace function void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_sale sales%rowtype; r record; v_base_qty numeric; v_avg numeric; v_cash_acc uuid;
begin
  v_bid := assert_business();
  assert_perm('sales.void');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'اكتب سبب الإلغاء.'; end if;
  select * into v_sale from sales where id = p_sale_id and business_id = v_bid for update;
  if not found then raise exception 'الفاتورة غير موجودة.'; end if;
  if v_sale.status <> 'CONFIRMED' then raise exception 'لا يمكن إلغاء فاتورة بحالة غير مؤكدة.'; end if;
  if v_sale.channel = 'DISTRIBUTION' then
    raise exception 'فواتير التوزيع تُعالج عبر تسوية الحمولة وليس الإلغاء المباشر.';
  end if;

  update sales set status = 'VOIDED' where id = v_sale.id;

  for r in select * from sale_items where sale_id = v_sale.id loop
    v_base_qty := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    select avg_cost into v_avg from products where id = r.product_id;
    insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
      quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
    values (v_bid, r.product_id, (select item_type from products where id = r.product_id), v_sale.warehouse_id, 'SALE_RETURN_IN',
      v_base_qty, r.quantity, r.unit_id, coalesce(v_avg,0), round(v_base_qty * coalesce(v_avg,0),2),
      'VOID_SALE', v_sale.id, v_sale.operation_id, auth.uid());
  end loop;

  if v_sale.payment_type = 'CASH' then
    v_cash_acc := get_default_cash_account();
    if v_cash_acc is not null then
      insert into cash_transactions(business_id, cash_account_id, direction, amount,
        reference_type, reference_id, operation_id, description, created_by)
      values (v_bid, v_cash_acc, 'OUT', v_sale.total, 'VOID_SALE', v_sale.id, v_sale.operation_id,
        'إرجاع نقدي لإلغاء بيع ' || v_sale.doc_number, auth.uid());
    end if;
  end if;

  perform audit('VOID_SALE','sale', v_sale.id, 'VOID',
    jsonb_build_object('status','CONFIRMED','total',v_sale.total),
    jsonb_build_object('status','VOIDED','reason',p_reason));

  return jsonb_build_object('id', v_sale.id, 'doc_number', v_sale.doc_number);
end $$;

-- ============================================================================
-- PURCHASES (بند 14) + التكلفة المرجحة (بند 95/96)
-- ============================================================================
create or replace function create_purchase(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bid uuid; v_op uuid; v_pur_id uuid; v_doc text;
  v_supplier uuid; v_warehouse uuid; v_date date; v_invoice text;
  v_discount numeric; v_pay_type payment_type; v_pay_method payment_method;
  v_subtotal numeric := 0; v_total numeric;
  v_base_qty numeric; v_price_base numeric; v_factor numeric; v_line_cost numeric;
  v_cur_qty numeric; v_cur_avg numeric; v_new_avg numeric; v_base_unit uuid;
  r record; v_dup_id uuid; v_dup_doc text; v_cash_acc uuid;
begin
  v_bid := assert_business();
  assert_perm('purchases.manage');

  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'PURCHASE') then
    select id, doc_number into v_dup_id, v_dup_doc from purchases where operation_id = v_op;
    return jsonb_build_object('id', v_dup_id, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;

  v_supplier := (p_payload->>'supplier_id')::uuid;
  v_warehouse := (p_payload->>'warehouse_id')::uuid;
  v_date := coalesce(nullif(p_payload->>'purchase_date','')::date, business_today());
  v_invoice := nullif(p_payload->>'invoice_number','');
  v_discount := coalesce((p_payload->>'discount')::numeric, 0);
  v_pay_type := coalesce(nullif(p_payload->>'payment_type','')::payment_type, 'CREDIT');
  v_pay_method := nullif(p_payload->>'payment_method','')::payment_method;

  if v_supplier is null or not exists(select 1 from suppliers where id = v_supplier and business_id = v_bid) then
    raise exception 'اختر مورداً صحيحاً.';
  end if;
  if v_warehouse is null or not exists(select 1 from warehouses where id = v_warehouse and business_id = v_bid) then
    raise exception 'اختر مستودعاً صحيحاً.';
  end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb)) = 0 then
    raise exception 'أضف صنفاً واحداً على الأقل.';
  end if;

  for r in select * from jsonb_to_recordset(p_payload->'items') as x(product_id uuid, quantity numeric, unit_id uuid, unit_price numeric) loop
    if r.quantity is null or r.quantity <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر.'; end if;
    if r.unit_price is null or r.unit_price < 0 then raise exception 'سعر الشراء غير صحيح.'; end if;
    if not exists(select 1 from products where id = r.product_id and business_id = v_bid) then
      raise exception 'صنف غير موجود في الفاتورة.';
    end if;
    v_subtotal := v_subtotal + round(r.quantity * r.unit_price, 2);
  end loop;

  if v_discount > v_subtotal then raise exception 'الخصم أكبر من الإجمالي.'; end if;
  v_total := v_subtotal - v_discount;
  v_doc := next_doc_number('PUR');

  insert into purchases(operation_id, doc_number, business_id, supplier_id, warehouse_id,
    purchase_date, invoice_number, payment_type, payment_method, subtotal, discount, total, status)
  values (v_op, v_doc, v_bid, v_supplier, v_warehouse, v_date, v_invoice,
    v_pay_type, v_pay_method, v_subtotal, v_discount, v_total, 'CONFIRMED')
  returning id into v_pur_id;

  for r in select * from jsonb_to_recordset(p_payload->'items') as x(product_id uuid, quantity numeric, unit_id uuid, unit_price numeric) loop
    insert into purchase_items(purchase_id, product_id, quantity, unit_id, unit_price, total)
    values (v_pur_id, r.product_id, r.quantity, r.unit_id, r.unit_price, round(r.quantity * r.unit_price, 2));

    v_base_qty := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    v_line_cost := round(r.quantity * r.unit_price, 2);
    if v_base_qty > 0 then v_price_base := round(v_line_cost / v_base_qty, 4); else v_price_base := 0; end if;

    insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
      quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
    values (v_bid, r.product_id, (select item_type from products where id = r.product_id), v_warehouse, 'PURCHASE_IN',
      v_base_qty, r.quantity, r.unit_id, v_price_base, v_line_cost,
      'PURCHASE', v_pur_id, v_op, auth.uid());

    -- تحديث المتوسط المرجح للتكلفة على مستوى النشاط كله
    select base_unit_id into v_base_unit from products where id = r.product_id;
    if r.unit_id = v_base_unit then v_factor := 1; else
      select factor into v_factor from unit_conversions
        where business_id = v_bid and from_unit_id = r.unit_id and to_unit_id = v_base_unit;
    end if;
    select coalesce((select sum(case when movement_type in ('PURCHASE_IN','PRODUCTION_IN','SALE_RETURN_IN','ADJUSTMENT_IN','TRANSFER_IN','DISTRIBUTION_RETURN_IN') then quantity else -quantity end)
      from inventory_movements where business_id = v_bid and item_id = r.product_id
        and movement_type <> 'PURCHASE_IN'), 0)
      into v_cur_qty;
    -- استبعاد حركات هذه الفاتورة نفسها: الأسهل طرح حركات الفاتورة الحالية من المجموع أعلاه غير ممكن ببساطة،
    -- لذلك نحسب الرصيد قبل الفاتورة عبر الطرح:
    v_cur_qty := v_cur_qty - v_base_qty;
    select avg_cost into v_cur_avg from products where id = r.product_id;
    if (coalesce(v_cur_qty,0) + v_base_qty) > 0 then
      v_new_avg := round(((coalesce(v_cur_qty,0) * coalesce(v_cur_avg,0)) + (v_base_qty * v_price_base))
        / (coalesce(v_cur_qty,0) + v_base_qty), 4);
    else v_new_avg := v_price_base; end if;
    update products set avg_cost = v_new_avg, last_purchase_cost = v_price_base where id = r.product_id;
  end loop;

  if v_pay_type = 'CASH' then
    v_cash_acc := coalesce(nullif(p_payload->>'cash_account_id','')::uuid, get_default_cash_account());
    if v_cash_acc is not null then
      insert into cash_transactions(business_id, cash_account_id, direction, amount,
        reference_type, reference_id, operation_id, description, created_by)
      values (v_bid, v_cash_acc, 'OUT', v_total, 'PURCHASE', v_pur_id, v_op, 'شراء نقدي ' || v_doc, auth.uid());
    end if;
  end if;

  perform audit('CREATE_PURCHASE','purchase', v_pur_id, 'CREATE', null,
    jsonb_build_object('doc_number', v_doc, 'total', v_total, 'supplier_id', v_supplier));

  return jsonb_build_object('id', v_pur_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

-- إلغاء شراء
create or replace function void_purchase(p_purchase_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_pur purchases%rowtype; r record; v_base_qty numeric; v_cost numeric; v_cash_acc uuid;
begin
  v_bid := assert_business();
  assert_perm('purchases.void');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'اكتب سبب الإلغاء.'; end if;
  select * into v_pur from purchases where id = p_purchase_id and business_id = v_bid for update;
  if not found then raise exception 'فاتورة الشراء غير موجودة.'; end if;
  if v_pur.status <> 'CONFIRMED' then raise exception 'لا يمكن إلغاء فاتورة بحالة غير مؤكدة.'; end if;

  update purchases set status = 'VOIDED' where id = v_pur.id;

  for r in select * from purchase_items where purchase_id = v_pur.id loop
    v_base_qty := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    v_cost := round(r.quantity * r.unit_price, 2);
    insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
      quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
    values (v_bid, r.product_id, (select item_type from products where id = r.product_id), v_pur.warehouse_id, 'PURCHASE_RETURN_OUT',
      v_base_qty, r.quantity, r.unit_id, case when v_base_qty > 0 then round(v_cost / v_base_qty, 4) else 0 end, v_cost,
      'VOID_PURCHASE', v_pur.id, v_pur.operation_id, auth.uid());
  end loop;

  if v_pur.payment_type = 'CASH' then
    v_cash_acc := get_default_cash_account();
    if v_cash_acc is not null then
      insert into cash_transactions(business_id, cash_account_id, direction, amount,
        reference_type, reference_id, operation_id, description, created_by)
      values (v_bid, v_cash_acc, 'IN', v_pur.total, 'VOID_PURCHASE', v_pur.id, v_pur.operation_id,
        'استرداد نقدي لإلغاء شراء ' || v_pur.doc_number, auth.uid());
    end if;
  end if;

  perform audit('VOID_PURCHASE','purchase', v_pur.id, 'VOID',
    jsonb_build_object('status','CONFIRMED','total',v_pur.total),
    jsonb_build_object('status','VOIDED','reason',p_reason));

  return jsonb_build_object('id', v_pur.id, 'doc_number', v_pur.doc_number);
end $$;

-- ============================================================================
-- PAYMENTS (بند 20/22)
-- ============================================================================
create or replace function create_customer_payment(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_doc text; v_id uuid; v_customer uuid; v_amount numeric; v_cash_acc uuid; v_dup uuid; v_dup_doc text;
begin
  v_bid := assert_business();
  assert_perm('payments.manage');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'CUSTOMER_PAYMENT') then
    select id, doc_number into v_dup, v_dup_doc from customer_payments where operation_id = v_op;
    return jsonb_build_object('id', v_dup, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;
  v_customer := (p_payload->>'party_id')::uuid;
  v_amount := (p_payload->>'amount')::numeric;
  if v_customer is null or not exists(select 1 from customers where id = v_customer and business_id = v_bid) then
    raise exception 'العميل غير موجود.';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر.'; end if;
  v_doc := next_doc_number('PAY');
  v_cash_acc := coalesce(nullif(p_payload->>'cash_account_id','')::uuid, get_default_cash_account());

  insert into customer_payments(operation_id, doc_number, business_id, customer_id, payment_date,
    amount, payment_method, cash_account_id, reference, notes, created_by)
  values (v_op, v_doc, v_bid, v_customer, coalesce(nullif(p_payload->>'payment_date','')::date, business_today()),
    v_amount, coalesce(nullif(p_payload->>'payment_method','')::payment_method,'CASH'),
    v_cash_acc, nullif(p_payload->>'reference',''), nullif(p_payload->>'notes',''), auth.uid())
  returning id into v_id;

  if v_cash_acc is not null then
    insert into cash_transactions(business_id, cash_account_id, direction, amount,
      reference_type, reference_id, operation_id, description, created_by)
    values (v_bid, v_cash_acc, 'IN', v_amount, 'CUSTOMER_PAYMENT', v_id, v_op, 'تحصيل من عميل ' || v_doc, auth.uid());
  end if;

  perform audit('CUSTOMER_PAYMENT','customer_payment', v_id, 'PAYMENT', null,
    jsonb_build_object('amount', v_amount, 'customer_id', v_customer));
  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

create or replace function create_supplier_payment(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_doc text; v_id uuid; v_supplier uuid; v_amount numeric; v_cash_acc uuid; v_dup uuid; v_dup_doc text;
begin
  v_bid := assert_business();
  assert_perm('payments.manage');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'SUPPLIER_PAYMENT') then
    select id, doc_number into v_dup, v_dup_doc from supplier_payments where operation_id = v_op;
    return jsonb_build_object('id', v_dup, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;
  v_supplier := (p_payload->>'party_id')::uuid;
  v_amount := (p_payload->>'amount')::numeric;
  if v_supplier is null or not exists(select 1 from suppliers where id = v_supplier and business_id = v_bid) then
    raise exception 'المورد غير موجود.';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر.'; end if;
  v_doc := next_doc_number('SPAY');
  v_cash_acc := coalesce(nullif(p_payload->>'cash_account_id','')::uuid, get_default_cash_account());

  insert into supplier_payments(operation_id, doc_number, business_id, supplier_id, payment_date,
    amount, payment_method, cash_account_id, reference, notes, created_by)
  values (v_op, v_doc, v_bid, v_supplier, coalesce(nullif(p_payload->>'payment_date','')::date, business_today()),
    v_amount, coalesce(nullif(p_payload->>'payment_method','')::payment_method,'CASH'),
    v_cash_acc, nullif(p_payload->>'reference',''), nullif(p_payload->>'notes',''), auth.uid())
  returning id into v_id;

  if v_cash_acc is not null then
    insert into cash_transactions(business_id, cash_account_id, direction, amount,
      reference_type, reference_id, operation_id, description, created_by)
    values (v_bid, v_cash_acc, 'OUT', v_amount, 'SUPPLIER_PAYMENT', v_id, v_op, 'دفعة لمورد ' || v_doc, auth.uid());
  end if;

  perform audit('SUPPLIER_PAYMENT','supplier_payment', v_id, 'PAYMENT', null,
    jsonb_build_object('amount', v_amount, 'supplier_id', v_supplier));
  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

-- ============================================================================
-- PRODUCTION (بند 23/24/25)
-- ============================================================================
create or replace function create_production_batch(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bid uuid; v_op uuid; v_doc text; v_id uuid;
  v_product uuid; v_warehouse uuid; v_recipe uuid; v_qty numeric; v_unit uuid;
  v_date date; v_shift text;
  v_output_qty numeric; v_factor numeric; v_base_qty numeric;
  v_mat_base numeric; v_mat_cost numeric; v_total_cost numeric := 0; v_avg numeric;
  r record; v_dup uuid; v_dup_doc text;
begin
  v_bid := assert_business();
  assert_perm('production.manage');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'PRODUCTION') then
    select id, doc_number into v_dup, v_dup_doc from production_batches where operation_id = v_op;
    return jsonb_build_object('id', v_dup, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;

  v_product := (p_payload->>'product_id')::uuid;
  v_warehouse := (p_payload->>'warehouse_id')::uuid;
  v_recipe := nullif(p_payload->>'recipe_version_id','')::uuid;
  v_qty := (p_payload->>'quantity')::numeric;
  v_unit := (p_payload->>'unit_id')::uuid;
  v_date := coalesce(nullif(p_payload->>'batch_date','')::date, business_today());
  v_shift := nullif(p_payload->>'shift','');

  if v_product is null or not exists(select 1 from products where id = v_product and business_id = v_bid and item_type = 'FINISHED_PRODUCT') then
    raise exception 'اختر منتجاً نهائياً صحيحاً.';
  end if;
  if v_recipe is null then raise exception 'اختر وصفة الإنتاج.'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'الكمية المنتجة يجب أن تكون أكبر من صفر.'; end if;
  if not exists(select 1 from recipe_versions rv join recipes rec on rec.id = rv.recipe_id
    where rv.id = v_recipe and rec.product_id = v_product and rv.business_id = v_bid) then
    raise exception 'الوصفة المختارة لا تنتمي لهذا المنتج.';
  end if;

  select output_quantity into v_output_qty from recipe_versions where id = v_recipe;
  v_base_qty := convert_qty_to_base(v_product, v_unit, v_qty);
  v_factor := v_base_qty / v_output_qty;

  -- حساب الاستهلاك والتحقق من توفر المواد
  for r in select ri.*, coalesce(p.avg_cost,0) as mat_avg
    from recipe_items ri join products p on p.id = ri.material_id
    where ri.recipe_version_id = v_recipe loop
    v_mat_base := round(r.quantity * v_factor, 3);
    if not exists(select 1 from products where id = r.material_id and business_id = v_bid and active) then
      raise exception 'مادة خام في الوصفة غير مفعّلة.';
    end if;
    perform assert_stock_available(r.material_id, v_warehouse, v_mat_base);
    v_mat_cost := round(v_mat_base * coalesce(r.mat_avg,0), 2);
    v_total_cost := v_total_cost + v_mat_cost;
  end loop;

  v_doc := next_doc_number('PRO');
  insert into production_batches(operation_id, doc_number, business_id, product_id, warehouse_id,
    recipe_version_id, quantity, unit_id, batch_date, shift, material_cost, status, notes, created_by)
  values (v_op, v_doc, v_bid, v_product, v_warehouse, v_recipe, v_qty, v_unit, v_date, v_shift,
    v_total_cost, 'CONFIRMED', nullif(p_payload->>'notes',''), auth.uid())
  returning id into v_id;

  -- حركات الاستهلاك
  for r in select ri.*, coalesce(p.avg_cost,0) as mat_avg
    from recipe_items ri join products p on p.id = ri.material_id
    where ri.recipe_version_id = v_recipe loop
    v_mat_base := round(r.quantity * v_factor, 3);
    v_mat_cost := round(v_mat_base * coalesce(r.mat_avg,0), 2);
    insert into production_consumption(batch_id, material_id, quantity, unit_id, unit_cost, total_cost)
    values (v_id, r.material_id, v_mat_base, r.unit_id, coalesce(r.mat_avg,0), v_mat_cost);
    insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
      quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
    values (v_bid, r.material_id, 'RAW_MATERIAL', v_warehouse, 'PRODUCTION_CONSUMPTION_OUT',
      v_mat_base, round(r.quantity * v_factor, 3), r.unit_id, coalesce(r.mat_avg,0), v_mat_cost,
      'PRODUCTION', v_id, v_op, auth.uid());
  end loop;

  -- إدخال المنتج النهائي
  v_avg := case when v_base_qty > 0 then round(v_total_cost / v_base_qty, 4) else 0 end;
  insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
    quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
  values (v_bid, v_product, 'FINISHED_PRODUCT', v_warehouse, 'PRODUCTION_IN',
    v_base_qty, v_qty, v_unit, v_avg, v_total_cost, 'PRODUCTION', v_id, v_op, auth.uid());

  perform audit('CREATE_PRODUCTION','production_batch', v_id, 'PRODUCTION', null,
    jsonb_build_object('doc_number', v_doc, 'quantity', v_qty, 'material_cost', v_total_cost, 'recipe_version', v_recipe));

  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'duplicate', false, 'material_cost', v_total_cost);
end $$;

-- ============================================================================
-- EXPENSES (بند 32)
-- ============================================================================
create or replace function create_expense(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_doc text; v_id uuid; v_amount numeric; v_cash_acc uuid; v_dup uuid; v_dup_doc text;
begin
  v_bid := assert_business();
  assert_perm('expenses.manage');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'EXPENSE') then
    select id, doc_number into v_dup, v_dup_doc from expenses where operation_id = v_op;
    return jsonb_build_object('id', v_dup, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;
  v_amount := (p_payload->>'amount')::numeric;
  if v_amount is null or v_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر.'; end if;
  if not exists(select 1 from expense_categories where id = (p_payload->>'category_id')::uuid and business_id = v_bid) then
    raise exception 'اختر تصنيف مصروف صحيحاً.';
  end if;
  v_doc := next_doc_number('EXP');
  v_cash_acc := nullif(p_payload->>'cash_account_id','')::uuid;

  insert into expenses(operation_id, doc_number, business_id, category_id, amount, expense_date,
    payment_method, cash_account_id, description, notes, created_by)
  values (v_op, v_doc, v_bid, (p_payload->>'category_id')::uuid, v_amount,
    coalesce(nullif(p_payload->>'expense_date','')::date, business_today()),
    coalesce(nullif(p_payload->>'payment_method','')::payment_method,'CASH'),
    v_cash_acc, nullif(p_payload->>'description',''), nullif(p_payload->>'notes',''), auth.uid())
  returning id into v_id;

  if v_cash_acc is not null then
    insert into cash_transactions(business_id, cash_account_id, direction, amount,
      reference_type, reference_id, operation_id, description, created_by)
    values (v_bid, v_cash_acc, 'OUT', v_amount, 'EXPENSE', v_id, v_op, 'مصروف ' || v_doc, auth.uid());
  end if;

  perform audit('CREATE_EXPENSE','expense', v_id, 'CREATE', null,
    jsonb_build_object('amount', v_amount, 'category_id', p_payload->>'category_id'));
  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

-- ============================================================================
-- INVENTORY: تسوية + هالك + مناقلة (بند 27/94/99)
-- ============================================================================
create or replace function create_inventory_adjustment(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_doc text; v_id uuid; v_qty numeric; v_base numeric;
  v_avg numeric; v_dup uuid; v_dup_doc text;
begin
  v_bid := assert_business();
  assert_perm('inventory.adjust');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'ADJUSTMENT') then
    select id, doc_number into v_dup, v_dup_doc from inventory_adjustments where operation_id = v_op;
    return jsonb_build_object('id', v_dup, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;
  v_qty := (p_payload->>'quantity')::numeric;
  if v_qty is null or v_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر.'; end if;
  if coalesce(nullif(p_payload->>'reason',''),'') = '' then raise exception 'اكتب سبب التسوية.'; end if;
  v_base := convert_qty_to_base((p_payload->>'product_id')::uuid, (p_payload->>'unit_id')::uuid, v_qty);
  if (p_payload->>'direction') = 'OUT' then
    perform assert_stock_available((p_payload->>'product_id')::uuid, (p_payload->>'warehouse_id')::uuid, v_base);
  end if;
  select avg_cost into v_avg from products where id = (p_payload->>'product_id')::uuid;
  v_doc := next_doc_number('ADJ');

  insert into inventory_adjustments(operation_id, doc_number, business_id, product_id, warehouse_id,
    direction, quantity, reason, adjusted_at, notes, created_by)
  values (v_op, v_doc, v_bid, (p_payload->>'product_id')::uuid, (p_payload->>'warehouse_id')::uuid,
    coalesce(nullif(p_payload->>'direction',''),'IN'), v_qty, p_payload->>'reason',
    coalesce(nullif(p_payload->>'adjusted_at','')::date, business_today()), nullif(p_payload->>'notes',''), auth.uid())
  returning id into v_id;

  insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
    quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
  values (v_bid, (p_payload->>'product_id')::uuid, (select item_type from products where id = (p_payload->>'product_id')::uuid),
    (p_payload->>'warehouse_id')::uuid,
    case when (p_payload->>'direction') = 'OUT' then 'ADJUSTMENT_OUT'::movement_type else 'ADJUSTMENT_IN'::movement_type end,
    v_base, v_qty, (p_payload->>'unit_id')::uuid, coalesce(v_avg,0), round(v_base * coalesce(v_avg,0),2),
    'ADJUSTMENT', v_id, v_op, auth.uid());

  perform audit('INVENTORY_ADJUSTMENT','inventory_adjustment', v_id, 'ADJUSTMENT', null,
    jsonb_build_object('direction', p_payload->>'direction', 'qty', v_qty, 'reason', p_payload->>'reason'));
  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

create or replace function create_waste(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_doc text; v_id uuid; v_qty numeric; v_base numeric; v_avg numeric; v_dup uuid; v_dup_doc text;
begin
  v_bid := assert_business();
  assert_perm('inventory.waste');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'WASTE') then
    select id, doc_number into v_dup, v_dup_doc from waste_records where operation_id = v_op;
    return jsonb_build_object('id', v_dup, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;
  v_qty := (p_payload->>'quantity')::numeric;
  if v_qty is null or v_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر.'; end if;
  if coalesce(nullif(p_payload->>'reason',''),'') = '' then raise exception 'اكتب سبب الهالك.'; end if;
  v_base := convert_qty_to_base((p_payload->>'product_id')::uuid, (p_payload->>'unit_id')::uuid, v_qty);
  perform assert_stock_available((p_payload->>'product_id')::uuid, (p_payload->>'warehouse_id')::uuid, v_base);
  select avg_cost into v_avg from products where id = (p_payload->>'product_id')::uuid;
  v_doc := next_doc_number('WST');

  insert into waste_records(operation_id, doc_number, business_id, product_id, warehouse_id,
    quantity, reason, wasted_at, notes, created_by)
  values (v_op, v_doc, v_bid, (p_payload->>'product_id')::uuid, (p_payload->>'warehouse_id')::uuid,
    v_qty, p_payload->>'reason', coalesce(nullif(p_payload->>'wasted_at','')::date, business_today()),
    nullif(p_payload->>'notes',''), auth.uid())
  returning id into v_id;

  insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
    quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
  values (v_bid, (p_payload->>'product_id')::uuid, (select item_type from products where id = (p_payload->>'product_id')::uuid),
    (p_payload->>'warehouse_id')::uuid, 'WASTE_OUT',
    v_base, v_qty, (p_payload->>'unit_id')::uuid, coalesce(v_avg,0), round(v_base * coalesce(v_avg,0),2),
    'WASTE', v_id, v_op, auth.uid());

  perform audit('CREATE_WASTE','waste', v_id, 'WASTE', null,
    jsonb_build_object('qty', v_qty, 'reason', p_payload->>'reason'));
  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

-- ============================================================================
-- TRANSFERS (بند 99)
-- ============================================================================
create or replace function create_transfer(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_doc text; v_id uuid; v_base numeric; v_avg numeric;
  v_from uuid; v_to uuid; v_dup uuid; v_dup_doc text; r record;
begin
  v_bid := assert_business();
  assert_perm('inventory.transfer');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'TRANSFER') then
    select id, doc_number into v_dup, v_dup_doc from transfers where operation_id = v_op;
    return jsonb_build_object('id', v_dup, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;
  v_from := (p_payload->>'from_warehouse_id')::uuid;
  v_to := (p_payload->>'to_warehouse_id')::uuid;
  if v_from is null or v_to is null or v_from = v_to then
    raise exception 'اختر مستودعين مختلفين للمناقلة.';
  end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb)) = 0 then
    raise exception 'أضف صنفاً واحداً على الأقل.';
  end if;

  for r in select * from jsonb_to_recordset(p_payload->'items') as x(product_id uuid, quantity numeric, unit_id uuid) loop
    if r.quantity is null or r.quantity <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر.'; end if;
    v_base := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    perform assert_stock_available(r.product_id, v_from, v_base);
  end loop;

  v_doc := next_doc_number('TRF');
  insert into transfers(operation_id, doc_number, business_id, from_warehouse_id, to_warehouse_id,
    transfer_date, status, notes, created_by)
  values (v_op, v_doc, v_bid, v_from, v_to,
    coalesce(nullif(p_payload->>'transfer_date','')::date, business_today()), 'CONFIRMED',
    nullif(p_payload->>'notes',''), auth.uid())
  returning id into v_id;

  for r in select * from jsonb_to_recordset(p_payload->'items') as x(product_id uuid, quantity numeric, unit_id uuid) loop
    insert into transfer_items(transfer_id, product_id, quantity, unit_id)
    values (v_id, r.product_id, r.quantity, r.unit_id);
    v_base := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    select avg_cost into v_avg from products where id = r.product_id;
    insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
      quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
    values (v_bid, r.product_id, (select item_type from products where id = r.product_id), v_from, 'TRANSFER_OUT',
      v_base, r.quantity, r.unit_id, coalesce(v_avg,0), round(v_base * coalesce(v_avg,0),2), 'TRANSFER', v_id, v_op, auth.uid());
    insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
      quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
    values (v_bid, r.product_id, (select item_type from products where id = r.product_id), v_to, 'TRANSFER_IN',
      v_base, r.quantity, r.unit_id, coalesce(v_avg,0), round(v_base * coalesce(v_avg,0),2), 'TRANSFER', v_id, v_op, auth.uid());
  end loop;

  perform audit('CREATE_TRANSFER','transfer', v_id, 'TRANSFER', null,
    jsonb_build_object('doc_number', v_doc, 'from', v_from, 'to', v_to));
  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

-- ============================================================================
-- DISTRIBUTION (بند 29-31)
-- ============================================================================
create or replace function create_distribution_load(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_doc text; v_id uuid; v_base numeric;
  v_warehouse uuid; v_dup uuid; v_dup_doc text; r record;
begin
  v_bid := assert_business();
  assert_perm('distribution.manage');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'DISTRIBUTION_LOAD') then
    select id, doc_number into v_dup, v_dup_doc from distribution_loads where operation_id = v_op;
    return jsonb_build_object('id', v_dup, 'doc_number', v_dup_doc, 'duplicate', true);
  end if;
  v_warehouse := (p_payload->>'warehouse_id')::uuid;
  if (p_payload->>'vehicle_id')::uuid is null or
     not exists(select 1 from vehicles where id = (p_payload->>'vehicle_id')::uuid and business_id = v_bid and active) then
    raise exception 'اختر سيارة صحيحة.';
  end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb)) = 0 then
    raise exception 'أضف أصنافاً للتحميل.';
  end if;

  for r in select * from jsonb_to_recordset(p_payload->'items') as x(product_id uuid, quantity numeric, unit_id uuid) loop
    if r.quantity is null or r.quantity <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر.'; end if;
    v_base := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    perform assert_stock_available(r.product_id, v_warehouse, v_base);
  end loop;

  v_doc := next_doc_number('LOD');
  insert into distribution_loads(operation_id, doc_number, business_id, vehicle_id, driver_id,
    distributor_id, warehouse_id, load_date, status, notes, created_by)
  values (v_op, v_doc, v_bid, (p_payload->>'vehicle_id')::uuid, nullif(p_payload->>'driver_id','')::uuid,
    nullif(p_payload->>'distributor_id','')::uuid, v_warehouse,
    coalesce(nullif(p_payload->>'load_date','')::date, business_today()), 'OPEN',
    nullif(p_payload->>'notes',''), auth.uid())
  returning id into v_id;

  for r in select * from jsonb_to_recordset(p_payload->'items') as x(product_id uuid, quantity numeric, unit_id uuid) loop
    insert into distribution_items(load_id, product_id, quantity, unit_id)
    values (v_id, r.product_id, r.quantity, r.unit_id);
    v_base := convert_qty_to_base(r.product_id, r.unit_id, r.quantity);
    insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
      quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
    values (v_bid, r.product_id, (select item_type from products where id = r.product_id), v_warehouse, 'DISTRIBUTION_LOAD_OUT',
      v_base, r.quantity, r.unit_id,
      coalesce((select avg_cost from products where id = r.product_id),0),
      round(v_base * coalesce((select avg_cost from products where id = r.product_id),0),2),
      'DISTRIBUTION_LOAD', v_id, v_op, auth.uid());
  end loop;

  perform audit('CREATE_DISTRIBUTION_LOAD','distribution_load', v_id, 'CREATE', null,
    jsonb_build_object('doc_number', v_doc, 'vehicle_id', p_payload->>'vehicle_id'));
  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

-- بيع أثناء التوزيع: يُنشئ sale (channel=DISTRIBUTION) مرتبطة بالحمولة — بلا حركة مخزون
-- لأن البضاعة خرجت فعلاً مع تحميل السيارة.
create or replace function record_distribution_delivery(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bid uuid; v_op uuid; v_load uuid; v_sale_id uuid; v_doc text;
  v_customer uuid; v_product uuid; v_qty numeric; v_unit uuid; v_price numeric;
  v_pay_type payment_type; v_base numeric; v_loaded numeric; v_out numeric;
  v_date date; v_del_id uuid; r record;
begin
  v_bid := assert_business();
  assert_perm('distribution.manage');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'DISTRIBUTION_DELIVERY') then
    select id into v_del_id from distribution_deliveries where operation_id = v_op;
    return jsonb_build_object('id', v_del_id, 'duplicate', true);
  end if;

  v_load := (p_payload->>'load_id')::uuid;
  v_customer := (p_payload->>'customer_id')::uuid;
  v_product := (p_payload->>'product_id')::uuid;
  v_qty := (p_payload->>'quantity')::numeric;
  v_unit := (p_payload->>'unit_id')::uuid;
  v_price := coalesce((p_payload->>'unit_price')::numeric, (select sale_price from products where id = v_product));
  v_pay_type := coalesce(nullif(p_payload->>'payment_type','')::payment_type, 'CASH');
  v_date := coalesce(nullif(p_payload->>'delivery_date','')::date, business_today());

  if not exists(select 1 from distribution_loads where id = v_load and business_id = v_bid and status in ('OPEN','IN_PROGRESS')) then
    raise exception 'الحمولة غير موجودة أو مُسوّاة مسبقاً.';
  end if;
  if v_customer is null or not exists(select 1 from customers where id = v_customer and business_id = v_bid and active) then
    raise exception 'اختر عميلاً صحيحاً.';
  end if;
  if v_qty is null or v_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر.'; end if;

  -- يجب أن يكون الصنف من محمولات الحمولة، والكمية ضمن الرصيد المتبقي على السيارة
  if not exists(select 1 from distribution_items where load_id = v_load and product_id = v_product) then
    raise exception 'هذا الصنف ليس ضمن محمولات الحمولة.';
  end if;
  v_base := convert_qty_to_base(v_product, v_unit, v_qty);
  v_loaded := coalesce((select sum(convert_qty_to_base(product_id, unit_id, quantity))
    from distribution_items where load_id = v_load and product_id = v_product), 0);
  v_out := coalesce((select sum(convert_qty_to_base(d.product_id, d.unit_id, d.quantity))
    from distribution_deliveries d where d.load_id = v_load and d.product_id = v_product), 0)
    + coalesce((select sum(convert_qty_to_base(dr.product_id, dr.unit_id, dr.quantity))
    from distribution_returns dr where dr.load_id = v_load and dr.product_id = v_product), 0);
  if (v_loaded - v_out) < v_base then
    raise exception 'الكمية المبيعة أكبر من الرصيد المتبقي على السيارة. المتبقي: %', (v_loaded - v_out);
  end if;

  v_doc := next_doc_number('SAL');
  insert into sales(operation_id, doc_number, business_id, customer_id, warehouse_id, sale_date,
    subtotal, discount, total, cost_total, payment_type, status, channel, load_id, created_by)
  select v_op, v_doc, v_bid, v_customer, l.warehouse_id, v_date,
    round(v_qty * v_price, 2), 0, round(v_qty * v_price, 2),
    round(v_base * coalesce((select avg_cost from products where id = v_product),0), 2),
    v_pay_type, 'CONFIRMED', 'DISTRIBUTION', v_load, auth.uid()
  from distribution_loads l where l.id = v_load
  returning id into v_sale_id;

  insert into sale_items(sale_id, product_id, quantity, unit_id, unit_price, total)
  values (v_sale_id, v_product, v_qty, v_unit, v_price, round(v_qty * v_price, 2));

  insert into distribution_deliveries(operation_id, load_id, business_id, customer_id, product_id,
    quantity, unit_id, unit_price, total, payment_type, delivery_date, sale_id, created_by)
  values (v_op, v_load, v_bid, v_customer, v_product, v_qty, v_unit, v_price,
    round(v_qty * v_price, 2), v_pay_type, v_date, v_sale_id, auth.uid())
  returning id into v_del_id;

  update distribution_loads set status = 'IN_PROGRESS' where id = v_load and status = 'OPEN';

  perform audit('DISTRIBUTION_DELIVERY','distribution_delivery', v_del_id, 'CREATE', null,
    jsonb_build_object('load_id', v_load, 'qty', v_qty));
  return jsonb_build_object('sale_id', v_sale_id, 'doc_number', v_doc, 'duplicate', false);
end $$;

-- مرتجع توزيع: يعيد البضاعة للمستودع
create or replace function record_distribution_return(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_load uuid; v_product uuid; v_qty numeric; v_unit uuid;
  v_base numeric; v_loaded numeric; v_out numeric; v_id uuid; v_warehouse uuid; r record;
begin
  v_bid := assert_business();
  assert_perm('distribution.manage');
  v_op := (p_payload->>'operation_id')::uuid;
  if not register_op(v_op, 'DISTRIBUTION_RETURN') then
    select id into v_id from distribution_returns where operation_id = v_op;
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;

  v_load := (p_payload->>'load_id')::uuid;
  v_product := (p_payload->>'product_id')::uuid;
  v_qty := (p_payload->>'quantity')::numeric;
  v_unit := (p_payload->>'unit_id')::uuid;

  select warehouse_id into v_warehouse from distribution_loads where id = v_load and business_id = v_bid;
  if v_warehouse is null then raise exception 'الحمولة غير موجودة.'; end if;
  if not exists(select 1 from distribution_loads where id = v_load and status in ('OPEN','IN_PROGRESS')) then
    raise exception 'الحمولة مُسوّاة مسبقاً — لا يمكن إضافة مرتجع.';
  end if;
  if not exists(select 1 from distribution_items where load_id = v_load and product_id = v_product) then
    raise exception 'هذا الصنف ليس ضمن محمولات الحمولة.';
  end if;
  if v_qty is null or v_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر.'; end if;

  v_base := convert_qty_to_base(v_product, v_unit, v_qty);
  v_loaded := coalesce((select sum(convert_qty_to_base(product_id, unit_id, quantity))
    from distribution_items where load_id = v_load and product_id = v_product), 0);
  v_out := coalesce((select sum(convert_qty_to_base(d.product_id, d.unit_id, d.quantity))
    from distribution_deliveries d where d.load_id = v_load and d.product_id = v_product), 0)
    + coalesce((select sum(convert_qty_to_base(dr.product_id, dr.unit_id, dr.quantity))
    from distribution_returns dr where dr.load_id = v_load and dr.product_id = v_product), 0);
  if (v_loaded - v_out) < v_base then
    raise exception 'الكمية المرتجعة أكبر من الرصيد المتبقي على السيارة. المتبقي: %', (v_loaded - v_out);
  end if;

  insert into distribution_returns(operation_id, load_id, business_id, product_id, quantity,
    unit_id, reason, return_date, created_by)
  values (v_op, v_load, v_bid, v_product, v_qty, v_unit, nullif(p_payload->>'reason',''),
    coalesce(nullif(p_payload->>'return_date','')::date, business_today()), auth.uid())
  returning id into v_id;

  insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
    quantity, input_quantity, input_unit_id, unit_cost, total_cost, reference_type, reference_id, operation_id, created_by)
  values (v_bid, v_product, (select item_type from products where id = v_product), v_warehouse, 'DISTRIBUTION_RETURN_IN',
    v_base, v_qty, v_unit, coalesce((select avg_cost from products where id = v_product),0),
    round(v_base * coalesce((select avg_cost from products where id = v_product),0),2),
    'DISTRIBUTION_RETURN', v_id, v_op, auth.uid());

  perform audit('DISTRIBUTION_RETURN','distribution_return', v_id, 'RETURN', null,
    jsonb_build_object('load_id', v_load, 'qty', v_qty, 'reason', p_payload->>'reason'));
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- تسوية الحمولة (بند 31): Loaded = Sold + Returned + Unaccounted
-- لا إغلاق دون معالجة الفروق أو تسجيل سبب.
create or replace function settle_distribution_load(
  p_load_id uuid,
  p_cash_collected numeric,
  p_variance_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_op uuid; v_doc text; v_id uuid; v_load distribution_loads%rowtype;
  v_loaded numeric := 0; v_sold numeric := 0; v_returned numeric := 0; v_unacc numeric;
  v_cash_expected numeric := 0; v_credit_total numeric := 0; v_cash_variance numeric;
  v_breakdown jsonb := '[]'::jsonb; v_cash_acc uuid; v_prod record; r record;
begin
  v_bid := assert_business();
  assert_perm('distribution.settle');
  select * into v_load from distribution_loads where id = p_load_id and business_id = v_bid for update;
  if not found then raise exception 'الحمولة غير موجودة.'; end if;
  if v_load.status = 'SETTLED' then raise exception 'الحمولة مُسوّاة مسبقاً.'; end if;

  v_op := gen_random_uuid();
  v_doc := next_doc_number('STL');

  for v_prod in
    select di.product_id,
      coalesce((select sum(convert_qty_to_base(di2.product_id, di2.unit_id, di2.quantity))
        from distribution_items di2 where di2.load_id = v_load.id and di2.product_id = di.product_id), 0) as loaded,
      coalesce((select sum(convert_qty_to_base(d.product_id, d.unit_id, d.quantity))
        from distribution_deliveries d where d.load_id = v_load.id and d.product_id = di.product_id), 0) as sold,
      coalesce((select sum(convert_qty_to_base(dr.product_id, dr.unit_id, dr.quantity))
        from distribution_returns dr where dr.load_id = v_load.id and dr.product_id = di.product_id), 0) as returned
    from distribution_items di where di.load_id = v_load.id
    group by di.product_id
  loop
    v_loaded := v_loaded + v_prod.loaded;
    v_sold := v_sold + v_prod.sold;
    v_returned := v_returned + v_prod.returned;
    v_breakdown := v_breakdown || jsonb_build_object(
      'product_id', v_prod.product_id,
      'loaded', v_prod.loaded, 'sold', v_prod.sold, 'returned', v_prod.returned,
      'unaccounted', v_prod.loaded - v_prod.sold - v_prod.returned);
  end loop;

  v_unacc := v_loaded - v_sold - v_returned;
  select coalesce(sum(total),0) into v_cash_expected from distribution_deliveries
    where load_id = v_load.id and payment_type = 'CASH';
  select coalesce(sum(total),0) into v_credit_total from distribution_deliveries
    where load_id = v_load.id and payment_type = 'CREDIT';
  v_cash_variance := round(v_cash_expected - coalesce(p_cash_collected, 0), 2);

  if v_unacc <> 0 and (p_variance_note is null or length(trim(p_variance_note)) < 3) then
    raise exception 'يوجد فرق كمية غير مبرر (%). سجل سبب الفرق قبل التسوية.', v_unacc;
  end if;
  if v_cash_variance <> 0 and (p_variance_note is null or length(trim(p_variance_note)) < 3) then
    raise exception 'يوجد فرق نقدي (%). سجل سبب الفرق قبل التسوية.', v_cash_variance;
  end if;

  insert into distribution_settlements(operation_id, doc_number, load_id, business_id, settlement_date,
    loaded_qty, sold_qty, returned_qty, waste_qty, unaccounted_qty, cash_collected, credit_total,
    cash_expected, cash_variance, variance_note, product_breakdown, created_by)
  values (v_op, v_doc, v_load.id, v_bid, business_today(),
    v_loaded, v_sold, v_returned, 0, v_unacc, coalesce(p_cash_collected,0), v_credit_total,
    v_cash_expected, v_cash_variance, p_variance_note, v_breakdown, auth.uid())
  returning id into v_id;

  if coalesce(p_cash_collected, 0) > 0 then
    v_cash_acc := get_default_cash_account();
    if v_cash_acc is not null then
      insert into cash_transactions(business_id, cash_account_id, direction, amount,
        reference_type, reference_id, operation_id, description, created_by)
      values (v_bid, v_cash_acc, 'IN', p_cash_collected, 'DISTRIBUTION_SETTLEMENT', v_id, v_op,
        'تحصيل تسوية حمولة ' || v_doc, auth.uid());
    end if;
  end if;

  update distribution_loads set status = 'SETTLED' where id = v_load.id;

  perform audit('SETTLE_DISTRIBUTION','distribution_settlement', v_id, 'SETTLEMENT', null,
    jsonb_build_object('doc_number', v_doc, 'loaded', v_loaded, 'sold', v_sold,
      'returned', v_returned, 'unaccounted', v_unacc, 'cash_collected', p_cash_collected));

  return jsonb_build_object('id', v_id, 'doc_number', v_doc, 'unaccounted', v_unacc,
    'cash_variance', v_cash_variance, 'duplicate', false);
end $$;

-- ============================================================================
-- USERS / SETTINGS (بند 34/68/69)
-- ============================================================================
create or replace function assign_user_role(p_user_id uuid, p_role user_role)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_target record; v_owners integer;
begin
  v_bid := assert_business();
  if not has_perm('users.manage') then
    raise exception 'ليس لديك صلاحية إدارة المستخدمين.' using errcode = '42501';
  end if;
  select * into v_target from profiles where id = p_user_id;
  if not found then raise exception 'المستخدم غير موجود.'; end if;
  if v_target.business_id is not null and v_target.business_id <> v_bid then
    raise exception 'المستخدم ينتمي لنشاط تجاري آخر.';
  end if;
  if v_target.role = 'OWNER' and get_my_role() <> 'OWNER' then
    raise exception 'لا يمكن تعديل حساب المالك إلا بواسطة المالك.';
  end if;
  if v_target.role = 'OWNER' and p_role <> 'OWNER' then
    select count(*) into v_owners from profiles where business_id = v_bid and role = 'OWNER' and active;
    if v_owners <= 1 then raise exception 'لا يمكن إزالة آخر مالك للنظام.'; end if;
  end if;

  update profiles set business_id = v_bid, role = p_role, updated_at = now() where id = p_user_id;
  perform audit('ASSIGN_ROLE','profile', p_user_id, 'UPDATE',
    jsonb_build_object('role', v_target.role), jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create or replace function update_business(p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_old businesses%rowtype;
begin
  v_bid := assert_business();
  if not has_perm('settings.manage') then
    raise exception 'ليس لديك صلاحية تعديل الإعدادات.' using errcode = '42501';
  end if;
  select * into v_old from businesses where id = v_bid;
  update businesses set
    name = coalesce(nullif(p_patch->>'name',''), v_old.name),
    currency = coalesce(nullif(p_patch->>'currency',''), v_old.currency),
    currency_symbol = coalesce(nullif(p_patch->>'currency_symbol',''), v_old.currency_symbol),
    timezone = coalesce(nullif(p_patch->>'timezone',''), v_old.timezone),
    allow_negative_stock = coalesce((p_patch->'allow_negative_stock')::boolean, v_old.allow_negative_stock)
  where id = v_bid;
  perform audit('UPDATE_BUSINESS','business', v_bid, 'UPDATE',
    to_jsonb(v_old), (select to_jsonb(b) from businesses b where b.id = v_bid));
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- DASHBOARD (بند 46/86/87): استعلام واحد — لا N+1
-- ============================================================================
create or replace function get_dashboard_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_bid uuid; v_today date; v_result jsonb;
begin
  v_bid := get_my_business_id();
  if v_bid is null then return jsonb_build_object('error', 'no_business'); end if;
  v_today := business_today();

  select jsonb_build_object(
    'sales_today', coalesce((select sum(total) from sales where business_id = v_bid and sale_date = v_today and status = 'CONFIRMED'), 0),
    'sales_today_count', coalesce((select count(*) from sales where business_id = v_bid and sale_date = v_today and status = 'CONFIRMED'), 0),
    'collections_today', coalesce((select sum(amount) from customer_payments where business_id = v_bid and payment_date = v_today), 0),
    'purchases_today', coalesce((select sum(total) from purchases where business_id = v_bid and purchase_date = v_today and status = 'CONFIRMED'), 0),
    'production_today', coalesce((select sum(material_cost) from production_batches where business_id = v_bid and batch_date = v_today and status = 'CONFIRMED'), 0),
    'expenses_today', coalesce((select sum(amount) from expenses where business_id = v_bid and expense_date = v_today), 0),
    'customer_receivables', coalesce((
      (select sum(total) from sales where business_id = v_bid and payment_type = 'CREDIT' and status = 'CONFIRMED')
      - (select sum(amount) from customer_payments where business_id = v_bid)), 0),
    'supplier_payables', coalesce((
      (select sum(total) from purchases where business_id = v_bid and payment_type = 'CREDIT' and status = 'CONFIRMED')
      - (select sum(amount) from supplier_payments where business_id = v_bid)), 0),
    'inventory_value', coalesce((
      select sum(s.qty * coalesce(p.avg_cost, 0)) from (
        select item_id, warehouse_id,
          sum(case when movement_type in ('PURCHASE_IN','PRODUCTION_IN','SALE_RETURN_IN','ADJUSTMENT_IN','TRANSFER_IN','DISTRIBUTION_RETURN_IN') then quantity else -quantity end) as qty
        from inventory_movements where business_id = v_bid group by item_id, warehouse_id
      ) s join products p on p.id = s.item_id where s.qty > 0), 0),
    'low_stock_count', coalesce((
      select count(*) from (
        select m.item_id,
          sum(case when m.movement_type in ('PURCHASE_IN','PRODUCTION_IN','SALE_RETURN_IN','ADJUSTMENT_IN','TRANSFER_IN','DISTRIBUTION_RETURN_IN') then m.quantity else -m.quantity end) as qty
        from inventory_movements m where m.business_id = v_bid group by m.item_id
      ) st join products p on p.id = st.item_id
      where p.active and p.min_stock > 0 and st.qty < p.min_stock), 0),
    'distribution_open_loads', coalesce((select count(*) from distribution_loads where business_id = v_bid and status in ('OPEN','IN_PROGRESS')), 0),
    'customers_count', coalesce((select count(*) from customers where business_id = v_bid and active), 0),
    'products_count', coalesce((select count(*) from products where business_id = v_bid and active), 0),
    'cash_balance', coalesce((
      (select sum(case when direction = 'IN' then amount else -amount end) from cash_transactions where business_id = v_bid)
    ), 0),
    'date', v_today
  ) into v_result;
  return v_result;
end $$;
