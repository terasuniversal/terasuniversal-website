\set ON_ERROR_STOP on
-- BASELINE (original live bodies): demonstrates the two F-PAY-1 database gaps P2 closes. Each block PASSes when the bug is present.
select public.test_as_admin();

do $$ declare r record; v jsonb; s text;
begin
  select * into r from public.test_seed(100, true);
  v := public.cancel_invoice(r.inv, 'baseline direct RPC');
  select status into s from public.invoices where id = r.inv;
  if s <> 'cancelled' then raise exception 'FAIL baseline-a: expected the direct RPC to cancel (bug), got %', s; end if;
  if (select status from public.invoice_payments where id = r.att) <> 'pending' then raise exception 'FAIL baseline-a: attempt changed'; end if;
  raise notice 'PASS baseline-a (BUG PRESENT): direct cancel_invoice cancelled an invoice with a pending ToyyibPay attempt';
end $$;

do $$ declare r record; v jsonb; i record;
begin
  select * into r from public.test_seed(100, true, 'cancelled');
  v := public.test_finalize(r.att, r.bill, 100, 'TXN-BASE-B');
  select status, amount_paid, balance_due into i from public.invoices where id = r.inv;
  if v->>'outcome' <> 'finalized' or i.amount_paid <> 100 or i.status <> 'cancelled' then
    raise exception 'FAIL baseline-b: expected finalized money on a cancelled invoice (bug), got % / % / %', v, i.status, i.amount_paid;
  end if;
  raise notice 'PASS baseline-b (BUG PRESENT): finalize recorded RM % as collected on a CANCELLED invoice (outcome %)', i.amount_paid, v->>'outcome';
end $$;
