-- C3D structural contract. Read-only assertions; no fixture or data mutation.

do $$
declare
  v_definition text;
begin
  if to_regclass('public.certificate_skill_results') is null then
    raise exception 'certificate_skill_results table is missing';
  end if;

  if not has_table_privilege('authenticated', 'public.certificate_skill_results', 'SELECT') then
    raise exception 'authenticated SELECT access was removed';
  end if;

  if has_table_privilege('authenticated', 'public.certificate_skill_results', 'INSERT')
     or has_table_privilege('authenticated', 'public.certificate_skill_results', 'UPDATE')
     or has_table_privilege('authenticated', 'public.certificate_skill_results', 'DELETE')
     or has_table_privilege('authenticated', 'public.certificate_skill_results', 'TRUNCATE') then
    raise exception 'authenticated direct skill write privilege remains';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'certificate_skill_results'
      and policyname = 'certificate_skill_results_insert'
  ) then
    raise exception 'certificate_skill_results_insert policy remains';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'certificate_skill_results'
      and policyname = 'certificate_skill_results_select'
      and cmd = 'SELECT'
  ) then
    raise exception 'certificate skill SELECT policy is missing';
  end if;

  if not exists (select 1 from pg_proc where oid = 'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'::regprocedure) then
    raise exception 'controlled issuance RPC is missing';
  end if;
  if not exists (select 1 from pg_proc where oid = 'app.duplicate_certificate_with_skill_snapshot(uuid)'::regprocedure) then
    raise exception 'controlled duplicate RPC is missing';
  end if;

  select pg_get_functiondef('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'::regprocedure) into v_definition;
  if position('certificate_skill_results' in v_definition) = 0 or position('security definer' in lower(v_definition)) = 0 then
    raise exception 'controlled issuance writer contract is missing';
  end if;
  select pg_get_functiondef('app.duplicate_certificate_with_skill_snapshot(uuid)'::regprocedure) into v_definition;
  if position('certificate_skill_results' in v_definition) = 0 or position('security definer' in lower(v_definition)) = 0 then
    raise exception 'controlled duplicate writer contract is missing';
  end if;

  if exists (
    select 1 from pg_proc
    where oid in ('app.reissue_certificate(uuid,text,text,jsonb)'::regprocedure, 'app.import_legacy_certificate(uuid,uuid,jsonb)'::regprocedure)
      and position('certificate_skill_results' in pg_get_functiondef(oid)) > 0
  ) then
    raise exception 'reissue or legacy import unexpectedly writes certificate skills';
  end if;
end;
$$;

select 'C3D certificate skill write hardening contract: PASS' as result;
