\set ON_ERROR_STOP on
-- G1 functional tests, single session. Each block prints PASS/FAIL lines.
select public.test_as_admin();

do $t$
declare v_inv uuid; v_inv2 uuid; r jsonb; r2 jsonb; k uuid := gen_random_uuid(); n_audit int; n_act int; e text;
begin
  -- t1 cash needs no reference; outcome recorded; partial payment state
  v_inv := public.g1_inv(1000);
  r := public.g1_pay(v_inv, 'cash', 400, null, k);
  perform public.g1_check('t1 cash without reference is recorded (partial)', r->>'outcome' = 'recorded' and public.g1_state(v_inv) = 'partially_paid/400.00/600.00', r::text || public.g1_state(v_inv));

  -- t2 replay with the same key and same details: original payment returned, nothing written
  select count(*) into n_audit from public.audit_logs; select count(*) into n_act from public.sales_activity;
  r2 := public.g1_pay(v_inv, 'cash', 400, null, k);
  perform public.g1_check('t2 replay returns the original payment, outcome duplicate_ignored',
    r2->>'outcome' = 'duplicate_ignored' and r2->>'payment_id' = r->>'payment_id', r2::text);
  perform public.g1_check('t2 replay writes nothing (rows, balance, audit, activity unchanged)',
    public.g1_rows(v_inv) = 1 and public.g1_state(v_inv) = 'partially_paid/400.00/600.00'
    and (select count(*) from public.audit_logs) = n_audit and (select count(*) from public.sales_activity) = n_act);

  -- t3 same key, different amount -> conflict; same key on another invoice -> conflict
  e := public.g1_err(format('select public.g1_pay(%L, ''cash'', 300, null, %L)', v_inv, k));
  perform public.g1_check('t3 same key with different details is refused (idempotency_key_conflict)', e = 'idempotency_key_conflict', e);
  v_inv2 := public.g1_inv(500);
  e := public.g1_err(format('select public.g1_pay(%L, ''cash'', 400, null, %L)', v_inv2, k));
  perform public.g1_check('t3 same key on another invoice is refused (idempotency_key_conflict)', e = 'idempotency_key_conflict' and public.g1_rows(v_inv2) = 0, e);

  -- t4 key is mandatory
  e := public.g1_err(format('select public.g1_pay(%L, ''cash'', 10, null, null)', v_inv2));
  perform public.g1_check('t4 missing idempotency key is refused (idempotency_key_required)', e = 'idempotency_key_required', e);

  -- t5 second partial with a new key completes the invoice
  r := public.g1_pay(v_inv, 'cash', 600, null, gen_random_uuid());
  perform public.g1_check('t5 second partial payment with a new key settles the invoice', public.g1_state(v_inv) = 'paid/1000.00/0.00' and public.g1_rows(v_inv) = 2, public.g1_state(v_inv));

  -- t6 replay after the invoice is paid still returns duplicate_ignored (not invoice_not_payable)
  r2 := public.g1_pay(v_inv, 'cash', 400, null, k);
  perform public.g1_check('t6 replay after the invoice is fully paid returns duplicate_ignored', r2->>'outcome' = 'duplicate_ignored', r2::text);
end $t$;

do $t$
declare v_inv uuid; v_inv2 uuid; r jsonb; e text;
begin
  v_inv := public.g1_inv(1000);
  -- t7 bank transfer / cheque need a reference; blank and punctuation-only references count as missing
  e := public.g1_err(format('select public.g1_pay(%L, ''bank_transfer'', 100, null, %L)', v_inv, gen_random_uuid()));
  perform public.g1_check('t7 bank transfer without reference is refused', e = 'payment_reference_required', e);
  e := public.g1_err(format('select public.g1_pay(%L, ''bank_transfer'', 100, %L, %L)', v_inv, '  - / ', gen_random_uuid()));
  perform public.g1_check('t7 bank transfer with a blank/punctuation-only reference is refused', e = 'payment_reference_required', e);
  e := public.g1_err(format('select public.g1_pay(%L, ''cheque'', 100, %L, %L)', v_inv, '', gen_random_uuid()));
  perform public.g1_check('t7 cheque without cheque number is refused', e = 'payment_reference_required', e);
  r := public.g1_pay(v_inv, 'other', 50, null, gen_random_uuid());
  perform public.g1_check('t7 provider "other" still needs no reference', r->>'outcome' = 'recorded', r::text);

  -- t8 duplicate reference on the same invoice and provider, after normalisation
  r := public.g1_pay(v_inv, 'bank_transfer', 100, 'FT-123 456', gen_random_uuid());
  e := public.g1_err(format('select public.g1_pay(%L, ''bank_transfer'', 100, %L, %L)', v_inv, 'ft123456', gen_random_uuid()));
  perform public.g1_check('t8 same normalised bank reference on the same invoice is refused (duplicate_payment_reference)', e = 'duplicate_payment_reference', e);
  perform public.g1_check('t8 stored reference is trimmed, not rewritten', (select payment_reference from public.invoice_payments where id = (r->>'payment_id')::uuid) = 'FT-123 456');

  -- t9 the same reference may be allocated to another invoice (one transfer paying several invoices)
  v_inv2 := public.g1_inv(300);
  r := public.g1_pay(v_inv2, 'bank_transfer', 300, 'FT123456', gen_random_uuid());
  perform public.g1_check('t9 same bank reference on a different invoice is allowed (split allocation)', r->>'outcome' = 'recorded' and public.g1_state(v_inv2) = 'paid/300.00/0.00', r::text);

  -- t10 same reference under a different provider on the same invoice is a different transaction identity
  r := public.g1_pay(v_inv, 'cheque', 100, 'FT123456', gen_random_uuid());
  perform public.g1_check('t10 same reference as cheque (different provider) on the same invoice is allowed', r->>'outcome' = 'recorded', r::text);

  -- t11 a reference used only by a non-successful payment does not block (rows inserted directly: the live trigger
  -- forbids flipping a successful row's status, so a refunded/failed row is seeded as such)
  insert into public.invoice_payments (invoice_id, payment_provider, amount, status, payment_reference)
  values (v_inv, 'bank_transfer', 100, 'refunded', 'RF-900'), (v_inv, 'bank_transfer', 100, 'failed', 'RF-901');
  r := public.g1_pay(v_inv, 'bank_transfer', 100, 'rf 900', gen_random_uuid());
  perform public.g1_check('t11 reference of a refunded payment can be recorded again', r->>'outcome' = 'recorded', r::text);
  r := public.g1_pay(v_inv, 'bank_transfer', 100, 'RF901', gen_random_uuid());
  perform public.g1_check('t11 reference of a failed payment can be recorded again', r->>'outcome' = 'recorded', r::text);

  -- t12 HRDF rows keep their own rule and do not block a customer reference
  insert into public.invoice_payments (invoice_id, payment_provider, amount, status, payment_reference, payment_source)
  values (v_inv, 'bank_transfer', 10, 'successful', 'HRDF-777', 'hrdf');
  r := public.g1_pay(v_inv, 'bank_transfer', 10, 'HRDF 777', gen_random_uuid());
  perform public.g1_check('t12 an HRDF row with the same reference does not block a customer payment', r->>'outcome' = 'recorded', r::text);
end $t$;

do $t$
declare v_inv uuid; v_draft uuid; e text;
begin
  -- t13 existing safety controls unchanged: overpayment, not payable, non-admin, invalid provider/amount
  v_inv := public.g1_inv(100);
  e := public.g1_err(format('select public.g1_pay(%L, ''cash'', 100.01, null, %L)', v_inv, gen_random_uuid()));
  perform public.g1_check('t13 overpayment still refused (payment_exceeds_balance)', e = 'payment_exceeds_balance', e);
  v_draft := (select inv from public.test_seed(100, false, 'draft'));
  e := public.g1_err(format('select public.g1_pay(%L, ''cash'', 10, null, %L)', v_draft, gen_random_uuid()));
  perform public.g1_check('t13 draft invoice still refused (invoice_not_payable)', e = 'invoice_not_payable', e);
  e := public.g1_err(format('select public.g1_pay(%L, ''toyyibpay'', 10, null, %L)', v_inv, gen_random_uuid()));
  perform public.g1_check('t13 toyyibpay is not a manual provider (invalid_payment_provider)', e = 'invalid_payment_provider', e);
  e := public.g1_err(format('select public.g1_pay(%L, ''cash'', 0, null, %L)', v_inv, gen_random_uuid()));
  perform public.g1_check('t13 zero amount refused (invalid_amount)', e = 'invalid_amount', e);
  perform public.test_as_staff();
  e := public.g1_err(format('select public.g1_pay(%L, ''cash'', 10, null, %L)', v_inv, gen_random_uuid()));
  perform public.g1_check('t13 non-admin refused by the wrapper module guard (not_authorized)', e = 'not_authorized', e);
  e := public.g1_err(format('select public.record_manual_payment_unguarded(%L, ''cash'', null, 10, current_date, null, null, %L)', v_inv, gen_random_uuid()));
  perform public.g1_check('t13 non-admin refused inside the unguarded body too (not_authorized)', e = 'not_authorized', e);
  perform public.test_as_admin();
  perform public.g1_check('t13 nothing was recorded by the refused calls', public.g1_rows(v_inv) = 0);
end $t$;

do $t$
declare v_inv uuid; e text;
begin
  -- t14 database-level backstop: the indexes refuse duplicates even if the function is bypassed
  v_inv := public.g1_inv(500);
  perform public.g1_pay(v_inv, 'bank_transfer', 100, 'IBG-555', gen_random_uuid());
  e := public.g1_err(format($q$insert into public.invoice_payments (invoice_id, payment_provider, amount, status, payment_reference) values (%L, 'bank_transfer', 100, 'successful', 'ibg555')$q$, v_inv));
  perform public.g1_check('t14 direct insert of a duplicate normalised reference violates invoice_payments_manual_reference_key', e like 'duplicate key value violates unique constraint "invoice_payments_manual_reference_key"%', e);
  e := public.g1_err(format($q$insert into public.invoice_payments (invoice_id, payment_provider, amount, status, idempotency_key) select %L, 'cash', 1, 'successful', idempotency_key from public.invoice_payments where idempotency_key is not null limit 1$q$, v_inv));
  perform public.g1_check('t14 direct insert of a reused idempotency key violates invoice_payments_idempotency_key_key', e like 'duplicate key value violates unique constraint "invoice_payments_idempotency_key_key"%', e);
end $t$;

-- t15 ACL: client roles
select public.g1_check('t15 authenticated can execute the new 8-argument wrapper',
  has_function_privilege('authenticated', 'public.record_manual_payment(uuid,text,text,numeric,date,text,text,uuid)', 'EXECUTE'));
select public.g1_check('t15 authenticated can no longer execute the old 7-argument wrapper',
  not has_function_privilege('authenticated', 'public.record_manual_payment(uuid,text,text,numeric,date,text,text)', 'EXECUTE'));
select public.g1_check('t15 anon and service_role cannot execute either wrapper; no client role can execute either unguarded body',
  not has_function_privilege('anon', 'public.record_manual_payment(uuid,text,text,numeric,date,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.record_manual_payment(uuid,text,text,numeric,date,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_manual_payment(uuid,text,text,numeric,date,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text,uuid)', 'EXECUTE'));
set role authenticated;
select public.g1_check('t15 calling the old 7-argument wrapper as authenticated is denied',
  public.g1_err($q$select public.record_manual_payment(gen_random_uuid(), 'cash', null, 1, current_date, null, null)$q$) = 'permission denied for function record_manual_payment');
reset role;
