-- ============================================================================
-- اختبارات قاعدة البيانات (بند 74-79/82/139) — سيناريوهات المواصفة كاملة
-- التشغيل: بعد migrations + bootstrap_business (تسجيل الدخول كمالك):
--   select run_bakery_ledger_tests();
-- من SQL Editor في Supabase أو psql بجلسة مالك النظام.
-- كل اختبار يفشل صراحةً برسالة عربية واضحة إن لم يتحقق الشرط.
-- ============================================================================

create or replace function test_assert(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not condition then
    raise exception '❌ TEST FAILED: %', message;
  end if;
end $$;

create or replace function run_bakery_ledger_tests()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_bid uuid; v_flour uuid; v_bread uuid; v_kg uuid; v_piece uuid;
  v_sup uuid; v_wh_fin uuid; v_wh_raw uuid; v_cash uuid; v_cat uuid;
  v_customer uuid; v_recipe uuid; v_rv uuid;
  v_stock numeric; v_res jsonb;
  v_op uuid := '11111111-1111-1111-1111-111111111111';
begin
  v_bid := get_my_business_id();
  perform test_assert(v_bid is not null, 'يجب تهيئة النظام أولاً (bootstrap_business)');

  select id into v_kg from units where business_id = v_bid and symbol = 'كغ';
  select id into v_piece from units where business_id = v_bid and symbol = 'قطعة';
  select id into v_wh_raw from warehouses where business_id = v_bid and kind = 'RAW';
  select id into v_wh_fin from warehouses where business_id = v_bid and kind = 'FINISHED';
  select id into v_cash from cash_accounts where business_id = v_bid and is_default;
  select id into v_cat from product_categories where business_id = v_bid and name = 'مواد خام';

  -- أصناف الاختبار
  insert into products(business_id, code, name, item_type, category_id, base_unit_id, avg_cost, min_stock)
  values (v_bid, 'T-RM', 'طحين اختبار', 'RAW_MATERIAL', v_cat, v_kg, 2, 0)
  returning id into v_flour;
  insert into products(business_id, code, name, item_type, base_unit_id, sale_price, avg_cost)
  values (v_bid, 'T-FP', 'خبز اختبار', 'FINISHED_PRODUCT', v_piece, 1, 0.5)
  returning id into v_bread;
  insert into suppliers(business_id, code, name) values (v_bid, 'T-SU', 'مورد اختبار')
  returning id into v_sup;
  insert into customers(business_id, code, name) values (v_bid, 'T-CU', 'عميل اختبار')
  returning id into v_customer;

  -- [بند 76] المخزون: +100 تسوية، +50 شراء، -20 بيع، -5 هالك، +3 مرتجع = 128
  perform create_inventory_adjustment(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'product_id', v_flour, 'warehouse_id', v_wh_raw,
    'direction', 'IN', 'quantity', 100, 'unit_id', v_kg, 'reason', 'رصيد افتتاحي اختبار'));
  perform create_purchase(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'supplier_id', v_sup, 'warehouse_id', v_wh_raw,
    'purchase_date', business_today(), 'items', jsonb_build_array(
      jsonb_build_object('product_id', v_flour, 'quantity', 50, 'unit_id', v_kg, 'unit_price', 2.5)),
    'discount', 0, 'payment_type', 'CASH'));
  perform create_sale(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'warehouse_id', v_wh_raw, 'sale_date', business_today(),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_flour, 'quantity', 20, 'unit_id', v_kg, 'unit_price', 3)),
    'discount', 0, 'payment_type', 'CASH'));
  perform create_waste(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'product_id', v_flour, 'warehouse_id', v_wh_raw,
    'quantity', 5, 'unit_id', v_kg, 'reason', 'هالك اختبار'));
  insert into inventory_movements(business_id, item_id, item_type, warehouse_id, movement_type,
    quantity, input_quantity, input_unit_id, reference_type, created_by)
  values (v_bid, v_flour, 'RAW_MATERIAL', v_wh_raw, 'SALE_RETURN_IN', 3, 3, v_kg, 'TEST', auth.uid());

  select stock_qty(v_flour, v_wh_raw) into v_stock;
  perform test_assert(v_stock = 128, format('[بند76] سيناريو المخزون: المتوقع 128 الفعلي %s', v_stock));

  -- رصيد افتتاحي للخبز لاختبار البيع الآجل
  perform create_inventory_adjustment(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'product_id', v_bread, 'warehouse_id', v_wh_fin,
    'direction', 'IN', 'quantity', 5000, 'unit_id', v_piece, 'reason', 'رصيد افتتاحي اختبار'));

  -- [بند 77] العميل: بيع آجل 1000 + 700، تحصيل 500 + 300 → رصيد 900
  perform create_sale(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'customer_id', v_customer, 'warehouse_id', v_wh_fin,
    'sale_date', business_today(), 'items', jsonb_build_array(
      jsonb_build_object('product_id', v_bread, 'quantity', 1000, 'unit_id', v_piece, 'unit_price', 1)),
    'discount', 0, 'payment_type', 'CREDIT'));
  perform create_sale(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'customer_id', v_customer, 'warehouse_id', v_wh_fin,
    'sale_date', business_today(), 'items', jsonb_build_array(
      jsonb_build_object('product_id', v_bread, 'quantity', 700, 'unit_id', v_piece, 'unit_price', 1)),
    'discount', 0, 'payment_type', 'CREDIT'));
  perform create_customer_payment(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'party_id', v_customer, 'amount', 500, 'payment_method', 'CASH'));
  perform create_customer_payment(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'party_id', v_customer, 'amount', 300, 'payment_method', 'CASH'));

  select balance into v_stock from v_customer_balances where customer_id = v_customer;
  perform test_assert(v_stock = 900, format('[بند77] سيناريو العميل: المتوقع 900 الفعلي %s', v_stock));

  -- [بند 78] المورد: شراء آجل 3500، دفعة 2000، شراء 1100، دفعة 1500 → 1100
  perform create_purchase(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'supplier_id', v_sup, 'warehouse_id', v_wh_raw,
    'purchase_date', business_today(), 'items', jsonb_build_array(
      jsonb_build_object('product_id', v_flour, 'quantity', 1400, 'unit_id', v_kg, 'unit_price', 2.5)),
    'discount', 0, 'payment_type', 'CREDIT'));  -- 3500
  perform create_supplier_payment(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'party_id', v_sup, 'amount', 2000, 'payment_method', 'CASH'));
  perform create_purchase(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'supplier_id', v_sup, 'warehouse_id', v_wh_raw,
    'purchase_date', business_today(), 'items', jsonb_build_array(
      jsonb_build_object('product_id', v_flour, 'quantity', 440, 'unit_id', v_kg, 'unit_price', 2.5)),
    'discount', 0, 'payment_type', 'CREDIT'));  -- 1100
  perform create_supplier_payment(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'party_id', v_sup, 'amount', 1500, 'payment_method', 'CASH'));

  select balance into v_stock from v_supplier_balances where supplier_id = v_sup;
  perform test_assert(v_stock = 1100, format('[بند78] سيناريو المورد: المتوقع 1100 الفعلي %s', v_stock));

  -- [بند 80] الإنتاج: وصفة 1000 قطعة تحتاج 700 كغ طحين
  -- الطحين الآن: 128 + 1400 + 440 = 1968
  insert into recipes(business_id, product_id, name)
  values (v_bid, v_bread, 'وصفة اختبار') returning id into v_recipe;
  insert into recipe_versions(business_id, recipe_id, version_no, output_quantity, output_unit_id)
  values (v_bid, v_recipe, 1, 1000, v_piece) returning id into v_rv;
  insert into recipe_items(recipe_version_id, material_id, quantity, unit_id)
  values (v_rv, v_flour, 700, v_kg);

  perform create_production_batch(jsonb_build_object(
    'operation_id', gen_random_uuid(), 'product_id', v_bread, 'warehouse_id', v_wh_fin,
    'recipe_version_id', v_rv, 'quantity', 1000, 'unit_id', v_piece,
    'batch_date', business_today()));

  select stock_qty(v_flour, v_wh_raw) into v_stock;
  perform test_assert(v_stock = 1268, format('[بند80] الطحين بعد الإنتاج: المتوقع 1268 الفعلي %s', v_stock));
  select stock_qty(v_bread, v_wh_fin) into v_stock;
  perform test_assert(v_stock = 4300, format('[بند80] الخبز بعد الإنتاج: المتوقع 4300 الفعلي %s', v_stock));

  -- [بند 17/127] منع البيع من مخزون غير متوفر
  begin
    perform create_sale(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'warehouse_id', v_wh_fin, 'sale_date', business_today(),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_bread, 'quantity', 999999, 'unit_id', v_piece, 'unit_price', 1)),
      'discount', 0, 'payment_type', 'CASH'));
    perform test_assert(false, '[بند17] كان يجب رفض البيع من مخزون غير متوفر');
  exception when others then
    if sqlerrm not like 'الكمية المطلوبة أكبر من الرصيد%' then
      perform test_assert(false, '[بند17] رسالة الرفض غير صحيحة: ' || sqlerrm);
    end if;
  end;

  -- [بند 39/108] Idempotency: نفس operation_id لا يكرر البيع
  v_res := create_sale(jsonb_build_object(
    'operation_id', v_op, 'warehouse_id', v_wh_fin, 'sale_date', business_today(),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_bread, 'quantity', 10, 'unit_id', v_piece, 'unit_price', 1)),
    'discount', 0, 'payment_type', 'CASH'));
  perform test_assert((v_res->>'duplicate') is null, '[بند39] أول تنفيذ ليس مكرراً');
  v_res := create_sale(jsonb_build_object(
    'operation_id', v_op, 'warehouse_id', v_wh_fin, 'sale_date', business_today(),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_bread, 'quantity', 10, 'unit_id', v_piece, 'unit_price', 1)),
    'discount', 0, 'payment_type', 'CASH'));
  perform test_assert((v_res->>'duplicate')::boolean, '[بند39] التنفيذ الثاني يجب أن يعيد duplicate=true');
  select count(*) into v_stock from sales where operation_id = v_op;
  perform test_assert(v_stock = 1, format('[بند39] فاتورة واحدة فقط لكل operation_id (الفعلي %s)', v_stock));

  -- [بند 82] سلامة المعاملات: البيع المرفوض لا يترك فاتورة بدون حركات
  select count(*) into v_stock from sales s
  where s.business_id = v_bid
    and not exists(select 1 from sale_items si where si.sale_id = s.id);
  perform test_assert(v_stock = 0, '[بند82] لا فاتورة بدون أصناف');

  return '✅ ALL DATABASE LEDGER TESTS PASSED';
end $$;

-- التشغيل (جلسة مالك النظام):
-- select run_bakery_ledger_tests();
