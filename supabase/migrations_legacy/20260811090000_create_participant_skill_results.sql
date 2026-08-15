-- New table: participant_skill_results.
--
-- Phase 2 of the Template A "Participant Skills Record" work (see
-- CERTIFICATE_ENGINE.md discussion / Phase 2 diagnosis report). Phase 1
-- (committed as 8110ef9) already derives "Attendance Requirement" live from
-- v_certificate_eligibility -- that is untouched by this migration. The
-- remaining four certificate rows (Theory Session, Practical Training,
-- Safety Awareness, Practical Assessment) have no data source today:
-- `assessments` is unique on (schedule_id, participant_id) -- ONE combined
-- verdict per participant per schedule, not decomposable per skill area --
-- and `attendance` has no session-type/category column. This table adds a
-- per-area verdict record without touching either existing table, so the
-- working Attendance/Assessment CMS screens and the 117 live certificates
-- are completely unaffected.
--
-- Schema only in this phase: no certificate rendering, CertData,
-- certificate generation, v_certificate_eligibility, or Assessment UI
-- changes here, and no rows are seeded -- the table ships empty.

create table if not exists public.participant_skill_results (
  id             uuid primary key default gen_random_uuid(),
  schedule_id    uuid not null references public.course_schedules (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  area           text not null
    check (area in ('theory_session', 'practical_training', 'safety_awareness', 'practical_assessment')),
  status         text not null default 'not_recorded'
    check (status in ('not_recorded', 'completed', 'passed', 'failed')),
  score          numeric,
  notes          text,
  assessed_by    uuid references public.profiles (id),
  assessed_at    timestamptz,
  locked         boolean not null default false,
  locked_at      timestamptz,
  locked_by      uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- One record per participant per schedule per area. Plain (not partial)
-- unique constraint, deliberately matching assessments_schedule_participant_key
-- (see 20260809100700_assessments_schedule_participant_unique.sql): this
-- table is designed as the same "edit in place, upsert via onConflict, lock
-- toggles editability" model as assessments -- there is no multi-attempt or
-- recreate-after-soft-delete concept here, so a plain constraint (rather
-- than a `where deleted_at is null` partial index, as participants uses for
-- its genuinely different "free the identity value on soft-delete" rule)
-- is the correct, consistent choice.
alter table public.participant_skill_results drop constraint if exists participant_skill_results_schedule_participant_area_key;
alter table public.participant_skill_results add constraint participant_skill_results_schedule_participant_area_key
  unique (schedule_id, participant_id, area);

create index if not exists participant_skill_results_schedule_participant_idx
  on public.participant_skill_results (schedule_id, participant_id) where deleted_at is null;

-- updated_at / audit: reuse the existing standard mechanisms exactly as
-- assessments/attendance/course_schedules do -- no new trigger infrastructure.
drop trigger if exists trg_participant_skill_results_updated_at on public.participant_skill_results;
create trigger trg_participant_skill_results_updated_at
  before update on public.participant_skill_results
  for each row execute function app.set_updated_at();

drop trigger if exists trg_participant_skill_results_audit on public.participant_skill_results;
create trigger trg_participant_skill_results_audit
  after insert or update or delete on public.participant_skill_results
  for each row execute function app.audit_trigger();

-- RLS: mirrors assessments' current live policies exactly (verified via
-- pg_policies before writing this) -- same RBAC model
-- (profiles.role/is_active via the app.* helpers), no parallel
-- authorization table, no new role concept.
alter table public.participant_skill_results enable row level security;
grant select, insert, update, delete on public.participant_skill_results to authenticated;
revoke all on public.participant_skill_results from anon;

drop policy if exists participant_skill_results_select on public.participant_skill_results;
create policy participant_skill_results_select on public.participant_skill_results
  for select to authenticated using (app.has_min_role('trainer'::public.user_role));

drop policy if exists participant_skill_results_insert on public.participant_skill_results;
create policy participant_skill_results_insert on public.participant_skill_results
  for insert to authenticated with check (app.is_admin_or_trainer());

drop policy if exists participant_skill_results_update on public.participant_skill_results;
create policy participant_skill_results_update on public.participant_skill_results
  for update to authenticated using (app.is_admin_or_trainer()) with check (app.is_admin_or_trainer());

drop policy if exists participant_skill_results_delete on public.participant_skill_results;
create policy participant_skill_results_delete on public.participant_skill_results
  for delete to authenticated using (app.is_admin());

comment on table public.participant_skill_results is
  'Per-area (theory/practical/safety/practical-assessment) trainer-entered result for one participant on one schedule. Feeds the Template A certificate Participant Skills Record (Phase 2C, not yet built) -- table is intentionally empty until the Assessment UI (Phase 2B, not yet built) can write to it.';
