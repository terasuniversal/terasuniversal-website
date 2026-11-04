-- DRAFT -- NOT APPLIED. Give new course schedules the certificate issuing branch automatically.
--
-- Why: app.issue_certificate_with_skill_snapshot refuses to issue when the schedule has no
-- branch_id ("Certificate issuing branch is not configured."), but no CRM path sets it: the
-- schedule form, duplicate-schedule and the Sales handoff all insert without branch_id. Every
-- new schedule therefore blocked its certificates until the branch was set by hand.
--
-- Target: Production iagzkrzeuawaxvacqprk. Forward-only, additive: one trigger function and one
-- BEFORE INSERT trigger on public.course_schedules. No existing row changes; filling the
-- schedules that already have no branch is a separate, separately approved data change.
--
-- Rule: on INSERT only, when branch_id is null and exactly one certificate_branches row is
-- active, use that branch. With zero or several active branches the column stays null, so
-- issuance keeps failing with the existing clear message instead of guessing a branch. An
-- explicitly supplied branch_id is never overwritten, and UPDATE is not affected.
--
-- SECURITY DEFINER because certificate_branches forces RLS and only certificates-module users
-- may read it, while schedules are created by schedules-module admins; the function reads only
-- the active branch ids, takes no arguments, has a fixed search_path, and only its owner may
-- execute it (checked below), so no other role can attach it to a table of their own.
--
-- Rollback: drop trigger trg_course_schedules_default_branch on public.course_schedules;
--           drop function app.default_course_schedule_branch();

begin;

do $$
declare
  v_fn boolean := to_regprocedure('app.default_course_schedule_branch()') is not null;
  v_trigger boolean;
begin
  if to_regnamespace('app') is null
     or to_regclass('public.course_schedules') is null
     or to_regclass('public.certificate_branches') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'course_schedules' and column_name = 'branch_id'
     ) then
    raise exception 'Default schedule branch requires schema app, public.certificate_branches and public.course_schedules.branch_id';
  end if;

  -- A re-run finds both already installed; anything half-present is not ours to replace.
  select exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.course_schedules'::regclass and tgname = 'trg_course_schedules_default_branch' and not tgisinternal
  ) into v_trigger;
  if v_fn <> v_trigger then
    raise exception 'app.default_course_schedule_branch and trg_course_schedules_default_branch are partly installed; inspect before applying';
  end if;
end $$;

create or replace function app.default_course_schedule_branch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_active uuid[];
begin
  if new.branch_id is null then
    select array_agg(b.id) into v_active
    from (select id from public.certificate_branches where is_active limit 2) b;
    if pg_catalog.cardinality(v_active) = 1 then
      new.branch_id := v_active[1];
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app.default_course_schedule_branch() from public, anon, authenticated, service_role;

-- PostgreSQL 14+ syntax (Production runs 17.6).
create or replace trigger trg_course_schedules_default_branch
  before insert on public.course_schedules
  for each row execute function app.default_course_schedule_branch();

-- Only the owner may execute it: nobody else can attach it to a table of their own.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p, pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = 'app.default_course_schedule_branch()'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> p.proowner
  ) then
    raise exception 'app.default_course_schedule_branch must be executable by its owner only';
  end if;
end $$;

commit;
