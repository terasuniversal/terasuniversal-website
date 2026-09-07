-- Atomic public registration creation and confirmation lookup.

create or replace function public.create_public_registration(
  p_schedule_id uuid,
  p_idempotency_key text,
  p_registration_secret text,
  p_attendees jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_schedule record;
  v_existing record;
  v_registration_id uuid;
  v_reference text;
  v_token text;
  v_token_hash text;
  v_idempotency_hash text;
  v_attendee jsonb;
  v_name text;
  v_identity text;
  v_email text;
  v_phone text;
  v_company text;
  v_count integer;
  v_used integer;
  v_holds integer;
  v_amount numeric(12,2);
  v_identity_values text[] := array[]::text[];
begin
  if p_schedule_id is null
     or p_idempotency_key is null
     or char_length(btrim(p_idempotency_key)) not between 16 and 200
     or p_registration_secret is null
     or p_registration_secret !~ '^[0-9A-Fa-f]{64}$'
     or jsonb_typeof(p_attendees) <> 'array' then
    raise exception 'invalid_registration_input' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_attendees);
  if v_count < 1 or v_count > 100 then
    raise exception 'invalid_attendee_count' using errcode = 'P0001';
  end if;

  v_idempotency_hash := encode(digest(btrim(p_idempotency_key), 'sha256'), 'hex');

  select pr.id, pr.registration_reference, pr.registration_status, pr.payment_status,
         pr.amount_snapshot, pr.hold_expires_at
    into v_existing
  from public.public_registrations pr
  where pr.schedule_id = p_schedule_id
    and pr.idempotency_key_hash = v_idempotency_hash;

  if v_existing.id is not null then
    return jsonb_build_object(
      'status', 'already_exists',
      'registration_reference', v_existing.registration_reference,
      'registration_status', v_existing.registration_status,
      'payment_status', v_existing.payment_status,
      'amount', v_existing.amount_snapshot,
      'hold_expires_at', v_existing.hold_expires_at
    );
  end if;

  select cs.id, cs.course_id, cs.capacity, cs.seats_taken, cs.status, cs.is_published,
         cs.deleted_at, cs.start_date, cs.end_date, cs.fee,
         c.title, c.course_name, c.status as course_status, c.deleted_at as course_deleted_at
    into v_schedule
  from public.course_schedules cs
  join public.courses c on c.id = cs.course_id
  where cs.id = p_schedule_id
  for update of cs;

  if v_schedule.id is null
     or v_schedule.deleted_at is not null
     or not v_schedule.is_published
     or v_schedule.course_deleted_at is not null
     or v_schedule.course_status <> 'published'
     or v_schedule.status <> 'open'::public.schedule_status
     or v_schedule.start_date < current_date
     or v_schedule.fee is null
     or v_schedule.capacity <= 0 then
    raise exception 'schedule_unavailable' using errcode = 'P0001';
  end if;

  -- Re-check after taking the schedule lock. This closes the retry race where
  -- two transactions pass the initial idempotency lookup before either commits.
  select pr.id, pr.registration_reference, pr.registration_status, pr.payment_status,
         pr.amount_snapshot, pr.hold_expires_at
    into v_existing
  from public.public_registrations pr
  where pr.schedule_id = p_schedule_id
    and pr.idempotency_key_hash = v_idempotency_hash;

  if v_existing.id is not null then
    return jsonb_build_object(
      'status', 'already_exists',
      'registration_reference', v_existing.registration_reference,
      'registration_status', v_existing.registration_status,
      'payment_status', v_existing.payment_status,
      'amount', v_existing.amount_snapshot,
      'hold_expires_at', v_existing.hold_expires_at
    );
  end if;

  select count(*) into v_used
  from public.schedule_participants sp
  where sp.schedule_id = p_schedule_id
    and sp.deleted_at is null
    and sp.registration_status <> 'cancelled';

  select coalesce(sum(pr.attendee_count), 0)::integer into v_holds
  from public.public_registrations pr
  where pr.schedule_id = p_schedule_id
    and pr.registration_status in ('pending_payment', 'payment_pending')
    and pr.hold_expires_at > now();

  if v_used + v_holds + v_count > v_schedule.capacity then
    raise exception 'capacity_exceeded' using errcode = 'P0001';
  end if;

  for v_attendee in select value from jsonb_array_elements(p_attendees)
  loop
    v_name := nullif(btrim(v_attendee->>'full_name'), '');
    v_identity := nullif(upper(regexp_replace(btrim(coalesce(v_attendee->>'ic_passport_no', '')), '[^0-9A-Za-z]', '', 'g')), '');
    v_email := nullif(lower(btrim(coalesce(v_attendee->>'email', ''))), '');
    v_phone := nullif(btrim(coalesce(v_attendee->>'phone', '')), '');
    v_company := nullif(btrim(coalesce(v_attendee->>'company', '')), '');

    if v_name is null or char_length(v_name) > 200
       or (v_identity is not null and char_length(v_identity) > 120)
       or (v_email is not null and (char_length(v_email) > 254 or position('@' in v_email) < 2))
       or (v_phone is not null and char_length(v_phone) > 40)
       or (v_company is not null and char_length(v_company) > 200) then
      raise exception 'invalid_attendee_input' using errcode = 'P0001';
    end if;

    if v_identity is not null then
      if v_identity = any(v_identity_values) then
        raise exception 'duplicate_attendee' using errcode = 'P0001';
      end if;
      if exists (
        select 1
        from public.public_registration_attendees pra
        join public.public_registrations pr on pr.id = pra.registration_id
        where pr.schedule_id = p_schedule_id
          and pr.registration_status in ('pending_payment', 'payment_pending', 'confirmed')
          and pra.identity_normalized = v_identity
      ) then
        raise exception 'duplicate_registration' using errcode = 'P0001';
      end if;
      if exists (
        select 1
        from public.participants p
        join public.schedule_participants sp on sp.participant_id = p.id
        where p.deleted_at is null
          and sp.schedule_id = p_schedule_id
          and sp.deleted_at is null
          and sp.registration_status <> 'cancelled'
          and upper(regexp_replace(coalesce(p.ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g')) = v_identity
      ) then
        raise exception 'duplicate_registration' using errcode = 'P0001';
      end if;
      v_identity_values := array_append(v_identity_values, v_identity);
    end if;
  end loop;

  v_token_hash := encode(digest(lower(btrim(p_registration_secret)), 'sha256'), 'hex');
  v_amount := round(v_schedule.fee * v_count, 2);

  insert into public.public_registrations (
    confirmation_token_hash, schedule_id, course_id, attendee_count,
    amount_snapshot, registration_status, payment_status,
    idempotency_key_hash, hold_expires_at
  ) values (
    v_token_hash, p_schedule_id, v_schedule.course_id, v_count,
    v_amount, 'pending_payment', 'pending',
    v_idempotency_hash, now() + interval '30 minutes'
  ) returning id, registration_reference into v_registration_id, v_reference;

  for v_attendee in select value from jsonb_array_elements(p_attendees)
  loop
    v_identity := nullif(upper(regexp_replace(btrim(coalesce(v_attendee->>'ic_passport_no', '')), '[^0-9A-Za-z]', '', 'g')), '');
    insert into public.public_registration_attendees (
      registration_id, full_name, ic_passport_no, identity_normalized,
      email, phone, company
    ) values (
      v_registration_id,
      btrim(v_attendee->>'full_name'),
      nullif(btrim(coalesce(v_attendee->>'ic_passport_no', '')), ''),
      v_identity,
      nullif(lower(btrim(coalesce(v_attendee->>'email', ''))), ''),
      nullif(btrim(coalesce(v_attendee->>'phone', '')), ''),
      nullif(btrim(coalesce(v_attendee->>'company', '')), '')
    );
  end loop;

  return jsonb_build_object(
    'status', 'created',
    'registration_reference', v_reference,
    'registration_status', 'pending_payment',
    'payment_status', 'pending',
    'amount', v_amount,
    'currency', 'MYR',
    'hold_expires_at', now() + interval '30 minutes',
    'course_title', coalesce(v_schedule.title, v_schedule.course_name),
    'start_date', v_schedule.start_date,
    'end_date', v_schedule.end_date
  );
end;
$$;

create or replace function public.get_public_registration_status(
  p_registration_reference text,
  p_registration_secret text
)
returns table (
  registration_reference text,
  course_title text,
  start_date date,
  end_date date,
  venue text,
  delivery_mode text,
  registration_status text,
  payment_status text,
  attendee_count integer,
  amount numeric,
  currency text,
  hold_expires_at timestamptz
)
language sql stable security definer
set search_path = pg_catalog, public, extensions
as $$
  select pr.registration_reference,
         coalesce(c.title, c.course_name),
         cs.start_date,
         cs.end_date,
         cs.venue,
         cs.training_mode,
         case when pr.hold_expires_at is not null and pr.hold_expires_at <= now()
              and pr.registration_status in ('pending_payment', 'payment_pending')
              then 'expired' else pr.registration_status end,
         pr.payment_status,
         pr.attendee_count,
         pr.amount_snapshot,
         pr.currency,
         pr.hold_expires_at
  from public.public_registrations pr
  join public.course_schedules cs on cs.id = pr.schedule_id
  join public.courses c on c.id = pr.course_id
  where pr.registration_reference = btrim(p_registration_reference)
    and pr.confirmation_token_hash = encode(digest(lower(btrim(p_registration_secret)), 'sha256'), 'hex');
$$;

revoke all on function public.create_public_registration(uuid, text, text, jsonb) from public;
grant execute on function public.create_public_registration(uuid, text, text, jsonb) to anon, authenticated;
revoke all on function public.get_public_registration_status(text, text) from public;
grant execute on function public.get_public_registration_status(text, text) to anon, authenticated;
