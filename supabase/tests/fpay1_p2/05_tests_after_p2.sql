\set ON_ERROR_STOP on
-- AFTER P2: functional cases. Every block raises 'FAIL ...' on a wrong result; ON_ERROR_STOP aborts the run.
select public.test_as_admin();

-- P2a: direct RPC cannot cancel while a ToyyibPay attempt is pending (wrapper and unguarded body)
do $$ declare r record; ok boolean := false;
begin
  select * into r from public.test_seed(100, true);
  begin perform public.cancel_invoice(r.inv, 'direct'); exception when others then ok := sqlerrm = 'active_toyyibpay_attempt'; end;
  if not ok then raise exception 'FAIL a1: expected active_toyyibpay_attempt'; end if;
  if (select status from public.invoices where id = r.inv) <> 'issued' then raise exception 'FAIL a1: invoice changed'; end if;
  if (select status from public.invoice_payments where id = r.att) <> 'pending' then raise exception 'FAIL a1: attempt changed'; end if;
  ok := false;
  begin perform public.cancel_invoice_unguarded(r.inv, 'direct unguarded'); exception when others then ok := sqlerrm = 'active_toyyibpay_attempt'; end;
  if not ok then raise exception 'FAIL a1b: unguarded body must refuse too'; end if;
  raise notice 'PASS a1: cancel_invoice / _unguarded refuse with active_toyyibpay_attempt; invoice issued, attempt pending';
end $$;

-- P2a: the app path (#252): supersede first, then cancel -> succeeds
do $$ declare r record; v jsonb;
begin
  select * into r from public.test_seed(100, true);
  perform public.mark_toyyibpay_attempt_superseded_unguarded(r.att);
  v := public.cancel_invoice(r.inv, 'after supersede');
  if v->>'status' <> 'cancelled' then raise exception 'FAIL a2: %', v; end if;
  raise notice 'PASS a2: after supersede the cancel proceeds (app path unchanged)';
end $$;

-- P2a: no attempts / only terminal attempts -> unchanged behaviour
do $$ declare r record; v jsonb;
begin
  select * into r from public.test_seed(100, false);
  v := public.cancel_invoice(r.inv, 'no attempts');
  if v->>'status' <> 'cancelled' then raise exception 'FAIL a3: %', v; end if;
  select * into r from public.test_seed(100, true);
  perform set_config('app.invoice_trusted_write', 'on', true);
  update public.invoice_payments set status = 'failed', updated_at = now() where id = r.att;
  v := public.cancel_invoice(r.inv, 'failed attempt only');
  if v->>'status' <> 'cancelled' then raise exception 'FAIL a3b: %', v; end if;
  raise notice 'PASS a3: no attempt / failed attempt -> cancel works as before';
end $$;

-- P2a: existing error mapping preserved (already_cancelled, payments, not_authorized via wrapper)
do $$ declare r record; e text;
begin
  select * into r from public.test_seed(100, false, 'cancelled');
  begin perform public.cancel_invoice(r.inv, 'x'); exception when others then e := sqlerrm; end;
  if e <> 'already_cancelled' then raise exception 'FAIL a4: %', e; end if;
  perform public.test_as_staff();
  select * into r from public.test_seed(100, true);
  e := null;
  begin perform public.cancel_invoice(r.inv, 'x'); exception when others then e := sqlerrm; end;
  if e <> 'not_authorized' then raise exception 'FAIL a4b: wrapper must still check module access first, got %', e; end if;
  e := null;
  begin perform public.cancel_invoice_unguarded(r.inv, 'x'); exception when others then e := sqlerrm; end;
  if e <> 'not_authorized' then raise exception 'FAIL a4c: admin check must stay first, got %', e; end if;
  perform public.test_as_admin();
  raise notice 'PASS a4: already_cancelled kept; not_authorized still raised before the new check (wrapper and body)';
end $$;

-- P2b: finalize on a cancelled invoice -> reconciliation_required, nothing collected
do $$ declare r record; v jsonb; i record; a record; n int;
begin
  select * into r from public.test_seed(100, true, 'cancelled');
  v := public.test_finalize(r.att, r.bill, 100, 'TXN-B1');
  select status, amount_paid, balance_due into i from public.invoices where id = r.inv;
  select status, verified_amount, provider_transaction_id into a from public.invoice_payments where id = r.att;
  select count(*) into n from public.audit_logs where record_id = r.att::text and message like '%invoice is cancelled -- reconciliation required%' and detail->>'provider_transaction_id' = 'TXN-B1';
  if v->>'outcome' <> 'reconciliation_required' or i.amount_paid <> 0 or i.status <> 'cancelled' or a.status <> 'pending'
     or a.verified_amount is not null or a.provider_transaction_id is not null or n <> 1 then
    raise exception 'FAIL b1: % / % % / % % % / audit %', v, i.status, i.amount_paid, a.status, a.verified_amount, a.provider_transaction_id, n;
  end if;
  if exists (select 1 from public.sales_activity where note like '%TXN-B1%' or (type = 'payment_recorded' and note like '%' || r.bill || '%')) then
    raise exception 'FAIL b1: payment activity written';
  end if;
  raise notice 'PASS b1: cancelled invoice -> reconciliation_required, attempt pending, RM 0 collected, evidence audited once';
end $$;

-- regressions: normal finalize, replay, different txn, overpayment, superseded
do $$ declare r record; v jsonb; i record;
begin
  select * into r from public.test_seed(100, true);
  v := public.test_finalize(r.att, r.bill, 100, 'TXN-N1');
  select status, amount_paid, balance_due into i from public.invoices where id = r.inv;
  if v->>'outcome' <> 'finalized' or i.status <> 'paid' or i.amount_paid <> 100 or i.balance_due <> 0 then raise exception 'FAIL r1: % %', v, i; end if;
  v := public.test_finalize(r.att, r.bill, 100, 'TXN-N1');
  if v->>'outcome' <> 'duplicate_ignored' then raise exception 'FAIL r2 replay: %', v; end if;
  v := public.test_finalize(r.att, r.bill, 100, 'TXN-OTHER');
  if v->>'outcome' <> 'reconciliation_required' then raise exception 'FAIL r3 different txn: %', v; end if;
  if (select amount_paid from public.invoices where id = r.inv) <> 100 then raise exception 'FAIL r2/r3 changed money'; end if;
  raise notice 'PASS r1-r3: finalize normal -> paid; replay -> duplicate_ignored; different txn -> reconciliation_required (no double count)';

  select * into r from public.test_seed(100, true);
  v := public.test_finalize(r.att, r.bill, 150, 'TXN-OVER');
  if v->>'outcome' <> 'amount_exceeds_balance' or (select status from public.invoice_payments where id = r.att) <> 'pending' then raise exception 'FAIL r4: %', v; end if;
  raise notice 'PASS r4: overpayment -> amount_exceeds_balance, attempt pending';

  select * into r from public.test_seed(100, true);
  perform public.mark_toyyibpay_attempt_superseded_unguarded(r.att);
  v := public.test_finalize(r.att, r.bill, 100, 'TXN-SUP');
  if v->>'outcome' <> 'reconciliation_required' or (select amount_paid from public.invoices where id = r.inv) <> 0 then raise exception 'FAIL r5: %', v; end if;
  raise notice 'PASS r5: superseded attempt -> reconciliation_required, nothing collected';

  select * into r from public.test_seed(100, true);
  begin perform public.test_finalize(r.att, 'WRONG', 100, 'T'); raise exception 'FAIL r6: no error'; exception when others then if sqlerrm <> 'billcode_mismatch' then raise; end if; end;
  raise notice 'PASS r6: billcode_mismatch still raised';
end $$;
