-- SST readiness + final invoice corporate document support.
-- Additive only: no activation, recalculation, or historical backfill.

alter table public.sales_quotations
  add column if not exists sst_amount numeric(12,2),
  add column if not exists tax_label_snapshot text,
  add column if not exists tax_basis_snapshot text,
  add column if not exists sst_registration_number_snapshot text,
  add column if not exists sst_effective_date_snapshot date;

alter table public.invoices
  add column if not exists sst_applicable boolean,
  add column if not exists sst_amount numeric(12,2),
  add column if not exists tax_label_snapshot text,
  add column if not exists tax_basis_snapshot text,
  add column if not exists sst_registration_number_snapshot text,
  add column if not exists sst_effective_date_snapshot date;

alter table public.sales_quotations
  add constraint sales_quotations_sst_rate_check
    check (sst_rate >= 0 and sst_rate <= 100),
  add constraint sales_quotations_sst_amount_check
    check (sst_amount is null or sst_amount >= 0),
  add constraint sales_quotations_sst_amount_matches_tax_check
    check (sst_amount is null or round(sst_amount, 2) = round(tax, 2)),
  add constraint sales_quotations_sst_off_amount_check
    check (sst_applicable or coalesce(sst_amount, 0) = 0),
  add constraint sales_quotations_total_arithmetic_check
    check (round(subtotal - discount + tax, 2) = round(total, 2));

alter table public.invoices
  add constraint invoices_sst_rate_check
    check (sst_rate is null or (sst_rate >= 0 and sst_rate <= 100)),
  add constraint invoices_sst_amount_check
    check (sst_amount is null or sst_amount >= 0),
  add constraint invoices_sst_off_amount_check
    check (sst_applicable is distinct from false or coalesce(sst_amount, 0) = 0),
  add constraint invoices_sst_amount_matches_tax_check
    check (sst_amount is null or round(sst_amount, 2) = round(tax_amount, 2)),
  add constraint invoices_total_arithmetic_check
    check (round(taxable_amount + tax_amount, 2) = round(grand_total, 2));

comment on column public.sales_quotations.sst_amount is
  'SST amount saved with this quotation; nullable only for legacy rows and never backfilled.';
comment on column public.invoices.sst_amount is
  'SST amount copied from the accepted quotation; nullable only for legacy rows.';

create or replace function app.guard_quotation_sst_snapshot_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  if old.status <> 'draft' and (
       new.sst_applicable is distinct from old.sst_applicable
    or new.sst_rate is distinct from old.sst_rate
    or new.sst_amount is distinct from old.sst_amount
    or new.tax is distinct from old.tax
    or new.total is distinct from old.total
    or new.tax_label_snapshot is distinct from old.tax_label_snapshot
    or new.tax_basis_snapshot is distinct from old.tax_basis_snapshot
    or new.sst_registration_number_snapshot is distinct from old.sst_registration_number_snapshot
    or new.sst_effective_date_snapshot is distinct from old.sst_effective_date_snapshot
  ) then
    raise exception 'quotation_sst_snapshot_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_quotation_sst_snapshot on public.sales_quotations;
create trigger trg_guard_quotation_sst_snapshot
before update on public.sales_quotations
for each row execute function app.guard_quotation_sst_snapshot_mutation();

create or replace function app.enforce_invoice_financial_immutability() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_trusted boolean := coalesce(current_setting('app.invoice_trusted_write', true), '') = 'on';
begin
  if new.quotation_id is distinct from old.quotation_id
     or new.opportunity_id is distinct from old.opportunity_id
     or new.company_id is distinct from old.company_id
     or new.quotation_number_snapshot is distinct from old.quotation_number_snapshot
     or new.customer_company_name is distinct from old.customer_company_name
     or new.customer_contact_name is distinct from old.customer_contact_name
     or new.customer_registration_no is distinct from old.customer_registration_no
     or new.customer_email is distinct from old.customer_email
     or new.customer_phone is distinct from old.customer_phone
     or new.training_service_address_snapshot is distinct from old.training_service_address_snapshot
     or new.currency is distinct from old.currency
     or new.subtotal is distinct from old.subtotal
     or new.discount_amount is distinct from old.discount_amount
     or new.taxable_amount is distinct from old.taxable_amount
     or new.tax_rate is distinct from old.tax_rate
     or new.tax_amount is distinct from old.tax_amount
     or new.grand_total is distinct from old.grand_total
     or new.sst_applicable is distinct from old.sst_applicable
     or new.sst_amount is distinct from old.sst_amount
     or new.tax_label_snapshot is distinct from old.tax_label_snapshot
     or new.tax_basis_snapshot is distinct from old.tax_basis_snapshot
     or new.sst_registration_number_snapshot is distinct from old.sst_registration_number_snapshot
     or new.sst_effective_date_snapshot is distinct from old.sst_effective_date_snapshot
  then
    raise exception 'invoice_financial_fields_immutable' using errcode = 'P0001';
  end if;

  if old.status <> 'draft' and (
       new.billing_name is distinct from old.billing_name
    or new.billing_company is distinct from old.billing_company
    or new.billing_registration_no is distinct from old.billing_registration_no
    or new.billing_address is distinct from old.billing_address
    or new.billing_email is distinct from old.billing_email
    or new.billing_phone is distinct from old.billing_phone
    or new.invoice_date is distinct from old.invoice_date
    or new.due_date is distinct from old.due_date
    or new.notes is distinct from old.notes
    or new.payment_terms is distinct from old.payment_terms
  ) then
    raise exception 'invoice_presentation_fields_immutable_after_issue' using errcode = 'P0001';
  end if;

  if not v_trusted and (
       new.status is distinct from old.status
    or new.amount_paid is distinct from old.amount_paid
    or new.balance_due is distinct from old.balance_due
    or new.issued_at is distinct from old.issued_at
    or new.paid_at is distinct from old.paid_at
    or new.cancelled_at is distinct from old.cancelled_at
  ) then
    raise exception 'invoice_system_fields_require_controlled_path' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.create_invoice_from_quotation(p_quotation_id uuid) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_quotation record;
  v_opportunity record;
  v_company record;
  v_invoice_id uuid;
  v_taxable numeric(12,2);
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  select email into v_actor_email from public.profiles where id = v_actor;
  select * into v_quotation from public.sales_quotations where id = p_quotation_id for update;
  if v_quotation.id is null then raise exception 'quotation_not_found' using errcode = 'P0001'; end if;
  if v_quotation.status <> 'accepted' then raise exception 'quotation_not_accepted' using errcode = 'P0001'; end if;
  if exists (select 1 from public.invoices where quotation_id = p_quotation_id) then
    raise exception 'invoice_already_exists' using errcode = 'P0001';
  end if;
  select * into v_opportunity from public.sales_opportunities where id = v_quotation.opportunity_id;
  if v_opportunity.id is null then raise exception 'opportunity_not_found' using errcode = 'P0001'; end if;
  select * into v_company from public.companies where id = v_opportunity.company_id;
  v_taxable := round(v_quotation.subtotal - v_quotation.discount, 2);
  if round(v_taxable + v_quotation.tax, 2) <> round(v_quotation.total, 2) then
    raise exception 'quotation_totals_inconsistent' using errcode = 'P0001';
  end if;
  insert into public.invoices (
    quotation_id, quotation_number_snapshot, opportunity_id, company_id,
    customer_company_name, customer_contact_name, customer_registration_no,
    customer_email, customer_phone, training_service_address_snapshot,
    billing_name, billing_company, billing_registration_no, billing_address, billing_email, billing_phone,
    currency, subtotal, discount_amount, taxable_amount, tax_rate, tax_amount, grand_total,
    sst_applicable, sst_amount, tax_label_snapshot, tax_basis_snapshot,
    sst_registration_number_snapshot, sst_effective_date_snapshot,
    balance_due, notes, payment_terms, created_by
  ) values (
    p_quotation_id, v_quotation.quotation_no, v_quotation.opportunity_id, v_opportunity.company_id,
    coalesce(v_quotation.customer_company_name, v_opportunity.company_name, v_company.company_name),
    coalesce(v_quotation.customer_contact_name, v_opportunity.contact_person),
    coalesce(v_quotation.customer_registration_no, v_company.registration_no),
    coalesce(v_quotation.customer_email, v_opportunity.contact_email),
    coalesce(v_quotation.customer_phone, v_opportunity.contact_phone), v_quotation.training_service_address,
    coalesce(v_quotation.customer_contact_name, v_opportunity.contact_person, v_quotation.customer_company_name, v_opportunity.company_name, 'N/A'),
    coalesce(v_quotation.customer_company_name, v_opportunity.company_name, v_company.company_name),
    coalesce(v_quotation.customer_registration_no, v_company.registration_no),
    coalesce(v_quotation.billing_address, v_company.billing_address, v_company.address),
    coalesce(v_quotation.customer_email, v_opportunity.contact_email),
    coalesce(v_quotation.customer_phone, v_opportunity.contact_phone),
    v_quotation.currency, v_quotation.subtotal, v_quotation.discount, v_taxable,
    v_quotation.sst_rate, v_quotation.tax, v_quotation.total,
    v_quotation.sst_applicable, coalesce(v_quotation.sst_amount, v_quotation.tax),
    v_quotation.tax_label_snapshot, v_quotation.tax_basis_snapshot,
    v_quotation.sst_registration_number_snapshot, v_quotation.sst_effective_date_snapshot,
    v_quotation.total, v_quotation.notes, v_quotation.terms, v_actor
  ) returning id into v_invoice_id;
  insert into public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, discount, sort_order,
    source_quotation_item_id, course_id_snapshot, course_name_snapshot, hrdf_claim, package_includes_snapshot
  ) select v_invoice_id, description, quantity, unit, unit_price, discount, sort_order,
    id, course_id, course_name_snapshot, hrdf_claim, package_includes_snapshot
    from public.sales_quotation_items where quotation_id = p_quotation_id order by sort_order;
  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'invoices', v_invoice_id::text,
    format('Invoice created from quotation %s', v_quotation.quotation_no),
    jsonb_build_object('invoice_id', v_invoice_id, 'quotation_id', p_quotation_id, 'snapshot_source', 'accepted_quotation'));
  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_opportunity.lead_metadata_id, v_quotation.opportunity_id, p_quotation_id,
      'invoice_created', format('Draft invoice created from %s', v_quotation.quotation_no), v_actor);
  return v_invoice_id;
end;
$$;

revoke all on function public.create_invoice_from_quotation(uuid) from public;
grant execute on function public.create_invoice_from_quotation(uuid) to authenticated;
