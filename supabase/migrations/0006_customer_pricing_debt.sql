-- 0006: التسعير الخاص بالعميل + الذمم (رصيد افتتاحي/استحقاق/أعمار) + إقفال الصندوق اليومي
-- يعمل محلياً (Dexie v3) الآن، وهذا الملف لضمان التطابق عند التفعيل المركزي (SYNC_ARCHITECTURE_DECISION.md).
-- ملاحظة: فرض حد الائتمان داخل create_sale منفذ حالياً في المحرك المحلي (opsCore.create_sale) مع اختبارات؛
-- عند التفعيل المركزي تُستبدل الدالة بنفس الكتلة (معلّمة أسفل الملف).

-- ============ 1) التسعير الخاص بالعميل ============
create table if not exists customer_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  price numeric(14,4) not null check (price >= 0),
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create unique index if not exists uq_customer_product_unit
  on customer_products (customer_id, product_id, unit_id)
  where unit_id is not null;
create unique index if not exists uq_customer_product_base
  on customer_products (customer_id, product_id)
  where unit_id is null;

create index if not exists idx_customer_products_business on customer_products (business_id);
create index if not exists idx_customer_products_product on customer_products (product_id);

-- دالة حل السعر: قاعدة العميل (بالتطابق الوحدوي ثم الأساس) ثم السعر الافتراضي للصنف
-- الأولوية: تطابق الوحدة > قاعدة الصنف للعميل > السعر العام؛ بين القواعد المتزامنة: الأحدث start_date ثم updated_at
create or replace function resolve_product_price(
  p_customer uuid, p_product uuid, p_unit uuid, p_date date
) returns table (price numeric(14,4), source text, rule_id uuid)
language sql stable as $$
  with candidates as (
    select cp.id, cp.price, cp.start_date, cp.updated_at,
           case when cp.unit_id is not null and cp.unit_id = p_unit then 2
                when cp.unit_id is null then 1
                else 0 end as specificity
    from customer_products cp
    where cp.customer_id = p_customer
      and cp.product_id = p_product
      and (cp.start_date is null or cp.start_date <= p_date)
      and (cp.end_date is null or cp.end_date >= p_date)
      and (cp.unit_id is null or cp.unit_id = p_unit)
  ),
  rule_hit as (
    select c.price,
           case c.specificity when 2 then 'CUSTOMER_UNIT_RULE' when 1 then 'CUSTOMER_PRODUCT_RULE' end as source,
           c.id
    from candidates c
    where c.specificity > 0
    order by c.specificity desc, c.start_date desc nulls last, c.updated_at desc
    limit 1
  ),
  general as (
    -- بلا عميل أو بلا قاعدة مطابقة → السعر العام للصنف (مطابق لسلوك الواجهة المحلية)
    select p.sale_price::numeric(14,4) as price, 'GENERAL' as source, null::uuid as id
    from products p
    where p.id = p_product
  )
  select * from rule_hit
  union all
  select * from general where not exists (select 1 from rule_hit)
  limit 1
$$;

-- ============ 2) الذمم: رصيد افتتاحي + استحقاق ============
alter table customers
  add column if not exists opening_balance numeric(14,2) not null default 0
    check (opening_balance >= 0),
  add column if not exists opening_balance_date date,
  add column if not exists opening_balance_approved boolean not null default false;

alter table sales add column if not exists due_date date;

-- الأرصدة تشمل الرصيد الافتتاحي المعتمد فقط
create or replace view v_customer_balances as
select
  c.business_id,
  c.id as customer_id,
  c.code,
  c.name,
  coalesce(s.credit_sales, 0) as total_sales,
  coalesce(s.credit_sales, 0) - coalesce(pay.paid, 0)
    + case when c.opening_balance_approved then coalesce(c.opening_balance, 0) else 0 end as balance,
  c.credit_limit,
  c.payment_terms_days,
  case when c.opening_balance_approved then coalesce(c.opening_balance, 0) else 0 end as opening_balance
from customers c
left join (
  select customer_id, sum(total) as credit_sales
  from sales where status = 'CONFIRMED' and payment_type = 'CREDIT'
  group by customer_id
) s on s.customer_id = c.id
left join (
  select customer_id, sum(amount) as paid
  from customer_payments group by customer_id
) pay on pay.customer_id = c.id;

-- كشف حساب العميل: صف الافتتاحي أولاً ثم الحركات مع رصيد تراكمي
create or replace function get_customer_statement(p_customer uuid, p_from date default null, p_to date default null)
returns table (date timestamptz, type text, reference text, debit numeric, credit numeric, balance numeric, notes text)
language plpgsql stable as $$
declare
  c customers%rowtype;
  b numeric := 0;
begin
  select * into c from customers where id = p_customer;
  if not found then return; end if;

  if c.opening_balance_approved and coalesce(c.opening_balance, 0) <> 0
     and (p_from is null or c.opening_balance_date is null or c.opening_balance_date >= p_from) then
    return query
    select coalesce(c.opening_balance_date::timestamptz, c.created_at),
           'رصيد افتتاحي'::text, 'OPENING'::text,
           coalesce(c.opening_balance, 0), 0::numeric,
           coalesce(c.opening_balance, 0), nullif(c.notes, '')::text;
    b := coalesce(c.opening_balance, 0);
  end if;

  return query
  with entries as (
    select s.created_at as d, 'بيع آجل'::text as t, s.doc_number as r,
           s.total as dr, 0::numeric as cr, s.notes
    from sales s
    where s.customer_id = p_customer and s.status = 'CONFIRMED' and s.payment_type = 'CREDIT'
      and (p_from is null or s.sale_date >= p_from)
      and (p_to is null or s.sale_date <= p_to)
    union all
    select cp.created_at, 'تحصيل', cp.doc_number, 0::numeric, cp.amount, cp.notes
    from customer_payments cp
    where cp.customer_id = p_customer
      and (p_from is null or cp.payment_date >= p_from)
      and (p_to is null or cp.payment_date <= p_to)
  )
  select e.d, e.t, e.r, e.dr, e.cr,
         b + sum(e.dr - e.cr) over (order by e.d, e.r rows between unbounded preceding and current row),
         e.notes
  from entries e order by e.d, e.r;
end;
$$;

-- أعمار الديون — الطريقة الموحدة مع الواجهة (computeCustomerAging في src/lib/pricing.ts):
-- الرصيد (= الافتتاحي المعتمد + فواتير آجلة − مدفوعات) يوزع على الديون من الأقدم للأحدث،
-- كل دين بتاريخ استحقاقه (due_date أو sale_date + مدة السداد؛ الافتتاحي بتاريخه)،
-- وكل جزء مخصص يدخل فئته العمرية (0-30 / 31-60 / 61-90 / 90+).
create or replace function get_receivables_aging(p_business uuid, p_as_of date default current_date)
returns table (
  customer_id uuid, code text, name text, balance numeric,
  current numeric, days_31_60 numeric, days_61_90 numeric, over_90 numeric,
  oldest_due_date date, over_limit boolean
)
language plpgsql stable as $$
declare
  rec record;
  d record;
  v_pool numeric;
  v_take numeric;
  c0 numeric; c1 numeric; c2 numeric; c3 numeric;
  oldest date;
begin
  for rec in
    select cb.*, c.payment_terms_days,
      case when c.opening_balance_approved then coalesce(c.opening_balance, 0) else 0 end as opening,
      coalesce(c.opening_balance_date, p_as_of) as opening_date
    from v_customer_balances cb join customers c on c.id = cb.customer_id
    where cb.business_id = p_business
  loop
    c0 := 0; c1 := 0; c2 := 0; c3 := 0; oldest := null;
    v_pool := rec.balance;
    if v_pool is null or v_pool <= 0 then
      return query select rec.customer_id, rec.code, rec.name, rec.balance,
        0::numeric, 0::numeric, 0::numeric, 0::numeric, null::date, false;
      continue;
    end if;

    for d in
      -- الديون من الأقدم: الافتتاحي أولاً (بتاريخه) ثم الفواتير بتواريخ استحقاقها
      select * from (
        select rec.opening_date as due, rec.opening as amount
        where rec.opening > 0
        union all
        select coalesce(s.due_date, s.sale_date + coalesce(rec.payment_terms_days, 0)) as due, s.total as amount
        from sales s
        where s.customer_id = rec.customer_id and s.status = 'CONFIRMED' and s.payment_type = 'CREDIT' and s.total > 0
      ) debts order by due asc
    loop
      if v_pool <= 0 then exit; end if;
      v_take := least(v_pool, d.amount);
      if v_take > 0 then
        if oldest is null then oldest := d.due; end if;
        if (p_as_of - d.due) <= 30 then c0 := c0 + v_take;
        elsif (p_as_of - d.due) <= 60 then c1 := c1 + v_take;
        elsif (p_as_of - d.due) <= 90 then c2 := c2 + v_take;
        else c3 := c3 + v_take;
        end if;
        v_pool := v_pool - v_take;
      end if;
    end loop;

    return query select rec.customer_id, rec.code, rec.name, rec.balance,
      c0, c1, c2, c3, oldest,
      (rec.credit_limit > 0 and rec.balance > rec.credit_limit);
  end loop;
end;
$$;

-- ============ 3) إقفال الصندوق اليومي ============
create table if not exists cash_closings (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  business_id uuid not null references businesses(id) on delete cascade,
  cash_account_id uuid not null references cash_accounts(id) on delete cascade,
  closing_date date not null,
  opening_balance numeric(14,2) not null default 0,
  total_in numeric(14,2) not null default 0,
  total_out numeric(14,2) not null default 0,
  expected_balance numeric(14,2) not null default 0,
  counted_balance numeric(14,2) not null,
  variance numeric(14,2) not null default 0,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cash_account_id, closing_date)
);

create index if not exists idx_cash_closings_business on cash_closings (business_id);

-- ============ ملاحظة تفعيل مركزي ============
-- عند اعتماد الخيار B: تُستبدل create_sale/void_sale بنسختيها من 0002 مع إضافة الكتلة التالية
-- قبل الاعتماد (للفواتير الآجلة) — نفس منطق المحرك المحلي في opsCore.create_sale:
--   if v_pay_type = 'CREDIT' and v_customer is not null then
--     select balance, credit_limit into v_bal, v_lim from v_customer_balances where customer_id = v_customer;
--     if v_lim > 0 and v_bal + v_total > v_lim and coalesce((p_payload->>'allow_over_credit')::boolean, false) is not true then
--       raise exception 'تجاوز حد الائتمان: رصيد العميل % + الفاتورة % يتجاوز الحد % — أكّد التجاوز للمتابعة.', v_bal, v_total, v_lim;
--     end if;
--   end if;
