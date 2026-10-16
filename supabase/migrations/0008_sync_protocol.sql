-- ============================================================================
-- 0008_sync_protocol.sql — بروتوكول المزامنة المركزية (تجربة الخطة B)
-- ---------------------------------------------------------------------------
-- المبدأ: الخادم هو المرجع النهائي. كل عملية من جهاز تمر عبر:
--   submit_sync_operation → فحص هوية الجهاز → منع تكرار operation_id →
--   تنفيذ الدالة المالية المصرّفة داخل معاملة + savepoint →
--   APPROVED (مع النتيجة) أو REJECTED (مع سبب عربي مفهوم).
-- لا last-write-wins على المال: الفاتورة إما تُعتمد كاملة أو تُرفض كاملة.
--
-- السحب: pull_changes بترتيب seq — كل جهاز يحفظ آخر seq سحبه محلياً.
-- ============================================================================

create table if not exists sync_queue (
  seq bigint generated always as identity primary key,
  operation_id uuid not null unique,
  business_id uuid not null references businesses(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  op_type text not null,
  payload jsonb not null,
  status text not null check (status in ('APPROVED','REJECTED','CONFLICT')),
  result jsonb,
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz not null default now(),
  client_recorded_at timestamptz,
  schema_version integer not null default 1
);
create index if not exists idx_sync_queue_pull on sync_queue(business_id, seq);
create index if not exists idx_sync_queue_status on sync_queue(business_id, status);

-- ---------- عمليات الكيانات المرجعية (عميل/مورد/صنف/سعر خاص) ----------
-- هذه كيانات وصفية: إنشاء/تعديل عبر upsert مع تحقق صلاحية. المال لا يمر من هنا.
-- تعارض تعديل متزامن: آخر إرسال معتمد يفوز على البيانات الوصفية فقط + سجل تدقيق
-- (السياسة المعتمدة في SYNC_ARCHITECTURE_DECISION.md — لا يخص الفواتير والدفعات)
create or replace function apply_customer_upsert(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_id uuid; v_op uuid;
begin
  v_bid := assert_business();
  perform assert_perm('customers.manage');
  v_id := (p_payload->>'id')::uuid;
  v_op := (p_payload->>'operation_id')::uuid;
  insert into customers(id, business_id, code, name, phone, area, salesperson,
      credit_limit, payment_terms_days, opening_balance, notes, active)
  values (v_id, v_bid, p_payload->>'code', p_payload->>'name', nullif(p_payload->>'phone',''),
      nullif(p_payload->>'area',''), nullif(p_payload->>'salesperson',''),
      coalesce((p_payload->>'credit_limit')::numeric,0), coalesce((p_payload->>'payment_terms_days')::int,0),
      coalesce((p_payload->>'opening_balance')::numeric,0), nullif(p_payload->>'notes',''),
      coalesce((p_payload->>'active')::boolean, true))
  on conflict (id) do update set
    code = excluded.code, name = excluded.name, phone = excluded.phone, area = excluded.area,
    salesperson = excluded.salesperson, credit_limit = excluded.credit_limit,
    payment_terms_days = excluded.payment_terms_days, opening_balance = excluded.opening_balance,
    notes = excluded.notes, active = excluded.active, updated_at = now();
  perform audit('SYNC_CUSTOMER_UPSERT','customer', v_id, 'UPSERT', null,
    jsonb_build_object('operation_id', v_op, 'name', p_payload->>'name'));
  return jsonb_build_object('id', v_id, 'entity', 'customers', 'duplicate', false);
end $$;

create or replace function apply_supplier_upsert(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_id uuid;
begin
  v_bid := assert_business();
  perform assert_perm('purchases.manage');
  v_id := (p_payload->>'id')::uuid;
  insert into suppliers(id, business_id, code, name, phone, address, notes, active)
  values (v_id, v_bid, p_payload->>'code', p_payload->>'name', nullif(p_payload->>'phone',''),
      nullif(p_payload->>'address',''), nullif(p_payload->>'notes',''),
      coalesce((p_payload->>'active')::boolean, true))
  on conflict (id) do update set
    code = excluded.code, name = excluded.name, phone = excluded.phone,
    address = excluded.address, notes = excluded.notes, active = excluded.active, updated_at = now();
  perform audit('SYNC_SUPPLIER_UPSERT','supplier', v_id, 'UPSERT', null, null);
  return jsonb_build_object('id', v_id, 'entity', 'suppliers', 'duplicate', false);
end $$;

create or replace function apply_product_upsert(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_id uuid;
begin
  v_bid := assert_business();
  perform assert_perm('products.manage');
  v_id := (p_payload->>'id')::uuid;
  insert into products(id, business_id, code, name, item_type, base_unit_id, sales_unit_id,
      sale_price, default_cost, min_stock, active)
  values (v_id, v_bid, p_payload->>'code', p_payload->>'name',
      (p_payload->>'item_type')::item_type,
      (p_payload->>'base_unit_id')::uuid, nullif(p_payload->>'sales_unit_id','')::uuid,
      coalesce((p_payload->>'sale_price')::numeric,0), coalesce((p_payload->>'default_cost')::numeric,0),
      coalesce((p_payload->>'min_stock')::numeric,0), coalesce((p_payload->>'active')::boolean, true))
  on conflict (id) do update set
    code = excluded.code, name = excluded.name, item_type = excluded.item_type,
    base_unit_id = excluded.base_unit_id, sales_unit_id = excluded.sales_unit_id,
    sale_price = excluded.sale_price, default_cost = excluded.default_cost,
    min_stock = excluded.min_stock, active = excluded.active, updated_at = now();
  perform audit('SYNC_PRODUCT_UPSERT','product', v_id, 'UPSERT', null, null);
  return jsonb_build_object('id', v_id, 'entity', 'products', 'duplicate', false);
end $$;

create or replace function apply_customer_price_upsert(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_id uuid;
begin
  v_bid := assert_business();
  perform assert_perm('customers.manage');
  v_id := (p_payload->>'id')::uuid;
  insert into customer_products(id, business_id, customer_id, product_id, unit_id, price, start_date, end_date, active)
  values (v_id, v_bid, (p_payload->>'customer_id')::uuid, (p_payload->>'product_id')::uuid,
      nullif(p_payload->>'unit_id','')::uuid, (p_payload->>'price')::numeric,
      nullif(p_payload->>'start_date','')::date, nullif(p_payload->>'end_date','')::date,
      coalesce((p_payload->>'active')::boolean, true))
  on conflict (id) do update set
    price = excluded.price, start_date = excluded.start_date, end_date = excluded.end_date,
    active = excluded.active, updated_at = now();
  perform audit('SYNC_CUSTOMER_PRICE_UPSERT','customer_product', v_id, 'UPSERT', null, null);
  return jsonb_build_object('id', v_id, 'entity', 'customer_products', 'duplicate', false);
end $$;

-- ---------- تنفيذ عملية متزامنة (المدخل الوحيد للأجهزة) ----------
create or replace function submit_sync_operation(
  p_operation_id uuid, p_op_type text, p_payload jsonb,
  p_client_recorded_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dev devices; v_bid uuid; v_existing record; v_result jsonb;
  v_err_sqlstate text; v_err_message text;
begin
  -- 1) هوية مزدوجة: إنسان (JWT) + آلة (رمز جهاز صالح)
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;
  v_dev := assert_device();
  v_bid := v_dev.business_id;
  perform touch_device_last_seen();

  -- 2) منع التكرار بقيد فريد + فحص مسبق (idempotency بند 39)
  select seq, status, result, rejection_reason into v_existing
    from sync_queue where operation_id = p_operation_id;
  if found then
    if v_existing.status = 'APPROVED' then
      return jsonb_build_object('status','DUPLICATE','operation_id', p_operation_id,
        'seq', v_existing.seq, 'result', v_existing.result, 'duplicate', true);
    else
      return jsonb_build_object('status', v_existing.status, 'operation_id', p_operation_id,
        'seq', v_existing.seq, 'rejection_reason', v_existing.rejection_reason, 'duplicate', true);
    end if;
  end if;

  -- 3) التنفيذ داخل كتلة استثناء — أي فشل يتراجع آثار العملية بالكامل
  --    (كتلة BEGIN/EXCEPTION = معاملة فرعية ضمنية في plpgsql)
  begin
    case p_op_type
      when 'CUSTOMER_UPSERT'  then v_result := apply_customer_upsert(p_payload);
      when 'SUPPLIER_UPSERT'  then v_result := apply_supplier_upsert(p_payload);
      when 'PRODUCT_UPSERT'   then v_result := apply_product_upsert(p_payload);
      when 'CUSTOMER_PRICE_UPSERT' then v_result := apply_customer_price_upsert(p_payload);
      when 'SALE'             then v_result := create_sale(p_payload);
      when 'SALE_VOID'        then v_result := void_sale((p_payload->>'sale_id')::uuid, p_payload->>'reason');
      when 'PURCHASE'         then v_result := create_purchase(p_payload);
      when 'PURCHASE_VOID'    then v_result := void_purchase((p_payload->>'purchase_id')::uuid, p_payload->>'reason');
      when 'CUSTOMER_PAYMENT' then v_result := create_customer_payment(p_payload);
      when 'SUPPLIER_PAYMENT' then v_result := create_supplier_payment(p_payload);
      when 'EXPENSE'          then v_result := create_expense(p_payload);
      when 'PRODUCTION_BATCH' then v_result := create_production_batch(p_payload);
      when 'INVENTORY_ADJUSTMENT' then v_result := create_inventory_adjustment(p_payload);
      when 'WASTE'            then v_result := create_waste(p_payload);
      when 'TRANSFER'         then v_result := create_transfer(p_payload);
      else
        raise exception 'نوع عملية غير معروف للمزامنة: %', p_op_type using errcode = '22023';
    end case;

    insert into sync_queue(operation_id, business_id, device_id, op_type, payload,
        status, result, client_recorded_at)
    values (p_operation_id, v_bid, v_dev.id, p_op_type, p_payload,
        'APPROVED', v_result, p_client_recorded_at);

    return jsonb_build_object('status','APPROVED','operation_id', p_operation_id,
      'result', v_result);
  exception when others then
    get stacked diagnostics v_err_sqlstate = RETURNED_SQLSTATE,
                            v_err_message = MESSAGE_TEXT;
    -- آثار العملية الفاشلة تُراجعت تلقائياً بالكامل عند دخول المعالج
    -- أثر العملية المرفوض = صف حالة فقط (لا أثر مالي إطلاقاً)
    insert into sync_queue(operation_id, business_id, device_id, op_type, payload,
        status, rejection_reason, client_recorded_at)
    values (p_operation_id, v_bid, v_dev.id, p_op_type, p_payload,
        'REJECTED', v_err_message, p_client_recorded_at);
    return jsonb_build_object('status','REJECTED','operation_id', p_operation_id,
      'rejection_reason', v_err_message);
  end;
end $$;

-- ---------- سحب التغييرات المعتمدة (لكل الأجهزة، منذ آخر seq) ----------
create or replace function pull_changes(p_since_seq bigint default 0, p_limit integer default 500)
returns table (
  seq bigint, operation_id uuid, device_id uuid, op_type text,
  payload jsonb, status text, rejection_reason text,
  submitted_at timestamptz, result jsonb
)
language sql stable security definer set search_path = public as $$
  select q.seq, q.operation_id, q.device_id, q.op_type, q.payload,
         q.status, q.rejection_reason, q.submitted_at, q.result
    from sync_queue q
   where q.business_id = get_my_business_id()
     and q.seq > coalesce(p_since_seq, 0)
   order by q.seq
   limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

-- ---------- إحصاء حالة المزامنة للوحة الجهاز ----------
create or replace function sync_status_summary()
returns table (approved bigint, rejected bigint, last_seq bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where status = 'APPROVED'),
    count(*) filter (where status = 'REJECTED'),
    coalesce(max(seq), 0)
  from sync_queue where business_id = get_my_business_id();
$$;

-- ---------- RLS على sync_queue ----------
alter table sync_queue enable row level security;

create policy sync_queue_select_members on sync_queue
for select to authenticated
using (business_id = get_my_business_id());

-- الإدخال والحذف المباشر محظور — كل شيء عبر submit_sync_operation
grant execute on function submit_sync_operation(uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function pull_changes(bigint,integer) to authenticated;
grant execute on function sync_status_summary() to authenticated;
grant execute on function apply_customer_upsert(jsonb), apply_supplier_upsert(jsonb),
  apply_product_upsert(jsonb), apply_customer_price_upsert(jsonb) to authenticated;

-- أصغر صلاحية: الزائر المجهول لا ينفّذ أي وظيفة مزامنة
-- (افتراضي PostgreSQL يمنح EXECUTE لـ public — يُسحب صراحةً هنا)
revoke execute on function submit_sync_operation(uuid,text,jsonb,timestamptz) from anon, public;
revoke execute on function pull_changes(bigint,integer) from anon, public;
revoke execute on function sync_status_summary() from anon, public;
revoke execute on function apply_customer_upsert(jsonb), apply_supplier_upsert(jsonb),
  apply_product_upsert(jsonb), apply_customer_price_upsert(jsonb) from anon, public;

revoke insert, update, delete, truncate on sync_queue from authenticated;
revoke all on sync_queue from anon;
