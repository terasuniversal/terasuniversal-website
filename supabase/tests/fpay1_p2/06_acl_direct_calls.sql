\set ON_ERROR_STOP on
-- AFTER P2: direct-call surface. finalize is EXECUTE-able by service_role only; the unguarded cancel body by nobody but its owner.
do $$ declare r record; e text;
begin
  select * into r from public.test_seed(100, true, 'cancelled');
  foreach e in array array['authenticated', 'anon'] loop
    begin
      execute format('set local role %I', e);
      perform public.finalize_toyyibpay_payment_from_callback(r.att, r.bill, 100, 'TXN-ACL', now(), now(), '{}'::jsonb);
      raise exception 'FAIL acl1: % could call finalize', e;
    exception when insufficient_privilege then reset role;
    end;
    begin
      execute format('set local role %I', e);
      perform public.cancel_invoice_unguarded(r.inv, 'x');
      raise exception 'FAIL acl2: % could call cancel_invoice_unguarded', e;
    exception when insufficient_privilege then reset role;
    end;
  end loop;
  if (select amount_paid from public.invoices where id = r.inv) <> 0 then raise exception 'FAIL acl: money moved'; end if;
  raise notice 'PASS acl1-2: authenticated and anon get permission denied on finalize and cancel_invoice_unguarded';
end $$;

do $$ declare r record; v jsonb;
begin
  select * into r from public.test_seed(100, true, 'cancelled');
  set local role service_role;
  v := public.finalize_toyyibpay_payment_from_callback(r.att, r.bill, 100, 'TXN-SR', now(), now(), '{}'::jsonb);
  reset role;
  if v->>'outcome' <> 'reconciliation_required' or (select amount_paid from public.invoices where id = r.inv) <> 0 then raise exception 'FAIL acl3: %', v; end if;
  raise notice 'PASS acl3: service_role direct finalize on a cancelled invoice -> reconciliation_required, RM 0';
end $$;
