# نظام إدارة المخبز 🍞

نظام تشغيل رقمي متكامل لمخبز كبير — يحول العمل اليدوي والدفاتر إلى نظام مركزي سريع وقابل للتتبع، يعمل **من الهاتف**، و**أوفلاين** عند ضعف الإنترنت، ويزامن تلقائياً عند عودة الاتصال.

> **المسار الكامل:** المورد ← شراء ← مخزون مواد خام ← إنتاج ← منتجات نهائية ← مبيعات/توزيع ← عملاء ← تحصيل ← صندوق ← مصاريف ← تقارير ← ربحية تقديرية — كلها مترابطة، وكل رصيد **يُحسب من الحركات** لا يدوياً.

---

## ✨ الميزات

| الوحدة | التفاصيل |
|---|---|
| **لوحة التحكم** | مبيعات/تحصيل/مشتريات/إنتاج/مصروفات اليوم، ديون العملاء، مستحقات الموردين، قيمة المخزون، تنبيهات النقص — كلها من قاعدة البيانات (RPC واحد، بلا N+1) |
| **البيع السريع** | شاشة Mobile-first: تسجيل بيع خلال ثوانٍ، أصناف ±، أسعار تلقائية، نقدي/آجل |
| **المشتريات** | فواتير بمواد متعددة، تحديث التكلفة المرجحة تلقائياً (Weighted Average)، آجل/نقدي |
| **المخزون** | سجل حركات مركزي `inventory_movements` (13 نوع حركة)، لا أرصدة يدوية أبداً، تسويات، هالك، مناقلات بين المستودعات |
| **الإنتاج والوصفات** | دفعات إنتاج بحساب استهلاك المواد من الوصفة، **نسخ وصفات (Versioning)** — الإنتاج القديم يحتفظ بنسخته |
| **التوزيع** | سيارات، سائقون، حمولات، بيع أثناء الجولة، مرتجعات، **معادلة المطابقة**: المحمول = المبيع + المرتجع + الفرق، تسوية لا تُغلق دون معالجة الفروق |
| **الحسابات** | كشوف عملاء وموردين (مدين/دائن/رصيد), صندوق بحسابات متعددة، مصاريف مصنفة |
| **التقارير** | 13 تقريراً مع فلاتر تاريخ وتصدير CSV متوافق Excel، ربحية **تقديرية** مع تنبيه صريح |
| **الصلاحيات** | 8 أدوار + PENDING — الحماية في قاعدة البيانات (RLS) وليس إخفاء أزرار فقط |
| **سجل التدقيق** | كل عملية حساسة (إنشاء/تعديل/إلغاء/دفع/إنتاج/تسوية) مع before/after |
| **Offline-First** | IndexedDB + طابور عمليات + محرك مزامنة idempotent — العملية لا تضيع أبداً |
| **PWA** | قابلة للتثبيت على الهاتف، تعمل بدون إنترنت، مزامنة تلقائية |

## 🧱 التقنيات

- **Frontend:** React 18 + TypeScript (strict) + Vite 6
- **UI:** Tailwind CSS 3 — عربي أولاً، RTL، Mobile-First
- **Routing:** React Router 7 — **HashRouter** (يعمل على GitHub Pages بلا rewrites)
- **Backend:** Supabase (PostgreSQL 15 + Auth + Row Level Security + RPCs معاملية)
- **Offline:** Dexie (IndexedDB) + Sync Engine
- **PWA:** vite-plugin-pwa (Workbox precache، NetworkOnly لـ Supabase API)
- **النشر:** GitHub Pages + GitHub Actions
- **الاختبارات:** Vitest (26 اختبار) + اختبارات SQL لسيناريوهات المواصفة

## 📂 هيكل المشروع

```
bakery-system/
├── src/
│   ├── app/            # Router، AppShell (Bottom Nav/Sidebar)، Auth store
│   ├── components/ui/  # kit المكونات (22 مكوناً)
│   ├── db/             # Dexie: pending_ops + cache_*
│   ├── features/       # 20 وحدة تشغيلية (sales, purchases, inventory, ...)
│   ├── lib/            # money, units, dates, csv, permissions, toast
│   ├── services/       # rpc, auth, lookups (كاش), operations, sync engine
│   └── types/          # أنواع النطاق الكاملة
├── supabase/
│   ├── migrations/     # 0001-0005: schema، RPCs، RLS، views، seed
│   └── tests/          # اختبارات SQL لسيناريوهات المواصفة
├── tests/              # اختبارات Vitest (26)
└── .github/workflows/  # deploy.yml → GitHub Pages
```

## 🚀 التشغيل المحلي

```bash
npm install
cp .env.example .env      # ثم املأ VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev               # http://localhost:5173
```

| الأمر | الوظيفة |
|---|---|
| `npm run dev` | خادم تطوير |
| `npm run build` | بناء الإنتاج (tsc + vite) |
| `npm test` | اختبارات Vitest |
| `npm run lint` | ESLint |
| `npm run typecheck` | فحص TypeScript |
| `npm run preview` | معاينة الإنتاج محلياً |

## 🔑 إعداد Supabase (من الصفر)

1. أنشئ مشروعاً في [supabase.com](https://supabase.com).
2. **Migrations:** من SQL Editor نفّذ الملفات بالترتيب:
   `0001_schema.sql` → `0002_functions.sql` → `0003_rls.sql` → `0004_views.sql`
   (أو `supabase db push` مع CLI).
   ⚠️ `0005_seed.sql` بيانات تجريبية للتطوير فقط — لا تنفذها في الإنتاج.
3. **رمز التهيئة:** `select setup_code from system_setup;`
4. **Auth:** من Authentication → Providers فعّل Email. عطّل Confirm signup إن أردت دخولاً فورياً.
5. **أول مالك:** من التطبيق: «إنشاء حساب جديد» ← تسجيل دخول ← صفحة **تهيئة النظام** ← أدخل رمز التهيئة واسم المخبز. (التهيئة تعمل مرة واحدة وتُنشئ الوحدات والمستودعات والصندوق والفئات.)
6. **بيئة الإنتاج:** في إعدادات مستودع GitHub أضف Variables:
   `VITE_SUPABASE_URL` و `VITE_SUPABASE_PUBLISHABLE_KEY` ← ثم أعد تشغيل الـworkflow.

> 🔒 **أمنياً:** مفتاح Publishable (anon) فقط في الواجهة — service_role لا يُدخل أبداً في المتصفح أو المستودع.

## 📲 PWA

- التثبيت: من متصفح الهاتف «إضافة إلى الشاشة الرئيسية».
- أوفلاين: كل الشاشات تعمل؛ العمليات تُحفظ محلياً وتزامن تلقائياً.
- Service Worker: precache للتطبيق + **NetworkOnly** لكل استدعاءات Supabase (لا كاش لبيانات حساسة).

## 🧪 الاختبارات

- **Vitest (26):** الحسابات المالية، تحويل الوحدات، سيناريوهات المواصفة 76-79 (مخزون 128، عميل 900، مورد 1100، توزيع فرق 50)، طابور المزامنة وidempotency.
- **SQL (`supabase/tests/ledger_tests.sql`):** نفس السيناريوهات ضد قاعدة حقيقية + منع البيع من مخزون غير متوفر + منع تكرار operation_id — تُشغل بجلسة المالك بعد التهيئة.

## 📦 النسخ الاحتياطي

البيانات في PostgreSQL (Supabase): نسخ احتياطي يومي تلقائي من Supabase (Pro)، أو `pg_dump` دوري. لا ميزة Backup داخل الواجهة — راجع `DEPLOYMENT.md`.

## 📚 التوثيق الكامل

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — المعمارية وطبقات النظام
- [DATABASE.md](./docs/DATABASE.md) — الجداول والعلاقات والRPCs
- [SECURITY.md](./docs/SECURITY.md) — RLS والصلاحيات وقائمة الأمان
- [OFFLINE_SYNC.md](./docs/OFFLINE_SYNC.md) — الطابور والمزامنة والتعارضات
- [DEPLOYMENT.md](./docs/DEPLOYMENT.md) — النشر والنسخ الاحتياطي
- [TESTING.md](./docs/TESTING.md) — الاختبارات وتشغيلها
- [PROJECT_SPEC.md](./docs/PROJECT_SPEC.md) — ملخص المواصفة الأصلية
- [PROJECT_DECISIONS.md](./docs/PROJECT_DECISIONS.md) — القرارات الهندسية المسجلة
