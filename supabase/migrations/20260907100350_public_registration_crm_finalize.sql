-- Trusted finalization from a paid public registration to existing CRM rows.

create or replace function public.finalize_public_registration_crm(p_registration_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_registration public.public_registrations%rowtype;
  v_schedule public.course_schedules%rowtype;
  v_attendee record;
  v_participant_id uuid;
  v_enrollment_id uuid;
  v_created_count integer := 0;
  v_enrolled_count integer := 0;
  v_identity text;
  v_email text;
  v_actor uuid;
  v_actor_email text;
begin
  if auth.role() <> 'service_role' and not app.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_registration
  from public.public_registrations
  where id = p_registration_id
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  if v_registration.registration_status = 'confirmed' then
    return jsonb_build_object('outcome', 'already_confirmed', 'registration_reference', v_registration.registration_reference);
  end if;
  if v_registration.payment_status <> 'paid' then
    raise exception 'registration_payment_not_confirmed' using errcode = 'P0001';
  end if;
  if v_registration.registration_status in ('cancelled', 'expired') then
    raise exception 'registration_not_finalizable' using errcode = 'P0001';
  end if;
  if v_registration.registration_status in ('pending_payment', 'failed') then
    update public.public_registrations
    set registration_status = 'payment_pending'
    where id = v_registration.id;
  end if;

  -- Serialize finalization for one schedule so the existing participant
  -- identity indexes and schedule capacity mirror remain race-safe.
  select * into v_schedule
  from public.course_schedules
  where id = v_registration.schedule_id
  for update;
  if v_schedule.id is null or v_schedule.status in ('cancelled', 'completed') then
    raise exception 'schedule_not_finalizable' using errcode = 'P0001';
  end if;

  for v_attendee in
    select * from public.public_registration_attendees
    where registration_id = v_registration.id
    order by created_at, id
  loop
    v_identity := nullif(upper(regexp_replace(btrim(coalesce(v_attendee.ic_passport_no, '')), '[^0-9A-Za-z]', '', 'g')), '');
    v_email := nullif(lower(btrim(coalesce(v_attendee.email, ''))), '');
    v_participant_id := null;

    if v_identity is not null then
      select p.id into v_participant_id
      from public.participants p
      where p.deleted_at is null
        and upper(regexp_replace(coalesce(p.ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g')) = v_identity
      order by p.created_at
      limit 1
      for update;
    end if;
    if v_participant_id is null and v_email is not null then
      select p.id into v_participant_id
      from public.participants p
      where p.deleted_at is null and lower(btrim(coalesce(p.email, ''))) = v_email
      order by p.created_at
      limit 1
      for update;
    end if;

    if v_participant_id is null then
      insert into public.participants (
        full_name, ic_passport_no, email, phone, company, status, registration_date
      ) values (
        btrim(v_attendee.full_name),
        nullif(btrim(coalesce(v_attendee.ic_passport_no, '')), ''),
        v_email,
        nullif(btrim(coalesce(v_attendee.phone, '')), ''),
        nullif(btrim(coalesce(v_attendee.company, '')), ''),
        'registered', current_date
      ) returning id into v_participant_id;
      v_created_count := v_created_count + 1;
    end if;

    update public.participants
    set email = coalesce(email, v_email),
        phone = coalesce(phone, nullif(btrim(coalesce(v_attendee.phone, '')), '')),
        company = coalesce(company, nullif(btrim(coalesce(v_attendee.company, '')), '')),
        updated_at = now()
    where id = v_participant_id;

    select sp.id into v_enrollment_id
    from public.schedule_participants sp
    where sp.schedule_id = v_registration.schedule_id
      and sp.participant_id = v_participant_id
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
    limit 1;

    if v_enrollment_id is null then
      insert into public.schedule_participants (schedule_id, participant_id, registration_status)
      values (v_registration.schedule_id, v_participant_id, 'registered')
      returning id into v_enrollment_id;
      v_enrolled_count := v_enrolled_count + 1;
    end if;

    update public.public_registration_attendees
    set participant_id = v_participant_id
    where id = v_attendee.id;
  end loop;

  update public.public_registrations
  set registration_status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      hold_expires_at = null
  where id = v_registration.id;

  if auth.uid() is null then
    select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();
  else
    v_actor := auth.uid();
    select email into v_actor_email from public.profiles where id = v_actor;
  end if;
  perform public.log_event_as_service(
    v_actor,
    v_actor_email,
    'create'::public.audit_action,
    'public_registrations',
    v_registration.id::text,
    'Public registration confirmed: ' || v_registration.registration_reference,
    jsonb_build_object('registration_reference', v_registration.registration_reference, 'schedule_id', v_registration.schedule_id, 'enrolled_count', v_enrolled_count)
  );

  return jsonb_build_object(
    'outcome', 'confirmed',
    'registration_reference', v_registration.registration_reference,
    'participants_created', v_created_count,
    'enrollments_created', v_enrolled_count
  );
end;
$$;

create or replace function public.verify_public_registration_manual_payment(
  p_registration_reference text,
  p_registration_secret text,
  p_amount numeric,
  p_payment_reference text,
  p_notes text default null,
  p_verifier_id uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_registration public.public_registrations%rowtype;
  v_payment public.public_registration_payments%rowtype;
  v_token_hash text;
  v_verifier_id uuid;
  v_verifier_email text;
begin
  if auth.role() <> 'service_role' and not app.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_verifier_id := coalesce(p_verifier_id, auth.uid());
  if auth.role() = 'authenticated' and p_verifier_id is not null and p_verifier_id <> auth.uid() then
    raise exception 'invalid_manual_verifier' using errcode = '42501';
  end if;
  if v_verifier_id is null or not exists (
    select 1 from public.profiles
    where id = v_verifier_id and is_active = true and role in ('admin', 'super_admin')
  ) then
    raise exception 'invalid_manual_verifier' using errcode = '42501';
  end if;
  select email into v_verifier_email from public.profiles where id = v_verifier_id;
  if p_amount is null or p_amount <= 0 or nullif(btrim(p_payment_reference), '') is null then
    raise exception 'invalid_manual_payment' using errcode = 'P0001';
  end if;

  v_token_hash := encode(digest(lower(btrim(p_registration_secret)), 'sha256'), 'hex');
  select * into v_registration
  from public.public_registrations
  where registration_reference = btrim(p_registration_reference)
    and confirmation_token_hash = v_token_hash
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  if round(p_amount, 2) <> round(v_registration.amount_snapshot, 2) then
    raise exception 'manual_payment_amount_mismatch' using errcode = 'P0001';
  end if;
  if v_registration.registration_status in ('cancelled', 'expired') then
    raise exception 'registration_not_verifiable' using errcode = 'P0001';
  end if;

  select * into v_payment
  from public.public_registration_payments
  where registration_id = v_registration.id
    and payment_provider = 'bank_transfer'
    and status in ('pending', 'processing', 'paid')
  order by created_at desc
  limit 1
  for update;

  if v_payment.id is null then
    insert into public.public_registration_payments (
      registration_id, payment_provider, status, amount, currency,
      provider_reference
    ) values (
      v_registration.id, 'bank_transfer', 'pending', v_registration.amount_snapshot, v_registration.currency,
      btrim(p_payment_reference)
    ) returning * into v_payment;
  elsif v_payment.status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid', 'registration_reference', v_registration.registration_reference);
  end if;

  -- Move through the bounded payment state machine even for staff-verified
  -- transfers; never create a payment attempt directly in `paid` state.
  update public.public_registration_payments
  set status = 'processing', provider_reference = btrim(p_payment_reference)
  where id = v_payment.id and status = 'pending';
  update public.public_registration_payments
  set status = 'paid', provider_reference = btrim(p_payment_reference),
      verified_amount = v_registration.amount_snapshot, verified_at = now(),
      raw_response = jsonb_build_object('notes', left(coalesce(p_notes, ''), 500), 'verified_by', v_verifier_id, 'verified_by_email', v_verifier_email)
  where id = v_payment.id and status = 'processing';

  update public.public_registrations
  set payment_status = case when payment_status = 'pending' then 'processing' else payment_status end
  where id = v_registration.id;
  update public.public_registrations set payment_status = 'paid' where id = v_registration.id;
  return public.finalize_public_registration_crm(v_registration.id);
end;
$$;

revoke all on function public.finalize_public_registration_crm(uuid) from public;
grant execute on function public.finalize_public_registration_crm(uuid) to authenticated, service_role;
revoke all on function public.verify_public_registration_manual_payment(text, text, numeric, text, text, uuid) from public;
grant execute on function public.verify_public_registration_manual_payment(text, text, numeric, text, text, uuid) to authenticated, service_role;
