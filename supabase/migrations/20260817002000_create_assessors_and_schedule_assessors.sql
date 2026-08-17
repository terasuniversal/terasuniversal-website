-- TERAS UNIVERSAL — Assessor Management + Schedule Assignment (Phase 1)
--
-- Forward-only, post-Baseline V1 migration (>= 20260817000000).
-- Idempotent/guarded. No destructive DROP. No production reset.
--
-- Adds, on top of the latest staff-management baseline (20260817001000):
--   1. audit_action enum values for assessor lifecycle events
--   2. staff_module_catalog entry: 'assessors' (admin-gated module key)
--   3. public.assessors           (assessor master data)
--   4. public.schedule_assessors  (schedule → assessor assignment junction)
--   5. RLS + grants (reads: any active staff; writes: admin+ only)
--
-- Design decisions:
--   * One primary assessor per schedule in Phase 1 (partial unique index on
--     is_primary), but the table shape does NOT block future multi-assessor
--     support (no single-row assessor_id column on course_schedules).
--   * Duplicate schedule+assessor is blocked by a unique (schedule_id,
--     assessor_id) index.
--   * Duplicate ACTIVE assessors are guarded with partial unique indexes on
--     email / ic_passport_no (NULL and inactive rows are not blocked), so a
--     deactivated record can be reactivated without colliding with itself,
--     and a genuinely different person with a blank identity isn't blocked.
--   * No soft-delete column: the module's "no hard delete" rule is enforced
--     by deactivation (is_active=false), per the approved Phase 1 scope.
--   * No generic audit trigger is attached here: server actions record the
--     vocabulary-specific actions (assessor_created / assessor_assigned / …)
--     through public.log_event, which avoids double-logging generic rows.
--   * assessments.assessor_id is untouched — it is per-participant assessment
--     attribution, not a schedule assignment (see ASSESSOR_MANAGEMENT_DECISION.md).

-- ---------------------------------------------------------------------------
-- 1. audit_action enum values (additive, guarded)
-- ---------------------------------------------------------------------------
do $$
declare
  v_label text;
begin
  foreach v_label in array array[
    'assessor_created', 'assessor_updated', 'assessor_activated',
    'assessor_deactivated', 'assessor_assigned', 'assessor_unassigned',
    'assessor_reassigned'
  ] loop
    begin
      execute format('alter type public.audit_action add value if not exists %L', v_label);
    exception when duplicate_object then null;
    end;
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 2. staff_module_catalog entry
-- ---------------------------------------------------------------------------
insert into public.staff_module_catalog (module_key, label, group_key, min_role)
values ('assessors', 'Assessors', 'training', 'admin')
on conflict (module_key) do update set
  label = excluded.label,
  group_key = excluded.group_key,
  min_role = excluded.min_role,
  is_active = true;

-- ---------------------------------------------------------------------------
-- 3. public.assessors — master data
-- ---------------------------------------------------------------------------
create table if not exists public.assessors (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  ic_passport_no  text,
  phone           text,
  email           text,
  organization    text,
  qualification   text,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,
  updated_by      uuid references public.profiles (id) on delete set null
);

comment on table public.assessors is
  'Assessor master data. Deactivate (is_active=false) instead of deleting; a deactivated assessor with historical schedule assignments stays readable.';

-- Guard against two ACTIVE assessors sharing the same email / IC-Passport.
-- NULLs are allowed to repeat (blank identity fields are optional); inactive
-- rows are excluded so a deactivated assessor can be reactivated cleanly.
create unique index if not exists assessors_active_email_unique
  on public.assessors (email) where is_active and email is not null;
create unique index if not exists assessors_active_ic_unique
  on public.assessors (ic_passport_no) where is_active and ic_passport_no is not null;

create index if not exists assessors_active_idx on public.assessors (is_active);

drop trigger if exists trg_assessors_updated_at on public.assessors;
create trigger trg_assessors_updated_at
  before update on public.assessors
  for each row execute function app.set_updated_at();

drop trigger if exists trg_assessors_stamp on public.assessors;
create trigger trg_assessors_stamp
  before insert or update on public.assessors
  for each row execute function app.stamp_actor();

-- ---------------------------------------------------------------------------
-- 4. public.schedule_assessors — schedule assignment junction
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_assessors (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.course_schedules (id) on delete cascade,
  assessor_id  uuid not null references public.assessors (id) on delete cascade,
  is_primary   boolean not null default true,
  assigned_at  timestamptz not null default now(),
  assigned_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.schedule_assessors is
  'Schedule → assessor assignment. Phase 1 UI manages a single primary assessor; the shape supports multiple assessors later (is_primary distinguishes them).';

-- Same assessor cannot be assigned to the same schedule twice.
create unique index if not exists schedule_assessors_schedule_assessor_unique
  on public.schedule_assessors (schedule_id, assessor_id);

-- At most one PRIMARY assessor per schedule.
create unique index if not exists schedule_assessors_one_primary_idx
  on public.schedule_assessors (schedule_id) where is_primary;

create index if not exists schedule_assessors_schedule_idx
  on public.schedule_assessors (schedule_id);
create index if not exists schedule_assessors_assessor_idx
  on public.schedule_assessors (assessor_id);

-- ---------------------------------------------------------------------------
-- 5. RLS + grants
-- ---------------------------------------------------------------------------
-- Reads are open to any active staff member so trainer/editor-facing pages
-- (Attendance print, Assessment, Schedule detail) can display the assigned
-- assessor. All writes are admin+ only, matching the app-layer guards
-- (requireRole("admin") + requireModuleAccess on the assessors/schedules
-- module) — RLS is the real enforcement boundary.
alter table public.assessors enable row level security;
alter table public.schedule_assessors enable row level security;

drop policy if exists assessors_read on public.assessors;
create policy assessors_read on public.assessors
  for select to authenticated using (app.is_active());

drop policy if exists assessors_insert on public.assessors;
create policy assessors_insert on public.assessors
  for insert to authenticated with check (app.is_admin());

drop policy if exists assessors_update on public.assessors;
create policy assessors_update on public.assessors
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

drop policy if exists assessors_delete on public.assessors;
create policy assessors_delete on public.assessors
  for delete to authenticated using (app.is_admin());

drop policy if exists schedule_assessors_read on public.schedule_assessors;
create policy schedule_assessors_read on public.schedule_assessors
  for select to authenticated using (app.is_active());

drop policy if exists schedule_assessors_insert on public.schedule_assessors;
create policy schedule_assessors_insert on public.schedule_assessors
  for insert to authenticated with check (app.is_admin());

drop policy if exists schedule_assessors_update on public.schedule_assessors;
create policy schedule_assessors_update on public.schedule_assessors
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

drop policy if exists schedule_assessors_delete on public.schedule_assessors;
create policy schedule_assessors_delete on public.schedule_assessors
  for delete to authenticated using (app.is_admin());

revoke all on public.assessors from anon;
revoke all on public.schedule_assessors from anon;
grant select, insert, update, delete on public.assessors to authenticated;
grant select, insert, update, delete on public.schedule_assessors to authenticated;
