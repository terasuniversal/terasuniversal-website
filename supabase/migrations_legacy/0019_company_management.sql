-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0019 — Company / Client Management
-- =====================================================================
-- Master database of corporate clients that send participants to training.
-- Links participants → companies so the company profile can aggregate
-- participants, schedules, attendance, assessments and certificates.
--
--   Manage = Admin+. View = Editor+ (read-only). Not public.
-- Idempotent. Builds on participants (0004/0012).
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'company_status') then
    create type company_status as enum ('active', 'inactive', 'prospect', 'archived');
  end if;
end$$;

create table if not exists public.companies (
  id                uuid primary key default gen_random_uuid(),
  company_id        text unique,                 -- auto CO-000001
  company_name      text not null,
  registration_no   text,
  industry          text,
  company_type      text,                        -- Sdn Bhd / Bhd / GLC / Government / Others
  address           text,
  postcode          text,
  city              text,
  state             text,
  country           text default 'Malaysia',
  phone             text,
  email             citext,
  website           text,
  person_in_charge  text,
  pic_position      text,
  pic_phone         text,
  pic_email         citext,
  billing_address   text,
  status            company_status not null default 'active',
  remarks           text,
  created_by        uuid references public.profiles (id),
  updated_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- --- Auto company_id (CO-000001) ------------------------------------
create sequence if not exists public.company_id_seq;
create or replace function app.gen_company_id()
returns trigger language plpgsql as $$
begin
  if new.company_id is null or new.company_id = '' then
    new.company_id := 'CO-' || lpad(nextval('public.company_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_company_id on public.companies;
create trigger trg_company_id before insert on public.companies
  for each row execute function app.gen_company_id();

-- --- Uniqueness & indexes -------------------------------------------
create unique index if not exists uq_companies_company_id on public.companies (company_id);
create unique index if not exists uq_companies_regno_live on public.companies (lower(registration_no)) where deleted_at is null and registration_no is not null;
create index if not exists idx_companies_status on public.companies (status) where deleted_at is null;
create index if not exists idx_companies_industry on public.companies (industry) where deleted_at is null;
create index if not exists idx_companies_state on public.companies (state) where deleted_at is null;
create index if not exists idx_companies_search on public.companies using gin (
  to_tsvector('simple', coalesce(company_id,'') || ' ' || coalesce(company_name,'') || ' ' ||
    coalesce(registration_no,'') || ' ' || coalesce(industry,'') || ' ' || coalesce(person_in_charge,''))
);

-- --- updated_at + actor + audit -------------------------------------
drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at before update on public.companies for each row execute function app.set_updated_at();
drop trigger if exists trg_companies_stamp on public.companies;
create trigger trg_companies_stamp before insert or update on public.companies for each row execute function app.stamp_actor();
drop trigger if exists trg_companies_audit on public.companies;
create trigger trg_companies_audit after insert or update or delete on public.companies for each row execute function app.audit_trigger();

-- --- RLS -------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.companies force row level security;
create policy companies_staff_read on public.companies for select using (app.is_editor());
create policy companies_admin_insert on public.companies for insert with check (app.is_admin());
create policy companies_admin_update on public.companies for update using (app.is_admin()) with check (app.is_admin());
create policy companies_admin_delete on public.companies for delete using (app.is_admin());

-- --- Link participants → companies ----------------------------------
alter table public.participants
  add column if not exists company_id uuid references public.companies (id) on delete set null;
create index if not exists idx_participants_company_id on public.participants (company_id) where deleted_at is null;

-- --- Grants ----------------------------------------------------------
grant select, insert, update, delete on public.companies to authenticated;
grant usage, select on sequence public.company_id_seq to authenticated;

comment on table public.companies is 'Corporate clients. Auto company_id CO-000001. Manage=Admin+, view=Editor+. Participants link via participants.company_id.';
