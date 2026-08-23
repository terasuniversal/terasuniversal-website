-- Legacy Participant Migration, Phase 1: staging foundation only.
-- No target table (participants/course_schedules/schedule_participants/
-- attendance/assessments/certificates) is merged into by this migration or
-- by any code in this change -- legacy_import_batches/
-- legacy_participant_staging/legacy_course_map hold raw imported rows plus
-- operator classification/mapping decisions until a future, separately-
-- approved merge phase. See SCHEDULE_PARTICIPANT_ENROLLMENT_INTEGRITY audit
-- for why no change to schedule_participants' own uniqueness is needed
-- here (already correct).

create table if not exists public.legacy_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_label text not null,
  original_filename text not null,
  source_file_hash text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'normalized', 'review', 'approved', 'merged', 'failed', 'cancelled')),
  total_row_count integer not null default 0,
  valid_count integer not null default 0,
  invalid_count integer not null default 0,
  approved_count integer not null default 0,
  merged_count integer not null default 0,
  notes text,
  error_summary jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-running an import against the same source file must not silently
-- create a second batch -- legacy_import_create_batch() checks this and
-- returns the existing batch id instead of inserting.
create unique index if not exists legacy_import_batches_source_hash_unique
  on public.legacy_import_batches (source_file_hash)
  where source_file_hash is not null;

drop trigger if exists trg_legacy_import_batches_updated_at on public.legacy_import_batches;
create trigger trg_legacy_import_batches_updated_at
  before update on public.legacy_import_batches
  for each row execute function app.set_updated_at();

drop trigger if exists trg_legacy_import_batches_audit on public.legacy_import_batches;
create trigger trg_legacy_import_batches_audit
  after insert or update or delete on public.legacy_import_batches
  for each row execute function app.audit_trigger();

alter table public.legacy_import_batches enable row level security;

drop policy if exists legacy_import_batches_select on public.legacy_import_batches;
create policy legacy_import_batches_select on public.legacy_import_batches
  for select using (app.is_admin());

drop policy if exists legacy_import_batches_insert on public.legacy_import_batches;
create policy legacy_import_batches_insert on public.legacy_import_batches
  for insert with check (app.is_admin());

drop policy if exists legacy_import_batches_update on public.legacy_import_batches;
create policy legacy_import_batches_update on public.legacy_import_batches
  for update using (app.is_admin()) with check (app.is_admin());

drop policy if exists legacy_import_batches_delete on public.legacy_import_batches;
create policy legacy_import_batches_delete on public.legacy_import_batches
  for delete using (app.is_admin());

revoke all on public.legacy_import_batches from public;
grant select, insert, update, delete on public.legacy_import_batches to authenticated;

-- One row per raw imported legacy event/person row. raw_data preserves the
-- entire source row verbatim; every other raw_* column is a copy for
-- indexing/search, never the sole source of truth -- normalization only
-- ever writes to the normalized_* / matched_*/mapped_*/match_status/
-- review_status columns, never back over a raw_* column.
create table if not exists public.legacy_participant_staging (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.legacy_import_batches (id) on delete cascade,
  source_row_number integer not null,
  raw_data jsonb not null default '{}'::jsonb,

  raw_name text,
  raw_ic_passport text,
  normalized_ic_passport text,
  raw_email text,
  normalized_email text,
  raw_phone text,
  normalized_phone text,
  raw_company text,
  raw_course_name text,
  normalized_course_name text,
  training_start_date date,
  training_end_date date,
  raw_certificate_number text,
  raw_status text,

  matched_participant_id uuid references public.participants (id),
  mapped_course_id uuid references public.courses (id),
  match_status text
    check (match_status in ('exact_match', 'probable_duplicate', 'new_participant', 'conflict')),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'reviewed', 'approved', 'rejected', 'merged')),
  validation_error text,
  duplicate_conflict_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotency: re-ingesting the same batch twice (retry after a partial
-- failure, accidental double-submit) must not duplicate staging rows.
create unique index if not exists legacy_participant_staging_batch_row_unique
  on public.legacy_participant_staging (batch_id, source_row_number);

create index if not exists legacy_participant_staging_batch_idx
  on public.legacy_participant_staging (batch_id);
create index if not exists legacy_participant_staging_ic_idx
  on public.legacy_participant_staging (normalized_ic_passport);
create index if not exists legacy_participant_staging_matched_participant_idx
  on public.legacy_participant_staging (matched_participant_id);

drop trigger if exists trg_legacy_participant_staging_updated_at on public.legacy_participant_staging;
create trigger trg_legacy_participant_staging_updated_at
  before update on public.legacy_participant_staging
  for each row execute function app.set_updated_at();

drop trigger if exists trg_legacy_participant_staging_audit on public.legacy_participant_staging;
create trigger trg_legacy_participant_staging_audit
  after insert or update or delete on public.legacy_participant_staging
  for each row execute function app.audit_trigger();

alter table public.legacy_participant_staging enable row level security;

drop policy if exists legacy_participant_staging_select on public.legacy_participant_staging;
create policy legacy_participant_staging_select on public.legacy_participant_staging
  for select using (app.is_admin());

drop policy if exists legacy_participant_staging_insert on public.legacy_participant_staging;
create policy legacy_participant_staging_insert on public.legacy_participant_staging
  for insert with check (app.is_admin());

drop policy if exists legacy_participant_staging_update on public.legacy_participant_staging;
create policy legacy_participant_staging_update on public.legacy_participant_staging
  for update using (app.is_admin()) with check (app.is_admin());

drop policy if exists legacy_participant_staging_delete on public.legacy_participant_staging;
create policy legacy_participant_staging_delete on public.legacy_participant_staging
  for delete using (app.is_admin());

revoke all on public.legacy_participant_staging from public;
grant select, insert, update, delete on public.legacy_participant_staging to authenticated;

-- Explicit, auditable course-name -> course_id mapping. No fuzzy matching:
-- a row here is either 'pending' (unresolved, requires a human decision) or
-- 'mapped' (an admin explicitly approved course_id for this exact
-- normalized name from this source). The Phase 1 import script only ever
-- inserts 'pending' rows for names with no existing mapping -- it never
-- writes 'mapped' itself; that transition is a separate, explicit human
-- approval action outside this migration's scope.
create table if not exists public.legacy_course_map (
  id uuid primary key default gen_random_uuid(),
  source_label text not null,
  raw_course_name text not null,
  normalized_course_name text not null,
  course_id uuid references public.courses (id),
  status text not null default 'pending'
    check (status in ('pending', 'mapped', 'rejected')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists legacy_course_map_source_name_unique
  on public.legacy_course_map (source_label, normalized_course_name);

drop trigger if exists trg_legacy_course_map_updated_at on public.legacy_course_map;
create trigger trg_legacy_course_map_updated_at
  before update on public.legacy_course_map
  for each row execute function app.set_updated_at();

drop trigger if exists trg_legacy_course_map_audit on public.legacy_course_map;
create trigger trg_legacy_course_map_audit
  after insert or update or delete on public.legacy_course_map
  for each row execute function app.audit_trigger();

alter table public.legacy_course_map enable row level security;

drop policy if exists legacy_course_map_select on public.legacy_course_map;
create policy legacy_course_map_select on public.legacy_course_map
  for select using (app.is_admin());

drop policy if exists legacy_course_map_insert on public.legacy_course_map;
create policy legacy_course_map_insert on public.legacy_course_map
  for insert with check (app.is_admin());

drop policy if exists legacy_course_map_update on public.legacy_course_map;
create policy legacy_course_map_update on public.legacy_course_map
  for update using (app.is_admin()) with check (app.is_admin());

drop policy if exists legacy_course_map_delete on public.legacy_course_map;
create policy legacy_course_map_delete on public.legacy_course_map
  for delete using (app.is_admin());

revoke all on public.legacy_course_map from public;
grant select, insert, update, delete on public.legacy_course_map to authenticated;

-- Provenance footprint: every table the approved legacy merge pathway may
-- legitimately create rows in gets a nullable legacy_batch_id, so every
-- future legacy-sourced row can be traced back to its import batch --
-- including course_schedules (one historical schedule per evidenced
-- canonical_course_id + training date/date range) and attendance/
-- assessments (created ONLY when the source explicitly proves attendance
-- or contains a valid assessment/result -- legacy_batch_id is provenance
-- infrastructure only and does not itself authorize fabricating either).
-- Nullable and additive; stays null on every existing row and on every row
-- created in this phase, since no merge runs yet.
alter table public.participants
  add column if not exists legacy_batch_id uuid references public.legacy_import_batches (id);
create index if not exists participants_legacy_batch_idx
  on public.participants (legacy_batch_id) where legacy_batch_id is not null;

alter table public.course_schedules
  add column if not exists legacy_batch_id uuid references public.legacy_import_batches (id);
create index if not exists course_schedules_legacy_batch_idx
  on public.course_schedules (legacy_batch_id) where legacy_batch_id is not null;

alter table public.schedule_participants
  add column if not exists legacy_batch_id uuid references public.legacy_import_batches (id);
create index if not exists schedule_participants_legacy_batch_idx
  on public.schedule_participants (legacy_batch_id) where legacy_batch_id is not null;

alter table public.attendance
  add column if not exists legacy_batch_id uuid references public.legacy_import_batches (id);
create index if not exists attendance_legacy_batch_idx
  on public.attendance (legacy_batch_id) where legacy_batch_id is not null;

alter table public.assessments
  add column if not exists legacy_batch_id uuid references public.legacy_import_batches (id);
create index if not exists assessments_legacy_batch_idx
  on public.assessments (legacy_batch_id) where legacy_batch_id is not null;

alter table public.certificates
  add column if not exists legacy_batch_id uuid references public.legacy_import_batches (id);
create index if not exists certificates_legacy_batch_idx
  on public.certificates (legacy_batch_id) where legacy_batch_id is not null;

-- Creates a new batch, or returns the existing batch id if a batch with the
-- same source_file_hash already exists (idempotent against accidental
-- re-upload of the same file). SECURITY DEFINER only to reach
-- legacy_import_batches under RLS as the calling admin's own actor --
-- app.is_admin() re-checks the caller's own role, it does not widen access.
--
-- The hash lookup matches a batch in ANY status, not just 'uploaded'. This
-- is deliberate: re-uploading the byte-identical file while a batch is
-- normalized/review/approved returns that same batch instead of forking a
-- second one competing for review, and re-uploading it once 'merged'
-- returns the already-merged batch as a correct no-op (nothing left to do).
-- The one gap this leaves, also deliberate for Phase 1: if a batch is
-- 'failed' or 'cancelled', re-uploading the identical file returns that
-- same dead batch, and legacy_import_ingest_rows() still refuses it
-- (status <> 'uploaded') -- there is no reset-to-'uploaded' path yet. A
-- genuine retry today requires either a real content change to the source
-- file (so the hash differs and a fresh batch is created) or a future,
-- separate, explicitly-approved "retry" operation that resets a dead
-- batch's status. Auto-resetting a failed/cancelled batch was intentionally
-- NOT built here -- that would let an accidental re-run silently resume a
-- batch a human previously stopped, which is the opposite of deliberate.
create or replace function public.legacy_import_create_batch(
  p_source_label text,
  p_original_filename text,
  p_source_file_hash text default null
) returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_source_file_hash is not null then
    select id into v_existing_id
    from public.legacy_import_batches
    where source_file_hash = p_source_file_hash;

    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  insert into public.legacy_import_batches (source_label, original_filename, source_file_hash, created_by)
  values (p_source_label, p_original_filename, p_source_file_hash, auth.uid())
  returning id into v_new_id;

  perform public.log_event('create'::audit_action, 'legacy_import_batches', v_new_id::text,
    format('Created legacy import batch for %s (%s)', p_original_filename, p_source_label));

  return v_new_id;
end;
$$;

revoke all on function public.legacy_import_create_batch(text, text, text) from public;
grant execute on function public.legacy_import_create_batch(text, text, text) to authenticated;

-- Bulk-ingests raw rows into legacy_participant_staging. Idempotent via the
-- (batch_id, source_row_number) unique index: re-running ingest for the same
-- batch (retry after a partial failure) skips rows already present rather
-- than duplicating them. Only accepts a batch still in 'uploaded' status, so
-- a batch already normalized/reviewed/approved cannot be silently
-- re-ingested out from under an in-progress review.
create or replace function public.legacy_import_ingest_rows(
  p_batch_id uuid,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_status text;
  v_inserted integer;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select status into v_status from public.legacy_import_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'uploaded' then
    raise exception 'invalid_batch_status' using errcode = 'P0001';
  end if;

  with inserted as (
    insert into public.legacy_participant_staging (
      batch_id, source_row_number, raw_data,
      raw_name, raw_ic_passport, normalized_ic_passport,
      raw_email, normalized_email, raw_phone, normalized_phone,
      raw_company, raw_course_name, normalized_course_name,
      training_start_date, training_end_date,
      raw_certificate_number, raw_status
    )
    select
      p_batch_id,
      (row_data ->> 'source_row_number')::integer,
      coalesce(row_data -> 'raw_data', '{}'::jsonb),
      row_data ->> 'raw_name',
      row_data ->> 'raw_ic_passport',
      row_data ->> 'normalized_ic_passport',
      row_data ->> 'raw_email',
      row_data ->> 'normalized_email',
      row_data ->> 'raw_phone',
      row_data ->> 'normalized_phone',
      row_data ->> 'raw_company',
      row_data ->> 'raw_course_name',
      row_data ->> 'normalized_course_name',
      nullif(row_data ->> 'training_start_date', '')::date,
      nullif(row_data ->> 'training_end_date', '')::date,
      row_data ->> 'raw_certificate_number',
      row_data ->> 'raw_status'
    from jsonb_array_elements(p_rows) as row_data
    on conflict (batch_id, source_row_number) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  update public.legacy_import_batches
  set status = 'normalized',
      total_row_count = (select count(*) from public.legacy_participant_staging where batch_id = p_batch_id)
  where id = p_batch_id;

  perform public.log_event('import'::audit_action, 'legacy_participant_staging', p_batch_id::text,
    format('Ingested %s staging rows for batch %s', v_inserted, p_batch_id));

  return v_inserted;
end;
$$;

revoke all on function public.legacy_import_ingest_rows(uuid, jsonb) from public;
grant execute on function public.legacy_import_ingest_rows(uuid, jsonb) to authenticated;
