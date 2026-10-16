#!/usr/bin/env node
/* بوابة اختبار تحاكي ما تفعله بوابة Supabase: تحويل /rest/v1/* إلى /* أمام
 * PostgREST الخام — كي يتحدث ناقل التطبيق (supabaseTransport.ts) بنفس شكل
 * روابط Supabase الحقيقي. للاختبار المحلي وCI فقط — ليست جزءاً من التطبيق.
 * الاستخدام: node scripts/dev-gateway.js [منفذ_البوابة] [منفذ_postgrest] */
const http = require('http')

const GATEWAY_PORT = Number(process.argv[2] || 5434)
const UPSTREAM_PORT = Number(process.argv[3] || 5437)

http
  .createServer((req, res) => {
    const url = req.url.replace(/^\/rest\/v1(?=\/|$)/, '')
    const up = http.request(
      {
        host: '127.0.0.1',
        port: UPSTREAM_PORT,
        method: req.method,
        path: url,
        headers: { ...req.headers, host: `127.0.0.1:${UPSTREAM_PORT}` },
      },
      (ur) => {
        res.writeHead(ur.statusCode, ur.headers)
        ur.pipe(res)
      },
    )
    up.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: `بوابة الاختبار: تعذر الوصول إلى PostgREST (${e.code})` }))
    })
    req.pipe(up)
  })
  .listen(GATEWAY_PORT, '127.0.0.1', () =>
    console.log(`[dev-gateway] :${GATEWAY_PORT}/rest/v1 -> postgrest :${UPSTREAM_PORT}`),
  )
