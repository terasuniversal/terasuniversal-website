-- C2C: structural contract for database-enforced certificate immutability.
-- Runtime mutation cases require an authenticated Staging fixture and are
-- executed by the C2C runtime matrix; this file is safe to run read-only.

do $$
declare
  v_required text[] := array[
    'certificate_no', 'certificate_number', 'verification_token',
    'verification_url', 'participant_name', 'holder_name', 'identity_no',
    'identity_last4', 'participant_id', 'course_id', 'schedule_id',
    'course_name', 'course_code', 'training_start_date', 'training_end_date',
    'venue', 'trainer_name', 'instructor', 'template_id', 'issue_date',
    'issued_by', 'replaces_certificate_id', 'certificate_file_url',
    'metadata', 'legacy_batch_id'
  ];
  v_field text;
  v_definition text;
  v_count integer;
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.certificates'::regclass
      and tgname = 'trg_certificate_historical_update_guard'
      and not tgisinternal
  ) then
    raise exception 'C2C historical immutability trigger is missing';
  end if;

  select pg_get_functiondef('app.certificate_historical_update_guard()'::regprocedure)
    into v_definition;
  foreach v_field in array v_required loop
    if position(format('new.%s is distinct from old.%s', v_field, v_field) in v_definition) = 0 then
      raise exception 'C2C protected field is missing from guard: %', v_field;
    end if;
  end loop;

  foreach v_field in array array[
    'revoke_certificate(uuid,text)',
    'update_certificate_metadata(uuid,date,text)',
    'set_certificate_deleted(uuid,boolean)',
    'set_certificate_verification_enabled(uuid,boolean)'
  ] loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.oid::regprocedure::text = format('app.%s', v_field)
        and p.prosecdef
        and p.proconfig @> array['search_path=public, app, extensions']::text[]
    ) then
      raise exception 'C2C operational SECURITY DEFINER RPC contract is missing: %', v_field;
    end if;
  end loop;

  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'certificates'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_count <> 0 then
    raise exception 'C2C ordinary direct certificate write privilege remains: % rows', v_count;
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'certificates' and cmd in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'C2C ordinary certificate write policy remains';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'::regprocedure
  ) then
    raise exception 'C2A issuance RPC is missing';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'app.duplicate_certificate_with_skill_snapshot(uuid)'::regprocedure
  ) then
    raise exception 'C2A duplicate RPC is missing';
  end if;
  select pg_get_functiondef('app.duplicate_certificate_with_skill_snapshot(uuid)'::regprocedure)
    into v_definition;
  if position('security definer' in lower(v_definition)) = 0
     or position('auth.uid()' in v_definition) = 0
     or position('app.is_active()' in v_definition) = 0
     or position('app.is_admin()' in v_definition) = 0
     or position('has_module_access_level(' in v_definition) = 0
     or position('set verification_url = ''/verify/'' || v_token' in v_definition) = 0 then
    raise exception 'C2C duplicate RPC security or verification URL contract is incomplete';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'app.duplicate_certificate_with_skill_snapshot(uuid)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=public, app, extensions']::text[]
  ) then
    raise exception 'C2C duplicate RPC search_path is not pinned';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'app.reissue_certificate(uuid,text,text,jsonb)'::regprocedure
  ) then
    raise exception 'C2A reissue RPC is missing';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'app.import_legacy_certificate(uuid,uuid,jsonb)'::regprocedure
  ) or not exists (
    select 1 from pg_proc
    where oid = 'public.import_legacy_certificate(uuid,uuid,jsonb)'::regprocedure
  ) then
    raise exception 'C2C legacy import RPC contract is missing';
  end if;

  if (select count(*) from public.certificate_issuance_snapshots) <> 0
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'certificate_issuance_snapshots') then
    raise exception 'C2A snapshot RLS policy is missing';
  end if;
  if (select count(*) from public.certificate_reissue_events) <> 0
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'certificate_reissue_events') then
    raise exception 'C2A reissue-event RLS policy is missing';
  end if;

  raise notice 'certificate_historical_immutability_contract: PASS';
end;
$$;
