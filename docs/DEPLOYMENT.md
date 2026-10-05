# النشر — DEPLOYMENT.md

## GitHub Pages عبر GitHub Actions

الworkflow: `.github/workflows/deploy.yml` — يعمل عند push على `main`:
1. `npm ci`
2. `npm run lint` + `npm test` (بوابة جودة — فشلها يمنع النشر)
3. `npm run build` مع `VITE_BASE_PATH=/<repo-name>/`
4. نسخ `index.html` إلى `404.html` + `.nojekyll` (ضمان الروابط المباشرة مع HashRouter)
5. نشر `dist/` إلى Pages

### إعداد المستودع (مرة واحدة)
- Settings → Pages → Source: **GitHub Actions**.
- Settings → Secrets and variables → Actions → **Variables** (Tab):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
- عند تغيير اسم المستودع حدّث `VITE_BASE_PATH` في الـworkflow (بند 115).

> يمكن وضع القيم في **Variables** (ليست secrets) لأنها Publishable آمنة للمتصح أصلاً؛ إن فضّلت Secrets فبدّل `vars.` إلى `secrets.` في الـworkflow.

## متطلبات ما قبل الإطلاق

1. تنفيذ migrations 0001→0004 على مشروع Supabase الإنتاجي (لا 0005).
2. استخراج رمز التهيئة وتنفيذ bootstrap (راجع README).
3. إنشاء حسابات الفريق وتعيين الأدوار من الإعدادات.
4. تعطيل Confirm-email إن لم يكن مطلوباً (Authentication → Providers → Email).

## النسخ الاحتياطي (بند 71)

- **Supabase Pro**: نسخ احتياطي يومي تلقائي مع PITR.
- **خطة مجانية**: جدولة `pg_dump` خارجي (GitHub Actions cron أو أي خادم) وتخزين النسخ خارج Supabase:
  ```bash
  pg_dump "$DATABASE_URL" -Fc -f bakery-$(date +%F).dump
  ```
- **الاستعادة**: `pg_restore -d "$DATABASE_URL" --clean bakery-YYYY-MM-DD.dump`.
- عند حذف مستخدم: صفوف profiles تُحذف بcascade لكن الحركات المالية تبقى (created_by يصبح null) — لا يُفقد السجل المالي.
- Retention مقترح: يومية لآخر 7 أيام + أسبوعية لآخر 8 أسابيع + شهرية لسنة.

## PWA وتحديثات

- Service Worker بـ autoUpdate: عند نشر نسخة جديدة يحدَّث التطبيق ويُعاد تحميله تلقائياً.
- أنماط Workbox: precache للأصول، **NetworkOnly** لاستدعاءات Supabase (بند 116 — لا كاش لبيانات حساسة).

## التحقق على الاستضافة الثابتة (بند 137)

- [x] base path مضبوط تلقائياً من اسم المستودع
- [x] assets بنسب مطلقة تحت الـbase
- [x] HashRouter: refresh/deep links تعمل (404.html = index.html احتياطاً)
- [x] manifest + service worker على المسار الصحيح
- [x] 404 يعيد للرئيسية بأمان
