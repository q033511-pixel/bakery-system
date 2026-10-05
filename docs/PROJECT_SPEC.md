# ملخص المواصفة — PROJECT_SPEC.md

ملخص تنفيذي للمواصفة الأصلية (161 بنداً) التي بُني عليها النظام، مع الإشارة لمكان التنفيذ:

| # | البند | التنفيذ |
|---|---|---|
| 1-2 | الهدف والقاعدة الذهبية: كل رصيد من الحركات | Views: v_stock, v_customer/supplier_balances, v_cash_balances |
| 3 | React+TS+Vite، Tailwind RTL عربي، HashRouter، Supabase، Dexie، PWA، GitHub Pages | المشروع كامل |
| 5 | فحص المشروع أولاً | بيئة جديدة — بُني من الصفر بمواصفة الزبون |
| 6 | لا توقف لأسئلة بسيطة؛ افتراضات موثقة | PROJECT_DECISIONS.md |
| 7 | بنية src مع features/services/repositories | src/** (repositories دُمجت في services — قرار موثق) |
| 8-10 | الوحدات: Auth، Dashboard، عملاء، موردون، منتجات (خام/نهائي/تغليف) | features/** |
| 11 | الوحدات والتحويل (كيس=50كغ...) | units + unit_conversions + lib/units |
| 12 | inventory_movements بأنواع الحركة الـ13 | 0001_schema + stock_qty() |
| 13 | مستودعات متعددة | warehouses (RAW/FINISHED/BRANCH...) |
| 14-15 | الشراء المترابط + كشف المورد | create_purchase + get_supplier_statement |
| 16-18 | البيع + منع المخزون السالب (قابل للضبط) + Quick Sale | create_sale + assert_stock_available + features/sales |
| 19-21 | العملاء الآجلون credit_limit + التحصيلات + طرق دفع قابلة للتوسعة | customers + payments |
| 22 | الصندوق cash_accounts/cash_transactions | expense/cash module |
| 23-26 | الإنتاج + الوصفات + Versioning + التكلفة تقديرية | production module + recipe_versions |
| 27-28 | الهالك + المرتجعات | waste_records + حركات مرتجعة |
| 29-31 | التوزيع: محمول=مبيع+مرتجع+فرق + تسوية بلا فروق مبررة | distribution module + settle_distribution_load |
| 32-33 | المصروفات + الموظفون | expenses + employees |
| 34-35 | 8 أدوار + RLS حقيقي | permissions + 0003_rls.sql |
| 36 | business_id قابل للتوسع دون SaaS | كل الجداول التشغيلية |
| 37-38 | Audit Log + VOID بدل الحذف | audit_logs + void_sale/void_purchase |
| 39 | operation_id لكل عملية | processed_operations + قيود UNIQUE |
| 40-43 | Offline queue + كاش مدروس + Sync Engine + تعارضات | db/db.ts + syncEngine |
| 44-45 | معاملات ذرية + RPCs | 0002_functions.sql |
| 46-47 | Dashboard من القاعدة + حالة الاتصال للمستخدم | get_dashboard_summary + SyncStatusBadge |
| 48-50 | تصميم Mobile-First + Bottom Nav/Sidebar + جداول ذكية | components/ui + AppShell |
| 51-53 | شاشات البيع/الشراء + Ledger abstraction | features/sales, purchases + كشوف |
| 54-58 | 11 تقريراً + فترات + فلاتر + CSV + pagination | reports module + 0004_views.sql |
| 59-61 | أداء + Indexes + Data integrity numeric | فهارس شاملة + numeric(14,2/3/4) |
| 62-63 | عملة ILS قابلة للتغيير + timezone-aware | businesses.currency/timezone + business_today() |
| 64-65 | Validation برسائل عربية + ضد double submit | rpc.ts + operation_id + disabled buttons |
| 66-68 | أمان الأسرار + Auth + أول Owner آمن | SECURITY.md + bootstrap_business |
| 69-70 | الإعدادات + ترقيم SAL-2026-000001 | settings + doc_sequences |
| 71-73 | Backup موثق + Seed dev + Migrations versioned | DEPLOYMENT.md + 0005 + supabase/migrations |
| 74-82 | اختبارات RLS والمخزون والعملاء والمورد والتوزيع والأوفلاين والمعاملات | TESTING.md + tests/ + supabase/tests |
| 83-85 | UI States + Accessibility + مصطلحات عربية ثابتة | components/ui/states + aria + لغة موحدة |
| 86-89 | Dashboard من القاعدة بلا N+1 بلا mock بلا خداع | get_dashboard_summary |
| 90-92 | رسائل خطأ معقمة + شارات أوفلاين + بحث سريع | rpc.ts + SyncStatusBadge + SearchSelect |
| 93-97 | Delete policies + تسوية بحركة + WAC + تسعير | void RPCs + avg_cost |
| 98-100 | فروع + مناقلات + Status model | branches + transfers + DocStatus |
| 101-104 | Service layer + Repositories + Types قوية | services/** + types/** |
| 105-108 | TanStack Query + Toasts + Confirmations + منع التكرار | React Query + toast + ConfirmDialog |
| 109-112 | Schema كامل + علاقات + item_type + Ledger | 0001_schema.sql |
| 113 | ربحية تقديرية مع تنبيه | get_profit_report + disclaimer |
| 114 | Security Checklist | SECURITY.md |
| 115-117 | deploy.yml + PWA + أيقونات | .github/workflows + vite-plugin-pwa + public/icons |
| 118-120 | README + ENV + 8 ملفات توثيق | README + docs/** + .env.example |
| 121-123 | 22 مكون + Money/Quantity inputs | components/ui/** |
| 124-125 | Quick Actions + سيناريو يومي كامل قابل للتنفيذ | Dashboard + التدفقات المبنية |
| 126-129 | Acceptance criteria + حالات الاختبار + لا fake data | شفافية في TESTING.md والنهاية |
| 130-135 | جودة كود + أمان تخزين + offline mutation + observability | strict TS + eslint + operation_id في الأخطاء |
| 136-139 | Build validation + static hosting + supabase validation | npm lint/test/build + docs |
| 140-150 | أولوية الدقة + مصدر موحد للحسابات + الأهداف النهائية | ARCHITECTURE.md |
| 151-161 | التنفيذ الكامل + القرارات + التقرير النهائي | هذا المشروع + PROJECT_DECISIONS.md + تقرير التسليم |
