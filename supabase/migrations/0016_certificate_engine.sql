-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0016 — Certificate Engine
-- =====================================================================
-- Template-based, reusable certificate system. Extends the certificates
-- table (0004/0011) to the full engine spec, adds certificate_templates,
-- an eligibility view, and public token verification.
--
--   Generate is gated (in the app) on: attendance = present,
--   assessment result = pass, competency = competent.
--   View = all staff (incl. Trainer). Generate/manage = Admin+.
-- Idempotent. Builds on training_schedules (0013) + assessments (0015).
-- =====================================================================

-- --- Status enum: add draft + archived -------------------------------
alter type certificate_status add value if not exists 'draft';
alter type certificate_status add value if not exists 'archived';

-- --- Certificate templates ------------------------------------------
create table if not exists public.certificate_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  orientation  text not null default 'landscape',   -- portrait | landscape
  paper_size   text not null default 'A4',
  -- config holds: logo_url, background_url, border_style, accent_color,
  -- primary_color, signature_url, signature_name, signature_title,
  -- body_text, show_qr, custom_fields:[{label,value}]
  config       jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  is_default   boolean not null default false,
  created_by   uuid references public.profiles (id),
  updated_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_cert_templates_active on public.certificate_templates (is_active) where deleted_at is null;

-- --- Extend certificates --------------------------------------------
-- Rename legacy columns to the spec names (fresh DB → no data loss).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='certificates' and column_name='certificate_no') then
    alter table public.certificates rename column certificate_no to certificate_number;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='certificates' and column_name='issued_at') then
    alter table public.certificates rename column issued_at to issue_date;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='certificates' and column_name='expires_at') then
    alter table public.certificates rename column expires_at to expiry_date;
  end if;
end$$;

alter table public.certificates
  add column if not exists certificate_id      uuid unique default gen_random_uuid(),
  add column if not exists template_id         uuid references public.certificate_templates (id) on delete set null,
  add column if not exists verification_token  text unique,
  add column if not exists verification_url    text,
  add column if not exists pdf_path            text,
  add column if not exists qr_code_path        text,
  add column if not exists issued_by           uuid references public.profiles (id),
  add column if not exists remarks             text;

-- NOTE: status default stays as-is; the app always sets status explicitly
-- ('draft' on generate). We avoid referencing the newly-added enum value in
-- this same migration (Postgres forbids using a new enum value in the tx that
-- added it).

-- Repoint schedule_id at training_schedules (was → old schedules).
do $$
begin
  if exists (select 1 from information_schema.table_constraints
             where constraint_schema='public' and table_name='certificates' and constraint_name='certificates_schedule_id_fkey') then
    alter table public.certificates drop constraint certificates_schedule_id_fkey;
  end if;
  alter table public.certificates
    add constraint certificates_schedule_id_fkey foreign key (schedule_id)
    references public.training_schedules (id) on delete set null;
exception when others then null;  -- tolerate pre-existing constraint on re-run
end$$;

create index if not exists idx_certificates_number on public.certificates (certificate_number);
create index if not exists idx_certificates_token on public.certificates (verification_token);
create index if not exists idx_certificates_schedule on public.certificates (schedule_id);
create index if not exists idx_certificates_issue on public.certificates (issue_date desc);

-- --- Auto certificate_number (CERT-YYYY-000001) ----------------------
create sequence if not exists public.certificate_number_seq;
create or replace function app.gen_certificate_number()
returns trigger language plpgsql as $$
begin
  if new.certificate_number is null or new.certificate_number = '' then
    new.certificate_number := 'CERT-' || to_char(coalesce(new.issue_date, current_date), 'YYYY')
      || '-' || lpad(nextval('public.certificate_number_seq')::text, 6, '0');
  end if;
  if new.verification_token is null or new.verification_token = '' then
    new.verification_token := encode(gen_random_bytes(16), 'hex');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_certificate_number on public.certificates;
create trigger trg_certificate_number before insert on public.certificates
  for each row execute function app.gen_certificate_number();

-- --- Eligibility view (present + pass + competent) -------------------
create or replace view public.v_certificate_eligibility as
select
  sp.schedule_id,
  sp.participant_id,
  ts.course_id,
  ts.course_name,
  p.full_name        as holder_name,
  att.attendance_status,
  asm.result,
  asm.competency_status,
  (att.attendance_status = 'present'
     and asm.result = 'pass'
     and asm.competency_status = 'competent') as eligible
from public.schedule_participants sp
join public.training_schedules ts on ts.id = sp.schedule_id
join public.participants p on p.id = sp.participant_id
left join public.attendance att on att.schedule_id = sp.schedule_id and att.participant_id = sp.participant_id and att.deleted_at is null
left join public.assessments asm on asm.schedule_id = sp.schedule_id and asm.participant_id = sp.participant_id and asm.deleted_at is null;

-- --- Public verification by token ------------------------------------
create or replace function public.verify_certificate_by_token(token text)
returns table (
  certificate_number text,
  holder_name        text,
  course_title       text,
  status             certificate_status,
  issue_date         date,
  expiry_date        date,
  is_valid           boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.certificate_number,
    c.holder_name,
    coalesce(co.title, c.holder_name) as course_title,
    c.status,
    c.issue_date,
    c.expiry_date,
    (c.status = 'issued' and (c.expiry_date is null or c.expiry_date >= current_date)) as is_valid
  from public.certificates c
  left join public.courses co on co.id = c.course_id
  where c.verification_token = trim(token)
    and c.deleted_at is null
    and c.status in ('issued', 'expired', 'revoked')
  limit 1;
$$;
grant execute on function public.verify_certificate_by_token(text) to anon, authenticated;

-- Redefine the legacy verify_certificate(code) (from 0011) to use the renamed
-- columns (issue_date/expiry_date). Return column names are kept as
-- issued_at/expires_at so the existing /verify?code= page keeps working.
create or replace function public.verify_certificate(code text)
returns table (
  holder_name    text,
  course_title   text,
  status         certificate_status,
  issued_at      date,
  expires_at     date,
  is_valid       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.holder_name,
    coalesce(co.title, c.holder_name) as course_title,
    c.status,
    c.issue_date  as issued_at,
    c.expiry_date as expires_at,
    (c.status = 'issued' and (c.expiry_date is null or c.expiry_date >= current_date)) as is_valid
  from public.certificates c
  left join public.courses co on co.id = c.course_id
  where c.verification_code = upper(trim(code))
    and c.deleted_at is null
    and c.status in ('issued', 'expired', 'revoked')
  limit 1;
$$;

-- --- RLS: certificates (rework) + templates -------------------------
drop policy if exists certificates_staff_read   on public.certificates;
drop policy if exists certificates_editor_write  on public.certificates;
drop policy if exists certificates_editor_update on public.certificates;
drop policy if exists certificates_admin_delete  on public.certificates;

create policy certificates_view on public.certificates
  for select using (app.is_editor() or app.current_role() = 'trainer');   -- all staff view
create policy certificates_admin_insert on public.certificates
  for insert with check (app.is_admin());                                  -- generate = admin+
create policy certificates_admin_update on public.certificates
  for update using (app.is_admin()) with check (app.is_admin());
create policy certificates_admin_delete on public.certificates
  for delete using (app.is_admin());

alter table public.certificate_templates enable row level security;
alter table public.certificate_templates force row level security;
create policy cert_templates_view on public.certificate_templates
  for select using (app.is_editor() or app.current_role() = 'trainer');
create policy cert_templates_admin_write on public.certificate_templates
  for all using (app.is_admin()) with check (app.is_admin());

-- --- Triggers + grants ----------------------------------------------
drop trigger if exists trg_cert_templates_updated_at on public.certificate_templates;
create trigger trg_cert_templates_updated_at before update on public.certificate_templates
  for each row execute function app.set_updated_at();
drop trigger if exists trg_cert_templates_audit on public.certificate_templates;
create trigger trg_cert_templates_audit after insert or update or delete on public.certificate_templates
  for each row execute function app.audit_trigger();

grant select on public.v_certificate_eligibility to authenticated;
grant select, insert, update, delete on public.certificate_templates to authenticated;
grant usage, select on sequence public.certificate_number_seq to authenticated;

-- --- Seed a default template ----------------------------------------
insert into public.certificate_templates (name, description, orientation, is_active, is_default, config)
values (
  'TERAS Standard (Landscape)',
  'Default TERAS UNIVERSAL certificate of competency.',
  'landscape', true, true,
  jsonb_build_object(
    'logo_url', '/teras-universal-logo.png',
    'accent_color', '#E1A925',
    'primary_color', '#0B2C56',
    'signature_name', 'Training Director',
    'signature_title', 'TERAS UNIVERSAL SDN. BHD.',
    'body_text', 'has successfully completed the training programme and is hereby certified as COMPETENT.',
    'show_qr', true,
    'custom_fields', '[]'::jsonb
  )
)
on conflict do nothing;
