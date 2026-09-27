-- I3A FORCE RLS policy contract. Local PostgreSQL only; read-only catalog assertions.
begin;

do $$
declare
  v_policy record;
  v_table text;
  v_function text;
  v_function_oid regprocedure;
  v_privilege text;
  v_tables text[] := array[
    'certificate_branches',
    'certificate_issuance_snapshots',
    'certificate_reissue_events'
  ];
  v_client_tables text[] := array[
    'certificates',
    'certificate_branches',
    'certificate_issuance_snapshots',
    'certificate_reissue_events'
  ];
  v_direct_write_privileges text[] := array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  v_lifecycle_functions text[] := array[
    'app.request_actor_id()',
    'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)',
    'app.duplicate_certificate_with_skill_snapshot(uuid)',
    'app.reissue_certificate(uuid,text,text,jsonb)',
    'app.revoke_certificate(uuid,text)',
    'app.update_certificate_metadata(uuid,date,text)',
    'app.set_certificate_deleted(uuid,boolean)',
    'app.set_certificate_verification_enabled(uuid,boolean)',
    'app.import_legacy_certificate(uuid,uuid,jsonb)',
    'public.issue_certificate_with_skill_snapshot(uuid,uuid,text)',
    'public.duplicate_certificate_with_skill_snapshot(uuid)',
    'public.reissue_certificate(uuid,text,text,jsonb)',
    'public.revoke_certificate(uuid,text)',
    'public.update_certificate_metadata(uuid,date,text)',
    'public.set_certificate_deleted(uuid,boolean)',
    'public.set_certificate_verification_enabled(uuid,boolean)',
    'public.import_legacy_certificate(uuid,uuid,jsonb)'
  ];
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres' and rolbypassrls)
    or not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
    raise exception 'I3A test database does not match hosted BYPASSRLS role attributes';
  end if;
  if not exists (
    select 1 from pg_roles
    where rolname = 'certificate_lifecycle_executor' and not rolbypassrls
  ) then
    raise exception 'I3A lifecycle executor must remain NOBYPASSRLS';
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

  -- Keep ACL assertions as defense in depth alongside RLS/policy checks.
  -- Authenticated reads remain module-gated by RLS; clients receive no direct
  -- table-write privileges, and anon has no direct table access.
  foreach v_table in array v_client_tables loop
    if has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
      or has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
      or has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
      or has_table_privilege('anon', format('public.%I', v_table), 'TRUNCATE') then
      raise exception 'I3A anon must have no direct ACL access to public.%', v_table;
    end if;
    if not has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') then
      raise exception 'I3A authenticated module-gated SELECT ACL is missing on public.%', v_table;
    end if;
    foreach v_privilege in array v_direct_write_privileges loop
      if has_table_privilege('authenticated', format('public.%I', v_table), v_privilege) then
        raise exception 'I3A authenticated retains direct % privilege on public.%', v_privilege, v_table;
      end if;
    end loop;
  end loop;

  select * into v_policy from pg_policies
  where schemaname = 'public' and tablename = 'certificate_branches'
    and policyname = 'certificate_branches_lifecycle_rpc_read';
  if not found or v_policy.cmd <> 'SELECT'
    or v_policy.roles <> array['certificate_lifecycle_executor']::name[]
    or position('is_active' in coalesce(v_policy.qual, '')) = 0
    or position('is_admin' in coalesce(v_policy.qual, '')) = 0
    or position('has_module_access_level' in coalesce(v_policy.qual, '')) = 0 then
    raise exception 'I3A branch lifecycle policy is absent or broader than the admin/module gate';
  end if;

  select * into v_policy from pg_policies
  where schemaname = 'public' and tablename = 'certificate_issuance_snapshots'
    and policyname = 'certificate_issuance_snapshots_lifecycle_rpc_insert';
  if not found or v_policy.cmd <> 'INSERT'
    or v_policy.roles <> array['certificate_lifecycle_executor']::name[]
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
    or v_policy.roles <> array['certificate_lifecycle_executor']::name[]
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
    or v_policy.roles <> array['certificate_lifecycle_executor']::name[]
    or position('is_active' in coalesce(v_policy.qual, '')) = 0
    or position('is_admin' in coalesce(v_policy.qual, '')) = 0
    or position('has_module_access_level' in coalesce(v_policy.qual, '')) = 0 then
    raise exception 'I3A event RETURNING read policy is absent or broader than the admin/module gate';
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

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'certificate_branches'
      and cmd in ('SELECT', 'ALL') and roles && array['anon', 'public']::name[]
  ) or exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('certificate_issuance_snapshots', 'certificate_reissue_events')
      and cmd in ('INSERT', 'ALL')
      and roles && array['anon', 'authenticated', 'public']::name[]
  ) then
    raise exception 'I3A lifecycle RLS policies expose anonymous reads or client direct INSERT';
  end if;

  if not has_table_privilege('authenticated', 'public.certificate_issuance_snapshots', 'SELECT')
    or not has_table_privilege('authenticated', 'public.certificate_reissue_events', 'SELECT') then
    raise exception 'I3A must preserve authenticated module-gated lifecycle reads';
  end if;

  foreach v_function in array v_lifecycle_functions loop
    v_function_oid := to_regprocedure(v_function);
    if v_function_oid is null or not exists (
      select 1 from pg_proc p
      where p.oid = v_function_oid
        and p.proowner = 'certificate_lifecycle_executor'::regrole
    ) then
      raise exception 'I3A lifecycle implementation is missing or not executor-owned: %', v_function;
    end if;
  end loop;
  raise notice 'HOSTED_FORCE_RLS_CONTRACT: PASS';
end;
$$;

rollback;
