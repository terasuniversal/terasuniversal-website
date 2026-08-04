-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0015 — Assessment Management
-- =====================================================================
-- Records participant assessment results per training schedule. Replaces the
-- basic assessments table (0011) with the full spec model: theory / practical
-- / overall scores, result, competency status, and a lock/unlock workflow
-- (unlock = Super Admin only). Trainer + Admin manage; Editor read-only.
--
-- One assessment row per (schedule, participant); auto-created when the
-- participant's attendance row is created. Idempotent.
-- Builds on training_schedules (0013) + attendance (0014).
-- =====================================================================

-- --- Enums -----------------------------------------------------------
-- Reuse assessment_result (0011: pending/pass/fail/… ) for the `result`
-- column; only pending/pass/fail are used here.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'competency_status') then
    create type competency_status as enum ('pending_review', 'competent', 'not_yet_competent');
  end if;
  if not exists (select 1 from pg_type where typname = 'assessment_type') then
    create type assessment_type as enum ('theory', 'practical', 'combined');
  end if;
end$$;

-- --- Replace the old (0011) assessments table ------------------------
drop table if exists public.assessments cascade;

create table public.assessments (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     text unique,                        -- auto ASMT-000001 (see trigger)
  schedule_id       uuid not null references public.training_schedules (id) on delete cascade,
  participant_id    uuid not null references public.participants (id) on delete cascade,
  assessment_type   assessment_type not null default 'combined',
  theory_score      numeric(5,2) check (theory_score is null or (theory_score >= 0 and theory_score <= 100)),
  practical_score   numeric(5,2) check (practical_score is null or (practical_score >= 0 and practical_score <= 100)),
  -- overall = average when both present, else whichever is present.
  overall_score     numeric(5,2) generated always as (
    case
      when theory_score is not null and practical_score is not null then round((theory_score + practical_score) / 2.0, 2)
      when theory_score is not null then theory_score
      when practical_score is not null then practical_score
      else null
    end
  ) stored,
  result            assessment_result not null default 'pending',
  competency_status competency_status not null default 'pending_review',
  assessment_date   date,
  assessor_id       uuid references public.profiles (id),
  remarks           text,
  locked            boolean not null default false,
  locked_at         timestamptz,
  locked_by         uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint uq_assessment_pair unique (schedule_id, participant_id)
);
create index if not exists idx_assessments_schedule on public.assessments (schedule_id) where deleted_at is null;
create index if not exists idx_assessments_participant on public.assessments (participant_id);
create index if not exists idx_assessments_result on public.assessments (result);
create index if not exists idx_assessments_competency on public.assessments (competency_status);
create index if not exists idx_assessments_assessor on public.assessments (assessor_id);

-- --- Auto assessment_id (ASMT-000001) --------------------------------
create sequence if not exists public.assessment_id_seq;
create or replace function app.gen_assessment_id()
returns trigger language plpgsql as $$
begin
  if new.assessment_id is null or new.assessment_id = '' then
    new.assessment_id := 'ASMT-' || lpad(nextval('public.assessment_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_assessment_id on public.assessments;
create trigger trg_assessment_id before insert on public.assessments
  for each row execute function app.gen_assessment_id();

-- --- Auto-create an assessment when an attendance row is created -----
create or replace function app.create_assessment_on_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.assessments (schedule_id, participant_id)
  values (new.schedule_id, new.participant_id)
  on conflict (schedule_id, participant_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_att_create_assessment on public.attendance;
create trigger trg_att_create_assessment
  after insert on public.attendance
  for each row execute function app.create_assessment_on_attendance();

-- --- updated_at + audit ----------------------------------------------
drop trigger if exists trg_assessments_updated_at on public.assessments;
create trigger trg_assessments_updated_at before update on public.assessments
  for each row execute function app.set_updated_at();
drop trigger if exists trg_assessments_audit on public.assessments;
create trigger trg_assessments_audit after insert or update or delete on public.assessments
  for each row execute function app.audit_trigger();

-- --- Access helpers (same permission set as attendance) --------------
create or replace function app.can_view_assessment()
returns boolean language sql stable security definer set search_path = public
as $$ select app.is_active() and (app.has_min_role('editor') or app.current_role() = 'trainer'); $$;

create or replace function app.can_manage_assessment()
returns boolean language sql stable security definer set search_path = public
as $$ select app.is_active() and (app.has_min_role('admin') or app.current_role() = 'trainer'); $$;

-- --- RLS -------------------------------------------------------------
alter table public.assessments enable row level security;
alter table public.assessments force row level security;

create policy assessments_view on public.assessments
  for select using (app.can_view_assessment());
create policy assessments_manage_insert on public.assessments
  for insert with check (app.can_manage_assessment());
-- Trainers/Admins may update only UNLOCKED rows (locking one is allowed
-- because the OLD row is still unlocked when the lock flag is set).
create policy assessments_manage_update on public.assessments
  for update using (app.can_manage_assessment() and locked = false)
  with check (app.can_manage_assessment());
-- Super Admin may update ANY row (including locked → this is how unlock works).
create policy assessments_super_update on public.assessments
  for update using (app.is_super_admin()) with check (app.is_super_admin());
create policy assessments_admin_delete on public.assessments
  for delete using (app.is_admin());

-- --- Grants ----------------------------------------------------------
grant select, insert, update, delete on public.assessments to authenticated;
grant usage, select on sequence public.assessment_id_seq to authenticated;

comment on table public.assessments is 'Participant assessments per schedule. overall_score is generated. Trainer/Admin manage; locked rows are editable only by Super Admin (unlock).';
