-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0021 — Operational Automation Centre
-- =====================================================================
-- Central automation module. Adds:
--   * automation_runs   — append-friendly log of every automation execution
--                         (bulk import, bulk cert generate, bulk download,
--                          email queue, etc.). Also serves import-history +
--                          notification + activity feeds.
--   * automation_templates — reusable templates (attendance / assessment /
--                         import mapping / report), complementing the
--                         certificate_templates table from 0016.
--   * app.automation_setting(key, default) — reads the site_settings
--                         'automation' JSONB object (configurable by admins).
--   * Seeds the 'automation' settings object (prefixes / timezone / date
--     format / export format), defaulting to CURRENT behaviour so nothing
--     changes until an admin edits it.
--   * Makes participant-ID and certificate-number prefixes CONFIGURABLE by
--     rewriting app.gen_participant_id() / app.gen_certificate_number() to
--     read the prefix from the settings object (falling back to 'TU-' /
--     'CERT-').
--
--   Permissions: Super Admin & Admin only (both new tables + settings).
-- Idempotent (safe to re-run).
-- =====================================================================

-- --- Audit action: add 'generate' for automation events --------------
alter type audit_action add value if not exists 'generate';

-- =====================================================================
-- 1. Settings helper + seed
-- =====================================================================
-- Reads a single key out of the site_settings row whose key='automation'.
-- SECURITY DEFINER so the ID-generation triggers can call it regardless of
-- the inserting user's read grants on site_settings.
create or replace function app.automation_setting(p_key text, p_default text default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif((select value ->> p_key from public.site_settings where key = 'automation'), ''),
    p_default
  );
$$;

grant execute on function app.automation_setting(text, text) to authenticated;

-- Seed the automation settings object. Defaults preserve CURRENT behaviour:
--   participant_prefix 'TU-', certificate_prefix 'CERT-'.
insert into public.site_settings (key, value, description, is_public)
values (
  'automation',
  jsonb_build_object(
    'participant_prefix', 'TU-',
    'certificate_prefix', 'CERT-',
    'timezone',           'Asia/Kuala_Lumpur',
    'date_format',        'DD/MM/YYYY',
    'export_format',      'csv'
  ),
  'Operational Automation Centre settings: ID prefixes, timezone, date & export format.',
  false
)
on conflict (key) do nothing;

-- =====================================================================
-- 2. Configurable ID generators (read prefix from settings)
-- =====================================================================
-- Participant ID: <prefix><6-digit sequence>, prefix from settings (def 'TU-').
create or replace function app.gen_participant_id()
returns trigger
language plpgsql
as $$
begin
  if new.participant_id is null or new.participant_id = '' then
    new.participant_id := app.automation_setting('participant_prefix', 'TU-')
      || lpad(nextval('public.participant_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

-- Certificate number: <prefix><YYYY>-<6-digit sequence>, prefix from
-- settings (def 'CERT-'). Year + sequence structure preserved.
create or replace function app.gen_certificate_number()
returns trigger language plpgsql as $$
begin
  if new.certificate_number is null or new.certificate_number = '' then
    new.certificate_number := app.automation_setting('certificate_prefix', 'CERT-')
      || to_char(coalesce(new.issue_date, current_date), 'YYYY')
      || '-' || lpad(nextval('public.certificate_number_seq')::text, 6, '0');
  end if;
  if new.verification_token is null or new.verification_token = '' then
    new.verification_token := encode(gen_random_bytes(16), 'hex');
  end if;
  return new;
end;
$$;

-- =====================================================================
-- 3. automation_runs — execution log
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'automation_run_status') then
    create type automation_run_status as enum ('success', 'partial', 'failed', 'running');
  end if;
end$$;

create table if not exists public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  run_type      text not null,                 -- 'bulk_import' | 'bulk_certificate' | 'bulk_download' | 'email_queue' | 'qr_generate' | ...
  status        automation_run_status not null default 'success',
  summary       text,
  total_count   integer not null default 0,
  success_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count  integer not null default 0,
  params        jsonb not null default '{}'::jsonb,  -- inputs (filename, schedule_id, selection, …)
  result        jsonb not null default '{}'::jsonb,  -- per-row outcomes / errors / created ids
  actor_id      uuid references public.profiles (id) on delete set null,
  actor_email   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_automation_runs_type on public.automation_runs (run_type);
create index if not exists idx_automation_runs_status on public.automation_runs (status);
create index if not exists idx_automation_runs_created on public.automation_runs (created_at desc);

comment on table public.automation_runs is 'Log of every automation execution (import history, bulk generate/download, email queue). Admin+ only.';

-- Stamp actor on insert (no updated_at — runs are effectively immutable records).
create or replace function app.stamp_automation_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_id is null then new.actor_id := auth.uid(); end if;
  if new.actor_email is null then
    select email into new.actor_email from public.profiles where id = auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_automation_runs_actor on public.automation_runs;
create trigger trg_automation_runs_actor before insert on public.automation_runs
  for each row execute function app.stamp_automation_actor();

-- =====================================================================
-- 4. automation_templates — reusable templates
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'automation_template_type') then
    create type automation_template_type as enum ('attendance', 'assessment', 'import', 'report', 'email');
  end if;
end$$;

create table if not exists public.automation_templates (
  id          uuid primary key default gen_random_uuid(),
  template_type automation_template_type not null,
  name        text not null,
  description text,
  content     jsonb not null default '{}'::jsonb,  -- column mapping / body / config
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists idx_automation_templates_type on public.automation_templates (template_type) where deleted_at is null;
create unique index if not exists uq_automation_templates_name on public.automation_templates (template_type, lower(name)) where deleted_at is null;

comment on table public.automation_templates is 'Reusable automation templates (attendance/assessment/import/report/email). Admin+ only. Cert templates live in certificate_templates.';

drop trigger if exists trg_automation_templates_updated_at on public.automation_templates;
create trigger trg_automation_templates_updated_at before update on public.automation_templates for each row execute function app.set_updated_at();
drop trigger if exists trg_automation_templates_stamp on public.automation_templates;
create trigger trg_automation_templates_stamp before insert or update on public.automation_templates for each row execute function app.stamp_actor();
drop trigger if exists trg_automation_templates_audit on public.automation_templates;
create trigger trg_automation_templates_audit after insert or update or delete on public.automation_templates for each row execute function app.audit_trigger();

-- =====================================================================
-- 5. RLS — Admin & Super Admin only
-- =====================================================================
alter table public.automation_runs enable row level security;
alter table public.automation_runs force row level security;
create policy automation_runs_admin_read on public.automation_runs for select using (app.is_admin());
create policy automation_runs_admin_insert on public.automation_runs for insert with check (app.is_admin());
-- No update/delete policy → runs are immutable via the API.

alter table public.automation_templates enable row level security;
alter table public.automation_templates force row level security;
create policy automation_templates_admin_read on public.automation_templates for select using (app.is_admin());
create policy automation_templates_admin_insert on public.automation_templates for insert with check (app.is_admin());
create policy automation_templates_admin_update on public.automation_templates for update using (app.is_admin()) with check (app.is_admin());
create policy automation_templates_admin_delete on public.automation_templates for delete using (app.is_admin());

-- =====================================================================
-- 6. Grants
-- =====================================================================
grant select, insert on public.automation_runs to authenticated;
grant select, insert, update, delete on public.automation_templates to authenticated;
