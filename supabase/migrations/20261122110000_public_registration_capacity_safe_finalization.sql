-- Capacity-safe public registration finalization (PKG-1c).
--
-- Why: public.finalize_public_registration_crm(uuid) locks the course schedule but never compares against capacity.
-- A registration whose 30-minute hold lapsed no longer counts against capacity (create_public_registration only counts
-- holds with hold_expires_at > now()), so its seat can be taken by another registration; a late ToyyibPay payment or a
-- staff-verified bank transfer for it still went on to enrol, where course_schedules_check (seats_taken <= capacity,
-- kept by app.sync_schedule_seats) raised check_violation and rolled back the whole transaction: the session was not
-- overbooked, but the verified payment, its transaction id and the audit trail were lost and the caller received an
-- error. Both payment paths
-- (finalize_public_registration_payment_from_callback and verify_public_registration_manual_payment) end in
-- finalize_public_registration_crm, so the capacity decision belongs there, under the schedule lock it already takes.
--
-- New behaviour:
-- 1. finalize_public_registration_crm, after locking the schedule and before creating any participant or enrolment:
--    used = active schedule_participants; held = attendees of OTHER pending registrations with an active hold;
--    needed = this registration's attendee_count (conservative: an attendee already enrolled still counts).
--    If used + held + needed > capacity (or capacity is null), nothing is allocated: the registration stays
--    payment_pending + paid, its hold is cleared (so it no longer holds seats and the payer is not shown "expired"),
--    an audit entry 'paid_unallocated' is written, and {outcome: 'paid_unallocated'} is returned WITHOUT raising, so the
--    verified payment that called it is committed and preserved. Staff reconcile from the existing "Paid, not
--    confirmed" queue: free or add capacity and call this function again (it re-checks under the lock), or refund
--    manually at ToyyibPay. There is no override and no automatic refund.
-- 2. finalize_public_registration_payment_from_callback, registration already cancelled/expired: a verified success
--    on an attempt that is still 'processing' is now recorded as paid (attempt paid; registration payment_status paid
--    when it was pending/processing) instead of leaving the attempt unpaid. No seat is allocated and the registration
--    status is not changed. Attempts that are already terminal keep the previous reconciliation record.
--
-- Concurrency: lock order is unchanged (registration -> payment attempt -> schedule); create_public_registration only
-- locks the schedule. Concurrent finalizations for one schedule serialize on the schedule row lock, and each capacity
-- query runs after the lock is granted (READ COMMITTED: a fresh snapshot per statement), so the second one sees the
-- first one's committed enrolments. No confirmed allocation can exceed capacity through these functions.
--
-- Scope: the bodies of these two functions only. Signatures, SECURITY DEFINER, search_path, owner and privileges are
-- preserved (CREATE OR REPLACE keeps the ACL; asserted below). No table, column, status, constraint, trigger, policy,
-- data or other function change. Idempotent. Rollback is a forward migration that re-creates the previous bodies
-- (pg_get_functiondef of the definitions pinned below by md5).

do $$
declare
  v_crm constant regprocedure := to_regprocedure('public.finalize_public_registration_crm(uuid)');
  v_cb constant regprocedure := to_regprocedure('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)');
  v_md5 text;
  v_src text;
begin
  if v_crm is null or v_cb is null then
    raise exception 'pkg1c_precondition_failed: a finalization function is missing' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('finalize_public_registration_crm', 'finalize_public_registration_payment_from_callback')) <> 2 then
    raise exception 'pkg1c_precondition_failed: expected exactly one overload of each finalization function' using errcode = 'P0001';
  end if;
  -- Refuse to overwrite an unknown version: each body must be the one captured on Staging and Production on
  -- 21 Nov 2026, or already this migration's version (re-run).
  select md5(regexp_replace(pg_get_functiondef(v_crm), '\s+', '', 'g')), prosrc into v_md5, v_src from pg_proc where oid = v_crm;
  if v_md5 <> '2cc828a6b557f110062eebacc7a455b4' and position('pkg1c_capacity_guard' in v_src) = 0 then
    raise exception 'pkg1c_precondition_failed: finalize_public_registration_crm differs from the expected definition' using errcode = 'P0001';
  end if;
  select md5(regexp_replace(pg_get_functiondef(v_cb), '\s+', '', 'g')), prosrc into v_md5, v_src from pg_proc where oid = v_cb;
  if v_md5 <> 'b696be946aef6dcd821774a4d76f8a09' and position('pkg1c_late_success_paid' in v_src) = 0 then
    raise exception 'pkg1c_precondition_failed: finalize_public_registration_payment_from_callback differs from the expected definition' using errcode = 'P0001';
  end if;
  -- Remember the current privileges so the postcondition can prove they are unchanged.
  perform set_config('pkg1c.acl_crm', coalesce((select proacl::text from pg_proc where oid = v_crm), 'null'), false);
  perform set_config('pkg1c.acl_cb', coalesce((select proacl::text from pg_proc where oid = v_cb), 'null'), false);
end $$;

create or replace function public.finalize_public_registration_crm(p_registration_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'app', 'extensions'
as $function$
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
  v_used integer;
  v_held integer;
  v_needed integer;
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

  -- pkg1c_capacity_guard: decide capacity under the schedule lock, before any allocation. Same rules as
  -- create_public_registration (active enrolments + other active holds); this registration's own hold is excluded and
  -- its attendees are counted as needed.
  select count(*)::integer into v_used
  from public.schedule_participants sp
  where sp.schedule_id = v_registration.schedule_id
    and sp.deleted_at is null
    and sp.registration_status <> 'cancelled';
  select coalesce(sum(pr.attendee_count), 0)::integer into v_held
  from public.public_registrations pr
  where pr.schedule_id = v_registration.schedule_id
    and pr.id <> v_registration.id
    and pr.registration_status in ('pending_payment', 'payment_pending')
    and pr.hold_expires_at > now();
  v_needed := v_registration.attendee_count;

  if v_schedule.capacity is null or v_used + v_held + v_needed > v_schedule.capacity then
    -- Paid but not allocated: keep the payment, allocate nothing, stop holding seats. Never raise here, so the
    -- verified payment written by the caller in this transaction is committed.
    update public.public_registrations
    set hold_expires_at = null
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
      'update'::public.audit_action,
      'public_registrations',
      v_registration.id::text,
      'Public registration paid but not allocated (capacity): ' || v_registration.registration_reference,
      jsonb_build_object('event', 'paid_unallocated', 'registration_reference', v_registration.registration_reference,
        'schedule_id', v_registration.schedule_id, 'capacity', v_schedule.capacity, 'used', v_used, 'held', v_held,
        'needed', v_needed)
    );
    return jsonb_build_object(
      'outcome', 'paid_unallocated',
      'registration_reference', v_registration.registration_reference
    );
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
$function$;

create or replace function public.finalize_public_registration_payment_from_callback(p_attempt_id uuid, p_bill_code text, p_verified_amount numeric, p_provider_transaction_id text, p_callback_received_at timestamp with time zone, p_raw_response jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'app'
as $function$
declare
  v_registration public.public_registrations%rowtype;
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or nullif(btrim(p_bill_code), '') is null
     or nullif(btrim(p_provider_transaction_id), '') is null
     or p_verified_amount is null or p_verified_amount <= 0 then
    raise exception 'invalid_verified_payment' using errcode = 'P0001';
  end if;

  -- Lock registration first, then payment attempt; this is the global order.
  select pr.* into v_registration
  from public.public_registrations pr
  where pr.id = (select registration_id from public.public_registration_payments where id = p_attempt_id)
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  select * into v_attempt
  from public.public_registration_payments
  where id = p_attempt_id and payment_provider = 'toyyibpay'
  for update;
  if v_attempt.id is null or v_attempt.registration_id <> v_registration.id then
    raise exception 'payment_attempt_not_found' using errcode = 'P0001';
  end if;

  if v_attempt.provider_bill_code is distinct from btrim(p_bill_code) then
    raise exception 'payment_bill_mismatch' using errcode = 'P0001';
  end if;

  if v_attempt.status = 'paid' then
    if v_attempt.provider_transaction_id = btrim(p_provider_transaction_id)
       and v_attempt.verified_amount = p_verified_amount then
      return jsonb_build_object('outcome', 'duplicate_ignored');
    end if;
    raise exception 'paid_attempt_conflict' using errcode = 'P0001';
  end if;
  if round(p_verified_amount, 2) <> round(v_attempt.amount, 2)
     or round(p_verified_amount, 2) <> round(v_registration.amount_snapshot, 2) then
    raise exception 'payment_amount_mismatch' using errcode = 'P0001';
  end if;

  if v_registration.registration_status in ('cancelled', 'expired') then
    if v_attempt.status in ('paid', 'refunded') then
      return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
    end if;
    if v_attempt.status = 'processing' then
      -- pkg1c_late_success_paid: the provider verified this payment, so record it as paid. No seat is allocated and
      -- the ended registration status is kept; staff refund or transfer it from the "Paid, not confirmed" queue.
      update public.public_registration_payments
      set status = 'paid',
          verified_amount = round(p_verified_amount, 2),
          provider_transaction_id = btrim(p_provider_transaction_id),
          verified_at = now(),
          callback_received_at = p_callback_received_at,
          raw_response = jsonb_build_object(
            'late_success_reconciliation_required', true,
            'verified_amount', round(p_verified_amount, 2),
            'provider_response', coalesce(p_raw_response, '{}'::jsonb)
          )
      where id = v_attempt.id;
      if v_registration.payment_status in ('pending', 'processing') then
        update public.public_registrations
        set payment_status = 'paid'
        where id = v_registration.id;
      end if;
    else
      update public.public_registration_payments
      set provider_transaction_id = btrim(p_provider_transaction_id),
          callback_received_at = p_callback_received_at,
          raw_response = jsonb_build_object(
            'late_success_reconciliation_required', true,
            'verified_amount', round(p_verified_amount, 2),
            'provider_response', coalesce(p_raw_response, '{}'::jsonb)
          )
      where id = v_attempt.id;
    end if;
    perform public.log_public_registration_payment_event(
      v_attempt.id, 'late_success_after_expiry',
      jsonb_build_object('registration_reference', v_registration.registration_reference,
        'attempt_recorded_paid', v_attempt.status = 'processing')
    );
    return jsonb_build_object('outcome', 'reconciliation_required', 'registration_reference', v_registration.registration_reference);
  end if;
  if v_attempt.status not in ('pending', 'processing') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;

  update public.public_registration_payments
  set status = 'paid',
      verified_amount = round(p_verified_amount, 2),
      provider_transaction_id = btrim(p_provider_transaction_id),
      verified_at = now(),
      callback_received_at = p_callback_received_at,
      raw_response = coalesce(p_raw_response, '{}'::jsonb)
  where id = v_attempt.id;

  update public.public_registrations
  set payment_status = 'paid'
  where id = v_registration.id;

  return public.finalize_public_registration_crm(v_registration.id);
end;
$function$;

do $$
declare
  v_crm constant regprocedure := 'public.finalize_public_registration_crm(uuid)'::regprocedure;
  v_cb constant regprocedure := 'public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)'::regprocedure;
begin
  if coalesce((select proacl::text from pg_proc where oid = v_crm), 'null') <> current_setting('pkg1c.acl_crm')
     or coalesce((select proacl::text from pg_proc where oid = v_cb), 'null') <> current_setting('pkg1c.acl_cb') then
    raise exception 'pkg1c_postcondition_failed: privileges of a finalization function changed' using errcode = 'P0001';
  end if;
  if not (select prosecdef from pg_proc where oid = v_crm) or not (select prosecdef from pg_proc where oid = v_cb) then
    raise exception 'pkg1c_postcondition_failed: a finalization function is no longer SECURITY DEFINER' using errcode = 'P0001';
  end if;
  if (select proconfig from pg_proc where oid = v_crm) is distinct from array['search_path=pg_catalog, public, app, extensions']
     or (select proconfig from pg_proc where oid = v_cb) is distinct from array['search_path=pg_catalog, public, app'] then
    raise exception 'pkg1c_postcondition_failed: search_path of a finalization function changed' using errcode = 'P0001';
  end if;
  if position('pkg1c_capacity_guard' in (select prosrc from pg_proc where oid = v_crm)) = 0
     or position('pkg1c_late_success_paid' in (select prosrc from pg_proc where oid = v_cb)) = 0 then
    raise exception 'pkg1c_postcondition_failed: new finalization bodies are not in place' using errcode = 'P0001';
  end if;
end $$;
