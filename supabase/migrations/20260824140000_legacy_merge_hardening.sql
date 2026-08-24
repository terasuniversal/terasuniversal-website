-- Legacy Participant Migration, Phase 3 hardening. Fixes four real
-- data-integrity gaps found in review of 20260824130000:
--   1. fabricated schedule capacity (was hardcoded 9999)
--   2. historical-schedule identity too broad (cross-batch, ignored end_date)
--   3. dry run evaluated rows independently, hiding intra-batch collisions
--   4/5. no concurrency protection for participant/schedule creation

-- ---------------------------------------------------------------------
-- 1. Unknown capacity: NULL, not a fabricated number.
--
-- course_schedules.capacity was NOT NULL default 0. The check constraint
-- is `CHECK (seats_taken >= 0 AND seats_taken <= capacity)` -- verified
-- live in a throwaway temp-table copy of the real constraint that
-- capacity = NULL makes `seats_taken <= capacity` evaluate to NULL, which
-- Postgres CHECK constraints treat as satisfied (a constraint only fails
-- on an explicit FALSE), so app.sync_schedule_seats()'s later UPDATE of
-- seats_taken never fails once capacity is NULL. No new constraint or
-- trigger needed -- NULL is a genuine "unknown", not a number that has to
-- be reconciled against real enrollment counts.
--
-- This is also already the established pattern elsewhere in this app:
-- app/admin/(protected)/schedules/actions.ts already writes
-- `capacity: capacity ?? null` on the edit path, and
-- lib/validation/schemas.ts already has a `capacity: ... .nullable()`
-- variant -- the application layer already tolerates a null capacity.
-- Every EXISTING schedule keeps its real, already-stored capacity value;
-- only NEWLY created legacy historical schedules will ever get NULL here.
--
-- But dropping NOT NULL alone weakens the invariant for every normal,
-- non-legacy schedule too -- the app's own participant-assignment logic
-- (assignParticipants) computes `Number(capacity) || 0`, so a normal
-- schedule that somehow ended up with NULL capacity would silently look
-- full (0 seats) rather than erroring loudly. A scoped CHECK constraint
-- closes that gap: capacity is only ever allowed to be NULL when the row
-- is a legacy-import-created historical schedule. Verified zero existing
-- normal schedules currently have NULL capacity, so this adds cleanly.
alter table public.course_schedules
  alter column capacity drop not null;

alter table public.course_schedules
  add constraint course_schedules_capacity_required_unless_legacy
  check (capacity is not null or legacy_batch_id is not null);

-- ---------------------------------------------------------------------
-- 2 & 3 & 4 & 5: rewritten dry run (batch-aware simulation) and execute
-- (batch-scoped schedule identity, advisory-lock concurrency protection,
-- null capacity).
--
-- Dry-run/execution parity (see also section F of the accompanying
-- report): both functions use the IDENTICAL deterministic keys --
--   participant: normalized_ic_passport (via the same regexp-normalized
--     lookup against participants.identity_no / ic_passport_no)
--   schedule: (legacy_batch_id = this batch, course_id, start_date,
--     end_date) where end_date is always coalesce(training_end_date,
--     training_start_date) on both sides
--   enrollment: the existing schedule_participants_active_unique
--     condition (deleted_at is null and registration_status <> 'cancelled')
--   certificate: certificate_no exact match
-- Dry run additionally tracks what earlier rows IN THE SAME SIMULATED PASS
-- would have created, so a later row correctly predicts REUSE_PLANNED_*
-- instead of independently re-predicting CREATE_NEW for the same identity.
-- Execution never trusts a prior dry-run result -- every row's execute
-- call re-derives its own state fresh from the database (plus the
-- advisory lock's re-check-after-lock), so if real state changed between
-- dry run and execution (another admin, a previous partial run), execution
-- still finds and reuses/creates correctly rather than blindly replaying
-- a stale plan.
create or replace function public.legacy_merge_dry_run(p_batch_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, app
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
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;

  for v_row in
    select * from public.legacy_participant_staging where batch_id = p_batch_id order by source_row_number
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

    -- HISTORICAL SCHEDULE (batch-scoped identity: course + start + end,
    -- never reused across a different legacy batch)
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

    -- CERTIFICATE (intra-batch duplicate surfaced explicitly, not just a
    -- real-DB collision)
    if v_row.raw_certificate_number is null or length(trim(v_row.raw_certificate_number)) = 0 then
      v_certificate_action := 'NO_CERTIFICATE_NO_NUMBER';
    else
      v_cert_key := trim(v_row.raw_certificate_number);
      if exists (select 1 from public.certificates where certificate_no = v_cert_key) then
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

  perform public.log_event_as_service(auth.uid(), (select email from public.profiles where id = auth.uid()),
    'update'::audit_action, 'legacy_import_batches', p_batch_id::text, 'Dry run requested for legacy import batch', jsonb_build_object('batch_id', p_batch_id));

  return jsonb_build_object('batch_id', p_batch_id, 'batch_status', v_batch.status, 'rows', v_rows);
end;
$$;

revoke all on function public.legacy_merge_dry_run(uuid) from public;
grant execute on function public.legacy_merge_dry_run(uuid) to authenticated;

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
    -- 1. Participant. Advisory xact lock keyed by the normalized identity
    -- serializes two concurrent execute calls racing on the same person:
    -- the second blocks until the first's transaction ends, then its own
    -- lookup (run AFTER acquiring the lock, never before) finds what the
    -- first created. Narrow key -- never blocks unrelated identities.
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

    -- 2. Historical schedule. Identity is scoped to THIS batch + course +
    -- start + end date -- an identical course/date pair imported by a
    -- different legacy batch is never silently reused (each batch is its
    -- own evidence source). Same advisory-lock pattern as participants,
    -- keyed narrowly to this batch+course+date-range.
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
        -- capacity is left NULL -- not evidenced by the source, never
        -- fabricated (allowed only because legacy_batch_id is set here --
        -- see course_schedules_capacity_required_unless_legacy). status
        -- 'completed' and is_published = false (the column's own default
        -- is TRUE, so this must be set explicitly) keep a historical
        -- import from ever behaving like an open, bookable upcoming class:
        -- public.get_public_upcoming_schedules() filters on
        -- is_published = true before anything else, so a legacy schedule
        -- can never reach the public training calendar regardless of its
        -- status or dates. 'completed' is the closest existing
        -- schedule_status value to "finished historical training" --
        -- there is no dedicated "imported"/"historical" status in the
        -- enum, and inventing one is out of scope for this fix.
        insert into public.course_schedules (course_id, start_date, end_date, status, capacity, is_published, legacy_batch_id, notes)
        values (
          v_row.mapped_course_id, v_row.training_start_date, v_end_date,
          'completed', null, false, p_batch_id,
          'Legacy historical schedule reconstructed from imported source data. Trainer, venue, exam date, and capacity were not recorded by the source and are intentionally left blank.'
        )
        returning id into v_schedule_id;
      end if;
    end if;

    -- 3. Enrollment: respects the existing partial unique active-enrollment
    -- index (schedule_id, participant_id) WHERE deleted_at IS NULL AND
    -- registration_status <> 'cancelled' -- unchanged, still the real
    -- enforcement boundary; this lookup-then-insert is protected from
    -- racing itself because both the participant and schedule identities
    -- above are already serialized by their own advisory locks, so by the
    -- time execution reaches here the (participant_id, schedule_id) pair
    -- is stable for this transaction.
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

    -- 4/5. Attendance and assessment: never created, no evidence column
    -- exists for either from any currently-supported source.

    -- 6. Certificate: unchanged -- collision with an existing certificate_no
    -- is a hard failure for this row, never silently duplicated or skipped.
    if v_row.raw_certificate_number is not null and length(trim(v_row.raw_certificate_number)) > 0 then
      if exists (select 1 from public.certificates where certificate_no = trim(v_row.raw_certificate_number)) then
        raise exception 'certificate_number_collision';
      end if;
      insert into public.certificates (certificate_no, participant_id, course_id, participant_name, course_name, issue_date, schedule_id, legacy_batch_id)
      values (
        trim(v_row.raw_certificate_number), v_participant_id, v_row.mapped_course_id,
        v_row.raw_name, coalesce(v_row.raw_course_name, ''), coalesce(v_row.training_start_date, current_date),
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
