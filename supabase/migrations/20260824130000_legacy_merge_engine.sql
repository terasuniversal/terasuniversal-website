-- Legacy Participant Migration, Phase 3: controlled merge engine.
-- Approved Batch -> Dry Run Plan -> Human Review -> Execute Merge.
-- No row ever writes to a target table outside legacy_merge_execute_row(),
-- and that function only ever processes a row whose batch is 'approved'
-- and whose own review_status is 'approved' -- rejected rows are never
-- touched, pending/reviewed rows block (they're not eligible).

-- Additive result-tracking columns so a merge's outcome is queryable and a
-- rerun can tell what's already done. Nullable; existing rows stay null.
alter table public.legacy_participant_staging
  add column if not exists result_participant_id uuid references public.participants (id),
  add column if not exists result_schedule_id uuid references public.course_schedules (id),
  add column if not exists result_enrollment_id uuid references public.schedule_participants (id),
  add column if not exists result_certificate_id uuid references public.certificates (id),
  add column if not exists merge_error text,
  add column if not exists merged_at timestamptz;

-- Read-only preview: computes what legacy_merge_execute_row() would do for
-- every row in the batch, without writing anything. Ineligible rows show
-- why (BLOCKED). Reuse/create decisions mirror the execute function's own
-- lookup logic exactly, so the preview cannot lie about what execution
-- will actually do.
create or replace function public.legacy_merge_dry_run(p_batch_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_batch record;
  v_rows jsonb;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(plan order by (plan->>'source_row_number')::int), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'row_id', s.id,
      'source_row_number', s.source_row_number,
      'raw_name', s.raw_name,
      'review_status', s.review_status,
      'match_status', s.match_status,
      'eligible', (
        s.review_status = 'approved'
        and s.validation_error is null
        and s.match_status in ('exact_match', 'new_participant')
        and (s.raw_course_name is null or s.mapped_course_id is not null)
      ),
      'participant_action', case
        when s.review_status = 'merged' then 'ALREADY_MERGED'
        when s.review_status <> 'approved' then 'BLOCKED_NOT_APPROVED'
        when s.validation_error is not null then 'BLOCKED_VALIDATION_ERROR'
        when s.match_status = 'exact_match' and s.matched_participant_id is not null then 'LINK_EXISTING'
        when s.match_status = 'new_participant' then 'CREATE_NEW'
        else 'BLOCKED_IDENTITY_UNRESOLVED'
      end,
      'participant_existing_id', s.matched_participant_id,
      'schedule_action', case
        when s.mapped_course_id is null and s.raw_course_name is not null then 'NO_SCHEDULE_COURSE_UNMAPPED'
        when s.mapped_course_id is null then 'NO_SCHEDULE_POSSIBLE'
        when s.training_start_date is null then 'NO_SCHEDULE_POSSIBLE'
        when exists (
          select 1 from public.course_schedules cs
          where cs.course_id = s.mapped_course_id and cs.start_date = s.training_start_date and cs.legacy_batch_id is not null
        ) then 'REUSE_EXISTING_HISTORICAL'
        else 'CREATE_HISTORICAL'
      end,
      'schedule_existing_id', (
        select cs.id from public.course_schedules cs
        where cs.course_id = s.mapped_course_id and cs.start_date = s.training_start_date and cs.legacy_batch_id is not null
        limit 1
      ),
      'enrollment_action', case
        when s.mapped_course_id is null or s.training_start_date is null then 'SKIP_NOT_EVIDENCED'
        else 'CREATE_OR_REUSE_ACTIVE'
      end,
      'attendance_action', 'NOT_CREATED_NO_EVIDENCE',
      'assessment_action', 'NOT_CREATED_NO_EVIDENCE',
      'certificate_action', case
        when s.raw_certificate_number is null or length(trim(s.raw_certificate_number)) = 0 then 'NO_CERTIFICATE_NO_NUMBER'
        when exists (select 1 from public.certificates c where c.certificate_no = trim(s.raw_certificate_number)) then 'CONFLICT_CERT_NUMBER_EXISTS'
        else 'CREATE_PRESERVE_NUMBER'
      end
    ) as plan
    from public.legacy_participant_staging s
    where s.batch_id = p_batch_id
  ) x;

  perform public.log_event_as_service(auth.uid(), (select email from public.profiles where id = auth.uid()),
    'update'::audit_action, 'legacy_import_batches', p_batch_id::text, 'Dry run requested for legacy import batch', jsonb_build_object('batch_id', p_batch_id));

  return jsonb_build_object('batch_id', p_batch_id, 'batch_status', v_batch.status, 'rows', v_rows);
end;
$$;

revoke all on function public.legacy_merge_dry_run(uuid) from public;
grant execute on function public.legacy_merge_dry_run(uuid) to authenticated;

-- Executes the merge for exactly one approved row, atomically. The inner
-- begin/exception block is a real Postgres subtransaction: if any target-
-- table write fails (e.g. a certificate_no collision), everything the
-- block did rolls back, and only then does the row get its merge_error
-- recorded -- the row is left 'approved' (not 'merged'), so a rerun will
-- retry it. A batch-level exception (bad auth, wrong batch/row state, row
-- not eligible) is NOT caught here -- those are caller/authorization
-- errors, not row-data failures, and must propagate as a hard error.
--
-- Idempotent: a row already 'merged' returns its existing result ids as a
-- no-op instead of re-running -- reruns can never fork a duplicate.
-- Participant/schedule/enrollment reuse all use deterministic lookup keys
-- (normalized IC/passport; course_id + start_date among legacy-flagged
-- schedules; the existing active-enrollment partial unique index) so a
-- retry after a partial batch failure converges on the same rows rather
-- than creating new ones.
create or replace function public.legacy_merge_execute_row(p_batch_id uuid, p_row_id uuid) returns jsonb
language plpgsql
security definer
-- extensions is required here (not just public, app): the certificates
-- insert below fires app.certificates_before_insert(), a trigger with no
-- search_path of its own that calls gen_random_bytes() to generate
-- verification_token -- that function lives in extensions. This exact
-- class of bug already happened once in this schema for another
-- certificate-touching RPC; same fix.
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
    -- 1. Participant: reuse the already-confirmed link, or defensively
    -- dedup by normalized IC/passport before creating (belt-and-suspenders
    -- against two different rows/reruns both trying to create the same
    -- person). Never touches an existing participant's populated fields.
    if v_row.match_status = 'exact_match' and v_row.matched_participant_id is not null then
      v_participant_id := v_row.matched_participant_id;
    else
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

    -- 2. Historical schedule: reuse an existing legacy-flagged schedule for
    -- the same evidenced course + date, or create one. Never invents
    -- trainer/venue/exam_date/time -- left null, not fabricated.
    if v_row.mapped_course_id is not null and v_row.training_start_date is not null then
      select id into v_schedule_id
      from public.course_schedules
      where course_id = v_row.mapped_course_id
        and start_date = v_row.training_start_date
        and legacy_batch_id is not null
      limit 1;

      if v_schedule_id is null then
        -- capacity defaults to 0, which the check constraint
        -- (seats_taken <= capacity) would then violate the moment the
        -- first enrollment's app.sync_schedule_seats() trigger updates
        -- seats_taken. A historical/completed schedule isn't meaningfully
        -- capacity-limited the way a live one is -- 9999 is a system
        -- bookkeeping ceiling, not a claim about the actual historical
        -- event, so setting it generously here doesn't fabricate a fact.
        insert into public.course_schedules (course_id, start_date, end_date, status, capacity, legacy_batch_id, notes)
        values (
          v_row.mapped_course_id, v_row.training_start_date,
          coalesce(v_row.training_end_date, v_row.training_start_date),
          'completed', 9999, p_batch_id,
          'Legacy historical schedule reconstructed from imported source data. Trainer, venue, and exam date were not recorded by the source and are intentionally left blank.'
        )
        returning id into v_schedule_id;
      end if;
    end if;

    -- 3. Enrollment: respects the existing partial unique active-enrollment
    -- index (schedule_id, participant_id) WHERE deleted_at IS NULL AND
    -- registration_status <> 'cancelled' -- reuses any existing active
    -- enrollment instead of racing past it into a duplicate-key error.
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

    -- 4/5. Attendance and assessment are never created here -- this engine
    -- has no evidence column for either from any currently-supported
    -- source, so both are structurally NOT_CREATED, not inferred from
    -- presence in the source or from generic status text.

    -- 6. Certificate: only when the source gave a real certificate number.
    -- A collision with an existing certificate_no is a hard failure for
    -- this row (never silently duplicated, never silently skipped).
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

-- Finalizes a batch to 'merged' only when every approved row has actually
-- merged (none still 'approved', i.e. unprocessed) and none carries a
-- merge_error. Rejected rows are excluded from both checks -- they were
-- never eligible and are permanently ignored.
create or replace function public.legacy_merge_finalize_batch(p_batch_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_batch record;
  v_unmerged integer;
  v_failed integer;
  v_merged_count integer;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;
  if v_batch.status = 'merged' then
    return jsonb_build_object('status', 'already_merged', 'batch_id', p_batch_id);
  end if;
  if v_batch.status <> 'approved' then
    raise exception 'batch_not_approved' using errcode = 'P0001';
  end if;

  select count(*) filter (where review_status = 'approved') into v_unmerged
  from public.legacy_participant_staging where batch_id = p_batch_id;
  -- Excludes rejected rows: an admin who rejects a row after a failed merge
  -- attempt (choosing not to pursue it) must not have that row's stale
  -- merge_error permanently block finalization -- rejected rows are always
  -- permanently excluded, per the same rule that excludes them from the
  -- approval-readiness check in Phase 2's approveBatch().
  select count(*) filter (where merge_error is not null and review_status <> 'rejected') into v_failed
  from public.legacy_participant_staging where batch_id = p_batch_id;
  select count(*) filter (where review_status = 'merged') into v_merged_count
  from public.legacy_participant_staging where batch_id = p_batch_id;

  if v_unmerged > 0 then
    raise exception 'rows_not_yet_merged' using errcode = 'P0001';
  end if;
  if v_failed > 0 then
    raise exception 'rows_have_merge_errors' using errcode = 'P0001';
  end if;

  update public.legacy_import_batches set status = 'merged', merged_count = v_merged_count where id = p_batch_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'legacy_import_batches', p_batch_id::text,
    format('Legacy import batch marked merged (%s row(s))', v_merged_count),
    jsonb_build_object('batch_id', p_batch_id, 'merged_count', v_merged_count));

  return jsonb_build_object('status', 'merged', 'batch_id', p_batch_id, 'merged_count', v_merged_count);
end;
$$;

revoke all on function public.legacy_merge_finalize_batch(uuid) from public;
grant execute on function public.legacy_merge_finalize_batch(uuid) to authenticated;
