#!/usr/bin/env node
/* تطبيق migrations على قاعدة PostgreSQL نظيفة — يُستخدم في:
 *   1) بيئة الاختبار المحلية (PostgreSQL مدمج 17.10)
 *   2) CI (GitHub Actions — خدمة postgres:17)
 *   3) مشروع Supabase تجريبي سحابي (بعد توفير المفاتيح من المالك)
 * البيئة: TEST_DATABASE_URL إلزامية. APPLY_SHIM=1 يضيف حاضنة المحاكاة المحلية
 * (supabase/dev/local_shim.sql) — تُستخدم فقط على PostgreSQL خام، ولا تُطبَّق
 * أبداً على مشروع Supabase سحابي (كل ما فيها موجود أصلاً). */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) { console.error('TEST_DATABASE_URL is required'); process.exit(1); }

async function main() {
  const c = new Client(URL_);
  await c.connect();
  try {
    if (process.env.APPLY_SHIM === '1') {
      const shim = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'dev', 'local_shim.sql'), 'utf8');
      await c.query(shim);
      console.log('[apply] local shim applied');
    }
    const dir = path.join(__dirname, '..', 'supabase', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await c.query(sql);
      console.log('[apply]', f, 'ok');
    }
    const counts = await c.query(`select
      (select count(*) from information_schema.tables where table_schema='public') as tables,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as functions`);
    console.log('[apply] tables:', counts.rows[0].tables, '| functions:', counts.rows[0].functions);
  } finally { await c.end(); }
}
main().catch((e) => { console.error('[apply] FAILED:', e.message.split('\n')[0]); process.exit(1); });
