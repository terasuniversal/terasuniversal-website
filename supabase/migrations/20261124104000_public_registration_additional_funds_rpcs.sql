-- AF1b (PKG-1d-B-DB-G1, P-AF1): the two staff RPCs of the additional-funds ledger (AF1a).
--
--   record_public_registration_additional_funds_claim: staff A records funds seen on a TERAS receiving-account
--     statement for a registration that is ALREADY paid. Creates one 'claimed' row (an unverified claim, not a receipt).
--   decide_public_registration_additional_funds: staff B (never the claimant) marks the claim 'verified' (genuine
--     second receipt) or 'rejected'. No refund, no settlement, no seat, no change to any registration or payment.
--
-- Both: active admin / super_admin only (auth.uid() + app.is_admin()); EXECUTE for authenticated only; mandatory notes
-- (at least five letters or digits); durable idempotency through the unique request ids (never an audit-log search);
-- exactly one semantic audit event per new financial event (row audit triggers are separate); no exception handler.
-- A bank reference shared with another record of the same receiving account is flagged as a POSSIBLE duplicate and never
-- rejected: reference semantics are unverified (M1b on hold). Requires AF1a. No DROP.

do $$
begin
  if to_regclass('public.public_registration_additional_funds') is null or to_regclass('public.payment_receiving_accounts') is null then
    raise exception 'af1b_precondition_failed: additional funds or receiving account table missing' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.public_registration_additional_funds'::regclass and tgname = 'trg_public_registration_additional_funds_guard') then
    raise exception 'af1b_precondition_failed: additional funds guard missing' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef('app.is_admin()'::regprocedure), '\s+', '', 'g')) <> '8f41288452b95115c01f55d50e2dae10' then
    raise exception 'af1b_precondition_failed: app.is_admin differs from the reviewed definition' using errcode = 'P0001';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.record_public_registration_additional_funds_claim(p_registration_id uuid, p_receiving_bank_account_id uuid, p_amount numeric, p_transferred_on date, p_payment_reference text, p_request_id uuid, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_registration public.public_registrations%rowtype;
  v_account public.payment_receiving_accounts%rowtype;
  v_existing public.public_registration_additional_funds%rowtype;
  v_row public.public_registration_additional_funds%rowtype;
  v_ref text;
  v_ref_key text;
  v_notes text;
  v_paid uuid[];
  v_dups uuid[];
begin
  -- af1_claim
  if v_actor is null or not app.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_ref := regexp_replace(btrim(coalesce(p_payment_reference, '')), '\s+', ' ', 'g');
  v_notes := btrim(coalesce(p_notes, ''));
  if p_registration_id is null or p_receiving_bank_account_id is null or p_request_id is null or p_transferred_on is null
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount >= 10000000000
     or v_ref !~ '^[A-Za-z0-9][A-Za-z0-9 /_.-]{2,63}$'
     or p_transferred_on > (now() at time zone 'Asia/Kuala_Lumpur')::date then
    raise exception 'invalid_additional_funds_claim' using errcode = 'P0001';
  end if;
  if length(v_notes) > 500 or length(regexp_replace(v_notes, '[^[:alnum:]]', '', 'g')) < 5 then
    raise exception 'invalid_additional_funds_notes' using errcode = 'P0001';
  end if;
  v_ref_key := upper(regexp_replace(v_ref, '\s+', '', 'g'));

  select * into v_account from public.payment_receiving_accounts
  where id = p_receiving_bank_account_id and is_active and deleted_at is null;
  if v_account.id is null then
    raise exception 'invalid_receiving_account' using errcode = 'P0001';
  end if;

  -- Lock order: registration first (as every payment writer), then the claim.
  select * into v_registration from public.public_registrations where id = p_registration_id for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  if p_transferred_on < (v_registration.created_at at time zone 'Asia/Kuala_Lumpur')::date then
    raise exception 'invalid_additional_funds_claim' using errcode = 'P0001';
  end if;

  -- Idempotency: one claim per request id (unique constraint); a replay with the same money facts returns the record.
  select * into v_existing from public.public_registration_additional_funds where claim_request_id = p_request_id for update;
  if v_existing.id is not null then
    if v_existing.registration_id = p_registration_id
       and v_existing.receiving_account_id = p_receiving_bank_account_id
       and v_existing.amount = round(p_amount, 2)
       and v_existing.transferred_on = p_transferred_on
       and upper(regexp_replace(v_existing.payment_reference, '\s+', '', 'g')) = v_ref_key then
      return jsonb_build_object('outcome', 'already_recorded', 'additional_funds_id', v_existing.id, 'status', v_existing.status,
        'registration_reference', v_registration.registration_reference);
    end if;
    raise exception 'request_id_conflict' using errcode = 'P0001';
  end if;

  -- Only a registration that is already paid can have ADDITIONAL funds; a first payment goes through bank verification.
  select coalesce(array_agg(id order by created_at, id), '{}'::uuid[]) into v_paid
  from public.public_registration_payments where registration_id = v_registration.id and status = 'paid';
  if cardinality(v_paid) = 0 then
    raise exception 'registration_not_paid' using errcode = 'P0001';
  end if;

  -- Possible duplicate (same receiving account, same normalised reference): flagged, never rejected.
  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) into v_dups from (
    select af.id from public.public_registration_additional_funds af
    where af.receiving_account_id = v_account.id and af.status <> 'rejected'
      and upper(regexp_replace(af.payment_reference, '\s+', '', 'g')) = v_ref_key
    union all
    select p.id from public.public_registration_payments p
    where p.payment_provider = 'bank_transfer' and p.receiving_account_id = v_account.id and p.status in ('paid', 'refunded')
      and upper(regexp_replace(coalesce(p.provider_reference, ''), '\s+', '', 'g')) = v_ref_key
  ) x;

  select email into v_actor_email from public.profiles where id = v_actor;
  insert into public.public_registration_additional_funds (
    registration_id, source, receiving_account_id, amount, currency, transferred_on, payment_reference,
    claim_request_id, related_payment_ids, duplicate_reference_candidates, claimed_by, claim_notes
  ) values (
    v_registration.id, 'bank_transfer', v_account.id, round(p_amount, 2), 'MYR', p_transferred_on, v_ref,
    p_request_id, v_paid, v_dups, v_actor, v_notes
  ) returning * into v_row;

  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::public.audit_action,
    'public_registration_additional_funds', v_row.id::text,
    'Additional funds claimed (unverified): ' || v_registration.registration_reference,
    jsonb_build_object('event', 'additional_funds_claimed', 'registration_reference', v_registration.registration_reference,
      'receiving_account_code', v_account.code, 'amount', v_row.amount, 'transferred_on', v_row.transferred_on,
      'payment_reference', v_row.payment_reference, 'request_id', p_request_id, 'related_payment_ids', to_jsonb(v_paid),
      'possible_duplicate_reference', cardinality(v_dups) > 0, 'verified', false, 'seat_allocated', false));

  return jsonb_build_object('outcome', 'claimed', 'additional_funds_id', v_row.id, 'status', 'claimed',
    'possible_duplicate_reference', cardinality(v_dups) > 0, 'registration_reference', v_registration.registration_reference);
end;
$function$;

CREATE OR REPLACE FUNCTION public.decide_public_registration_additional_funds(p_additional_funds_id uuid, p_decision text, p_request_id uuid, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_row public.public_registration_additional_funds%rowtype;
  v_prior public.public_registration_additional_funds%rowtype;
  v_notes text;
  v_reference text;
begin
  -- af1_decide
  if v_actor is null or not app.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_notes := btrim(coalesce(p_notes, ''));
  if p_additional_funds_id is null or p_request_id is null or p_decision is null or p_decision not in ('verified', 'rejected') then
    raise exception 'invalid_additional_funds_decision' using errcode = 'P0001';
  end if;
  if length(v_notes) > 500 or length(regexp_replace(v_notes, '[^[:alnum:]]', '', 'g')) < 5 then
    raise exception 'invalid_additional_funds_notes' using errcode = 'P0001';
  end if;

  -- Lock the claim first, then check idempotency, so a concurrent replay sees the committed decision.
  select * into v_row from public.public_registration_additional_funds where id = p_additional_funds_id for update;
  if v_row.id is null then
    raise exception 'additional_funds_not_found' using errcode = 'P0001';
  end if;
  select * into v_prior from public.public_registration_additional_funds where decision_request_id = p_request_id;
  if v_prior.id is not null then
    if v_prior.id = v_row.id and v_prior.status = p_decision then
      return jsonb_build_object('outcome', 'already_decided', 'additional_funds_id', v_row.id, 'status', v_row.status);
    end if;
    raise exception 'request_id_conflict' using errcode = 'P0001';
  end if;
  if v_row.status <> 'claimed' then
    raise exception 'invalid_additional_funds_transition' using errcode = 'P0001';
  end if;
  -- Four-eyes: the person who reported the funds can never confirm (or reject) their own claim.
  if v_row.claimed_by = v_actor then
    raise exception 'four_eyes_required' using errcode = '42501';
  end if;

  update public.public_registration_additional_funds
  set status = p_decision, decision_request_id = p_request_id, decided_by = v_actor, decided_at = now(), decision_notes = v_notes
  where id = v_row.id
  returning * into v_row;

  select email into v_actor_email from public.profiles where id = v_actor;
  select registration_reference into v_reference from public.public_registrations where id = v_row.registration_id;
  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::public.audit_action,
    'public_registration_additional_funds', v_row.id::text,
    'Additional funds ' || p_decision || ': ' || v_reference,
    jsonb_build_object('event', 'additional_funds_' || p_decision, 'registration_reference', v_reference,
      'amount', v_row.amount, 'request_id', p_request_id, 'claimed_by', v_row.claimed_by, 'seat_allocated', false));

  return jsonb_build_object('outcome', 'decided', 'additional_funds_id', v_row.id, 'status', v_row.status);
end;
$function$;

alter function public.record_public_registration_additional_funds_claim(uuid, uuid, numeric, date, text, uuid, text) owner to postgres;
alter function public.decide_public_registration_additional_funds(uuid, text, uuid, text) owner to postgres;
revoke all on function public.record_public_registration_additional_funds_claim(uuid, uuid, numeric, date, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.decide_public_registration_additional_funds(uuid, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.record_public_registration_additional_funds_claim(uuid, uuid, numeric, date, text, uuid, text) to authenticated;
grant execute on function public.decide_public_registration_additional_funds(uuid, text, uuid, text) to authenticated;

do $$
declare
  v_claim constant regprocedure := 'public.record_public_registration_additional_funds_claim(uuid,uuid,numeric,date,text,uuid,text)'::regprocedure;
  v_decide constant regprocedure := 'public.decide_public_registration_additional_funds(uuid,text,uuid,text)'::regprocedure;
begin
  if (select proacl::text from pg_proc where oid = v_claim) <> '{postgres=X/postgres,authenticated=X/postgres}'
     or (select proacl::text from pg_proc where oid = v_decide) <> '{postgres=X/postgres,authenticated=X/postgres}' then
    raise exception 'af1b_postcondition_failed: privileges of an additional funds RPC are not as specified' using errcode = 'P0001';
  end if;
  if (select proowner::regrole::text from pg_proc where oid = v_claim) <> 'postgres' or (select proowner::regrole::text from pg_proc where oid = v_decide) <> 'postgres'
     or not (select prosecdef from pg_proc where oid = v_claim) or not (select prosecdef from pg_proc where oid = v_decide)
     or (select proconfig from pg_proc where oid = v_claim) is distinct from array['search_path=pg_catalog, public, app']
     or (select proconfig from pg_proc where oid = v_decide) is distinct from array['search_path=pg_catalog, public, app'] then
    raise exception 'af1b_postcondition_failed: owner, SECURITY DEFINER or search_path of an additional funds RPC is not as specified' using errcode = 'P0001';
  end if;
  if position('af1_claim' in (select prosrc from pg_proc where oid = v_claim)) = 0 or position('af1_decide' in (select prosrc from pg_proc where oid = v_decide)) = 0 then
    raise exception 'af1b_postcondition_failed: additional funds RPC bodies are not in place' using errcode = 'P0001';
  end if;
end $$;
