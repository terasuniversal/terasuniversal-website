-- TERAS UNIVERSAL — Trainer Master V1 (production schema repair)
--
-- Forward-only, additive migration. Fixes the confirmed production gap:
-- the Trainers admin module (app/admin/(protected)/trainers/**) and the
-- Reports "Total trainers" export both query public.trainers, which was
-- only ever defined in the never-applied numbered/design lineage
-- (0003_content_modules.sql / 0018_trainer_management.sql) and does not
-- exist in the live compatibility schema.
--
-- Explicitly OUT OF SCOPE / not touched by this migration:
--   * public.training_schedules is NOT created or resurrected.
--   * No trainer_id FK column is added to course_schedules or any other
--     table (see the design-decisions note below for the one trainer_id
--     TEXT column that IS added, on public.trainers itself, for an
--     unrelated reason — a display code, not a foreign key).
--   * public.course_schedules.trainer_name (live, free-text) is untouched —
--     Training Schedule keeps assigning trainers by name only. A FK from
--     course_schedules to this new table is a separate future phase.
--   * supabase/migrations/0003_content_modules.sql and
--     0018_trainer_management.sql are left exactly as-is (design reference
--     only, never applied — do not run them).
--
-- Design decisions:
--   * Soft delete only: deleted_at, no DELETE policy, no DELETE grant.
--     Matches public.companies (also deleted_at-based) rather than
--     public.assessors (is_active boolean) — the app's existing
--     softDeleteTrainer()/restoreTrainer() actions already write
--     deleted_at, unchanged by this migration.
--   * Column set matches lib/validation/schemas.ts's trainerSchema exactly,
--     with ONE deliberate addition beyond the approved column list: a
--     server-generated `trainer_id` text column (TR-000001 style), because
--     5 existing UI files (page.tsx, [id]/page.tsx, [id]/edit/page.tsx,
--     trainers/export/route.ts, reports/export/route.ts) already select/
--     display/sort/search on `trainer_id` as a human-readable code distinct
--     from the uuid `id` — this is the same auto-numbering the old
--     (never-applied) 0018_trainer_management.sql defined via
--     app.gen_trainer_id() + trainer_id_seq. Rewriting 5 UI files to drop
--     all `trainer_id` references would be a bigger app-layer change than
--     adding this one self-contained, server-only, auto-generated column —
--     it is never part of trainerSchema/readForm/toPayload, so the
--     create/update form path is completely unaffected.
--     (created_by/updated_by + app.stamp_actor() were also considered,
--     matching public.companies/public.assessors, but are omitted — nothing
--     in the app reads them, and per-change actor attribution already comes
--     from public.audit_logs via the generic audit trigger below.)
--   * RLS is module-access-aware (app.can_view_trainers() /
--     app.can_manage_trainers()), not the older role-only pattern
--     public.companies uses. This follows the PR #33 security-review fix
--     applied to public.assessors (20260817002100_assessor_security_integrity.sql
--     finding #1): a role-only RLS check on a module-gated table lets an
--     explicit-access admin with NO Trainers module access still write
--     directly via the authenticated client, bypassing requireModuleAccess()
--     at the app layer. The helpers combine the same role floor the app
--     already enforces (requireRole("editor") for reads, requireRole("admin")
--     for writes) with public.has_module_access_level('trainers', 'view') —
--     the same level the app's own requireModuleAccess("trainers") /
--     hasModuleAccess("trainers") calls already check (both default to
--     level='view'), so this is a literal translation of the existing app
--     guards into RLS, not a new authorization model.
--   * The 'trainers' entry in public.staff_module_catalog already exists
--     live (module_key='trainers', min_role='editor', verified via direct
--     query against project iagzkrzeuawaxvacqprk before writing this
--     migration) — per the task's own instruction this migration does NOT
--     insert or modify a staff_module_catalog row.
--   * Unique-index names for ic_passport_no/staff_no deliberately contain
--     the literal substrings "_ic_" / "_staff_" (trainers_active_ic_unique /
--     trainers_active_staff_unique) because
--     app/admin/(protected)/trainers/actions.ts's mapErr() already maps a
--     23505 (unique_violation) error to a field-specific message by
--     checking error.message.includes("_ic_") / .includes("_staff_") — the
--     index names are load-bearing for that existing error-mapping code, not
--     cosmetic.
--   * IC/passport and staff number uniqueness is case-insensitive
--     (lower(...)), matching the old 0018 design's own precedent for these
--     two fields. Email uniqueness is also case-insensitive
--     (lower(email)), matching profiles.email's citext (case-insensitive)
--     semantics for "a person's email" elsewhere in this schema — but as a
--     plain functional index rather than the extensions.citext type, since
--     migration 20260721030532_move_citext_out_of_public deliberately
--     relocated citext out of the public schema and a new public-schema
--     citext column would work against that. mapErr() has no "_email_"
--     branch today, so a duplicate email currently falls through to the
--     generic "_form: Duplicate value." message (test matrix item 8) —
--     unchanged by this migration; adding field-specific email error
--     mapping is an application-layer change outside this migration's scope.
--   * Phone is intentionally NOT unique — the task explicitly rules this
--     out (trainers can share a household/office line; not an identity
--     field).
--
-- No destructive DROP. No changes to any other table. Not applied to
-- production by this migration — see PR description.

-- ---------------------------------------------------------------------------
-- 1. public.trainers — master data
-- ---------------------------------------------------------------------------
create table if not exists public.trainers (
  id                uuid primary key default gen_random_uuid(),
  trainer_id        text,
  full_name         text not null,
  ic_passport_no    text,
  staff_no          text,
  email             text,
  phone             text,
  position          text,
  department        text,
  employment_type   text,
  specialisation    text,
  qualifications    text[] not null default '{}',
  competencies      text[] not null default '{}',
  trainer_photo     text,
  signature_image   text,
  status            text not null default 'active',
  joining_date      date,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.trainers is
  'Trainer master data (Trainer Master V1). Soft-delete only: deactivate via '
  'deleted_at, never DROP a row. course_schedules.trainer_name remains the '
  'live free-text scheduling field — this table is not yet FK-linked to '
  'course_schedules (separate future phase).';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trainers'::regclass and conname = 'trainers_status_check'
  ) then
    alter table public.trainers
      add constraint trainers_status_check
      check (status in ('active', 'inactive', 'retired', 'on_leave'));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2. Auto-generated trainer_id (TR-000001) — mirrors the old (never-applied)
--    0018_trainer_management.sql's app.gen_trainer_id()/trainer_id_seq, so
--    the existing UI's display/search/sort behavior needs no code change.
--    Guarded/idempotent; does not touch 0018 itself.
-- ---------------------------------------------------------------------------
create sequence if not exists public.trainer_id_seq;

create or replace function app.gen_trainer_id()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if new.trainer_id is null or new.trainer_id = '' then
    new.trainer_id := 'TR-' || lpad(nextval('public.trainer_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trainers_gen_id on public.trainers;
create trigger trg_trainers_gen_id
  before insert on public.trainers
  for each row execute function app.gen_trainer_id();

create unique index if not exists trainers_trainer_id_unique on public.trainers (trainer_id);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
-- Identity uniqueness among non-deleted rows only, so a soft-deleted trainer
-- doesn't permanently block re-registering the same IC/staff-no/email, and a
-- restored trainer can't collide with itself. Names contain "_ic_" /
-- "_staff_" — see header note; mapErr() in actions.ts depends on this.
create unique index if not exists trainers_active_ic_unique
  on public.trainers (lower(ic_passport_no)) where deleted_at is null and ic_passport_no is not null;

create unique index if not exists trainers_active_staff_unique
  on public.trainers (lower(staff_no)) where deleted_at is null and staff_no is not null;

create unique index if not exists trainers_active_email_unique
  on public.trainers (lower(email)) where deleted_at is null and email is not null;

create index if not exists idx_trainers_status on public.trainers (status) where deleted_at is null;
create index if not exists idx_trainers_department on public.trainers (department) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. Triggers — updated_at + generic audit (matches public.companies, the
--    other deleted_at-based module in this schema; app.audit_trigger()
--    already recognizes a deleted_at null->set / set->null transition as
--    'delete' / 'restore' rather than a plain 'update', so
--    softDeleteTrainer()/restoreTrainer() are logged correctly with no
--    further changes needed here).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_trainers_updated_at on public.trainers;
create trigger trg_trainers_updated_at
  before update on public.trainers
  for each row execute function app.set_updated_at();

drop trigger if exists trg_trainers_audit on public.trainers;
create trigger trg_trainers_audit
  after insert or delete or update on public.trainers
  for each row execute function app.audit_trigger();

-- ---------------------------------------------------------------------------
-- 5. Module-aware authorization helpers (app schema — not PostgREST-exposed;
--    SECURITY DEFINER; safe search_path). Mirrors app.can_manage_assessors()
--    / app.can_manage_schedule_assessors() from
--    20260817002100_assessor_security_integrity.sql, combined with the same
--    role floor the app layer already enforces
--    (requireRole("editor")/requireRole("admin") in the trainers module).
-- ---------------------------------------------------------------------------
create or replace function app.can_view_trainers()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select app.is_super_admin()
    or (app.has_min_role('editor'::public.user_role) and public.has_module_access_level('trainers', 'view'));
$$;

create or replace function app.can_manage_trainers()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select app.is_super_admin()
    or (app.has_min_role('admin'::public.user_role) and public.has_module_access_level('trainers', 'view'));
$$;

revoke all on function app.can_view_trainers() from public;
revoke all on function app.can_manage_trainers() from public;
grant execute on function app.can_view_trainers() to authenticated;
grant execute on function app.can_manage_trainers() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS + grants — no DELETE path (soft-delete only, per task requirement).
-- ---------------------------------------------------------------------------
alter table public.trainers enable row level security;

drop policy if exists trainers_read on public.trainers;
create policy trainers_read on public.trainers
  for select to authenticated using (app.can_view_trainers());

drop policy if exists trainers_insert on public.trainers;
create policy trainers_insert on public.trainers
  for insert to authenticated with check (app.can_manage_trainers());

drop policy if exists trainers_update on public.trainers;
create policy trainers_update on public.trainers
  for update to authenticated using (app.can_manage_trainers()) with check (app.can_manage_trainers());

-- No trainers_delete policy: hard delete is not supported. Deactivate via
-- deleted_at (softDeleteTrainer) / restoreTrainer instead.
drop policy if exists trainers_delete on public.trainers;

revoke all on public.trainers from anon;
revoke delete on public.trainers from authenticated;
grant select, insert, update on public.trainers to authenticated;
