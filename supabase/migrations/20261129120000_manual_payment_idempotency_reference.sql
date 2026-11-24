-- G1 (DRAFT, NOT APPLIED ANYWHERE): manual payments become idempotent and bank transfer / cheque payments need a reference.
--
-- Finding (read-only, Production iagzkrzeuawaxvacqprk and Staging eokiaehnvzbggmacifcf, 2026-11-23):
-- record_manual_payment_unguarded (md5 db3e3d34..., identical in both) inserts one row per call. The invoice row lock
-- only serialises calls; it does not recognise a resubmission. A double submit, a retry after a lost response or two
-- staff recording the same transfer therefore create two successful payments while the balance allows it.
-- payment_reference is optional for every provider, and nothing stops the same bank reference being recorded twice.
--
-- Change (one logical change):
--   1. invoice_payments.idempotency_key uuid (nullable; old rows stay NULL) + a unique index on it. The column may already
--      exist after a rollback (the rollback keeps it, no DROP COLUMN); the functions and indexes may not.
--   2. A unique index on the normalised reference of successful customer bank_transfer / cheque payments, per invoice and
--      provider. Normalisation: upper-case, letters and digits only ("FT-123 456" = "ft123456"). It is scoped to the
--      invoice so one bank transaction can still be allocated across several invoices. HRDF rows keep their own rule.
--   3. New 8-argument record_manual_payment(..., p_idempotency_key uuid) wrapper (same module guard as M-S7) and
--      record_manual_payment_unguarded body:
--        - the key is mandatory; a replay with the same key on the same invoice and the same payment details returns the
--          original payment (outcome duplicate_ignored) and writes nothing; the same key with different details or a
--          different invoice is refused (idempotency_key_conflict);
--        - bank_transfer and cheque need a reference (payment_reference_required);
--        - a second successful payment with the same normalised reference on the same invoice and provider is refused
--          (duplicate_payment_reference); the unique index is the backstop for concurrent sessions;
--        - unchanged: admin check, provider list, amount > 0, invoice FOR UPDATE lock, issued/partially_paid only,
--          amount <= balance_due, audit log, sales_activity rows, return shape (plus outcome).
--   4. EXECUTE on the old 7-argument wrapper is revoked from authenticated, so no client path can skip the key. Its body
--      and the old 7-argument unguarded function are not changed or dropped.
-- Not changed: RLS, table grants, other payment functions (HRDF, ToyyibPay, receipts), existing rows.
-- Fail-closed pre/postconditions inside one DO block; lock_timeout 5s; a re-run fails closed (precondition).
-- Rollback: docs/security/crm-g1/20261129120000_manual_payment_idempotency_reference.rollback.sql

do $g1$
declare
  v_old_wrapper regprocedure := to_regprocedure('public.record_manual_payment(uuid,text,text,numeric,date,text,text)');
  v_old_unguarded regprocedure := to_regprocedure('public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text)');
  v_new_wrapper regprocedure;
  v_new_unguarded regprocedure;
  v_dupes int;
begin
  perform set_config('lock_timeout', '5s', true);

  -- ---- Preflight ------------------------------------------------------------------------------------------------
  if v_old_wrapper is null or v_old_unguarded is null
     or (select md5(prosrc) from pg_proc where oid = v_old_unguarded) <> 'db3e3d34fce21530c92e3ae8ab43a82d'
     or (select md5(prosrc) from pg_proc where oid = v_old_wrapper) <> '95b4afc264c3b4579e49b29b8024fcfc'
     or (select proacl::text from pg_proc where oid = v_old_wrapper) is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
     or (select proacl::text from pg_proc where oid = v_old_unguarded) is distinct from '{postgres=X/postgres}' then
    raise exception 'g1_precondition_failed: record_manual_payment functions are not the reviewed pre-state - nothing changed'
      using errcode = 'P0001';
  end if;
  if to_regprocedure('public.record_manual_payment(uuid,text,text,numeric,date,text,text,uuid)') is not null
     or to_regprocedure('public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text,uuid)') is not null
     or to_regclass('public.invoice_payments_idempotency_key_key') is not null
     or to_regclass('public.invoice_payments_manual_reference_key') is not null then
    raise exception 'g1_precondition_failed: G1 objects already exist - nothing changed' using errcode = 'P0001';
  end if;
  select count(*) into v_dupes from (
    select 1 from public.invoice_payments
    where payment_provider in ('bank_transfer', 'cheque') and status = 'successful' and payment_source is distinct from 'hrdf'
      and payment_reference is not null and regexp_replace(upper(payment_reference), '[^A-Z0-9]', '', 'g') <> ''
    group by invoice_id, payment_provider, regexp_replace(upper(payment_reference), '[^A-Z0-9]', '', 'g')
    having count(*) > 1
  ) d;
  if v_dupes <> 0 then
    raise exception 'g1_precondition_failed: % existing duplicate reference group(s) - resolve before applying, nothing changed', v_dupes
      using errcode = 'P0001';
  end if;

  -- ---- Schema ---------------------------------------------------------------------------------------------------
  alter table public.invoice_payments add column if not exists idempotency_key uuid;
  create unique index if not exists invoice_payments_idempotency_key_key
    on public.invoice_payments (idempotency_key) where idempotency_key is not null;
  create unique index if not exists invoice_payments_manual_reference_key
    on public.invoice_payments (invoice_id, payment_provider, (regexp_replace(upper(payment_reference), '[^A-Z0-9]', '', 'g')))
    where payment_provider in ('bank_transfer', 'cheque') and status = 'successful' and payment_source is distinct from 'hrdf'
      and payment_reference is not null and regexp_replace(upper(payment_reference), '[^A-Z0-9]', '', 'g') <> '';

  -- ---- Functions ------------------------------------------------------------------------------------------------
  execute $fn$
create function public.record_manual_payment_unguarded(p_invoice_id uuid, p_payment_provider text, p_payment_method text,
  p_amount numeric, p_payment_date date, p_payment_reference text, p_notes text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public, app
as $body$
declare
  v_invoice record;
  v_existing record;
  v_lead_metadata_id uuid;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_payment_id uuid;
  v_new_amount_paid numeric(12,2);
  v_new_status text;
  v_reference text := nullif(btrim(p_payment_reference), '');
  v_reference_norm text := regexp_replace(upper(coalesce(p_payment_reference, '')), '[^A-Z0-9]', '', 'g');
  v_constraint text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_payment_provider not in ('cash', 'bank_transfer', 'cheque', 'other') then
    raise exception 'invalid_payment_provider' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key_required' using errcode = 'P0001';
  end if;
  if p_payment_provider in ('bank_transfer', 'cheque') and v_reference_norm = '' then
    raise exception 'payment_reference_required' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;

  -- Replay check runs under the invoice lock and before the payable/balance checks, so a resubmission of a payment that
  -- already settled the invoice returns the original payment instead of "not payable".
  select id, invoice_id, payment_provider, amount, payment_reference into v_existing
  from public.invoice_payments where idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.invoice_id = p_invoice_id and v_existing.payment_provider = p_payment_provider
       and v_existing.amount = p_amount and coalesce(v_existing.payment_reference, '') = coalesce(v_reference, '') then
      return jsonb_build_object('payment_id', v_existing.id, 'amount_paid', v_invoice.amount_paid, 'status', v_invoice.status,
        'outcome', 'duplicate_ignored');
    end if;
    raise exception 'idempotency_key_conflict' using errcode = 'P0001';
  end if;

  if v_invoice.status not in ('issued', 'partially_paid') then
    raise exception 'invoice_not_payable' using errcode = 'P0001';
  end if;
  if p_amount > v_invoice.balance_due then
    raise exception 'payment_exceeds_balance' using errcode = 'P0001';
  end if;
  if p_payment_provider in ('bank_transfer', 'cheque') and exists (
    select 1 from public.invoice_payments
    where invoice_id = p_invoice_id and payment_provider = p_payment_provider and status = 'successful'
      and payment_source is distinct from 'hrdf'
      and regexp_replace(upper(coalesce(payment_reference, '')), '[^A-Z0-9]', '', 'g') = v_reference_norm
  ) then
    raise exception 'duplicate_payment_reference' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  begin
    insert into public.invoice_payments (
      invoice_id, payment_provider, payment_method, amount, currency, status,
      payment_reference, notes, paid_at, created_by, idempotency_key
    ) values (
      p_invoice_id, p_payment_provider, p_payment_method, p_amount, v_invoice.currency, 'successful',
      v_reference, p_notes, coalesce(p_payment_date, current_date)::timestamptz, v_actor, p_idempotency_key
    ) returning id into v_payment_id;
  exception when unique_violation then
    -- Concurrent sessions: the indexes are the final arbiter; map them to the same codes as the checks above.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'invoice_payments_idempotency_key_key' then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    elsif v_constraint = 'invoice_payments_manual_reference_key' then
      raise exception 'duplicate_payment_reference' using errcode = 'P0001';
    end if;
    raise;
  end;

  select amount_paid, status into v_new_amount_paid, v_new_status from public.invoices where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'invoice_payments', v_payment_id::text,
    format('Manual payment of RM %s recorded on invoice %s (%s)', p_amount, v_invoice.invoice_no, p_payment_provider),
    jsonb_build_object('invoice_id', p_invoice_id, 'payment_id', v_payment_id, 'amount', p_amount, 'provider', p_payment_provider));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'payment_recorded',
    format('%s: payment of RM %s recorded (%s)', v_invoice.invoice_no, p_amount, p_payment_provider), v_actor);

  if v_new_status = 'paid' then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
      format('Invoice %s fully paid', v_invoice.invoice_no), jsonb_build_object('invoice_id', p_invoice_id));
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_paid', format('%s fully paid', v_invoice.invoice_no), v_actor);
  elsif v_new_status = 'partially_paid' then
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_partially_paid',
      format('%s partially paid (balance RM %s)', v_invoice.invoice_no, v_invoice.grand_total - v_new_amount_paid), v_actor);
  end if;

  return jsonb_build_object('payment_id', v_payment_id, 'amount_paid', v_new_amount_paid, 'status', v_new_status, 'outcome', 'recorded');
end;
$body$
$fn$;

  execute $fn$
create function public.record_manual_payment(p_invoice_id uuid, p_payment_provider text, p_payment_method text,
  p_amount numeric, p_payment_date date, p_payment_reference text, p_notes text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $body$
begin
  if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.record_manual_payment_unguarded(p_invoice_id, p_payment_provider, p_payment_method, p_amount, p_payment_date,
    p_payment_reference, p_notes, p_idempotency_key);
end;
$body$
$fn$;

  v_new_wrapper := to_regprocedure('public.record_manual_payment(uuid,text,text,numeric,date,text,text,uuid)');
  v_new_unguarded := to_regprocedure('public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text,uuid)');

  alter function public.record_manual_payment_unguarded(uuid, text, text, numeric, date, text, text, uuid) owner to postgres;
  alter function public.record_manual_payment(uuid, text, text, numeric, date, text, text, uuid) owner to postgres;
  revoke all on function public.record_manual_payment_unguarded(uuid, text, text, numeric, date, text, text, uuid)
    from public, anon, authenticated, service_role;
  revoke all on function public.record_manual_payment(uuid, text, text, numeric, date, text, text, uuid)
    from public, anon, service_role;
  grant execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text, uuid) to authenticated;

  revoke execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) from authenticated;

  -- ---- Postconditions -------------------------------------------------------------------------------------------
  if (select proacl::text from pg_proc where oid = v_new_wrapper) is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
     or (select proacl::text from pg_proc where oid = v_new_unguarded) is distinct from '{postgres=X/postgres}'
     or (select proacl::text from pg_proc where oid = v_old_wrapper) is distinct from '{postgres=X/postgres}'
     or (select proacl::text from pg_proc where oid = v_old_unguarded) is distinct from '{postgres=X/postgres}'
     or (select md5(prosrc) from pg_proc where oid = v_old_unguarded) <> 'db3e3d34fce21530c92e3ae8ab43a82d'
     or (select md5(prosrc) from pg_proc where oid = v_old_wrapper) <> '95b4afc264c3b4579e49b29b8024fcfc'
     or not (select prosecdef from pg_proc where oid = v_new_wrapper)
     or not (select prosecdef from pg_proc where oid = v_new_unguarded)
     or (select proconfig::text from pg_proc where oid = v_new_wrapper) is distinct from '{"search_path=\"\""}'
     or (select proconfig::text from pg_proc where oid = v_new_unguarded) is distinct from '{"search_path=public, app"}'
     or has_function_privilege('anon', v_new_wrapper, 'EXECUTE')
     or has_function_privilege('authenticated', v_new_unguarded, 'EXECUTE')
     or has_function_privilege('authenticated', v_old_wrapper, 'EXECUTE')
     or to_regclass('public.invoice_payments_idempotency_key_key') is null
     or to_regclass('public.invoice_payments_manual_reference_key') is null then
    raise exception 'g1_postcondition_failed: unexpected function ACL, body or index after G1' using errcode = 'P0001';
  end if;
end;
$g1$;
