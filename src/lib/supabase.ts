import { createClient } from '@supabase/supabase-js'
import { env } from './env'

/**
 * Supabase client — يستخدم Publishable Key فقط (بند 66).
 * لا يوجد أي service_role أو secret في الواجهة إطلاقاً.
 */
export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'bakery.auth',
  },
  db: { schema: 'public' },
  global: { headers: { 'x-client-info': 'bakery-system/1.0.0' } },
})
