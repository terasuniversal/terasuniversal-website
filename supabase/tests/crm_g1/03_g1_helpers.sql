\set ON_ERROR_STOP on
-- G1 test helpers (fixture only). Calls go through the client-facing wrapper, as the app does.
create or replace function public.g1_inv(p_total numeric) returns uuid language sql as $$
  select inv from public.test_seed(p_total, false)
$$;
create or replace function public.g1_pay(p_inv uuid, p_provider text, p_amount numeric, p_ref text, p_key uuid, p_method text default 'Maybank')
returns jsonb language plpgsql as $$
begin
  -- plpgsql so the 8-argument wrapper only has to exist when called (after G1), not when the helper is created.
  return public.record_manual_payment(p_inv, p_provider, p_method, p_amount, current_date, p_ref, null::text, p_key);
end $$;
-- Returns the exception code (text before ':') raised by p_sql, or 'ok'.
create or replace function public.g1_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return split_part(sqlerrm, ':', 1);
end $$;
create or replace function public.g1_check(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  if p_ok then raise notice 'PASS %', p_name; else raise notice 'FAIL % %', p_name, p_detail; end if;
end $$;
create or replace function public.g1_rows(p_inv uuid) returns int language sql as $$
  select count(*)::int from public.invoice_payments where invoice_id = p_inv
$$;
create or replace function public.g1_state(p_inv uuid) returns text language sql as $$
  select status || '/' || amount_paid || '/' || balance_due from public.invoices where id = p_inv
$$;
