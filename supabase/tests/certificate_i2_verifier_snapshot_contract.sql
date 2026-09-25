-- I2 verifier historical-source regression. Local/test PostgreSQL only.
-- Synthetic records and verification logs are transaction-scoped and rolled back.

begin;

do $$
declare
  v_participant uuid := '00000000-0000-4000-8000-00000000d101';
  v_course uuid := '00000000-0000-4000-8000-00000000d102';
  v_modern uuid := '00000000-0000-4000-8000-00000000d103';
  v_missing_code uuid := '00000000-0000-4000-8000-00000000d104';
  v_legacy uuid := '00000000-0000-4000-8000-00000000d105';
  v_issued uuid := '00000000-0000-4000-8000-00000000d107';
  v_result record;
  v_public jsonb;
begin
  if exists (select 1 from public.participants where id = v_participant)
    or exists (select 1 from public.courses where id = v_course)
    or exists (select 1 from public.certificates where id in (v_modern, v_missing_code, v_legacy, v_issued))
    or exists (select 1 from public.certificate_verifications where query_value like 'I2-SNAPSHOT-%') then
    raise exception 'I2 synthetic fixture collision; refusing to write test rows';
  end if;

  insert into public.participants (id, full_name, status, participant_id, company, ic_passport_no)
  values (v_participant, 'I2 Live Holder', 'active', '123456', 'I2 Live Company', 'I2-SYNTHETIC-PASSPORT-DO-NOT-RETURN');
  insert into public.courses (id, course_name, title, active)
  values (v_course, 'I2 Live Course', 'I2 Live Course', true);

  insert into public.certificates (
    id, certificate_no, certificate_number, verification_token,
    participant_name, holder_name, participant_id, course_id,
    course_name, training_start_date, training_end_date, issue_date, expiry_date,
    status, verification_enabled, public_verification_enabled, deleted_at
  ) values
    (v_modern, 'I2-SNAPSHOT-MODERN', 'I2-SNAPSHOT-MODERN', 'I2-SNAPSHOT-TOKEN-MODERN',
     'I2 Certificate Row Holder', 'I2 Certificate Row Holder', v_participant, v_course,
     'I2 Certificate Row Course', date '2026-09-01', date '2026-09-02', date '2026-09-10', null,
     'valid', true, true, null),
    (v_missing_code, 'I2-SNAPSHOT-NO-CODE', 'I2-SNAPSHOT-NO-CODE', 'I2-SNAPSHOT-TOKEN-NO-CODE',
     'I2 Certificate Row Holder', 'I2 Certificate Row Holder', v_participant, v_course,
     'I2 Certificate Row Course', date '2026-09-01', date '2026-09-02', date '2026-09-10', null,
     'valid', true, true, null),
    (v_legacy, 'I2-SNAPSHOT-LEGACY', 'I2-SNAPSHOT-LEGACY', 'I2-SNAPSHOT-TOKEN-LEGACY',
     'I2 Legacy Row Holder', 'I2 Legacy Row Holder', v_participant, v_course,
     'I2 Legacy Row Course', date '2026-09-01', date '2026-09-02', date '2026-09-10', null,
     'valid', true, true, null),
    (v_issued, 'I2-SNAPSHOT-ISSUED', 'I2-SNAPSHOT-ISSUED', 'I2-SNAPSHOT-TOKEN-ISSUED',
     'I2 Issued Holder', 'I2 Issued Holder', v_participant, v_course,
     'I2 Issued Course', date '2026-09-01', date '2026-09-02', date '2026-09-10', null,
     'issued', true, true, null);

  insert into public.certificate_issuance_snapshots (
    certificate_id, holder_name, course_name, participant_code_snapshot,
    company_snapshot, training_start_date, training_end_date, issue_date,
    render_payload
  ) values
    (v_modern, 'I2 Captured Historical Holder', 'I2 Captured Historical Course', '123456',
     'I2 Captured Historical Company', date '2026-08-01', date '2026-08-02', date '2026-08-03',
     '{"source":"I2 synthetic snapshot"}'::pg_catalog.jsonb),
    (v_missing_code, 'I2 Captured Holder Without Code', 'I2 Captured Course Without Code', null,
     'I2 Captured Company Without Code', date '2026-08-04', date '2026-08-05', date '2026-08-06',
     '{"source":"I2 synthetic snapshot without participant code"}'::pg_catalog.jsonb);

  update public.participants
  set participant_id = 'I2-CURRENT-MUTABLE-CODE', company = 'I2 Current Mutable Company'
  where id = v_participant;
  update public.courses
  set course_name = 'I2 Current Mutable Course', title = 'I2 Current Mutable Course'
  where id = v_course;

  select * into v_result
  from public.verify_and_log('I2-SNAPSHOT-TOKEN-MODERN', 'token', null, 'I2 synthetic snapshot test');
  if not found or not v_result.found then raise exception 'I2 modern snapshot certificate was not found'; end if;
  if v_result.holder_name <> 'I2 Captured Historical Holder' then
    raise exception 'I2 fail: holder name did not prefer the captured snapshot';
  end if;
  if v_result.participant_code_masked <> '••••56' then
    raise exception 'I2 fail: short participant code was not masked to its final two characters';
  end if;
  if v_result.company <> 'I2 Captured Historical Company'
    or v_result.course_title <> 'I2 Captured Historical Course'
    or v_result.training_start_date <> date '2026-08-01'
    or v_result.training_end_date <> date '2026-08-02'
    or v_result.issue_date <> date '2026-08-03' then
    raise exception 'I2 fail: snapshot fields differ: company=%, course=%, start=%, end=%, issue=%', v_result.company, v_result.course_title, v_result.training_start_date, v_result.training_end_date, v_result.issue_date;
  end if;
  v_public := pg_catalog.to_jsonb(v_result);
  if v_public::text like '%I2-SYNTHETIC-PASSPORT-DO-NOT-RETURN%'
    or v_public ? 'identity_no' or v_public ? 'ic_passport_no' then
    raise exception 'I2 fail: prohibited identity data is present in public verification output';
  end if;

  select * into v_result
  from public.verify_and_log('I2-SNAPSHOT-TOKEN-NO-CODE', 'token', null, 'I2 synthetic no-code test');
  if not found or v_result.participant_code_masked is not null then
    raise exception 'I2 fail: modern snapshot with no captured participant code fell back to mutable participant data';
  end if;

  select * into v_result
  from public.verify_and_log('I2-SNAPSHOT-TOKEN-ISSUED', 'token', null, 'I2 synthetic issued test');
  if not found or not v_result.found or not v_result.is_valid or v_result.status <> 'valid' then
    raise exception 'I2 fail: unexpired issued certificate was not handled as valid';
  end if;

  select * into v_result
  from public.verify_and_log('I2-SNAPSHOT-TOKEN-LEGACY', 'token', null, 'I2 synthetic legacy test');
  if not found or v_result.participant_code_masked = 'I2-CURRENT-MUTABLE-CODE'
    or v_result.participant_code_masked not like 'I2-C%'
    or v_result.company <> 'I2 Current Mutable Company'
    or v_result.course_title <> 'I2 Current Mutable Course' then
    raise exception 'I2 legacy-only fallback or masking compatibility changed';
  end if;

  -- Exercise the defensive unknown-status branch by temporarily removing the
  -- repository CHECK constraint inside this transaction, then restore it.
  alter table public.certificates drop constraint certificates_status_check;
  insert into public.certificates (
    id, certificate_no, certificate_number, verification_token,
    participant_name, holder_name, participant_id, course_id, course_name,
    issue_date, status, verification_enabled, public_verification_enabled
  ) values (
    '00000000-0000-4000-8000-00000000d106', 'I2-SNAPSHOT-UNKNOWN', 'I2-SNAPSHOT-UNKNOWN',
    'I2-SNAPSHOT-TOKEN-UNKNOWN', 'I2 Synthetic Unknown', 'I2 Synthetic Unknown',
    v_participant, v_course, 'I2 Unknown Course', date '2026-09-01',
    'future_unknown', true, true
  );
  select * into v_result
  from public.verify_and_log('I2-SNAPSHOT-TOKEN-UNKNOWN', 'token', null, 'I2 synthetic unknown-status test');
  if found then raise exception 'I2 fail: unknown lifecycle status was returned as a public credential'; end if;
  delete from public.certificates where id = '00000000-0000-4000-8000-00000000d106';
  alter table public.certificates
    add constraint certificates_status_check
    check (status = any (array['valid'::text, 'expired'::text, 'revoked'::text, 'draft'::text, 'issued'::text, 'archived'::text]));
end;
$$;

rollback;

DO $$
begin
  if exists (select 1 from public.participants where id = '00000000-0000-4000-8000-00000000d101')
    or exists (select 1 from public.courses where id = '00000000-0000-4000-8000-00000000d102')
    or exists (select 1 from public.certificates where id in (
      '00000000-0000-4000-8000-00000000d103',
      '00000000-0000-4000-8000-00000000d104',
      '00000000-0000-4000-8000-00000000d105',
      '00000000-0000-4000-8000-00000000d107'))
    or exists (select 1 from public.certificate_verifications where query_value like 'I2-SNAPSHOT-%') then
    raise exception 'I2 snapshot regression rollback verification failed';
  end if;
  raise notice 'I2 snapshot regression probes rolled back';
end;
$$;
