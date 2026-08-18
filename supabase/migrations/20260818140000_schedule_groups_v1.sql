-- TERAS UNIVERSAL — Training Schedule Groups V1
--
-- Forward-only, additive migration. Adds Schedule/Class -> Groups ->
-- Trainer Assignment on top of the existing live course_schedules /
-- schedule_assessors / schedule_participants / trainers / assessors tables.
-- No existing table's columns are altered except one new nullable FK on
-- schedule_participants. Zero rows are backfilled/migrated.
--
-- Explicitly OUT OF SCOPE / not touched by this migration:
--   * public.attendance — untouched. Group-aware attendance is a documented
--     future extension point, not built here.
--   * public.course_schedules.trainer_name / .venue — untouched, still free
--     text. Legacy (ungrouped) schedules keep exactly their current
--     behavior; trainer_name is not migrated into schedule_groups.
--   * public.set_schedule_assessor() RPC / schedule_assessors table — the
--     schedule's shared/primary assessor mechanism is unchanged. Groups
--     only ever ADD an optional override on top of it.
--   * No venue/classroom relational resource — venue stays free text, no
--     exclusivity model is introduced (this migration adds no venue
--     conflict logic at all, in code or DB).
--
-- Design decisions:
--   * schedule_groups.start_time/end_time mirror course_schedules' own
--     start_time/end_time shape exactly (same type, same nullability) —
--     this is not a new session/scheduling engine, just the identical
--     granularity the schedule itself already has, applied one level down.
--     A group with no time falls back to its parent schedule's time for
--     conflict-checking purposes (app-layer, see actions.ts).
--   * assessor_id on schedule_groups is an OVERRIDE only. The schedule's
--     shared assessor stays sourced from schedule_assessors (is_primary).
--     Effective assessor = group.assessor_id ?? schedule primary assessor,
--     computed in the app layer — schedule_assessors is never duplicated
--     or written to by this migration.
--   * schedule_participants gets ONE new nullable schedule_group_id column
--     (Option A from the task brief) rather than a separate mapping table:
--     a column can only hold one value, so "one group per participant per
--     schedule" is guaranteed by construction with no extra constraint
--     needed, NULL means ungrouped/legacy, and zero changes are required to
--     the existing enrollment/capacity/duplicate-protection logic.
--   * "the group belongs to the same schedule as the enrollment" (STOP GATE
--     #2 fix) is enforced at the DATABASE level via a composite foreign key
--     — schedule_groups gets a UNIQUE (id, schedule_id) constraint (trivial,
--     since id is already unique on its own), and schedule_participants'
--     FK becomes FOREIGN KEY (schedule_group_id, schedule_id) REFERENCES
--     schedule_groups (id, schedule_id) instead of a plain single-column
--     FK. With MATCH SIMPLE (Postgres' default), a NULL schedule_group_id
--     still skips the check entirely (ungrouped stays ungrouped, no
--     constraint applies), but a NON-NULL schedule_group_id now MUST name a
--     group whose own schedule_id is the same row's schedule_id — an
--     attempt to assign a participant into a group from a different
--     schedule fails with a real FK violation, not just an app-layer
--     rejection. The app-layer check in assignParticipantGroup is kept
--     as-is (defense in depth / a friendlier error message before ever
--     reaching the DB), not removed.
--   * No DELETE policy/grant on schedule_groups, matching public.trainers
--     and public.course_schedules' own soft-delete convention
--     (deleted_at). "Block removal if participants are still assigned"
--     (task requirement) is enforced in the app-layer removeGroup action,
--     which checks for active schedule_participants rows referencing the
--     group before soft-deleting it — not a DB constraint, because the
--     safe response is "ask the admin to reassign first", not a hard
--     database error.
--   * RLS write authorization reuses public.has_module_access_level via a
--     new app.can_manage_schedule_groups() helper scoped to the 'schedules'
--     module only (has_module_access_level('schedules','admin')) — matching
--     createSchedule/updateSchedule's existing app-layer guard
--     (requireRole("admin") + requireModuleAccess("schedules")) exactly.
--     Deliberately NOT combined with has_module_access('trainers')/
--     ('assessors') the way set_schedule_assessor's app.can_manage_schedule_
--     assessors() combines 'schedules'+'assessors' — Groups is a
--     sub-feature of Schedules, not of Trainers or Assessors, so a single
--     module check is the correct minimal reuse of what already exists, not
--     an under-powered copy of a different RPC's authorization.
--   * READ policy is app.is_active() (any active staff), matching
--     schedule_assessors_read's own live policy exactly (verified via
--     Supabase MCP before writing this) — not re-litigating that precedent.
--   * created_by/updated_by + app.stamp_actor() ARE included here (unlike
--     the trainers migration, which omitted them because nothing read
--     them) — group provenance is operationally relevant here (who set
--     which trainer/assessor override), matching public.companies/
--     public.assessors' own convention.
--
-- No destructive DROP. No changes to course_schedules/attendance/
-- schedule_assessors. Not applied to production by this migration.

-- ---------------------------------------------------------------------------
-- 1. public.schedule_groups
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_groups (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.course_schedules (id) on delete cascade,
  name         text not null,
  trainer_id   uuid references public.trainers (id) on delete set null,
  assessor_id  uuid references public.assessors (id) on delete set null,
  capacity     integer,
  start_time   time,
  end_time     time,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null
);

comment on table public.schedule_groups is
  'Training Schedule Groups V1 — optional subdivision of a course_schedules '
  'row (Group A / Group B / ...), each with its own trainer and an optional '
  'assessor override. A schedule with no groups is legacy/ungrouped and '
  'behaves exactly as before this migration. Soft-delete only (deleted_at); '
  'the app layer blocks removal while participants are still assigned.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.schedule_groups'::regclass and conname = 'schedule_groups_capacity_check'
  ) then
    alter table public.schedule_groups
      add constraint schedule_groups_capacity_check check (capacity is null or capacity >= 0);
  end if;
end$$;

-- No duplicate group name within the same schedule among non-deleted rows.
create unique index if not exists schedule_groups_active_name_unique
  on public.schedule_groups (schedule_id, lower(name)) where deleted_at is null;

-- Composite-FK target for schedule_participants below (STOP GATE #2 fix):
-- lets a foreign key require "this group's schedule_id equals that row's
-- schedule_id" instead of just "this group id exists somewhere".
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.schedule_groups'::regclass and conname = 'schedule_groups_id_schedule_id_unique'
  ) then
    alter table public.schedule_groups
      add constraint schedule_groups_id_schedule_id_unique unique (id, schedule_id);
  end if;
end$$;

create index if not exists idx_schedule_groups_schedule on public.schedule_groups (schedule_id) where deleted_at is null;
create index if not exists idx_schedule_groups_trainer on public.schedule_groups (trainer_id) where deleted_at is null;
create index if not exists idx_schedule_groups_assessor on public.schedule_groups (assessor_id) where deleted_at is null;

drop trigger if exists trg_schedule_groups_updated_at on public.schedule_groups;
create trigger trg_schedule_groups_updated_at
  before update on public.schedule_groups
  for each row execute function app.set_updated_at();

drop trigger if exists trg_schedule_groups_stamp on public.schedule_groups;
create trigger trg_schedule_groups_stamp
  before insert or update on public.schedule_groups
  for each row execute function app.stamp_actor();

drop trigger if exists trg_schedule_groups_audit on public.schedule_groups;
create trigger trg_schedule_groups_audit
  after insert or delete or update on public.schedule_groups
  for each row execute function app.audit_trigger();

-- ---------------------------------------------------------------------------
-- 2. schedule_participants — additive group assignment column
-- ---------------------------------------------------------------------------
alter table public.schedule_participants
  add column if not exists schedule_group_id uuid;

create index if not exists idx_schedule_participants_group on public.schedule_participants (schedule_group_id) where deleted_at is null;

comment on column public.schedule_participants.schedule_group_id is
  'Optional group within the parent schedule. NULL = ungrouped/legacy '
  'enrollment. A column (not a mapping table) so "one group per participant '
  'per schedule" holds by construction. Enforced (not just app-checked) to '
  'belong to the SAME schedule_id via the composite FK below.';

-- Composite FK (STOP GATE #2 fix) replaces a plain single-column FK to
-- schedule_groups(id): requires the referenced group's own schedule_id to
-- match this row's schedule_id, not just that the group id exists
-- somewhere. NULL schedule_group_id still skips the check entirely under
-- Postgres' default MATCH SIMPLE, so ungrouped enrollments are unaffected.
-- No ON DELETE action is specified (defaults to NO ACTION/RESTRICT) rather
-- than ON DELETE SET NULL, because a multi-column ON DELETE SET NULL would
-- null out schedule_id too (NOT NULL, would raise) -- moot in practice
-- since groups are soft-deleted (deleted_at), never hard-deleted, by every
-- code path in this migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.schedule_participants'::regclass and conname = 'schedule_participants_group_same_schedule_fkey'
  ) then
    alter table public.schedule_participants
      add constraint schedule_participants_group_same_schedule_fkey
      foreign key (schedule_group_id, schedule_id)
      references public.schedule_groups (id, schedule_id);
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Conflict-check read functions.
--    schedule_group_trainer_conflicts stays scoped to schedule_groups vs.
--    schedule_groups only — trainer scope is deliberately NOT expanded here
--    (STOP GATE #2 is an assessor-only + data-integrity fix): a legacy
--    schedule's free-text trainer_name has no stable identity to match a
--    trainer_id against, so comparing against it would be exactly the kind
--    of "invent inaccurate comparison logic" the task warns against, and
--    there is no per-schedule "shared trainer" concept to fall back to the
--    way there is for assessors.
--    schedule_group_assessor_conflicts (below) DOES reach into other,
--    genuinely ungrouped/legacy schedules via schedule_assessors directly
--    — see that function's own header for the exact scoping rule that
--    keeps this correct rather than double-counted.
--    SECURITY INVOKER (not DEFINER): runs as the calling authenticated
--    user, so it only ever sees what that user's own RLS grants already
--    allow — no privilege escalation, this is a read helper, not an
--    authorization gate.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_group_trainer_conflicts(
  p_trainer_id uuid,
  p_schedule_id uuid,
  p_start_time time,
  p_end_time time,
  p_exclude_group_id uuid default null
)
returns table (group_id uuid, group_name text, schedule_code text)
language sql
stable
security invoker
set search_path = 'public'
as $$
  select g.id, g.name, cs.schedule_code
  from public.schedule_groups g
  join public.course_schedules cs on cs.id = g.schedule_id
  join public.course_schedules target on target.id = p_schedule_id
  where p_trainer_id is not null
    and p_start_time is not null and p_end_time is not null
    and g.trainer_id = p_trainer_id
    and g.deleted_at is null
    and cs.deleted_at is null
    and (p_exclude_group_id is null or g.id <> p_exclude_group_id)
    and cs.start_date <= target.end_date and cs.end_date >= target.start_date
    and coalesce(g.start_time, cs.start_time) is not null
    and coalesce(g.end_time, cs.end_time) is not null
    and coalesce(g.start_time, cs.start_time) < p_end_time
    and coalesce(g.end_time, cs.end_time) > p_start_time;
$$;

revoke all on function public.schedule_group_trainer_conflicts(uuid, uuid, time, time, uuid) from public;
grant execute on function public.schedule_group_trainer_conflicts(uuid, uuid, time, time, uuid) to authenticated;

-- Effective assessor = g.assessor_id (override) ?? that group's own
-- schedule's primary assessor (schedule_assessors.is_primary) — the same
-- fallback rule the app layer uses, applied per candidate group so the
-- comparison is against what each OTHER group's assessor actually resolves
-- to today, not just its raw override column.
--
-- Two UNION'd branches (STOP GATE #2 fix):
--
--   Branch 1 (schedule_groups vs. schedule_groups) explicitly excludes
--   groups belonging to the SAME schedule as the one being checked
--   (cs.id <> target.id). A schedule's shared assessor is, by definition,
--   expected to cover every one of that ONE class's own concurrent groups
--   at once (that is the entire point of "shared assessor" from the
--   business rules) — flagging sibling groups in the same class as
--   conflicting with each other over the shared/overridden assessor would
--   be a false positive, not a real double-booking.
--
--   Branch 2 (schedule_assessors vs. OTHER schedules) is new: it compares
--   against another schedule's raw primary-assessor assignment directly,
--   but ONLY for schedules that currently have NO schedule_groups rows at
--   all (`not exists (... schedule_groups g2 ...)`) — i.e. genuinely
--   ungrouped/legacy schedules, exactly the case branch 1 cannot see
--   (branch 1 only ever looks at schedule_groups rows). Restricting this
--   branch to group-less schedules is not just scope discipline, it
--   PREVENTS double-counting: a schedule that DOES have groups has its
--   entire assessor exposure already covered by branch 1 (every one of its
--   groups — overridden or defaulting to that schedule's own primary — is
--   a schedule_groups row branch 1 already scans), so also matching that
--   schedule's raw schedule_assessors row here would report the exact same
--   real-world assignment as two separate conflict rows.
create or replace function public.schedule_group_assessor_conflicts(
  p_assessor_id uuid,
  p_schedule_id uuid,
  p_start_time time,
  p_end_time time,
  p_exclude_group_id uuid default null
)
returns table (group_id uuid, group_name text, schedule_code text)
language sql
stable
security invoker
set search_path = 'public'
as $$
  select g.id, g.name, cs.schedule_code
  from public.schedule_groups g
  join public.course_schedules cs on cs.id = g.schedule_id
  join public.course_schedules target on target.id = p_schedule_id
  left join public.schedule_assessors sa on sa.schedule_id = g.schedule_id and sa.is_primary
  where p_assessor_id is not null
    and p_start_time is not null and p_end_time is not null
    and coalesce(g.assessor_id, sa.assessor_id) = p_assessor_id
    and g.deleted_at is null
    and cs.deleted_at is null
    and cs.id <> target.id
    and (p_exclude_group_id is null or g.id <> p_exclude_group_id)
    and cs.start_date <= target.end_date and cs.end_date >= target.start_date
    and coalesce(g.start_time, cs.start_time) is not null
    and coalesce(g.end_time, cs.end_time) is not null
    and coalesce(g.start_time, cs.start_time) < p_end_time
    and coalesce(g.end_time, cs.end_time) > p_start_time

  union all

  select null::uuid, 'Primary assessor'::text, cs.schedule_code
  from public.schedule_assessors sa
  join public.course_schedules cs on cs.id = sa.schedule_id
  join public.course_schedules target on target.id = p_schedule_id
  where sa.is_primary
    and sa.assessor_id = p_assessor_id
    and p_assessor_id is not null
    and p_start_time is not null and p_end_time is not null
    and cs.deleted_at is null
    and cs.id <> target.id
    and cs.start_date <= target.end_date and cs.end_date >= target.start_date
    and cs.start_time is not null and cs.end_time is not null
    and cs.start_time < p_end_time and cs.end_time > p_start_time
    and not exists (
      select 1 from public.schedule_groups g2 where g2.schedule_id = sa.schedule_id and g2.deleted_at is null
    );
$$;

revoke all on function public.schedule_group_assessor_conflicts(uuid, uuid, time, time, uuid) from public;
grant execute on function public.schedule_group_assessor_conflicts(uuid, uuid, time, time, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Module-aware authorization helper (app schema — not PostgREST-exposed;
--    SECURITY DEFINER; safe search_path). Reuses the 'schedules' module
--    only — see header note on why this is not combined with 'trainers'/
--    'assessors' the way set_schedule_assessor's helper is.
-- ---------------------------------------------------------------------------
create or replace function app.can_manage_schedule_groups()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select app.is_super_admin()
    or (app.has_min_role('admin'::public.user_role) and public.has_module_access_level('schedules', 'admin'));
$$;

revoke all on function app.can_manage_schedule_groups() from public;
grant execute on function app.can_manage_schedule_groups() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS + grants
-- ---------------------------------------------------------------------------
alter table public.schedule_groups enable row level security;

-- Matches schedule_assessors_read's own live policy exactly (any active
-- staff can read) — not introducing a stricter read model for a sibling
-- table of the same schedule-detail page.
drop policy if exists schedule_groups_read on public.schedule_groups;
create policy schedule_groups_read on public.schedule_groups
  for select to authenticated using (app.is_active());

drop policy if exists schedule_groups_insert on public.schedule_groups;
create policy schedule_groups_insert on public.schedule_groups
  for insert to authenticated with check (app.can_manage_schedule_groups());

drop policy if exists schedule_groups_update on public.schedule_groups;
create policy schedule_groups_update on public.schedule_groups
  for update to authenticated using (app.can_manage_schedule_groups()) with check (app.can_manage_schedule_groups());

-- No schedule_groups_delete policy: soft-delete only (deleted_at), matching
-- course_schedules/public.trainers. Dependency-safety (block removal while
-- participants are assigned) is enforced in the app-layer removeGroup
-- action before it issues the soft-delete UPDATE.
drop policy if exists schedule_groups_delete on public.schedule_groups;

revoke all on public.schedule_groups from anon;
revoke delete on public.schedule_groups from authenticated;
grant select, insert, update on public.schedule_groups to authenticated;
