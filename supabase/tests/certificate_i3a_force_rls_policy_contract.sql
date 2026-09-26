-- I3A FORCE RLS policy contract. Local PostgreSQL only; read-only catalog assertions.
begin;

do $$
declare
  v_policy record;
  v_table text;
  v_tables text[] := array[
    'certificate_branches',
    'certificate_issuance_snapshots',
    'certificate_reissue_events'
  ];
begin
  if exists (
    select 1 from pg_roles
    where rolname = 'postgres' and (rolsuper or rolbypassrls)
  ) then
    raise exception 'I3A test owner must be neither SUPERUSER nor BYPASSRLS';
  end if;

  foreach v_table in array v_tables loop
    if not exists (
      select 1 from pg_class c
      where c.oid = format('public.%I', v_table)::regclass
        and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception 'I3A FORCE RLS missing for public.%', v_table;
    end if;
  end loop;

  select * into v_policy from pg_policies
  where schemaname = 'public' and tablename = 'certificate_branches'
    and policyname = 'certificate_branches_lifecycle_rpc_read';
  if not found or v_policy.cmd <> 'SELECT'
    or v_policy.roles <> array['postgres']::name[]
    or position('is_active' in coalesce(v_policy.qual, '')) = 0
    or position('is_admin' in coalesce(v_policy.qual, '')) = 0
    or position('has_module_access_level' in coalesce(v_policy.qual, '')) = 0 then
    raise exception 'I3A branch lifecycle policy is absent or broader than the admin/module gate';
  end if;

  select * into v_policy from pg_policies
  where schemaname = 'public' and tablename = 'certificate_issuance_snapshots'
    and policyname = 'certificate_issuance_snapshots_lifecycle_rpc_insert';
  if not found or v_policy.cmd <> 'INSERT'
    or v_policy.roles <> array['postgres']::name[]
    or position('is_active' in coalesce(v_policy.with_check, '')) = 0
    or position('is_admin' in coalesce(v_policy.with_check, '')) = 0
    or position('has_module_access_level' in coalesce(v_policy.with_check, '')) = 0
    or position('created_by' in coalesce(v_policy.with_check, '')) = 0 then
    raise exception 'I3A snapshot lifecycle policy is absent or broader than the admin/module/actor gate';
  end if;

  select * into v_policy from pg_policies
  where schemaname = 'public' and tablename = 'certificate_reissue_events'
    and policyname = 'certificate_reissue_events_lifecycle_rpc_insert';
  if not found or v_policy.cmd <> 'INSERT'
    or v_policy.roles <> array['postgres']::name[]
    or position('is_active' in coalesce(v_policy.with_check, '')) = 0
    or position('is_admin' in coalesce(v_policy.with_check, '')) = 0
    or position('has_module_access_level' in coalesce(v_policy.with_check, '')) = 0
    or position('reissued_by' in coalesce(v_policy.with_check, '')) = 0 then
    raise exception 'I3A reissue-event lifecycle policy is absent or broader than the admin/module/actor gate';
  end if;

  select * into v_policy from pg_policies
  where schemaname = 'public' and tablename = 'certificate_reissue_events'
    and policyname = 'certificate_reissue_events_lifecycle_rpc_read';
  if not found or v_policy.cmd <> 'SELECT'
    or v_policy.roles <> array['postgres']::name[]
    or position('is_active' in coalesce(v_policy.qual, '')) = 0
    or position('is_admin' in coalesce(v_policy.qual, '')) = 0
    or position('has_module_access_level' in coalesce(v_policy.qual, '')) = 0
    or position('reissued_by' in coalesce(v_policy.qual, '')) = 0 then
    raise exception 'I3A event RETURNING read policy is absent or broader than the admin/module/actor gate';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='certificate_branches'
      and policyname='certificate_branches_read' and cmd='SELECT'
      and roles=array['authenticated']::name[]
      and position('has_module_access' in coalesce(qual,'')) > 0
  ) or not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='certificate_issuance_snapshots'
      and policyname='certificate_issuance_snapshots_read' and cmd='SELECT'
      and roles=array['authenticated']::name[]
      and position('has_module_access' in coalesce(qual,'')) > 0
  ) or not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='certificate_reissue_events'
      and policyname='certificate_reissue_events_read' and cmd='SELECT'
      and roles=array['authenticated']::name[]
      and position('has_module_access' in coalesce(qual,'')) > 0
  ) then
    raise exception 'I3A existing authenticated module-boundary SELECT policy changed';
  end if;

  if has_table_privilege('anon', 'public.certificate_branches', 'SELECT')
    or has_table_privilege('authenticated', 'public.certificate_issuance_snapshots', 'INSERT')
    or has_table_privilege('anon', 'public.certificate_issuance_snapshots', 'INSERT')
    or has_table_privilege('authenticated', 'public.certificate_reissue_events', 'INSERT')
    or has_table_privilege('anon', 'public.certificate_reissue_events', 'INSERT') then
    raise exception 'I3A must not grant anonymous branch reads or direct lifecycle INSERT';
  end if;

  if not has_table_privilege('authenticated', 'public.certificate_issuance_snapshots', 'SELECT')
    or not has_table_privilege('authenticated', 'public.certificate_reissue_events', 'SELECT') then
    raise exception 'I3A must preserve authenticated module-gated lifecycle reads';
  end if;
end;
$$;

rollback;
