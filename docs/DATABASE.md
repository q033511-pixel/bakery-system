# قاعدة البيانات — DATABASE.md

## نظرة عامة

PostgreSQL 15 عبر Supabase. الانتقال من قاعدة فارغة إلى نظام كامل عبر Migrations مرقمة versioned (بند 73):

| الملف | المحتوى |
|---|---|
| `0001_schema.sql` | Enums + 40 جدول + قيود + فهارس |
| `0002_functions.sql` | دوال المساعدة + 15 RPC معاملية + bootstrap |
| `0003_rls.sql` | تفعيل RLS على كل الجداول + السياسات |
| `0004_views.sql` | Views + 14 دالة تقارير وكشوف |
| `0005_seed.sql` | بيانات تطوير فقط (لا إنتاج) |

## الجداول الرئيسية

### الهوية والإعدادات
- `businesses` — النشاط: العملة (ILS/₪ افتراضياً)، timezone، سياسة المخزون السالب
- `profiles` — المستخدمون: role (9 قيم) + business_id (PENDING = بانتظار تفعيل المالك)
- `branches`, `warehouses`, `app_settings`, `system_setup` (رمز تهيئة أول مالك — بلا RLS policies فلا يُقرأ من العميل)

### البيانات الرئيسية
- `products` (item_type: RAW_MATERIAL | FINISHED_PRODUCT | PACKAGING) — sale_price / default_cost / **avg_cost** (مرجحة) / last_purchase_cost / min_stock
- `units` + `unit_conversions` — مثال: 1 كيس = 50 كغ
- `customers`, `suppliers`, `employees`, `product_categories`, `expense_categories`, `cash_accounts`, `vehicles`, `drivers`

### الإنتاج
- `recipes` → `recipe_versions` (إصدارات: الإنتاج القديم يحتفظ بنسخته) → `recipe_items`
- `production_batches` + `production_consumption` (يحفظ تكلفة المواد لحظة الإنتاج)

### المالية والتشغيل
- `inventory_movements` — **الجدول المحوري**: 13 نوع حركة (enum movement_type)، الكمية دائماً موجبة والاتجاه من النوع، quantity بالوحدة الأساسية + input_quantity/input_unit_id للعرض
- `purchases`/`purchase_items`, `sales`/`sale_items` (channel: DIRECT|DISTRIBUTION + load_id), `customer_payments`, `supplier_payments`
- `inventory_adjustments`, `waste_records`, `transfers`/`transfer_items`
- `distribution_loads`/`items`/`deliveries`/`returns`/`settlements` (التسوية تحفظ product_breakdown jsonb)
- `cash_transactions` (direction IN/OUT مرتبط بكل عملية), `audit_logs`, `doc_sequences`, `processed_operations` (idempotency)

## العلاقات الأساسية

```
customers  ──< sales ──< sale_items >── products ──< inventory_movements
suppliers  ──< purchases ──< purchase_items
recipes ──< recipe_versions ──< recipe_items
production_batches ──< production_consumption
vehicles ──< distribution_loads ──< items/deliveries/returns ──1:1── settlements
```

## دوال RPC المعاملية (SECURITY DEFINER)

| الدالة | الوظيفة | الصلاحية |
|---|---|---|
| `bootstrap_business` | إنشاء النشاط + أول OWNER + الافتراضيات | مرة واحدة برمز تهيئة |
| `create_sale` | بيع: فاتورة+أصناف+مخزون+نقدية+audit | sales.manage |
| `void_sale` | إلغاء بيع بحركات عكسية | sales.void |
| `create_purchase` | شراء + تحديث التكلفة المرجحة | purchases.manage |
| `void_purchase` | إلغاء شراء بحركات عكسية | purchases.void |
| `create_customer_payment` / `create_supplier_payment` | تحصيل/دفعة + حركة صندوق | payments.manage |
| `create_production_batch` | إنتاج: استهلاك المواد + إدخال المنتج | production.manage |
| `create_expense` | مصروف + حركة صندوق | expenses.manage |
| `create_inventory_adjustment` / `create_waste` | تسوية/هالك بحركة موثقة | inventory.adjust / waste |
| `create_transfer` | مناقلة بين مستودعين | inventory.transfer |
| `create_distribution_load` / `record_distribution_delivery` / `record_distribution_return` / `settle_distribution_load` | دورة التوزيع كاملة | distribution.manage / settle |
| `assign_user_role` | تفعيل وتعيين دور مستخدم | users.manage |
| `update_business` / `update_my_profile` | إعدادات النشاط / الاسم الشخصي | settings.manage / أي مستخدم |
| `get_dashboard_summary` | كل مؤشرات اللوحة في استدعاء واحد | أي عضو |

## التقارير (0004)

Views: `v_stock`, `v_customer_balances`, `v_supplier_balances`, `v_cash_balances`.
RPCs: `get_sales_report`, `get_sales_daily_summary`, `get_purchases_report`, `get_inventory_report`, `get_movements_report`, `get_production_report`, `get_expenses_report`, `get_cash_report`, `get_distribution_report`, `get_customers_report`, `get_suppliers_report`, `get_profit_report`, `get_customer_statement`, `get_supplier_statement`, `get_audit_logs`.

## الترقيم (بند 70)

`doc_sequences` بمفتاح (business, prefix, year) + `ON CONFLICT DO UPDATE ... RETURNING` — ذري:
`SAL-2026-000001`, `PUR-…`, `PAY-…`, `SPAY-…`, `PRO-…`, `EXP-…`, `ADJ-…`, `WST-…`, `TRF-…`, `LOD-…`, `STL-…`.

## الدقة والسلامة (بند 61/63)

- الأموال `numeric(14,2)`، الكميات `numeric(14,3)`، تكلفة الوحدة `numeric(14,4)` — **لا floating point**.
- Timestamps `timestamptz` + `business_today()` يحترم timezone النشاط.
- Foreign keys + CHECK (الكميات موجبة، الخصم ≤ الإجمالي) + UNIQUE (business+code، business+doc_number، operation_id).
