\set ON_ERROR_STOP on
-- G1 Docker fixture: the two live record_manual_payment functions, verbatim (prosrc decoded from Production, 2026-11-23;
-- md5 95b4afc2 wrapper / db3e3d34 unguarded, identical on Staging). ACLs set to the live values. Loaded after the P2 fixture.
create function public.record_manual_payment_unguarded(p_invoice_id uuid, p_payment_provider text, p_payment_method text, p_amount numeric, p_payment_date date, p_payment_reference text, p_notes text)
returns jsonb language plpgsql security definer set search_path = public, app
as $orig$
declare
  v_invoice record;
  v_lead_metadata_id uuid;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_payment_id uuid;
  v_new_amount_paid numeric(12,2);
  v_new_status text;
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

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status not in ('issued', 'partially_paid') then
    raise exception 'invoice_not_payable' using errcode = 'P0001';
  end if;
  if p_amount > v_invoice.balance_due then
    raise exception 'payment_exceeds_balance' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  insert into public.invoice_payments (
    invoice_id, payment_provider, payment_method, amount, currency, status,
    payment_reference, notes, paid_at, created_by
  ) values (
    p_invoice_id, p_payment_provider, p_payment_method, p_amount, v_invoice.currency, 'successful',
    p_payment_reference, p_notes, coalesce(p_payment_date, current_date)::timestamptz, v_actor
  ) returning id into v_payment_id;

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

  return jsonb_build_object('payment_id', v_payment_id, 'amount_paid', v_new_amount_paid, 'status', v_new_status);
end;
$orig$;
create function public.record_manual_payment(p_invoice_id uuid, p_payment_provider text, p_payment_method text, p_amount numeric, p_payment_date date, p_payment_reference text, p_notes text)
returns jsonb language plpgsql security definer set search_path = ''
as $orig$
begin
  if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.record_manual_payment_unguarded(p_invoice_id, p_payment_provider, p_payment_method, p_amount, p_payment_date, p_payment_reference, p_notes);
end; $orig$;
revoke all on function public.record_manual_payment_unguarded(uuid, text, text, numeric, date, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) from public, anon, service_role;
grant execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) to authenticated;
