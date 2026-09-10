-- Quotation Commercial Upgrade Phase 1: commercial defaults and historical
-- quotation snapshots.  This migration is additive and intentionally does
-- not backfill existing quotations or change invoice/payment behaviour.

create table if not exists public.course_commercial_profiles (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  standard_display_name text not null,
  hrdf_display_name text,
  hrdf_claimable boolean not null default false,
  quotation_description text not null,
  package_includes jsonb not null default '[]'::jsonb,
  accommodation_included_default boolean not null default false,
  accommodation_description_default text,
  meals_included_default boolean not null default false,
  meals_description_default text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_commercial_profiles_course_id_key unique (course_id),
  constraint course_commercial_profiles_package_includes_array_check
    check (jsonb_typeof(package_includes) = 'array'),
  constraint course_commercial_profiles_accommodation_description_check
    check (accommodation_included_default or accommodation_description_default is null),
  constraint course_commercial_profiles_meals_description_check
    check (meals_included_default or meals_description_default is null)
);

comment on table public.course_commercial_profiles is
  'Quotation-facing defaults kept separate from public course CMS content.';
comment on column public.course_commercial_profiles.package_includes is
  'JSON array of non-accommodation/non-meal inclusion objects; optional accommodation and meals use their explicit fields.';

create index if not exists course_commercial_profiles_course_id_idx
  on public.course_commercial_profiles(course_id);

alter table public.course_commercial_profiles enable row level security;

drop policy if exists course_commercial_profiles_select on public.course_commercial_profiles;
create policy course_commercial_profiles_select on public.course_commercial_profiles
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists course_commercial_profiles_insert on public.course_commercial_profiles;
create policy course_commercial_profiles_insert on public.course_commercial_profiles
  for insert to authenticated
  with check (app.is_admin());

drop policy if exists course_commercial_profiles_update on public.course_commercial_profiles;
create policy course_commercial_profiles_update on public.course_commercial_profiles
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists course_commercial_profiles_delete on public.course_commercial_profiles;
create policy course_commercial_profiles_delete on public.course_commercial_profiles
  for delete to authenticated
  using (app.is_admin());

revoke all on public.course_commercial_profiles from anon;
grant select, insert, update, delete on public.course_commercial_profiles to authenticated;
revoke truncate, references, trigger on public.course_commercial_profiles from authenticated;

alter table public.sales_quotation_items
  add column if not exists course_id uuid references public.courses(id) on delete set null,
  add column if not exists course_name_snapshot text,
  add column if not exists hrdf_claim boolean,
  add column if not exists package_includes_snapshot jsonb not null default '[]'::jsonb;

alter table public.sales_quotation_items
  add constraint sales_quotation_items_package_includes_array_check
  check (jsonb_typeof(package_includes_snapshot) = 'array');

create index if not exists sales_quotation_items_course_id_idx
  on public.sales_quotation_items(course_id);

alter table public.sales_quotations
  add column if not exists customer_company_name text,
  add column if not exists customer_contact_name text,
  add column if not exists customer_registration_no text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists billing_address text,
  add column if not exists training_service_address text;

-- Commercial snapshots are draft-editable only. Revisions are new rows and
-- therefore remain the governed way to change a sent/rejected/expired quote.
create or replace function app.guard_quotation_commercial_snapshot_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_quotation_status text;
begin
  if tg_table_name = 'sales_quotations' then
    if old.status <> 'draft' and (
      new.customer_company_name is distinct from old.customer_company_name
      or new.customer_contact_name is distinct from old.customer_contact_name
      or new.customer_registration_no is distinct from old.customer_registration_no
      or new.customer_email is distinct from old.customer_email
      or new.customer_phone is distinct from old.customer_phone
      or new.billing_address is distinct from old.billing_address
      or new.training_service_address is distinct from old.training_service_address
    ) then
      raise exception 'governed_quotation_snapshot_immutable' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'sales_quotation_items' then
    select status into v_quotation_status
    from public.sales_quotations
    where id = old.quotation_id;

    if v_quotation_status is distinct from 'draft' and (
      new.course_id is distinct from old.course_id
      or new.course_name_snapshot is distinct from old.course_name_snapshot
      or new.hrdf_claim is distinct from old.hrdf_claim
      or new.package_includes_snapshot is distinct from old.package_includes_snapshot
    ) then
      raise exception 'governed_quotation_item_snapshot_immutable' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_quotation_commercial_snapshot on public.sales_quotations;
create trigger trg_guard_quotation_commercial_snapshot
before update on public.sales_quotations
for each row execute function app.guard_quotation_commercial_snapshot_mutation();

drop trigger if exists trg_guard_quotation_item_commercial_snapshot on public.sales_quotation_items;
create trigger trg_guard_quotation_item_commercial_snapshot
before update on public.sales_quotation_items
for each row execute function app.guard_quotation_commercial_snapshot_mutation();
