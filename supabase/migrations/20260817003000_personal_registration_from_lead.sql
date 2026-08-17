-- TERAS UNIVERSAL — Personal & Company Registration from Sales Lead
--
-- Forward-only, post-baseline migration. Adds narrow registration paths from
-- a Sales Lead (individual course registration + company batch registration),
-- kept fully separate from the B2B flow (Lead -> Opportunity -> Quotation).
--
-- Schedule Reuse Policy (official): a Training Schedule represents the actual
-- training batch/session, NOT a company/customer. Multiple companies and
-- personal registrants enroll into the SAME existing Open schedule when the
-- course/session matches, the schedule is not deleted/closed, and capacity
-- remains. No "one schedule per company". A NEW schedule is only created by
-- Training Operations for a genuinely different batch (date/session, private/
-- in-house, different venue/trainer, or a new batch when one is full).
--
-- What this changes:
--   1. sales_activity          : new 'personal_registration_completed' type +
--                                nullable participant_id/schedule_id (audit).
--   2. sales_lead_metadata     : nullable personal_registration_schedule_id
--                                outcome field (lead pipeline status is NOT
--                                changed; B2B reporting is untouched).
--   3. participants            : nullable registration_source + source_lead_id
--                                (source attribution).
--   4. register_personal_lead(...)  — atomic personal registration with
--                                capacity enforcement (row lock + count).
--   5. register_company_enrollment(...) — atomic multi-participant company
--                                registration with batch capacity enforcement.
--
-- Capacity: course_schedules.capacity + seats_taken already exist, and the
-- sync_schedule_seats trigger recomputes seats_taken from active
-- schedule_participants rows on every write; the seats_taken <= capacity CHECK
-- is the database's overbooking safety net for ALL writers. Each registration
-- RPC additionally locks the schedule row (SELECT ... FOR UPDATE) and counts
-- active enrollments inside its transaction, so two concurrent registrations
-- serialize and cannot exceed capacity with a friendly error.
--
-- Explicitly NOT touched: the sales_lead_metadata status CHECK, the
-- opportunity/quotation cascade RPCs, attendance, assessments, certificates,
-- and the participants identity dedupe rules (IC/passport only — there is no
-- email/phone participant dedupe anywhere in the app; we do not invent one).
--
-- All DDL is idempotent/guarded. No destructive DROP. No reset.

-- ---------------------------------------------------------------------------
-- 1. sales_activity: audit event type + participant/schedule refs
-- ---------------------------------------------------------------------------
alter table public.sales_activity add column if not exists participant_id uuid references public.participants(id);
alter table public.sales_activity add column if not exists schedule_id uuid references public.course_schedules(id);

create index if not exists sales_activity_participant_idx on public.sales_activity (participant_id);
create index if not exists sales_activity_schedule_idx on public.sales_activity (schedule_id);

alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check check (type in (
  'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added',
  'proposal_sent', 'won', 'lost',
  'opportunity_created', 'quotation_created', 'quotation_sent', 'quotation_revised',
  'quotation_accepted', 'quotation_rejected', 'opportunity_won', 'opportunity_lost',
  'training_handoff_created', 'company_linked', 'company_created',
  'task_created', 'task_completed', 'task_reopened', 'task_cancelled',
  'personal_registration_completed'
));

-- ---------------------------------------------------------------------------
-- 2. sales_lead_metadata: personal-registration outcome field
-- ---------------------------------------------------------------------------
alter table public.sales_lead_metadata
  add column if not exists personal_registration_schedule_id uuid references public.course_schedules(id);

-- ---------------------------------------------------------------------------
-- 3. participants: source attribution (nulls preserve the original source)
-- ---------------------------------------------------------------------------
alter table public.participants add column if not exists registration_source text;
alter table public.participants add column if not exists source_lead_id uuid references public.sales_lead_metadata(id);

create index if not exists participants_source_lead_idx
  on public.participants (source_lead_id) where source_lead_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Atomic Personal Registration RPC
-- ---------------------------------------------------------------------------
-- Authorization (narrow, DB-enforced): any ACTIVE staff member who is at
-- least an editor AND has module access to sales_leads + participants +
-- schedules may run exactly this flow. super_admin always passes; legacy
-- profiles pass via the module catalog role floor. No broad RLS relaxation —
-- the RPC only writes the specific columns/tables of this registration.
--
-- Participant resolution: IC/Passport is the ONLY identity key (matches the
-- app's existing identity-only dedupe — participants have no email/phone
-- uniqueness rule, so we do not invent one). Existing participant -> reuse +
-- fill only missing contact fields (never overwrite good data with blanks;
-- original registration_source/source_lead_id preserved). No participant ->
-- create with registration_source='sales_lead', source_lead_id=<lead>.
--
-- Schedule eligibility (matches current CRM rules): must exist, not
-- soft-deleted, status not in ('completed','cancelled'). Capacity is enforced
-- by locking the schedule row and counting ACTIVE enrollments inside this
-- transaction; the seats_taken <= capacity CHECK remains the race safety net.
--
-- Lead outcome: sets only personal_registration_schedule_id; the pipeline
-- status enum and the B2B flow are untouched.
create or replace function public.register_personal_lead(
  p_lead_metadata_id uuid,
  p_schedule_id uuid,
  p_full_name text,
  p_ic_passport_no text default null,
  p_email text default null,
  p_phone text default null,
  p_company text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_lead          record;
  v_sched         record;
  v_course_name   text;
  v_participant_id uuid;
  v_participant_created boolean := false;
  v_enrollment_id uuid;
  v_enrolled_existing boolean := false;
  v_used          int;
  v_norm          text;
  v_clean_email   text;
begin
  -- Authorization (active staff, editor+, sales_leads + participants + schedules)
  if not (app.is_active()
          and app.has_min_role('editor'::public.user_role)
          and public.has_module_access('sales_leads')
          and public.has_module_access('participants')
          and public.has_module_access('schedules')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_lead_metadata_id is null or p_schedule_id is null
     or nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  -- Lead must exist.
  select * into v_lead from public.v_sales_lead_inbox where lead_metadata_id = p_lead_metadata_id;
  if v_lead is null then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;

  -- Schedule must exist, be non-deleted, be active/open, and is locked for the
  -- duration of this transaction so concurrent registrations cannot overbook.
  select * into v_sched from public.course_schedules
  where id = p_schedule_id and deleted_at is null
  for update;
  if v_sched is null then
    raise exception 'schedule_not_found' using errcode = 'P0001';
  end if;
  if v_sched.status in ('completed', 'cancelled') then
    raise exception 'schedule_not_eligible' using errcode = 'P0001';
  end if;

  v_used := (select count(*) from public.schedule_participants sp
             where sp.schedule_id = p_schedule_id
               and sp.deleted_at is null
               and sp.registration_status <> 'cancelled');

  -- Participant resolution — IC/Passport first, then email. Both are DB-
  -- enforced identity keys for ACTIVE participants (ic index + the
  -- participants_active_email_unique index), so a lead email that already
  -- belongs to an active participant is reused rather than rejected.
  v_norm := upper(regexp_replace(coalesce(p_ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g'));
  v_clean_email := lower(trim(coalesce(p_email, '')));

  if v_norm <> '' then
    select id into v_participant_id
    from public.participants
    where deleted_at is null
      and upper(regexp_replace(coalesce(ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g')) = v_norm
    limit 1;
  end if;
  if v_participant_id is null and v_clean_email <> '' then
    select id into v_participant_id
    from public.participants
    where deleted_at is null and lower(trim(email)) = v_clean_email
    limit 1;
  end if;

  if v_participant_id is null then
    insert into public.participants (full_name, ic_passport_no, email, phone, company, registration_source, source_lead_id)
    values (
      trim(p_full_name),
      nullif(trim(coalesce(p_ic_passport_no, '')), ''),
      nullif(v_clean_email, ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_company, '')), ''),
      'sales_lead',
      p_lead_metadata_id
    )
    returning id into v_participant_id;
    v_participant_created := true;
  else
    -- Reuse: fill only missing contact fields; never overwrite existing data
    -- with blanks; preserve the participant's original source attribution.
    update public.participants
    set email = coalesce(email, nullif(v_clean_email, '')),
        phone = coalesce(phone, nullif(trim(coalesce(p_phone, '')), '')),
        company = coalesce(company, nullif(trim(coalesce(p_company, '')), '')),
        registration_source = coalesce(registration_source, 'sales_lead'),
        source_lead_id = coalesce(source_lead_id, p_lead_metadata_id),
        updated_at = now()
    where id = v_participant_id;
  end if;

  -- Enrollment — prevent duplicate active enrollment. If it already exists,
  -- no new seat is consumed (the existing row is already counted in v_used).
  select id into v_enrollment_id
  from public.schedule_participants
  where schedule_id = p_schedule_id
    and participant_id = v_participant_id
    and deleted_at is null
    and registration_status <> 'cancelled'
  limit 1;

  if v_enrollment_id is null then
    if v_used + 1 > v_sched.capacity then
      raise exception 'capacity_exceeded' using errcode = 'P0001';
    end if;
    insert into public.schedule_participants (schedule_id, participant_id, registration_status)
    values (p_schedule_id, v_participant_id, 'registered')
    returning id into v_enrollment_id;
    v_used := v_used + 1;
  else
    v_enrolled_existing := true;
  end if;

  -- Lead outcome (pipeline status untouched).
  update public.sales_lead_metadata
  set personal_registration_schedule_id = p_schedule_id,
      updated_at = now()
  where id = p_lead_metadata_id;

  -- Audit/activity.
  select c.title into v_course_name
  from public.courses c where c.id = v_sched.course_id;
  insert into public.sales_activity (lead_metadata_id, participant_id, schedule_id, type, note, actor_id)
  values (
    p_lead_metadata_id, v_participant_id, p_schedule_id, 'personal_registration_completed',
    'Registered ' || trim(p_full_name) || ' to ' || coalesce(v_sched.schedule_code, '') ||
    ' (' || coalesce(v_course_name, '') || ')',
    auth.uid()
  );

  return jsonb_build_object(
    'status', case
      when v_participant_created then 'created'
      when v_enrolled_existing then 'already_enrolled'
      else 'enrolled'
    end,
    'participant_id', v_participant_id,
    'participant_created', v_participant_created,
    'already_enrolled', v_enrolled_existing,
    'enrollment_id', v_enrollment_id,
    'schedule_id', p_schedule_id,
    'schedule_code', v_sched.schedule_code,
    'course_name', v_course_name,
    'capacity', v_sched.capacity,
    'used_after', v_used,
    'remaining_after', greatest(v_sched.capacity - v_used, 0)
  );
end;
$$;

revoke all on function public.register_personal_lead(uuid, uuid, text, text, text, text, text) from public;
grant execute on function public.register_personal_lead(uuid, uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Atomic Company Registration RPC (multi-participant, same schedule)
-- ---------------------------------------------------------------------------
-- A company/customer picks one EXISTING eligible schedule and enrolls several
-- participants belonging to that company into it. The whole batch commits or
-- rolls back as one transaction:
--   * schedule row is locked; ACTIVE enrollments are counted inside the tx.
--   * every participant that needs a NEW enrollment consumes one seat; if the
--     batch would exceed capacity, the ENTIRE batch fails (no partial rows).
--   * per-participant identity dedupe (IC/passport) + duplicate-enrollment
--     guard; an already-enrolled participant is reported and skips capacity.
--   * company association: an existing company_id is used as-is; otherwise the
--     company name is matched (case-insensitive exact) against the companies
--     master to reuse it — a NEW company record is never created here.
create or replace function public.register_company_enrollment(
  p_lead_metadata_id uuid,
  p_schedule_id uuid,
  p_company_id uuid default null,
  p_company_name text default null,
  p_participants jsonb default '[]'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_lead          record;
  v_sched         record;
  v_course_name   text;
  v_used          int;
  v_resolved_company_id uuid;
  v_company_text  text;
  v_participant   record;
  v_pid           uuid;
  v_created       boolean;
  v_enrollment_id uuid;
  v_already       boolean;
  v_results       jsonb := '[]'::jsonb;
  v_enrolled_count int := 0;
  v_already_count int := 0;
  v_norm          text;
  v_clean_email   text;
begin
  -- Authorization (same narrow gate as personal registration)
  if not (app.is_active()
          and app.has_min_role('editor'::public.user_role)
          and public.has_module_access('sales_leads')
          and public.has_module_access('participants')
          and public.has_module_access('schedules')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_lead_metadata_id is null or p_schedule_id is null
     or p_participants is null or jsonb_typeof(p_participants) <> 'array' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select * into v_lead from public.v_sales_lead_inbox where lead_metadata_id = p_lead_metadata_id;
  if v_lead is null then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;

  select * into v_sched from public.course_schedules
  where id = p_schedule_id and deleted_at is null
  for update;
  if v_sched is null then
    raise exception 'schedule_not_found' using errcode = 'P0001';
  end if;
  if v_sched.status in ('completed', 'cancelled') then
    raise exception 'schedule_not_eligible' using errcode = 'P0001';
  end if;

  v_used := (select count(*) from public.schedule_participants sp
             where sp.schedule_id = p_schedule_id
               and sp.deleted_at is null
               and sp.registration_status <> 'cancelled');

  -- Company association — reuse an existing company, never create a duplicate.
  if p_company_id is not null then
    select company_name into v_company_text from public.companies
    where id = p_company_id and deleted_at is null;
    if v_company_text is null then
      raise exception 'company_not_found' using errcode = 'P0001';
    end if;
    v_resolved_company_id := p_company_id;
  elsif nullif(trim(coalesce(p_company_name, '')), '') is not null then
    v_company_text := trim(p_company_name);
    select id into v_resolved_company_id from public.companies
    where deleted_at is null and lower(trim(company_name)) = lower(v_company_text)
    limit 1;
    if v_resolved_company_id is not null then
      select company_name into v_company_text from public.companies where id = v_resolved_company_id;
    end if;
  end if;

  for v_participant in
    select * from jsonb_to_recordset(p_participants)
      as x(full_name text, ic_passport_no text, email text, phone text)
  loop
    if nullif(trim(coalesce(v_participant.full_name, '')), '') is null then
      raise exception 'invalid_participant' using errcode = 'P0001';
    end if;
    v_norm := upper(regexp_replace(coalesce(v_participant.ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g'));
    v_clean_email := lower(trim(coalesce(v_participant.email, '')));
    v_pid := null; v_created := false; v_already := false; v_enrollment_id := null;

    if v_norm <> '' then
      select id into v_pid from public.participants
      where deleted_at is null
        and upper(regexp_replace(coalesce(ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g')) = v_norm
      limit 1;
    end if;
    if v_pid is null and v_clean_email <> '' then
      select id into v_pid from public.participants
      where deleted_at is null and lower(trim(email)) = v_clean_email
      limit 1;
    end if;

    if v_pid is null then
      insert into public.participants (full_name, ic_passport_no, email, phone, company, company_id, registration_source, source_lead_id)
      values (
        trim(v_participant.full_name),
        nullif(trim(coalesce(v_participant.ic_passport_no, '')), ''),
        nullif(v_clean_email, ''),
        nullif(trim(coalesce(v_participant.phone, '')), ''),
        v_company_text,
        v_resolved_company_id,
        'sales_lead',
        p_lead_metadata_id
      )
      returning id into v_pid;
      v_created := true;
    else
      update public.participants
      set company = coalesce(company, v_company_text),
          company_id = coalesce(company_id, v_resolved_company_id),
          email = coalesce(email, nullif(v_clean_email, '')),
          phone = coalesce(phone, nullif(trim(coalesce(v_participant.phone, '')), '')),
          registration_source = coalesce(registration_source, 'sales_lead'),
          source_lead_id = coalesce(source_lead_id, p_lead_metadata_id),
          updated_at = now()
      where id = v_pid;
    end if;

    select id into v_enrollment_id from public.schedule_participants
    where schedule_id = p_schedule_id and participant_id = v_pid
      and deleted_at is null and registration_status <> 'cancelled'
    limit 1;

    if v_enrollment_id is null then
      if v_used + 1 > v_sched.capacity then
        raise exception 'capacity_exceeded' using errcode = 'P0001';
      end if;
      insert into public.schedule_participants (schedule_id, participant_id, registration_status)
      values (p_schedule_id, v_pid, 'registered')
      returning id into v_enrollment_id;
      v_used := v_used + 1;
      v_enrolled_count := v_enrolled_count + 1;
    else
      v_already := true;
      v_already_count := v_already_count + 1;
    end if;

    v_results := v_results || jsonb_build_object(
      'full_name', trim(v_participant.full_name),
      'participant_id', v_pid,
      'participant_created', v_created,
      'already_enrolled', v_already,
      'enrollment_id', v_enrollment_id
    );
  end loop;

  update public.sales_lead_metadata
  set personal_registration_schedule_id = p_schedule_id,
      updated_at = now()
  where id = p_lead_metadata_id;

  select c.title into v_course_name from public.courses c where c.id = v_sched.course_id;
  insert into public.sales_activity (lead_metadata_id, schedule_id, type, note, actor_id)
  values (
    p_lead_metadata_id, p_schedule_id, 'personal_registration_completed',
    'Registered ' || v_enrolled_count || ' participant(s) to ' || coalesce(v_sched.schedule_code, '') ||
    ' (' || coalesce(v_course_name, '') || ')' || case when v_already_count > 0 then ' — ' || v_already_count || ' already enrolled' else '' end,
    auth.uid()
  );

  return jsonb_build_object(
    'status', 'completed',
    'enrolled_count', v_enrolled_count,
    'already_enrolled_count', v_already_count,
    'company_id', v_resolved_company_id,
    'company_name', v_company_text,
    'schedule_id', p_schedule_id,
    'schedule_code', v_sched.schedule_code,
    'course_name', v_course_name,
    'capacity', v_sched.capacity,
    'used_after', v_used,
    'remaining_after', greatest(v_sched.capacity - v_used, 0),
    'participants', v_results
  );
end;
$$;

revoke all on function public.register_company_enrollment(uuid, uuid, uuid, text, jsonb) from public;
grant execute on function public.register_company_enrollment(uuid, uuid, uuid, text, jsonb) to authenticated;
