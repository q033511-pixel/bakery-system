# الأمان — SECURITY.md

## المبدأ

الحماية في **قاعدة البيانات أولاً** (بند 35/140): إخفاء الأزرار في الواجهة تجربة مستخدم فقط — أي مستخدم يحاول استدعاء Data API مباشرة يصطدم بـ RLS وفحص الصلاحيات داخل الـ RPCs.

## الطبقات

### 1. Row Level Security (0003_rls.sql)
- RLS مفعّل على **كل** الجداول (42 جدولاً).
- القراءة: أعضاء النشاط فقط (`business_id = get_my_business_id()`) — مستخدم PENDING يرى صفه فقط.
- الجداول المالية والتشغيلية: **بلا أي سياسة كتابة** — INSERT/UPDATE/DELETE محجوبة تماماً عن العملاء؛ الكتابة عبر RPCs حصراً (`SECURITY DEFINER` يتحقق بالصلاحية داخلياً ثم يكتب بصفتها).
- `audit_logs`: قراءة للمالك/المدير/المحاسب فقط (`audit.view`).
- `system_setup` (رمز التهيئة): **لا سياسات إطلاقاً** — محجوب 100% عن العملاء.

### 2. فحص داخل الدوال
كل RPC يبدأ بـ `assert_business()` ثم `assert_perm('…')` — نفس مصفوفة `role_has_perm` المطبقة في الواجهة (`src/lib/permissions.ts`)، فلا تفرّق الواجهة عن الخادم أبداً.

### 3. إدارة المستخدمين (بند 68)
- التسجيل المفتوح ينشئ profile بحالة **PENDING** بلا business_id — لا يرى شيئاً.
- المالك فقط يفعّل ويُعيّن الدور عبر `assign_user_role`.
- حماية آخر مالك: لا يمكن إزالة OWNER الوحيد.
- رمز التهيئة `system_setup.setup_code` يُستخرج من SQL Editor (يتطلب صلاحية قاعدة البيانات) ويُبطل بعد الاستخدام.

### 4. الأسرار (بند 66/131)
- الواجهة تستخدم **Publishable (anon) Key** فقط — service_role/service_key/DB password لا تدخل المتصفح أو المستودع أو IndexedDB أبداً.
- `.env` في `.gitignore`؛ القيم في الإنتاج تُمرر كـ GitHub Variables لحظة البناء.
- لا session tokens في Dexie؛ الجلسة تديرها مكتبة Supabase.

### 5. سلامة العمليات المالية
- لا حذف للفواتير المؤكدة — VOID بحركات عكسية وaudit (بند 38/93).
- audit_logs مع before_data/after_data لكل تعديل حساس (بند 37/143).
- منع التكرار: operation_id UNIQUE + `processed_operations` (بند 108).

### 6. XSS
- لا `dangerouslySetInnerHTML` في أي مكوّن — كل العرض عبر React escaping.
- رسائل الأخطاء للمستخدم عربية ومعقمة؛ التفاصيل التقنية في console للمطور فقط (بند 90).

## قائمة التحقق النهائية (بند 114)

- [x] No secrets in frontend
- [x] RLS enabled على كل الجداول
- [x] Policies محدودة الامتياز (least privilege) ومفحوصة بالأدوار
- [x] Auth مفعّل — لا وصول مجهول للبيانات
- [x] Owner bootstrap محمي برمز + قاعدة "مرة واحدة"
- [x] Audit logs لكل الأحداث الحساسة
- [x] لا حذف غير آمن للسجل المالي
- [x] Input validation (واجهة + قيود قاعدة بيانات)
- [x] XSS-safe rendering
- [x] متغيرات بيئة آمنة
- [x] لا بيانات حساسة في التخزين المحلي
- [x] رسائل خطأ معقمة للمستخدم
