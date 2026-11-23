\set ON_ERROR_STOP on
-- Test helpers (fixture only). Rows are inserted directly; the BEFORE UPDATE guards only police updates.
create or replace function public.test_seed(p_total numeric, p_pending boolean, p_status text default 'issued')
returns table (inv uuid, att uuid, bill text) language plpgsql as $$
declare v_inv uuid; v_att uuid; v_bill text := 'B' || substr(md5(random()::text), 1, 8); v_opp uuid;
begin
  insert into public.sales_opportunities default values returning id into v_opp;
  insert into public.invoices (invoice_no, opportunity_id, status, subtotal, taxable_amount, grand_total, balance_due, issued_at, cancelled_at)
  values ('INV-T-' || substr(md5(random()::text), 1, 6), v_opp, p_status, p_total, p_total, p_total, p_total,
          case when p_status <> 'draft' then now() end, case when p_status = 'cancelled' then now() end)
  returning id into v_inv;
  if p_pending then
    insert into public.invoice_payments (invoice_id, payment_provider, amount, status, provider_bill_code, payment_url)
    values (v_inv, 'toyyibpay', p_total, 'pending', v_bill, 'https://dev.toyyibpay.com/' || v_bill)
    returning id into v_att;
  end if;
  return query select v_inv, v_att, v_bill;
end $$;

create or replace function public.test_as_admin() returns void language sql as $$
  select set_config('test.is_admin', 'true', false), set_config('test.uid', '00000000-0000-4000-8000-000000000001', false);
$$;
create or replace function public.test_as_staff() returns void language sql as $$
  select set_config('test.is_admin', 'false', false), set_config('test.uid', '00000000-0000-4000-8000-000000000002', false);
$$;
create or replace function public.test_finalize(p_att uuid, p_bill text, p_amount numeric, p_txn text) returns jsonb language sql as $$
  select public.finalize_toyyibpay_payment_from_callback(p_att, p_bill, p_amount, p_txn, now(), now(), jsonb_build_object('test', true));
$$;
