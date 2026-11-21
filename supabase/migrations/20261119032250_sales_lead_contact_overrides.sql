-- Sales lead contact corrections: overlay table (1 of 4). NOT APPLIED anywhere yet.
--
-- Why: public enquiries and proposal requests are the customer's original submission
-- and must stay immutable, yet Sales needs to correct a mistyped name, e-mail or
-- phone. A correction is stored here as ONE COMPLETE contact record per lead; when
-- a row exists, v_sales_lead_inbox (migration 4 of 4) shows these four values instead
-- of the source's. Because the row is complete, an optional value can be cleared
-- (stored as NULL) and is still distinguishable from "no correction" (no row).
--
-- Scope: new table only. No existing table, policy or data is touched. Writes happen
-- only through public.update_sales_lead_contact() (migration 3 of 4); authenticated
-- users get SELECT only. Custom Staging default privileges are broader than
-- Production, hence the explicit revoke.
--
-- Rollback: forward repair only (see migration 4). The table is never dropped
-- without an explicit retention decision because it holds personal data.

create table if not exists public.sales_lead_contact_overrides (
  id uuid primary key default gen_random_uuid(),
  lead_metadata_id uuid not null unique
    references public.sales_lead_metadata(id) on delete cascade,
  contact_name text not null,
  company text,
  email text,
  phone text,
  version integer not null default 1,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_lead_contact_overrides_name_len
    check (char_length(btrim(contact_name)) between 1 and 120),
  constraint sales_lead_contact_overrides_company_len
    check (company is null or char_length(btrim(company)) between 1 and 160),
  constraint sales_lead_contact_overrides_email_len
    check (email is null or char_length(btrim(email)) between 3 and 254),
  constraint sales_lead_contact_overrides_phone_len
    check (phone is null or char_length(btrim(phone)) between 1 and 40),
  constraint sales_lead_contact_overrides_contact_method
    check (email is not null or phone is not null),
  constraint sales_lead_contact_overrides_version_positive
    check (version >= 1)
);

alter table public.sales_lead_contact_overrides enable row level security;

drop policy if exists sales_lead_contact_overrides_select on public.sales_lead_contact_overrides;
create policy sales_lead_contact_overrides_select
  on public.sales_lead_contact_overrides
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

revoke all on public.sales_lead_contact_overrides from public, anon, authenticated;
grant select on public.sales_lead_contact_overrides to authenticated;

drop trigger if exists trg_sales_lead_contact_overrides_updated_at on public.sales_lead_contact_overrides;
create trigger trg_sales_lead_contact_overrides_updated_at
  before update on public.sales_lead_contact_overrides
  for each row execute function app.set_updated_at();

drop trigger if exists trg_sales_lead_contact_overrides_stamp on public.sales_lead_contact_overrides;
create trigger trg_sales_lead_contact_overrides_stamp
  before insert or update on public.sales_lead_contact_overrides
  for each row execute function app.stamp_actor();

drop trigger if exists trg_sales_lead_contact_overrides_audit on public.sales_lead_contact_overrides;
create trigger trg_sales_lead_contact_overrides_audit
  after insert or update or delete on public.sales_lead_contact_overrides
  for each row execute function app.audit_trigger();

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.sales_lead_contact_overrides'::regclass) then
    raise exception 'lead_contact_postcondition_failed: RLS not enabled' using errcode = 'P0001';
  end if;
  if has_table_privilege('anon', 'public.sales_lead_contact_overrides', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.sales_lead_contact_overrides', 'insert,update,delete,truncate') then
    raise exception 'lead_contact_postcondition_failed: unexpected table privilege' using errcode = 'P0001';
  end if;
end $$;
