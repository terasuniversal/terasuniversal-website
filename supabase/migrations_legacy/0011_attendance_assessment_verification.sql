-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0011 — Attendance, Assessment & Public Certificate Verification
-- =====================================================================
-- Added per the locked operational scope:
--   * attendance   — per-participant, per-session presence
--   * assessments  — per-participant results (score / pass-fail)
--   * public certificate verification — anonymous lookup by a non-guessable
--     verification code, exposing only safe fields for issued certificates.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'assessment_result') then
    create type assessment_result as enum ('pending', 'competent', 'not_yet_competent', 'pass', 'fail');
  end if;
end$$;

-- ---------------------------------------------------------------------
-- ATTENDANCE
-- ---------------------------------------------------------------------
create table if not exists public.attendance (
  id             uuid primary key default gen_random_uuid(),
  schedule_id    uuid not null references public.schedules (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  session_date   date not null,
  present        boolean not null default false,
  check_in_time  time,
  remarks        text,
  recorded_by    uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (participant_id, session_date)
);
create index if not exists idx_attendance_schedule on public.attendance (schedule_id);
create index if not exists idx_attendance_participant on public.attendance (participant_id);

-- ---------------------------------------------------------------------
-- ASSESSMENTS
-- ---------------------------------------------------------------------
create table if not exists public.assessments (
  id             uuid primary key default gen_random_uuid(),
  schedule_id    uuid references public.schedules (id) on delete set null,
  participant_id uuid not null references public.participants (id) on delete cascade,
  assessment_type text,                         -- 'Theory', 'Practical', 'Final'
  score          numeric(5,2),
  max_score      numeric(5,2) default 100,
  result         assessment_result not null default 'pending',
  assessed_by    uuid references public.profiles (id),
  assessed_at    date,
  remarks        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_assessments_participant on public.assessments (participant_id);
create index if not exists idx_assessments_schedule on public.assessments (schedule_id);

-- ---------------------------------------------------------------------
-- CERTIFICATE VERIFICATION CODE
-- ---------------------------------------------------------------------
-- Non-guessable code printed on the certificate / QR. Public verification
-- uses this, never the sequential certificate_no.
alter table public.certificates
  add column if not exists verification_code text unique;

-- Auto-generate a code on insert if none supplied.
create or replace function app.gen_verification_code()
returns trigger language plpgsql as $$
begin
  if new.verification_code is null then
    new.verification_code := upper(replace(encode(gen_random_bytes(6), 'hex'), '/', ''));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cert_code on public.certificates;
create trigger trg_cert_code before insert on public.certificates
  for each row execute function app.gen_verification_code();

-- Public verification RPC. SECURITY DEFINER so anon can call it without any
-- table privilege; returns ONLY safe fields, and ONLY for issued (valid)
-- certificates. Never exposes the certificates table for enumeration.
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
    co.title as course_title,
    c.status,
    c.issued_at,
    c.expires_at,
    (c.status = 'issued' and (c.expires_at is null or c.expires_at >= current_date)) as is_valid
  from public.certificates c
  left join public.courses co on co.id = c.course_id
  where c.verification_code = upper(trim(code))
    and c.deleted_at is null
    and c.status in ('issued', 'expired', 'revoked')  -- reveal issued/expired/revoked; never 'pending'
  limit 1;
$$;

grant execute on function public.verify_certificate(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS + triggers + grants for the new tables
-- ---------------------------------------------------------------------
alter table public.attendance enable row level security;
alter table public.attendance force row level security;
alter table public.assessments enable row level security;
alter table public.assessments force row level security;

create policy attendance_staff_read on public.attendance for select using (app.is_editor());
create policy attendance_staff_write on public.attendance for insert with check (app.is_editor());
create policy attendance_staff_update on public.attendance for update using (app.is_editor()) with check (app.is_editor());
create policy attendance_admin_delete on public.attendance for delete using (app.is_admin());

create policy assessments_staff_read on public.assessments for select using (app.is_editor());
create policy assessments_staff_write on public.assessments for insert with check (app.is_editor());
create policy assessments_staff_update on public.assessments for update using (app.is_editor()) with check (app.is_editor());
create policy assessments_admin_delete on public.assessments for delete using (app.is_admin());

-- updated_at + audit triggers
create trigger trg_attendance_updated_at before update on public.attendance for each row execute function app.set_updated_at();
create trigger trg_assessments_updated_at before update on public.assessments for each row execute function app.set_updated_at();
create trigger trg_attendance_audit after insert or update or delete on public.attendance for each row execute function app.audit_trigger();
create trigger trg_assessments_audit after insert or update or delete on public.assessments for each row execute function app.audit_trigger();

-- grants (RLS still filters rows)
grant select, insert, update, delete on public.attendance to authenticated;
grant select, insert, update, delete on public.assessments to authenticated;
