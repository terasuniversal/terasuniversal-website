-- Legacy Participant Migration, Phase 3 final hardening. Two independent
-- fixes:
--   1. A real server-verifiable Dry Run -> Execute gate. Previously nothing
--      stopped Execute from running against a batch that had never been
--      dry-run, or whose approved-row state had changed since the last dry
--      run was reviewed.
--   2. Certificate issue_date was fabricated as coalesce(training_start_date,
--      current_date) -- current_date is the import date, not evidence.

-- ---------------------------------------------------------------------
-- 1. Dry-run checkpoint + staleness gate.
--
-- legacy_import_batches gets two small additive columns: dry_run_at (when
-- the last dry run ran) and dry_run_hash (a fingerprint of the
-- merge-relevant state it reviewed). Nothing about the whole plan is
-- stored -- just a digest, the smallest representation that can still
-- detect drift.
alter table public.legacy_import_batches
  add column if not exists dry_run_at timestamptz,
  add column if not exists dry_run_hash text;

-- Shared fingerprint, used identically by legacy_merge_dry_run (to record
-- the checkpoint) and legacy_merge_verify_checkpoint (to compare against
-- it) -- one definition, so the two can never silently drift apart.
--
-- Scope: every row currently 'approved' or 'merged'. 'approved' rows are
-- what a dry run/execute actually operates on; 'merged' rows are included
-- too so that a retry after a partial batch failure produces the SAME
-- fingerprint as before that partial run (a row's own tracked fields --
-- identity, course, certificate number, dates -- don't change when it
-- transitions from approved to merged, and it stays in the same IN-list
-- either way) -- an established retry does not need a fresh dry run.
-- What DOES change the fingerprint: a tracked field changing while a row
-- is still approved, a previously-approved row becoming rejected (drops
-- out of the set), or a previously-pending row becoming newly approved
-- (enters the set) -- exactly the "participant decision / course mapping
-- / row approval state / certificate number / training date" conditions
-- called out as required triggers for DRY_RUN_STALE.
--
-- Target-table collision/state drift (e.g. someone else creates a
-- colliding participant or certificate number between dry run and
-- execute) is deliberately NOT folded into this fingerprint: doing so
-- would make a normal merged-row-marked-ALREADY_MERGED re-derivation
-- differ from its original CREATE_NEW/LINK_EXISTING prediction on every
-- single retry, breaking the established idempotent-retry design for no
-- safety benefit. That class of drift is already handled correctly by
-- legacy_merge_execute_row's own fresh, atomic DB lookups at the moment
-- of execution (proven in QA: a certificate_no collision introduced after
-- planning still fails that specific row cleanly, never silently
-- succeeds or duplicates) -- dry run is a preview, not a guarantee, and
-- execution's own atomicity is what actually protects the data.
create or replace function app.legacy_merge_fingerprint(p_batch_id uuid) returns text
language sql
security definer
set search_path = public, app, extensions
as $$
  select encode(
    digest(
      coalesce(
        string_agg(
          s.id::text || '|' ||
          coalesce(s.match_status, '') || '|' ||
          coalesce(s.matched_participant_id::text, '') || '|' ||
          coalesce(s.mapped_course_id::text, '') || '|' ||
          coalesce(trim(s.raw_certificate_number), '') || '|' ||
          coalesce(s.training_start_date::text, '') || '|' ||
          coalesce(s.training_end_date::text, ''),
          ',' order by s.id
        ),
        ''
      ),
      'sha256'
    ),
    'hex'
  )
  from public.legacy_participant_staging s
  where s.batch_id = p_batch_id
    and s.review_status in ('approved', 'merged');
$$;

revoke all on function app.legacy_merge_fingerprint(uuid) from public;

-- Rewritten dry run: same batch-aware simulation as 20260824140000, plus
-- (a) an id tie-breaker on the row order, matching execution's own order
-- exactly, (b) the certificate/no-evidenced-date action, and (c) writing
-- the dry_run_at/dry_run_hash checkpoint every time it runs.
create or replace function public.legacy_merge_dry_run(p_batch_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_batch record;
  v_row record;
  v_rows jsonb := '[]'::jsonb;
  v_plan jsonb;
  v_eligible boolean;
  v_participant_action text;
  v_participant_existing_id uuid;
  v_participant_ref text;
  v_schedule_action text;
  v_schedule_existing_id uuid;
  v_schedule_ref text;
  v_schedule_key text;
  v_end_date date;
  v_enrollment_action text;
  v_enrollment_key text;
  v_certificate_action text;
  v_cert_key text;
  v_planned_participants jsonb := '{}'::jsonb;
  v_planned_schedules jsonb := '{}'::jsonb;
  v_planned_enrollments jsonb := '{}'::jsonb;
  v_planned_certs jsonb := '{}'::jsonb;
  v_hash text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;

  for v_row in
    select * from public.legacy_participant_staging where batch_id = p_batch_id order by source_row_number, id
  loop
    v_eligible := (
      v_row.review_status = 'approved'
      and v_row.validation_error is null
      and v_row.match_status in ('exact_match', 'new_participant')
      and (v_row.raw_course_name is null or v_row.mapped_course_id is not null)
    );

    -- PARTICIPANT
    v_participant_existing_id := null;
    v_participant_ref := null;
    if v_row.review_status = 'merged' then
      v_participant_action := 'ALREADY_MERGED';
      v_participant_ref := v_row.result_participant_id::text;
    elsif v_row.review_status <> 'approved' then
      v_participant_action := 'BLOCKED_NOT_APPROVED';
    elsif v_row.validation_error is not null then
      v_participant_action := 'BLOCKED_VALIDATION_ERROR';
    elsif v_row.match_status = 'exact_match' and v_row.matched_participant_id is not null then
      v_participant_action := 'LINK_EXISTING';
      v_participant_existing_id := v_row.matched_participant_id;
      v_participant_ref := v_row.matched_participant_id::text;
    elsif v_row.match_status = 'new_participant' then
      select id into v_participant_existing_id
      from public.participants
      where deleted_at is null
        and v_row.normalized_ic_passport is not null
        and (
          regexp_replace(coalesce(identity_no, ''), '[^A-Za-z0-9]', '', 'g') = v_row.normalized_ic_passport
          or regexp_replace(coalesce(ic_passport_no, ''), '[^A-Za-z0-9]', '', 'g') = v_row.normalized_ic_passport
        )
      limit 1;

      if v_participant_existing_id is not null then
        v_participant_action := 'LINK_EXISTING';
        v_participant_ref := v_participant_existing_id::text;
      elsif v_row.normalized_ic_passport is not null and v_planned_participants ? v_row.normalized_ic_passport then
        v_participant_action := 'REUSE_PLANNED_NEW';
        v_participant_ref := v_planned_participants ->> v_row.normalized_ic_passport;
      else
        v_participant_action := 'CREATE_NEW';
        v_participant_ref := 'NEW#' || v_row.id::text;
        if v_row.normalized_ic_passport is not null then
          v_planned_participants := v_planned_participants || jsonb_build_object(v_row.normalized_ic_passport, v_participant_ref);
        end if;
      end if;
    else
      v_participant_action := 'BLOCKED_IDENTITY_UNRESOLVED';
    end if;

    -- HISTORICAL SCHEDULE
    v_schedule_action := null;
    v_schedule_existing_id := null;
    v_schedule_ref := null;
    if v_row.mapped_course_id is null and v_row.raw_course_name is not null then
      v_schedule_action := 'NO_SCHEDULE_COURSE_UNMAPPED';
    elsif v_row.mapped_course_id is null or v_row.training_start_date is null then
      v_schedule_action := 'NO_SCHEDULE_POSSIBLE';
    else
      v_end_date := coalesce(v_row.training_end_date, v_row.training_start_date);
      v_schedule_key := v_row.mapped_course_id::text || '|' || v_row.training_start_date::text || '|' || v_end_date::text;

      select id into v_schedule_existing_id
      from public.course_schedules
      where course_id = v_row.mapped_course_id
        and start_date = v_row.training_start_date
        and end_date = v_end_date
        and legacy_batch_id = p_batch_id
      limit 1;

      if v_schedule_existing_id is not null then
        v_schedule_action := 'REUSE_EXISTING_HISTORICAL';
        v_schedule_ref := v_schedule_existing_id::text;
      elsif v_planned_schedules ? v_schedule_key then
        v_schedule_action := 'REUSE_PLANNED_HISTORICAL';
        v_schedule_ref := v_planned_schedules ->> v_schedule_key;
      else
        v_schedule_action := 'CREATE_HISTORICAL';
        v_schedule_ref := 'NEW#' || v_row.id::text;
        v_planned_schedules := v_planned_schedules || jsonb_build_object(v_schedule_key, v_schedule_ref);
      end if;
    end if;

    -- ENROLLMENT
    if v_schedule_ref is null or v_participant_ref is null
       or v_participant_action like 'BLOCKED%' or v_participant_action = 'ALREADY_MERGED' then
      v_enrollment_action := 'SKIP_NOT_EVIDENCED';
    else
      v_enrollment_key := v_participant_ref || '::' || v_schedule_ref;
      if v_participant_ref not like 'NEW#%' and v_schedule_ref not like 'NEW#%' and exists (
        select 1 from public.schedule_participants
        where schedule_id = v_schedule_ref::uuid
          and participant_id = v_participant_ref::uuid
          and deleted_at is null
          and registration_status <> 'cancelled'
      ) then
        v_enrollment_action := 'REUSE_EXISTING_ENROLLMENT';
      elsif v_planned_enrollments ? v_enrollment_key then
        v_enrollment_action := 'REUSE_PLANNED_ENROLLMENT';
      else
        v_enrollment_action := 'CREATE_ENROLLMENT';
        v_planned_enrollments := v_planned_enrollments || jsonb_build_object(v_enrollment_key, true);
      end if;
    end if;

    -- CERTIFICATE. issue_date has no nullable representation (certificates
    -- module-wide NOT NULL, relied on for display/PDF/verification) and
    -- current_date must never be substituted -- a certificate number with
    -- no evidenced training_start_date is blocked, not fabricated.
    if v_row.raw_certificate_number is null or length(trim(v_row.raw_certificate_number)) = 0 then
      v_certificate_action := 'NO_CERTIFICATE_NO_NUMBER';
    else
      v_cert_key := trim(v_row.raw_certificate_number);
      if v_row.training_start_date is null then
        v_certificate_action := 'BLOCKED_CERTIFICATE_DATE_REQUIRED';
      elsif exists (select 1 from public.certificates where certificate_no = v_cert_key) then
        v_certificate_action := 'CONFLICT_CERT_NUMBER_EXISTS';
      elsif v_planned_certs ? v_cert_key then
        v_certificate_action := 'CONFLICT_CERT_NUMBER_DUPLICATE_IN_BATCH';
      else
        v_certificate_action := 'CREATE_PRESERVE_NUMBER';
        v_planned_certs := v_planned_certs || jsonb_build_object(v_cert_key, v_row.id::text);
      end if;
    end if;

    v_plan := jsonb_build_object(
      'row_id', v_row.id,
      'source_row_number', v_row.source_row_number,
      'raw_name', v_row.raw_name,
      'review_status', v_row.review_status,
      'match_status', v_row.match_status,
      'eligible', v_eligible,
      'participant_action', v_participant_action,
      'participant_existing_id', v_participant_existing_id,
      'schedule_action', v_schedule_action,
      'schedule_existing_id', v_schedule_existing_id,
      'enrollment_action', v_enrollment_action,
      'attendance_action', 'NOT_CREATED_NO_EVIDENCE',
      'assessment_action', 'NOT_CREATED_NO_EVIDENCE',
      'certificate_action', v_certificate_action
    );
    v_rows := v_rows || jsonb_build_array(v_plan);
  end loop;

  v_hash := app.legacy_merge_fingerprint(p_batch_id);
  update public.legacy_import_batches
  set dry_run_at = now(), dry_run_hash = v_hash
  where id = p_batch_id;

  perform public.log_event_as_service(auth.uid(), (select email from public.profiles where id = auth.uid()),
    'update'::audit_action, 'legacy_import_batches', p_batch_id::text, 'Dry run requested for legacy import batch', jsonb_build_object('batch_id', p_batch_id, 'dry_run_hash', v_hash));

  return jsonb_build_object('batch_id', p_batch_id, 'batch_status', v_batch.status, 'dry_run_hash', v_hash, 'rows', v_rows);
end;
$$;

revoke all on function public.legacy_merge_dry_run(uuid) from public;
grant execute on function public.legacy_merge_dry_run(uuid) to authenticated;

-- Server-verifiable gate: recomputes the fingerprint the exact same way
-- and compares against the stored checkpoint. Called by executeMerge()
-- before processing any row -- if this raises, zero rows are touched.
create or replace function public.legacy_merge_verify_checkpoint(p_batch_id uuid) returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_batch record;
  v_current_hash text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;

  if v_batch.dry_run_at is null or v_batch.dry_run_hash is null then
    raise exception 'dry_run_required' using errcode = 'P0001';
  end if;

  v_current_hash := app.legacy_merge_fingerprint(p_batch_id);
  if v_current_hash <> v_batch.dry_run_hash then
    raise exception 'DRY_RUN_STALE' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.legacy_merge_verify_checkpoint(uuid) from public;
grant execute on function public.legacy_merge_verify_checkpoint(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Certificate issue_date: real evidence only, never fabricated.
--
-- certificates.issue_date is NOT NULL and relied on module-wide (list/
-- export/reports/PDF "Date of Completion"/public verification) -- making
-- it nullable would be a real, broad schema change, not a scoped one, so
-- it is NOT changed here. Instead: a certificate number is only ever
-- created using the row's own evidenced training_start_date as issue_date
-- (never coalesce(...,  current_date)); a certificate number with no
-- evidenced training_start_date fails that row cleanly and atomically
-- (same shape as certificate_number_collision) rather than substituting
-- the import date -- reviewable via merge_error, never silently wrong.
create or replace function public.legacy_merge_execute_row(p_batch_id uuid, p_row_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_row public.legacy_participant_staging%rowtype;
  v_batch record;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_participant_id uuid;
  v_schedule_id uuid;
  v_enrollment_id uuid;
  v_certificate_id uuid;
  v_end_date date;
  v_err text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;
  if v_batch.status <> 'approved' then
    raise exception 'batch_not_approved' using errcode = 'P0001';
  end if;

  select * into v_row from public.legacy_participant_staging where id = p_row_id and batch_id = p_batch_id;
  if v_row.id is null then
    raise exception 'row_not_found' using errcode = 'P0001';
  end if;

  if v_row.review_status = 'merged' then
    return jsonb_build_object(
      'status', 'already_merged', 'row_id', p_row_id,
      'participant_id', v_row.result_participant_id, 'schedule_id', v_row.result_schedule_id,
      'enrollment_id', v_row.result_enrollment_id, 'certificate_id', v_row.result_certificate_id
    );
  end if;
  if v_row.review_status <> 'approved' then
    raise exception 'row_not_approved' using errcode = 'P0001';
  end if;
  if v_row.validation_error is not null then
    raise exception 'row_has_validation_error' using errcode = 'P0001';
  end if;
  if v_row.match_status not in ('exact_match', 'new_participant') then
    raise exception 'identity_not_resolved' using errcode = 'P0001';
  end if;
  if v_row.raw_course_name is not null and v_row.mapped_course_id is null then
    raise exception 'course_not_mapped' using errcode = 'P0001';
  end if;

  begin
    -- 1. Participant.
    if v_row.match_status = 'exact_match' and v_row.matched_participant_id is not null then
      v_participant_id := v_row.matched_participant_id;
    else
      if v_row.normalized_ic_passport is not null then
        perform pg_advisory_xact_lock(hashtext('legacy_participant_ic:' || v_row.normalized_ic_passport));
      end if;

      select id into v_participant_id
      from public.participants
      where deleted_at is null
        and v_row.normalized_ic_passport is not null
        and (
          regexp_replace(coalesce(identity_no, ''), '[^A-Za-z0-9]', '', 'g') = v_row.normalized_ic_passport
          or regexp_replace(coalesce(ic_passport_no, ''), '[^A-Za-z0-9]', '', 'g') = v_row.normalized_ic_passport
        )
      limit 1;

      if v_participant_id is null then
        insert into public.participants (full_name, ic_passport_no, company, legacy_batch_id)
        values (v_row.raw_name, v_row.raw_ic_passport, v_row.raw_company, p_batch_id)
        returning id into v_participant_id;
      end if;
    end if;

    -- 2. Historical schedule.
    if v_row.mapped_course_id is not null and v_row.training_start_date is not null then
      v_end_date := coalesce(v_row.training_end_date, v_row.training_start_date);

      perform pg_advisory_xact_lock(hashtext(
        'legacy_schedule:' || p_batch_id::text || '|' || v_row.mapped_course_id::text || '|' ||
        v_row.training_start_date::text || '|' || v_end_date::text
      ));

      select id into v_schedule_id
      from public.course_schedules
      where course_id = v_row.mapped_course_id
        and start_date = v_row.training_start_date
        and end_date = v_end_date
        and legacy_batch_id = p_batch_id
      limit 1;

      if v_schedule_id is null then
        insert into public.course_schedules (course_id, start_date, end_date, status, capacity, is_published, legacy_batch_id, notes)
        values (
          v_row.mapped_course_id, v_row.training_start_date, v_end_date,
          'completed', null, false, p_batch_id,
          'Legacy historical schedule reconstructed from imported source data. Trainer, venue, exam date, and capacity were not recorded by the source and are intentionally left blank.'
        )
        returning id into v_schedule_id;
      end if;
    end if;

    -- 3. Enrollment.
    if v_schedule_id is not null then
      select id into v_enrollment_id
      from public.schedule_participants
      where schedule_id = v_schedule_id
        and participant_id = v_participant_id
        and deleted_at is null
        and registration_status <> 'cancelled'
      limit 1;

      if v_enrollment_id is null then
        insert into public.schedule_participants (schedule_id, participant_id, registration_status, legacy_batch_id)
        values (v_schedule_id, v_participant_id, 'completed', p_batch_id)
        returning id into v_enrollment_id;
      end if;
    end if;

    -- 4/5. Attendance and assessment: never created.

    -- 6. Certificate: preserve the exact source number; issue_date is the
    -- row's own evidenced training_start_date, never a substituted
    -- current_date. A number with no evidenced date fails this row
    -- cleanly rather than fabricating one.
    if v_row.raw_certificate_number is not null and length(trim(v_row.raw_certificate_number)) > 0 then
      if v_row.training_start_date is null then
        raise exception 'certificate_date_required';
      end if;
      if exists (select 1 from public.certificates where certificate_no = trim(v_row.raw_certificate_number)) then
        raise exception 'certificate_number_collision';
      end if;
      insert into public.certificates (certificate_no, participant_id, course_id, participant_name, course_name, issue_date, schedule_id, legacy_batch_id)
      values (
        trim(v_row.raw_certificate_number), v_participant_id, v_row.mapped_course_id,
        v_row.raw_name, coalesce(v_row.raw_course_name, ''), v_row.training_start_date,
        v_schedule_id, p_batch_id
      )
      returning id into v_certificate_id;
    end if;

    update public.legacy_participant_staging
    set review_status = 'merged',
        result_participant_id = v_participant_id,
        result_schedule_id = v_schedule_id,
        result_enrollment_id = v_enrollment_id,
        result_certificate_id = v_certificate_id,
        merged_at = now(),
        merge_error = null
    where id = p_row_id;

    perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'legacy_participant_staging', p_row_id::text,
      format('Legacy row "%s" merged (participant=%s, schedule=%s, enrollment=%s, certificate=%s)', v_row.raw_name, v_participant_id, v_schedule_id, v_enrollment_id, v_certificate_id),
      jsonb_build_object('batch_id', p_batch_id, 'row_id', p_row_id, 'participant_id', v_participant_id, 'schedule_id', v_schedule_id, 'enrollment_id', v_enrollment_id, 'certificate_id', v_certificate_id));

    return jsonb_build_object(
      'status', 'merged', 'row_id', p_row_id,
      'participant_id', v_participant_id, 'schedule_id', v_schedule_id,
      'enrollment_id', v_enrollment_id, 'certificate_id', v_certificate_id
    );

  exception when others then
    v_err := sqlerrm;
    update public.legacy_participant_staging set merge_error = v_err where id = p_row_id;
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'legacy_participant_staging', p_row_id::text,
      format('Legacy row "%s" merge FAILED: %s', v_row.raw_name, v_err),
      jsonb_build_object('batch_id', p_batch_id, 'row_id', p_row_id, 'error', v_err));
    return jsonb_build_object('status', 'failed', 'row_id', p_row_id, 'error', v_err);
  end;
end;
$$;

revoke all on function public.legacy_merge_execute_row(uuid, uuid) from public;
grant execute on function public.legacy_merge_execute_row(uuid, uuid) to authenticated;
