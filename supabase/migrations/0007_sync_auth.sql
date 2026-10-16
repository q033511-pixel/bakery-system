-- ============================================================================
-- 0007_sync_auth.sql — هوية الأجهزة على الخادم (تجربة الخطة B — بيئة اختبار)
-- القسم (ج): فصل رمز PIN المحلي عن هوية المستخدم لدى الخادم
-- ---------------------------------------------------------------------------
-- المبادئ:
--   1) رمز PIN المحلي = قفل الشاشة على الجهاز فقط — لا يُرسل للخادم أبداً.
--   2) هوية الإنسان = حساب Supabase (auth.users + profiles) عبر JWT.
--   3) هوية الآلة = صف في devices برمز خاص بكل جهاز (ليس سراً مشتركاً):
--        • يولَّد عشوائياً 32 بايت عند التسجيل ويُعرض مرة واحدة.
--        • يخزَّن على الخادم بصيغة sha256 فقط.
--        • يُرسل من الجهاز في ترويسة x-device-token (ليس داخل الكود ولا الحزمة).
--        • قابل للإبطال (REVOKED) والتدوير (rotate) في أي لحظة من لوحة المالك.
--   4) الصلاحيات = دور الإنسان المالك للجهاز (OWNER/ACCOUNTANT/...) — نفس
--      مصفوفة permissions القائمة، لا صلاحيات جديدة للأجهزة.
-- ============================================================================

-- pgcrypto: موجود مسبقاً في Supabase السحابي بمخطط extensions — نفس المسار هنا
create extension if not exists pgcrypto with schema extensions;

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('WEB','WINDOWS','ANDROID')),
  token_hash text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoke_reason text,
  rotated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_devices_business on devices(business_id);
create index if not exists idx_devices_profile on devices(profile_id);

-- ---------- مساعدات رمز الجهاز (تقرأ ترويسات PostgREST بنفس آلية Supabase) ----------
create or replace function get_header(p_name text)
returns text
language sql stable
as $$
  select nullif(current_setting('request.headers', true)::jsonb ->> lower(p_name), '');
$$;

-- pgcrypto يوضع في مخطط extensions على Supabase السحابي، وقد يكون في public على
-- خوادم أخرى — الفحص عند الاستدعاء يجعل الدالة صحيحة في الحالتين.
create or replace function sha256_hex(p_text text)
returns text
language plpgsql immutable as $$
begin
  return encode(extensions.digest(p_text, 'sha256'), 'hex');
exception when undefined_function or undefined_object then
  return encode(digest(p_text, 'sha256'), 'hex');
end $$;

create or replace function random_hex_token(p_bytes integer default 32)
returns text
language plpgsql volatile as $$
begin
  return encode(extensions.gen_random_bytes(p_bytes), 'hex');
exception when undefined_function or undefined_object then
  return encode(gen_random_bytes(p_bytes), 'hex');
end $$;

-- ---------- التحقق من جهاز صالح مرتبط بالحساب الحالي ----------
-- قراءة نقية (STABLE) — لا كتابة هنا؛ تحديث آخر ظهور عبر touch_device_last_seen()
create or replace function get_my_device()
returns devices
language plpgsql stable security definer set search_path = public as $$
declare v_dev devices; v_bid uuid; v_token text; v_device_id text;
begin
  if auth.uid() is null then return null; end if;
  select business_id into v_bid from profiles where id = auth.uid();
  if v_bid is null then return null; end if;
  v_device_id := get_header('x-device-id');
  v_token := get_header('x-device-token');
  if v_device_id is null or v_token is null then return null; end if;
  select * into v_dev from devices
   where id = nullif(v_device_id,'')::uuid
     and business_id = v_bid
     and profile_id = auth.uid()
     and status = 'ACTIVE'
     and token_hash = sha256_hex(v_token)
     and (expires_at is null or expires_at > now());
  return v_dev;
end $$;

-- تحديث آخر ظهور — يُستدعى من مسار الرفع بعد نجاح assert_device
create or replace function touch_device_last_seen()
returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_dev devices;
begin
  v_dev := get_my_device();
  if v_dev.id is not null then
    update devices set last_seen_at = now() where id = v_dev.id;
  end if;
end $$;

create or replace function assert_device()
returns devices
language plpgsql stable security definer set search_path = public as $$
declare v_dev devices;
begin
  v_dev := get_my_device();
  if v_dev.id is null then
    raise exception 'الجهاز غير مصرّح أو تم إبطاله. حدِّث تسجيل الجهاز من لوحة المالك.'
      using errcode = 'P0001';
  end if;
  return v_dev;
end $$;

-- ---------- تسجيل جهاز (المالك/المدير فقط) — يُرجع الرمز مرة واحدة ----------
create or replace function register_device(p_name text, p_platform text, p_profile_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_token text; v_id uuid;
begin
  v_bid := assert_business();
  perform assert_perm('settings.manage');
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'اكتب اسماً واضحاً للجهاز.';
  end if;
  if not exists(select 1 from profiles where id = p_profile_id and business_id = v_bid and active) then
    raise exception 'المستخدم غير موجود في نشاطك التجاري.';
  end if;
  v_token := random_hex_token(32);
  insert into devices(business_id, profile_id, name, platform, token_hash)
  values (v_bid, p_profile_id, trim(p_name), p_platform, sha256_hex(v_token))
  returning id into v_id;
  perform audit('REGISTER_DEVICE','device', v_id, 'CREATE', null,
    jsonb_build_object('name', p_name, 'platform', p_platform));
  -- يُعرض الرمز مرة واحدة فقط — الخادم يخزن الهاش
  return jsonb_build_object('device_id', v_id, 'token', v_token);
end $$;

-- ---------- إبطال جهاز ----------
create or replace function revoke_device(p_device_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid;
begin
  v_bid := assert_business();
  perform assert_perm('settings.manage');
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'اكتب سبب الإبطال.';
  end if;
  update devices set status = 'REVOKED', revoked_at = now(),
    revoked_by = auth.uid(), revoke_reason = trim(p_reason), updated_at = now()
   where id = p_device_id and business_id = v_bid and status = 'ACTIVE';
  if not found then raise exception 'الجهاز غير موجود أو مُبطّل مسبقاً.'; end if;
  perform audit('REVOKE_DEVICE','device', p_device_id, 'UPDATE', null,
    jsonb_build_object('reason', trim(p_reason)));
  return jsonb_build_object('revoked', true);
end $$;

-- ---------- تدوير رمز جهاز (سر جديد، يُعرض مرة واحدة) ----------
create or replace function rotate_device_token(p_device_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_token text;
begin
  v_bid := assert_business();
  perform assert_perm('settings.manage');
  v_token := random_hex_token(32);
  update devices set token_hash = sha256_hex(v_token), rotated_at = now(), updated_at = now()
   where id = p_device_id and business_id = v_bid and status = 'ACTIVE';
  if not found then raise exception 'الجهاز غير موجود أو مُبطّل — لا يمكن تدوير رمزه.'; end if;
  perform audit('ROTATE_DEVICE_TOKEN','device', p_device_id, 'UPDATE', null,
    jsonb_build_object('rotated_at', now()));
  return jsonb_build_object('device_id', p_device_id, 'token', v_token);
end $$;

-- ---------- عرض أجهزة النشاط (المالك/المدير) ----------
create or replace function list_devices()
returns table (
  id uuid, name text, platform text, status text,
  profile_email text, registered_at timestamptz, last_seen_at timestamptz,
  revoked_at timestamptz, revoke_reason text
)
language sql stable security definer set search_path = public as $$
  select d.id, d.name, d.platform, d.status,
         (select email from auth.users where id = d.profile_id),
         d.registered_at, d.last_seen_at, d.revoked_at, d.revoke_reason
    from devices d
   where d.business_id = get_my_business_id()
   order by d.registered_at desc;
$$;

-- ---------- RLS على devices ----------
alter table devices enable row level security;

create policy devices_select_members on devices
for select to authenticated
using (business_id = get_my_business_id());

create policy devices_insert_admin on devices
for insert to authenticated
with check (business_id = get_my_business_id() and has_perm('settings.manage'));

create policy devices_update_admin on devices
for update to authenticated
using (business_id = get_my_business_id() and has_perm('settings.manage'))
with check (business_id = get_my_business_id() and has_perm('settings.manage'));

create policy devices_delete_admin on devices
for delete to authenticated
using (business_id = get_my_business_id() and get_my_role() in ('OWNER','ADMIN'));

-- دوال الجهاز تُنفَّذ بوضع المستخدم؛ security definer مطلوب لتحديث last_seen وتجنب التسريب
grant execute on function get_my_device(), assert_device(), touch_device_last_seen() to authenticated;
grant execute on function register_device(text,text,uuid), revoke_device(uuid,text),
  rotate_device_token(uuid), list_devices() to authenticated;
