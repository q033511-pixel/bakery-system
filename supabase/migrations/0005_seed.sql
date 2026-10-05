-- ============================================================================
-- 0005_seed.sql — بيانات تجريبية لبيئة التطوير فقط (بند 72)
-- ⚠️ لا تُنفّذ في Production. تعمل بعد bootstrap_business فقط، وتتخطى نفسها
-- تلقائياً إذا كانت البيانات موجودة. تُطبّق عبر: supabase db reset أو يدوياً.
-- ============================================================================

do $$
declare
  v_bid uuid;
  v_flour uuid; v_yeast uuid; v_salt uuid; v_oil uuid; v_bags uuid;
  v_bread uuid; v_saj uuid;
  v_kg uuid; v_g uuid; v_l uuid; v_bag_u uuid; v_piece uuid; v_bundle uuid;
  v_wh_raw uuid; v_wh_fin uuid;
  v_cash uuid;
  v_cat_bread uuid; v_cat_raw uuid;
  v_recipe_v uuid;
begin
  select id into v_bid from businesses order by created_at limit 1;
  if v_bid is null then
    raise notice 'لا يوجد نشاط تجاري — شغّل bootstrap أولاً. تخطي الـseed.';
    return;
  end if;

  -- منع تكرار الـseed
  if exists(select 1 from products where business_id = v_bid) then
    raise notice 'البيانات موجودة مسبقاً — تخطي الـseed.';
    return;
  end if;

  select id into v_kg from units where business_id = v_bid and symbol = 'كغ';
  select id into v_g from units where business_id = v_bid and symbol = 'غ';
  select id into v_l from units where business_id = v_bid and symbol = 'ل';
  select id into v_bag_u from units where business_id = v_bid and symbol = 'كيس';
  select id into v_piece from units where business_id = v_bid and symbol = 'قطعة';
  select id into v_bundle from units where business_id = v_bid and symbol = 'ربطة';
  select id into v_wh_raw from warehouses where business_id = v_bid and kind = 'RAW';
  select id into v_wh_fin from warehouses where business_id = v_bid and kind = 'FINISHED';
  select id into v_cash from cash_accounts where business_id = v_bid and is_default;
  select id into v_cat_bread from product_categories where business_id = v_bid and name = 'خبز';
  select id into v_cat_raw from product_categories where business_id = v_bid and name = 'مواد خام';

  -- مواد خام
  insert into products(business_id, code, name, item_type, category_id, base_unit_id, sale_price, default_cost, avg_cost, min_stock)
  values (v_bid,'RM-001','طحين','RAW_MATERIAL',v_cat_raw,v_kg,0,2.50,2.50,200)
  returning id into v_flour;
  insert into products(business_id, code, name, item_type, category_id, base_unit_id, sale_price, default_cost, avg_cost, min_stock)
  values (v_bid,'RM-002','خميرة','RAW_MATERIAL',v_cat_raw,v_kg,0,8.00,8.00,10)
  returning id into v_yeast;
  insert into products(business_id, code, name, item_type, category_id, base_unit_id, sale_price, default_cost, avg_cost, min_stock)
  values (v_bid,'RM-003','ملح','RAW_MATERIAL',v_cat_raw,v_kg,0,1.20,1.20,5)
  returning id into v_salt;
  insert into products(business_id, code, name, item_type, category_id, base_unit_id, sale_price, default_cost, avg_cost, min_stock)
  values (v_bid,'RM-004','زيت','RAW_MATERIAL',v_cat_raw,v_l,0,6.00,6.00,20)
  returning id into v_oil;
  insert into products(business_id, code, name, item_type, category_id, base_unit_id, sale_price, default_cost, avg_cost, min_stock)
  values (v_bid,'PK-001','أكياس تغليف','PACKAGING',v_cat_raw,v_piece,0,0.10,0.10,500)
  returning id into v_bags;

  -- منتجات نهائية
  insert into products(business_id, code, name, item_type, category_id, base_unit_id, sales_unit_id, sale_price, default_cost, min_stock)
  values (v_bid,'FP-001','خبز عربي','FINISHED_PRODUCT',v_cat_bread,v_piece,v_bundle,0.30,0.12,0)
  returning id into v_bread;
  insert into products(business_id, code, name, item_type, category_id, base_unit_id, sales_unit_id, sale_price, default_cost, min_stock)
  values (v_bid,'FP-002','خبز صاج','FINISHED_PRODUCT',v_cat_bread,v_piece,v_bundle,0.40,0.15,0)
  returning id into v_saj;

  -- وصفة: 1000 قطعة خبز عربي تحتاج طحين 700 كغ + خميرة 15 كغ + ملح 10 كغ + زيت 20 لتر
  insert into recipes(business_id, product_id, name)
  values (v_bid, v_bread, 'وصفة خبز عربي القياسية')
  returning id into v_recipe_v;
  -- v_recipe_v هنا هو recipe id — أنشئ النسخة:
  insert into recipe_versions(business_id, recipe_id, version_no, output_quantity, output_unit_id, notes)
  values (v_bid, v_recipe_v, 1, 1000, v_piece, 'النسخة الأولى')
  returning id into v_recipe_v;

  insert into recipe_items(recipe_version_id, material_id, quantity, unit_id) values
    (v_recipe_v, v_flour, 700, v_kg),
    (v_recipe_v, v_yeast, 15, v_kg),
    (v_recipe_v, v_salt, 10, v_kg),
    (v_recipe_v, v_oil, 20, v_l);

  -- عملاء
  insert into customers(business_id, code, name, phone, area, credit_limit, payment_terms_days) values
    (v_bid,'CU-001','بقالة النور','0599000001','المنطقة الشرقية',2000,7),
    (v_bid,'CU-002','مطعم الأصيل','0599000002','وسط البلد',5000,15),
    (v_bid,'CU-003','سوق الحي','0599000003','المنطقة الغربية',1000,0);

  -- موردين
  insert into suppliers(business_id, code, name, phone, address) values
    (v_bid,'SU-001','مطحنة الفروز','042000001','المنطقة الصناعية'),
    (v_bid,'SU-002','شركة الزيوت المتحدة','042000002','المنطقة الصناعية');

  -- سيارات وسائقون
  insert into vehicles(business_id, code, name, plate) values
    (v_bid,'VH-01','سيارة التوزيع 01','123-45'),
    (v_bid,'VH-02','سيارة التوزيع 02','678-90');
  insert into drivers(business_id, name, phone) values
    (v_bid,'أحمد الموزع','0599111111'),
    (v_bid,'خالد الموزع','0599222222');

  -- موظفون
  insert into employees(business_id, name, phone, role) values
    (v_bid,'أحمد الموزع','0599111111','موزع'),
    (v_bid,'سامر العجّان','0599333333','عجّان'),
    (v_bid,'يوسف الخبّاز','0599444444','خبّاز');

  raise notice 'تم تطبيق الـseed التجريبي بنجاح.';
end $$;
