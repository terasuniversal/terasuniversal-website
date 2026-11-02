-- Disposable-database fixture only. Minimal schema mirroring the Production
-- objects the certificate issuance pipeline touches (from read-only Production
-- catalog queries, 2026-11-01). Tables are trimmed to the columns used, RLS is not
-- reproduced, and v_certificate_eligibility is a condensed equivalent, not the
-- verbatim definition. The 20261101091525 and 20261101124601 migrations
-- are replayed on top of this to rebuild the live function bodies. All rows
-- are synthetic. Never run this against a real project.
create extension if not exists pgcrypto;
create schema if not exists app;
create schema if not exists auth;
create schema if not exists extensions;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;

create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create type audit_action as enum ('create', 'update', 'delete', 'restore');
create table public.profiles (id uuid primary key, email text, role text not null, is_active boolean not null default true);
create table public.audit_logs (id bigserial primary key, actor_id uuid, actor_email text, action audit_action, entity_type text, entity_id text, summary text, metadata jsonb not null default '{}', created_at timestamptz default now());

create function app.is_active() returns boolean language sql stable as $$ select coalesce((select is_active from public.profiles where id = auth.uid()), false) $$;
create function app.is_admin() returns boolean language sql stable as $$ select coalesce((select role in ('admin','super_admin') from public.profiles where id = auth.uid()), false) $$;
create function public.has_module_access_level(text, text) returns boolean language sql stable as $$ select app.is_admin() $$;
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create function app.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create table public.certificate_templates (id uuid primary key default gen_random_uuid(), name text, is_active boolean default true, deleted_at timestamptz, config jsonb not null default '{}');
create table public.courses (
  id uuid primary key default gen_random_uuid(), title text, course_name text, course_code text, certificate_type text default 'completion',
  attendance_min_percent numeric default 100, assessment_required boolean default false, competency_required boolean default false,
  certificate_generation_enabled boolean default true, certificate_template_id uuid references public.certificate_templates(id), deleted_at timestamptz
);
create table public.certificate_branches (id uuid primary key default gen_random_uuid(), branch_code text not null, branch_name text not null, display_address text, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.course_schedules (id uuid primary key default gen_random_uuid(), course_id uuid references public.courses(id), schedule_code text, status text, start_date date, end_date date, exam_date date, venue text, trainer_name text, branch_id uuid references public.certificate_branches(id), deleted_at timestamptz);
create table public.participants (id uuid primary key default gen_random_uuid(), full_name text, participant_id text, participant_code text, company text, ic_passport_no text);
create table public.schedule_groups (id uuid primary key default gen_random_uuid(), schedule_id uuid, name text, trainer_id uuid, assessor_id uuid, deleted_at timestamptz);
create table public.trainers (id uuid primary key default gen_random_uuid(), full_name text);
create table public.assessors (id uuid primary key default gen_random_uuid(), full_name text);
create table public.schedule_assessors (schedule_id uuid, assessor_id uuid, is_primary boolean, assigned_at timestamptz, created_at timestamptz default now());
create table public.schedule_participants (schedule_id uuid, participant_id uuid, registration_status text default 'confirmed', schedule_group_id uuid, deleted_at timestamptz);
create table public.attendance (schedule_id uuid, participant_id uuid, session_date date, attendance_status text, deleted_at timestamptz);
create table public.assessments (schedule_id uuid, participant_id uuid, result text, competency_status text, theory_score numeric, practical_score numeric, locked boolean not null default false, deleted_at timestamptz);
create table public.participant_skill_results (id uuid primary key default gen_random_uuid(), schedule_id uuid, participant_id uuid, area text, status text, score numeric, notes text, assessed_by uuid, assessed_at timestamptz, locked boolean not null default false, locked_at timestamptz, locked_by uuid, updated_at timestamptz not null default now(), deleted_at timestamptz, unique (schedule_id, participant_id, area));
create sequence public.certificate_number_seq;

create table public.certificates (
  id uuid primary key default gen_random_uuid(), certificate_no text unique, participant_name text, identity_last4 text, course_name text, course_code text,
  training_start_date date, training_end_date date, issue_date date, expiry_date date, status text check (status in ('valid','expired','revoked','draft','issued','archived')),
  trainer_name text, venue text, created_at timestamptz default now(), updated_at timestamptz default now(), participant_id uuid references public.participants(id), course_id uuid references public.courses(id),
  metadata jsonb, identity_no text, instructor text, certificate_file_url text, public_verification_enabled boolean default true, certificate_number text, holder_name text,
  template_id uuid references public.certificate_templates(id), verification_token text, verification_url text, verification_enabled boolean default true, issued_by uuid, remarks text,
  schedule_id uuid references public.course_schedules(id), deleted_at timestamptz, legacy_batch_id uuid, replaces_certificate_id uuid references public.certificates(id), schedule_code text, exam_date date,
  branch_id uuid references public.certificate_branches(id), branch_code text, branch_name text, branch_address text, effective_assessor_name text, participant_code_snapshot text, company_snapshot text
);
create unique index certificates_active_schedule_participant_uniq on public.certificates (schedule_id, participant_id) where deleted_at is null and status <> 'revoked' and schedule_id is not null;
create unique index uq_certificates_number on public.certificates (certificate_number) where certificate_number is not null;

create table public.certificate_skill_results (
  id uuid primary key default gen_random_uuid(), certificate_id uuid not null references public.certificates(id) on delete cascade, area text not null, status text not null, score numeric, notes text, source_skill_result_id uuid, created_at timestamptz not null default now(),
  unique (certificate_id, area),
  check ((area in ('theory_session','practical_training','safety_awareness') and status in ('not_recorded','completed')) or (area = 'practical_assessment' and status in ('not_recorded','passed','failed')) or (area = 'attendance_requirement' and status in ('not_recorded','met','not_met')))
);
create table public.certificate_issuance_snapshots (
  id uuid primary key default gen_random_uuid(), certificate_id uuid not null unique references public.certificates(id) on delete restrict, snapshot_version int not null default 1 check (snapshot_version > 0), renderer_version text not null default 'certificate_renderer_v1',
  holder_name text not null, identity_no text, identity_last4 text, course_name text not null, training_start_date date, training_end_date date, venue text, trainer_name text, template_id uuid, template_name text, template_config jsonb not null default '{}',
  signature_reference text, verification_metadata jsonb not null default '{}', render_payload jsonb not null default '{}', created_at timestamptz not null default now(), created_by uuid, company_snapshot text, participant_code_snapshot text, course_code text, schedule_code text, exam_date date,
  branch_id uuid, branch_code text, branch_name text, branch_address text, effective_trainer_id uuid, effective_assessor_id uuid, effective_assessor_name text, group_id uuid, group_name text, assessment_result text, competency_status text, issue_date date
);
-- Erector replay re-creates this constraint; it must already exist to be dropped.
alter table public.certificate_issuance_snapshots add constraint certificate_issuance_snapshots_c4_content_digest_check check (true);

create function app.certificates_before_insert() returns trigger language plpgsql as $$
begin
  if new.certificate_number is null and new.certificate_no is not null then new.certificate_number := new.certificate_no; end if;
  if new.certificate_number is null or new.certificate_number = '' then
    new.certificate_number := 'CERT-' || to_char(coalesce(new.issue_date, current_date), 'YYYY') || '-' || lpad(nextval('public.certificate_number_seq')::text, 6, '0');
  end if;
  if new.certificate_no is null then new.certificate_no := new.certificate_number; end if;
  if new.verification_token is null or new.verification_token = '' then new.verification_token := encode(gen_random_bytes(16), 'hex'); end if;
  if new.holder_name is null and new.participant_name is not null then new.holder_name := new.participant_name; end if;
  if new.participant_name is null and new.holder_name is not null then new.participant_name := new.holder_name; end if;
  return new;
end $$;
create trigger trg_certificates_before_insert before insert on public.certificates for each row execute function app.certificates_before_insert();

create view public.v_certificate_eligibility as
with enrollment as (select schedule_id, participant_id, registration_status as enrollment_status from schedule_participants where deleted_at is null and registration_status <> 'cancelled'),
attendance_agg as (select schedule_id, participant_id, count(*) filter (where attendance_status = 'present') present_days, count(*) filter (where attendance_status = 'late') late_days, count(*) filter (where attendance_status = 'excused') excused_days from attendance where deleted_at is null group by 1, 2),
existing_cert as (select distinct on (schedule_id, participant_id) schedule_id, participant_id, id as certificate_id, certificate_number from certificates where deleted_at is null and schedule_id is not null and status <> 'revoked' order by schedule_id, participant_id, created_at desc),
j as (select e.schedule_id, cs.schedule_code, e.participant_id, cs.course_id, coalesce(co.title, co.course_name) course_name, co.course_code, p.full_name holder_name, cs.status schedule_status,
  coalesce(att.present_days,0)+coalesce(att.late_days,0) attended_days, greatest(cs.end_date-cs.start_date+1-coalesce(att.excused_days,0),0) expected_days,
  co.attendance_min_percent, co.assessment_required, co.competency_required, co.certificate_generation_enabled, co.certificate_template_id,
  ar.schedule_id is not null assessment_row_exists, ar.result, ar.competency_status, ec.certificate_id existing_certificate_id
  from enrollment e join course_schedules cs on cs.id=e.schedule_id and cs.deleted_at is null join courses co on co.id=cs.course_id join participants p on p.id=e.participant_id
  left join attendance_agg att on att.schedule_id=e.schedule_id and att.participant_id=e.participant_id
  left join assessments ar on ar.schedule_id=e.schedule_id and ar.participant_id=e.participant_id and ar.deleted_at is null
  left join existing_cert ec on ec.schedule_id=e.schedule_id and ec.participant_id=e.participant_id),
f as (select j.*, case when expected_days<=0 then 100::numeric else round(attended_days::numeric*100/expected_days,2) end attendance_percentage from j),
g as (select f.*, attendance_percentage>=attendance_min_percent attendance_satisfied,
  case when not assessment_required then true when not assessment_row_exists then false when result is distinct from 'pass' then false when competency_required and coalesce(competency_status,'')<>'competent' then false else true end assessment_satisfied from f)
select g.*, certificate_generation_enabled and certificate_template_id is not null and schedule_status='completed' and attendance_satisfied and assessment_satisfied and existing_certificate_id is null eligible,
  case when not certificate_generation_enabled then 'certificate_generation_disabled' when certificate_template_id is null then 'certificate_template_not_configured' when schedule_status<>'completed' then 'schedule_not_completed' when not attendance_satisfied then 'attendance_not_met' when assessment_required and not assessment_row_exists then 'assessment_missing' when assessment_required and result is distinct from 'pass' then 'assessment_not_passed' when assessment_required and competency_required and coalesce(competency_status,'')<>'competent' then 'competency_not_met' when existing_certificate_id is not null then 'certificate_already_exists' end ineligibility_reason
from g;

do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public, app to authenticated, service_role;
grant select on public.certificates, public.certificate_issuance_snapshots, public.certificate_skill_results to authenticated;
