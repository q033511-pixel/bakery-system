-- ============================================================================
-- supabase_shim.sql — حاضنة اختبار محلية فقط (ليست جزءاً من migrations الإنتاج)
-- تُطبَّق على PostgreSQL خام لمحاكاة ما يوفره Supabase السحابي أصلاً:
--   1) أدوار auth.anon / authenticated / service_role (NOLOGIN — تُستخدم بـ SET ROLE)
--   2) مخطط auth مع auth.uid() يقرأ request.jwt.claims بنفس آلية PostgREST
--   3) جدول auth.users مبسّط (المفاتيح الأجنية في المخطط تشير إليه)
-- على مشروع Supabase حقيقي: لا تُطبَّق — كل ما هنا موجود أصلاً.
-- ============================================================================

-- 1) الأدوار (كما في Supabase)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- 2) مخطط auth + uid() بنفس آلية PostgREST الحقيقية
create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

-- 3) جدول مستخدمين مبسّط ليكمل المفاتيح الأجنية
create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 4) صلاحيات تنفيذ مطابقة لسلوك PostgREST (RLS هو الحاكم الفعلي)
create schema if not exists extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant all on auth.users to anon, authenticated, service_role;
