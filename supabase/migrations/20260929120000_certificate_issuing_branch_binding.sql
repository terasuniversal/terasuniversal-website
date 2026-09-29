-- Phase A recovery: deterministic issuing-branch binding for every course
-- schedule.
--
-- Context: app.issue_certificate_with_skill_snapshot (20260922160000:196-204)
-- requires course_schedules.branch_id to reference an active
-- certificate_branches row. The application has no branch configuration path,
-- and course_schedules.branch_id is nullable with no default and no trigger,
-- so every schedule created through the app is left NULL and issuance fails
-- with 'Certificate issuing branch is not configured.'
--
-- This migration does NOT remove or weaken that RPC gate. It makes the
-- invariant "every schedule carries an active issuing branch" satisfiable and
-- durable:
--   1. ensure the unique deterministic HQ issuing branch exists/active,
--   2. resolve one shared default-branch function,
--   3. make the column default and a BEFORE INSERT guard use it,
--   4. backfill schedules still missing one.
-- Forward-only and idempotent. Does not touch certificates, snapshots, or any
-- other certificate object.

begin;

do $phase_a_precondition$
begin
  if current_user <> 'postgres' then
    raise exception 'Phase A issuing-branch binding requires migration role postgres';
  end if;
  if to_regclass('public.certificate_branches') is null
     or to_regclass('public.course_schedules') is null then
    raise exception 'Phase A precondition failed: certificate_branches/course_schedules missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course_schedules' and column_name = 'branch_id'
  ) then
    raise exception 'Phase A precondition failed: course_schedules.branch_id missing';
  end if;
  if to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)') is null then
    raise exception 'Phase A precondition failed: certificate issuance RPC missing';
  end if;
  if position(
       'Certificate issuing branch is not configured.' in
       pg_catalog.pg_get_functiondef(to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'))
     ) = 0
     or position(
       'Certificate issuing branch is inactive or missing.' in
       pg_catalog.pg_get_functiondef(to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'))
     ) = 0 then
    raise exception 'Phase A precondition failed: existing issuer branch validation is not present';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'certificate_branches'
      and c.conname = 'certificate_branches_code_key'
      and c.contype = 'u'
  ) then
    raise exception 'Phase A precondition failed: certificate branch natural key is not unique';
  end if;
end;
$phase_a_precondition$;

-- 1. Resolve or create the single default issuing branch. branch_code 'HQ' is
--    the established TERAS issuing identity; reuse it if present, otherwise
--    create it. Idempotent.
do $phase_a_seed$
declare
  v_default_id uuid;
begin
  select b.id into v_default_id
  from public.certificate_branches b
  where b.branch_code = 'HQ'
  order by b.created_at, b.id
  limit 1;

  if v_default_id is null then
    insert into public.certificate_branches (branch_code, branch_name, display_address, is_active)
    values (
      'HQ',
      'TERAS UNIVERSAL SDN. BHD.',
      'Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia',
      true
    )
    on conflict (branch_code) do nothing;
    select b.id into v_default_id
    from public.certificate_branches b
    where b.branch_code = 'HQ';
  end if;

  if v_default_id is null then
    raise exception 'Phase A seed failed: could not resolve a default issuing branch';
  end if;

  -- Avoid a no-op UPDATE (and its audit trigger) when the canonical row is
  -- already active. Never rewrite an existing branch's name/address here.
  update public.certificate_branches
  set is_active = true
  where id = v_default_id and is_active is distinct from true;
end;
$phase_a_seed$;

-- 2. Shared resolver: only the canonical active HQ branch is a default.
--    SECURITY DEFINER because certificate_branches is FORCE RLS; the owner
--    (postgres) has BYPASSRLS, so resolution is never blocked by a caller's
--    module access. A different active branch is not a silent fallback.
create or replace function app.default_schedule_branch_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $fn$
  select b.id
  from public.certificate_branches b
  where b.branch_code = 'HQ' and b.is_active
  limit 1;
$fn$;

revoke all on function app.default_schedule_branch_id() from public, anon, authenticated, service_role;
grant execute on function app.default_schedule_branch_id() to authenticated, service_role;

-- 3. Database guard: fill NULLs from the canonical resolver, reject a
--    conflicting explicit branch, and rebind restored schedules if their
--    branch was absent. This covers app writes and direct DB/RPC inserts.
create or replace function app.set_schedule_default_branch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $trg$
declare
  v_default_branch_id uuid;
begin
  -- Soft-deleting a schedule does not need branch validation. On restore,
  -- a legacy NULL branch is filled; unchanged valid assignments are retained.
  if tg_op = 'UPDATE' and new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.branch_id is not distinct from old.branch_id
     and new.branch_id is not null then
    return new;
  end if;

  v_default_branch_id := app.default_schedule_branch_id();
  if v_default_branch_id is null then
    raise exception 'Canonical TERAS HQ issuing branch is missing or inactive.' using errcode = 'P0001';
  end if;

  if new.branch_id is null then
    new.branch_id := v_default_branch_id;
  elsif new.branch_id is distinct from v_default_branch_id then
    raise exception 'New schedules must use the canonical active TERAS HQ issuing branch.' using errcode = 'P0001';
  end if;
  return new;
end;
$trg$;

revoke all on function app.set_schedule_default_branch() from public, anon, authenticated, service_role;

drop trigger if exists trg_course_schedules_default_branch on public.course_schedules;
create trigger trg_course_schedules_default_branch
  before insert or update of branch_id, deleted_at on public.course_schedules
  for each row execute function app.set_schedule_default_branch();

-- 4. Declarative default for writers that omit the column entirely.
alter table public.course_schedules
  alter column branch_id set default app.default_schedule_branch_id();

-- 5. Backfill live schedules still missing a branch. Soft-deleted schedules
--    are preserved without rewriting even if their legacy branch is NULL.
update public.course_schedules
set branch_id = app.default_schedule_branch_id()
where branch_id is null and deleted_at is null;

-- 6. Postconditions: the invariant must now hold.
do $phase_a_postcondition$
declare
  v_missing integer;
begin
  if (select count(*) from public.certificate_branches where branch_code = 'HQ') <> 1
     or not exists (
       select 1 from public.certificate_branches
       where branch_code = 'HQ'
         and branch_name = 'TERAS UNIVERSAL SDN. BHD.'
         and is_active
     ) then
    raise exception 'Phase A postcondition failed: canonical HQ branch is not unique, named, and active';
  end if;
  if app.default_schedule_branch_id() is distinct from
     (select b.id from public.certificate_branches b where b.branch_code = 'HQ' and b.is_active) then
    raise exception 'Phase A postcondition failed: resolver did not return the canonical active HQ branch';
  end if;
  select count(*) into v_missing from public.course_schedules where branch_id is null and deleted_at is null;
  if v_missing <> 0 then
    raise exception 'Phase A postcondition failed: % live schedules still lack a branch', v_missing;
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class r on r.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'course_schedules'
      and t.tgname = 'trg_course_schedules_default_branch'
      and not t.tgisinternal
      and (t.tgtype & 1) = 1 -- ROW
      and (t.tgtype & 2) = 2 -- BEFORE
      and (t.tgtype & 4) = 4 -- INSERT
      and (t.tgtype & 16) = 16 -- UPDATE
  ) then
    raise exception 'Phase A postcondition failed: default-branch trigger missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname = 'default_schedule_branch_id'
      and p.prosecdef
      and p.proconfig = array['search_path=pg_catalog']
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception 'Phase A postcondition failed: branch resolver security contract is incorrect';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname = 'set_schedule_default_branch'
      and p.prosecdef
      and p.proconfig = array['search_path=pg_catalog']
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception 'Phase A postcondition failed: branch trigger function security contract is incorrect';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_attrdef d
    join pg_catalog.pg_class r on r.oid = d.adrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum = d.adnum
    where n.nspname = 'public'
      and r.relname = 'course_schedules'
      and a.attname = 'branch_id'
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) like '%default_schedule_branch_id%'
  ) then
    raise exception 'Phase A postcondition failed: branch_id default is not wired to the canonical resolver';
  end if;
end;
$phase_a_postcondition$;

commit;
