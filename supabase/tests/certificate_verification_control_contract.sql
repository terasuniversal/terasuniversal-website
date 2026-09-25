-- C5B1/I2 verification-control contract.
--
-- BEHAVIORAL RUN RULES:
--   * Isolated local/test PostgreSQL only; never connect to STAGING or Production.
--   * Run this whole file on one PostgreSQL session with ON_ERROR_STOP enabled.
--   * This file opens a transaction, creates only C5B1-SYNTHETIC fixtures,
--     exercises verify_and_log (which writes audit logs), and explicitly rolls
--     back before a post-rollback existence check. Never run on Production.
--   * A PASS requires the final post-rollback DO block to succeed. If execution
--     stops before ROLLBACK, disconnect the session and verify fixture absence
--     with an independent read-only check before reporting any result.
--   * No participant PII is used; no result rows or tokens are printed.
--
-- Matrix exercised: valid + both flags true; verification_enabled false;
-- public_verification_enabled false; both flags false; draft; archived; deleted;
-- revoked; expired; valid and issued with expiry in the past; unknown certificate/token;
-- C2 snapshot-backed display; legacy without snapshot; legacy verifier ACL;
-- identity_no public lookup closure. legacy import compatibility false and admin
-- admin toggle false/true are asserted against installed function definitions below.
-- unknown lifecycle state is fail-closed by the verifier whitelist; current
-- database CHECK constraints reject unknown states before fixture insertion.

begin;

do $$
declare
  v_fn oid;
  v_def text;
  v_def_compact text;
  v_result record;
  v_count integer;
  v_token text;
  v_public_id uuid := '00000000-0000-4000-8000-00000000c5b1';
  v_course_id uuid := '00000000-0000-4000-8000-00000000c5b2';

begin
  select p.oid, pg_catalog.pg_get_functiondef(p.oid)
    into v_fn, v_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'verify_and_log'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)
      = 'p_query text, p_method text, p_ip text, p_ua text';

  if v_fn is null then raise exception 'C5B1 verifier missing'; end if;
  if not (select prosecdef from pg_catalog.pg_proc where oid = v_fn) then
    raise exception 'C5B1 verifier must remain SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = v_fn and p.proconfig @> array['search_path=pg_catalog']
  ) then raise exception 'C5B1 verifier search_path is not pinned'; end if;
  if pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid = v_fn)) <> 'postgres' then
    raise exception 'C5B1 verifier owner changed';
  end if;
  if not pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'C5B1 verifier expected EXECUTE grants are missing';
  end if;

  if v_def not like '%verification_enabled is false%'
    or v_def not like '%public_verification_enabled%'
    or v_def not like '%valid%issued%expired%revoked%' then
    raise exception 'C5B1 verifier policy clauses are missing';
  end if;

  -- Verify the legacy functions remain available only to the explicit trusted
  -- service role; no anon/authenticated identity_no lookup bypass may remain.
  foreach v_fn in array array[
    pg_catalog.to_regprocedure('public.verify_certificate(text)'),
    pg_catalog.to_regprocedure('public.verify_certificate_by_value(text)')
  ] loop
    if v_fn is null then raise exception 'C5B1 legacy verifier missing'; end if;
    if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'C5B1 legacy verifier remains callable by anon/authenticated';
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'C5B1 trusted service_role compatibility grant missing';
    end if;
  end loop;

  v_fn := pg_catalog.to_regprocedure('public.verify_certificate_by_token(text)');
  if v_fn is not null and (
    pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
  ) then raise exception 'C5B1 token-only legacy verifier retains a non-owner grant'; end if;

  select pg_catalog.pg_get_functiondef(p.oid) into v_def
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)');
  if v_def is null or v_def not like '%public_verification_enabled%'
    or v_def not like '%verification_enabled%' then
    raise exception 'C5B1 legacy import does not map both verification fields';
  end if;
  v_def_compact := pg_catalog.lower(pg_catalog.regexp_replace(v_def, '[[:space:]]', '', 'g'));
  if pg_catalog.strpos(v_def_compact, 'public_verification_enabled,verification_enabled') = 0
    or pg_catalog.strpos(v_def_compact, 'v_public_verification_enabled,v_public_verification_enabled') = 0
    or pg_catalog.strpos(v_def_compact, '::pg_catalog.bool,true') = 0
    or pg_catalog.strpos(v_def_compact, 'certificate_issuance_snapshots') > 0 then
    raise exception 'C5B1 legacy import compatibility mapping/default/snapshot contract failed';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid) into v_def
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('app.set_certificate_verification_enabled(uuid,boolean)');
  if v_def is null or v_def not like '%verification_enabled%'
    or v_def not like '%public_verification_enabled%' then
    raise exception 'C5B1 admin toggle does not synchronize both fields';
  end if;
  v_def_compact := pg_catalog.lower(pg_catalog.regexp_replace(v_def, '[[:space:]]', '', 'g'));
  if pg_catalog.strpos(v_def_compact, 'setverification_enabled=p_enabled,public_verification_enabled=p_enabled') = 0
    or pg_catalog.strpos(v_def_compact, 'app.is_active()') = 0
    or pg_catalog.strpos(v_def_compact, 'app.is_admin()') = 0
    or pg_catalog.strpos(v_def_compact, 'has_module_access_level(''certificates'',''admin'')') = 0
    or pg_catalog.strpos(v_def_compact, 'deleted_atisnull') = 0 then
    raise exception 'C5B1 admin toggle authorization/existence/synchronization contract failed';
  end if;

  if exists (select 1 from public.participants where id = v_public_id)
    or exists (select 1 from public.courses where id = v_course_id)
    or exists (
      select 1 from public.certificates
      where certificate_no like 'C5B1-SYNTHETIC-%'
        or verification_token like 'C5B1-SYNTHETIC-%'
        or identity_no like 'C5B1-SYNTHETIC-%'
    ) or exists (
      select 1 from public.certificate_verifications
      where pg_catalog.upper(query_value) like 'C5B1-SYNTHETIC-%'
    ) then
    raise exception 'C5B1 fixture key collision; refusing to write test rows';
  end if;

  insert into public.participants (id, full_name, status)
  values (v_public_id, 'C5B1 Synthetic Holder', 'active');
  insert into public.courses (id, course_name, title, active)
  values (v_course_id, 'C5B1 Synthetic Course', 'C5B1 Synthetic Course', true);

  insert into public.certificates (
    id, certificate_no, certificate_number, verification_token,
    participant_name, holder_name, participant_id, course_id,
    course_name, issue_date, expiry_date, status,
    verification_enabled, public_verification_enabled, deleted_at
  ) values
    ('00000000-0000-4000-8000-00000000c501', 'C5B1-SYNTHETIC-VALID', 'C5B1-SYNTHETIC-VALID', 'C5B1-SYNTHETIC-TOKEN-VALID', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date, current_date + 30, 'valid', true, true, null),
    ('00000000-0000-4000-8000-00000000c502', 'C5B1-SYNTHETIC-CANONICAL-OFF', 'C5B1-SYNTHETIC-CANONICAL-OFF', 'C5B1-SYNTHETIC-TOKEN-CANONICAL-OFF', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date, null, 'valid', false, true, null),
    ('00000000-0000-4000-8000-00000000c503', 'C5B1-SYNTHETIC-COMPAT-OFF', 'C5B1-SYNTHETIC-COMPAT-OFF', 'C5B1-SYNTHETIC-TOKEN-COMPAT-OFF', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date, null, 'valid', true, false, null),
    ('00000000-0000-4000-8000-00000000c504', 'C5B1-SYNTHETIC-BOTH-OFF', 'C5B1-SYNTHETIC-BOTH-OFF', 'C5B1-SYNTHETIC-TOKEN-BOTH-OFF', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date, null, 'valid', false, false, null),
    ('00000000-0000-4000-8000-00000000c505', 'C5B1-SYNTHETIC-DRAFT', 'C5B1-SYNTHETIC-DRAFT', 'C5B1-SYNTHETIC-TOKEN-DRAFT', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date, null, 'draft', true, true, null),
    ('00000000-0000-4000-8000-00000000c506', 'C5B1-SYNTHETIC-ARCHIVED', 'C5B1-SYNTHETIC-ARCHIVED', 'C5B1-SYNTHETIC-TOKEN-ARCHIVED', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date, null, 'archived', true, true, null),
    ('00000000-0000-4000-8000-00000000c507', 'C5B1-SYNTHETIC-REVOKED', 'C5B1-SYNTHETIC-REVOKED', 'C5B1-SYNTHETIC-TOKEN-REVOKED', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date, null, 'revoked', true, true, null),
    ('00000000-0000-4000-8000-00000000c508', 'C5B1-SYNTHETIC-EXPIRED', 'C5B1-SYNTHETIC-EXPIRED', 'C5B1-SYNTHETIC-TOKEN-EXPIRED', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date - 90, current_date - 1, 'expired', true, true, null),
    ('00000000-0000-4000-8000-00000000c509', 'C5B1-SYNTHETIC-VALID-PAST', 'C5B1-SYNTHETIC-VALID-PAST', 'C5B1-SYNTHETIC-TOKEN-VALID-PAST', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date - 90, current_date - 1, 'valid', true, true, null),
    ('00000000-0000-4000-8000-00000000c510', 'C5B1-SYNTHETIC-ISSUED-PAST', 'C5B1-SYNTHETIC-ISSUED-PAST', 'C5B1-SYNTHETIC-TOKEN-ISSUED-PAST', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date - 90, current_date - 1, 'issued', true, true, null),
    ('00000000-0000-4000-8000-00000000c511', 'C5B1-SYNTHETIC-DELETED', 'C5B1-SYNTHETIC-DELETED', 'C5B1-SYNTHETIC-TOKEN-DELETED', 'C5B1 Synthetic Holder', 'C5B1 Synthetic Holder', v_public_id, v_course_id, 'C5B1 Synthetic Course', current_date, null, 'valid', true, true, now());

  update public.certificates
  set identity_no = 'C5B1-SYNTHETIC-IDENTITY-ONLY'
  where id = '00000000-0000-4000-8000-00000000c501';
  if not found then raise exception 'identity_no lookup closure fixture was not created'; end if;

  insert into public.certificate_issuance_snapshots (
    certificate_id, holder_name, course_name, participant_code_snapshot,
    company_snapshot, training_start_date, training_end_date, render_payload
  ) values (
    '00000000-0000-4000-8000-00000000c501',
    'C5B1 Snapshot Holder', 'C5B1 Snapshot Course', 'C5B1-SNAPSHOT-CODE',
    'C5B1 Snapshot Company', current_date - 20, current_date - 10,
    '{"display":"C5B1 immutable test snapshot"}'::jsonb
  );

  select * into v_result
  from public.verify_and_log('C5B1-SYNTHETIC-TOKEN-VALID', 'token', null, 'C5B1 synthetic test');
  if not found or not v_result.found or not v_result.is_valid or v_result.status <> 'valid' then
    raise exception 'valid + both flags true case failed';
  end if;

  for v_token in
    select token from (values
      ('C5B1-SYNTHETIC-TOKEN-CANONICAL-OFF'),
      ('C5B1-SYNTHETIC-TOKEN-COMPAT-OFF'),
      ('C5B1-SYNTHETIC-TOKEN-BOTH-OFF'),
      ('C5B1-SYNTHETIC-TOKEN-DRAFT'),
      ('C5B1-SYNTHETIC-TOKEN-ARCHIVED'),
      ('C5B1-SYNTHETIC-TOKEN-DELETED')
    ) as hidden(token)
  loop
    select * into v_result from public.verify_and_log(v_token, 'token', null, 'C5B1 synthetic test');
    if found then raise exception 'hidden-state no-details case failed'; end if;
  end loop;

  select * into v_result
  from public.verify_and_log('C5B1-SYNTHETIC-TOKEN-REVOKED', 'token', null, 'C5B1 synthetic test');
  if not found or not v_result.found or v_result.is_valid or v_result.status <> 'revoked' then
    raise exception 'revoked visible-invalid case failed';
  end if;

  select * into v_result
  from public.verify_and_log('C5B1-SYNTHETIC-TOKEN-EXPIRED', 'token', null, 'C5B1 synthetic test');
  if not found or not v_result.found or v_result.is_valid or v_result.status <> 'expired' then
    raise exception 'expired visible-invalid case failed';
  end if;

  for v_token in
    select token from (values
      ('C5B1-SYNTHETIC-TOKEN-VALID-PAST'),
      ('C5B1-SYNTHETIC-TOKEN-ISSUED-PAST')
    ) as expired(token)
  loop
    select * into v_result from public.verify_and_log(v_token, 'token', null, 'C5B1 synthetic test');
    if not found or not v_result.found or v_result.is_valid or v_result.status <> 'expired' then
      raise exception 'past-expiry effective status case failed';
    end if;
  end loop;

  -- Preserve case-insensitive certificate-number lookup semantics.
  select * into v_result
  from public.verify_and_log('c5b1-synthetic-valid', 'number', null, 'C5B1 synthetic test');
  if not found or not v_result.found then raise exception 'certificate-number lookup case failed'; end if;

  -- This identifier exists only in identity_no, never in the public number or
  -- token columns. The verifier must return no row and log only not_found.
  select pg_catalog.count(*) into v_count
  from public.verify_and_log('C5B1-SYNTHETIC-IDENTITY-ONLY', 'auto', null, 'C5B1 identity closure test');
  if v_count <> 0 then raise exception 'identity_no public lookup closure failed'; end if;
  if not exists (
    select 1 from public.certificate_verifications
    where query_value = 'C5B1-SYNTHETIC-IDENTITY-ONLY'
      and method = 'auto'
      and status_returned = 'not_found'
      and certificate_id is null
      and certificate_number is null
  ) then raise exception 'identity_no lookup did not resolve to generic not_found'; end if;

  -- Modern public verification prefers the captured historical holder when a
  -- snapshot exists; course/company/code/date fields remain snapshot-first.
  if v_result.course_title <> 'C5B1 Snapshot Course'
    or v_result.holder_name <> 'C5B1 Snapshot Holder'
    or v_result.company <> 'C5B1 Snapshot Company'
    or v_result.participant_code_masked not like 'C5B1%'
    or v_result.training_start_date <> current_date - 20 then
    raise exception 'C2 snapshot display regression';
  end if;

  select * into v_result
  from public.verify_and_log('C5B1-SYNTHETIC-TOKEN-VALID', 'token', null, 'C5B1 synthetic test');
  if v_result.course_title <> 'C5B1 Snapshot Course' then
    raise exception 'C2 snapshot data changed during verification';
  end if;
  if exists (
    select 1 from public.certificate_issuance_snapshots
    where certificate_id = '00000000-0000-4000-8000-00000000c501'
      and (holder_name <> 'C5B1 Snapshot Holder'
        or company_snapshot <> 'C5B1 Snapshot Company'
        or participant_code_snapshot <> 'C5B1-SNAPSHOT-CODE'
        or course_name <> 'C5B1 Snapshot Course'
        or training_start_date is distinct from current_date - 20
        or training_end_date is distinct from current_date - 10
        or render_payload <> '{"display":"C5B1 immutable test snapshot"}'::jsonb)
  ) then raise exception 'C2 snapshot row was modified'; end if;

  select * into v_result
  from public.verify_and_log('C5B1-SYNTHETIC-TOKEN-REVOKED', 'token', null, 'C5B1 synthetic test');
  -- A legacy row has no snapshot and resolves its current course master fallback.
  if not exists (
    select 1 from public.certificates c
    where c.verification_token = 'C5B1-SYNTHETIC-TOKEN-REVOKED'
      and not exists (select 1 from public.certificate_issuance_snapshots s where s.certificate_id = c.id)
  ) then raise exception 'legacy no-snapshot fixture was not created'; end if;
  if v_result.course_title <> 'C5B1 Synthetic Course' then
    raise exception 'legacy no-snapshot fallback case failed';
  end if;

  select * into v_result
  from public.verify_and_log('C5B1-SYNTHETIC-UNKNOWN', 'token', null, 'C5B1 synthetic test');
  if found then raise exception 'unknown token must return no details'; end if;
  select * into v_result
  from public.verify_and_log('C5B1-SYNTHETIC-UNKNOWN-NUMBER', 'number', null, 'C5B1 synthetic test');
  if found then raise exception 'unknown certificate number must return no details'; end if;

  select pg_catalog.count(*) into v_count
  from public.certificate_verifications
  where query_value like 'C5B1-SYNTHETIC-%';
  if v_count < 12 then raise exception 'verification logging regression'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (select 1 from public.participants where id = '00000000-0000-4000-8000-00000000c5b1')
    or exists (select 1 from public.courses where id = '00000000-0000-4000-8000-00000000c5b2')
    or exists (select 1 from public.certificates where certificate_no like 'C5B1-SYNTHETIC-%')
    or exists (select 1 from public.certificate_issuance_snapshots where certificate_id = '00000000-0000-4000-8000-00000000c501')
    or exists (select 1 from public.certificate_verifications where pg_catalog.upper(query_value) like 'C5B1-SYNTHETIC-%') then
    raise exception 'C5B1 rollback verification failed';
  end if;
  raise notice 'C5B1 rollback verification succeeded';
end;
$$;
