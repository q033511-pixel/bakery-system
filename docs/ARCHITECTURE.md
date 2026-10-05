# المعمارية — ARCHITECTURE.md

## نظرة عامة

نظام SPA ثلاثي الطبقات فوق Supabase، مصمم من البداية لـ**Offline-First** و**سلامة البيانات المالية**:

```
┌─────────────────────────────────────────────────┐
│ UI Layer (React + Tailwind, RTL, Mobile-First)  │
│   20 وحدة تشغيلية + kit مكونات مشترك            │
├─────────────────────────────────────────────────┤
│ Service Layer                                    │
│   operations (registry) | auth | lookups | rpc  │
│   syncEngine: enqueue → drain → retry/dedupe    │
├──────────────────────┬──────────────────────────┤
│ Online: Supabase RPC │ Offline: Dexie queue      │
│ (معاملات ذرية)       │ (IndexedDB, idempotent)  │
├──────────────────────┴──────────────────────────┤
│ PostgreSQL: schema + RLS + SECURITY DEFINER RPCs │
└─────────────────────────────────────────────────┘
```

## القرارات المعمارية الأساسية

### 1. كل رقم له أصل حركة (بند 2)
- رصيد العميل = Σ(مبيعات آجلة) − Σ(تحصيلات) — View: `v_customer_balances`
- رصيد المورد = Σ(مشتريات آجلة) − Σ(دفعات) — View: `v_supplier_balances`
- رصيد الصندوق = Σ(IN) − Σ(OUT) — View: `v_cash_balances`
- رصيد المخزون = Σ(حركات داخل) − Σ(حركات خارج) — View: `v_stock`
- **لا يوجد حقل `current_balance` يُثق به — إلغاء/تعديل أي عملية يعكس الأرصدة تلقائياً.**

### 2. المعاملات الذرية في PostgreSQL (بند 44/45)
كل عملية تشغيلية دالة PL/pgSQL واحدة `SECURITY DEFINER` تنفذ كل شيء داخل معاملة واحدة:
`create_sale` (فاتورة + أصناف + تحقق مخزون + حركات + نقدية + audit). فشل أي جزء = ROLLBACK كامل. المتصفح لا ينفذ سلاسل mutations حساسة.

### 3. Idempotency بـ operation_id (بند 39/108/133)
- كل عملية يولّد لها العميل UUID ثابتاً قبل الإرسال.
- `register_op()` يسجله في `processed_operations` (UNIQUE) — إعادة الإرسال (نقر مزدوج، retry، مزامنة بعد أوفلاين) تعيد نتيجة العملية الأصلية `duplicate: true` دون تكرار.
- فشل المعاملة يلغي تسجيل الـoperation_id أيضاً (نفس المعاملة) — إعادة المحاولة تعمل.

### 4. الإلغاء بدل الحذف (بند 38/93)
الفواتير المؤكدة لا تُحذف: `void_sale` / `void_purchase` تنشئ حركات عكسية (reversal) وتضع الحالة `VOIDED` وتسجل السبب في audit. لا حذف صامت للسجل المالي.

### 5. التكلفة المرجحة (بند 95/96)
عند الشراء: `avg_cost = (رصيد_الكمية × المتوسط_القديم + كمية_الشراء × سعر_الشراء_بالوحدة_الأساسية) / (الرصيد + الشراء)`. تكلفة الإنتاج من الوصفة × متوسط تكلفة المواد. **لا تُخلط أسعار البيع بالتكاليف.**

### 6. مخزون التوزيع (بند 29-31)
البضاعة تخرج من المستودع لحظة التحميل (`DISTRIBUTION_LOAD_OUT`)، والبيع أثناء الجولة ينشئ فاتورة مالية مرتبطة بالحمولة **دون حركة مخزون إضافية**، والمرتجع يعيدها (`DISTRIBUTION_RETURN_IN`). التسوية تحتسب الفرق وتمنع الإغلاق دون سبب موثق.

### 7. فصل الطبقات (بند 7/101/103)
- UI لا يستدعي Supabase مباشرة للعمليات المالية — عبر `services/operations`.
- منطق الأعمال المركزي في PostgreSQL؛ الواجهة تحقق للتجربة فقط، **الخادم هو المرجع**.
- TypeScript strict، لا `any` في منطق الأعمال.

## مصفوفة الصلاحيات (مطابقة للـSQL والـTS)

| الصلاحية | OWNER/ADMIN | ACCOUNTANT | SALES | WAREHOUSE | PRODUCTION | DISTRIBUTOR | VIEWER |
|---|---|---|---|---|---|---|---|
| sales.manage | ✅ | — | ✅ | — | — | — | — |
| sales.void | ✅ | — | — | — | — | — | — |
| purchases.manage | ✅ | — | — | ✅ | — | — | — |
| payments.manage | ✅ | ✅ | ✅ | — | — | ✅ | — |
| expenses.manage | ✅ | ✅ | — | — | — | — | — |
| inventory.adjust/transfer/waste | ✅ | adjust فقط | — | ✅ | waste فقط | — | — |
| production.manage | ✅ | — | — | — | ✅ | — | — |
| distribution.manage/settle | ✅ | — | — | — | — | ✅ | — |
| users.manage | ✅ | — | — | — | — | — | — |
| audit.view | ✅ | ✅ | — | — | — | — | — |
| قراءة شاملة | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## الأداء (بند 58-60/87/145/146)

- Dashboard: RPC واحد `get_dashboard_summary` (استعلامات مجمّعة داخل PostgreSQL).
- Code-splitting: كل شاشة lazy-loaded + vendor chunks منفصلة.
- Indexes على كل مفاتيح البحث: business_id، التواريخ، operation_id، reference_id، status.
- Pagination limit 500 في القوائم مع فلاتر تاريخ إلزامية.
