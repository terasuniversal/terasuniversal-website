-- F-PAY-1 P2 Docker fixture: the minimum of the live schema that cancel_invoice / finalize touch.
-- Trigger functions and the functions under test are copied verbatim from Staging (= Production, md5-identical, 2026-11-23).
-- Auth/RBAC helpers are stubs driven by session settings so tests can act as admin, non-admin or the service role.
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
create schema if not exists app;
create schema if not exists auth;
create type public.audit_action as enum ('insert', 'update', 'delete', 'login', 'export');

create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function app.is_admin() returns boolean language sql stable as
$$ select coalesce(current_setting('test.is_admin', true), 'false') = 'true' $$;
create or replace function public.has_module_access_level(p_module text, p_level text) returns boolean language sql stable as
$$ select coalesce(current_setting('test.is_admin', true), 'false') = 'true' $$;

create table public.profiles (id uuid primary key, email text, role text, is_active boolean default true, created_at timestamptz default now());
create table public.sales_opportunities (id uuid primary key default gen_random_uuid(), lead_metadata_id uuid);
create table public.sales_activity (id bigserial primary key, lead_metadata_id uuid, opportunity_id uuid, quotation_id uuid, type text, note text, actor_id uuid, created_at timestamptz default now());
create table public.audit_logs (id bigserial primary key, actor uuid, actor_email text, action public.audit_action, table_name text, record_id text, message text, detail jsonb, created_at timestamptz default now());
create table public.receipts (id uuid primary key default gen_random_uuid(), invoice_payment_id uuid, status text, refunded_at timestamptz);

create or replace function public.log_event_as_service(p_actor uuid, p_email text, p_action public.audit_action, p_table text, p_id text, p_message text, p_detail jsonb)
returns void language sql security definer set search_path = public as
$$ insert into public.audit_logs (actor, actor_email, action, table_name, record_id, message, detail) values (p_actor, p_email, p_action, p_table, p_id, p_message, p_detail) $$;

create table public.invoices (
  id uuid primary key default gen_random_uuid(), invoice_no text not null unique, quotation_id uuid not null unique default gen_random_uuid(),
  opportunity_id uuid not null, company_id uuid, billing_name text not null default 'UAT', billing_company text, billing_registration_no text,
  billing_address text, billing_email text, billing_phone text, invoice_date date not null default current_date,
  due_date date not null default (current_date + 30), currency text not null default 'MYR', subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0, taxable_amount numeric(12,2) not null default 0, tax_rate numeric not null default 0,
  tax_amount numeric(12,2) not null default 0, grand_total numeric(12,2) not null default 0, amount_paid numeric(12,2) not null default 0,
  balance_due numeric(12,2) not null default 0, status text not null default 'draft', notes text, payment_terms text,
  issued_at timestamptz, paid_at timestamptz, cancelled_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), created_by uuid, updated_by uuid, quotation_number_snapshot text,
  customer_company_name text, customer_contact_name text, customer_registration_no text, customer_email text, customer_phone text,
  training_service_address_snapshot text, sst_applicable boolean, tax_label_snapshot text, tax_basis_snapshot text,
  sst_registration_number_snapshot text, sst_effective_date_snapshot date,
  constraint invoices_amount_paid_check check (amount_paid >= 0),
  constraint invoices_balance_due_check check (balance_due >= 0),
  constraint invoices_grand_total_check check (grand_total >= 0),
  constraint invoices_status_check check (status = any (array['draft','issued','partially_paid','paid','cancelled'])),
  constraint invoices_total_arithmetic_check check (round((taxable_amount + tax_amount), 2) = round(grand_total, 2))
);
create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices(id), payment_provider text not null,
  payment_method text, amount numeric(12,2) not null, currency text not null default 'MYR', status text not null default 'successful',
  provider_bill_code text, provider_transaction_id text, provider_reference text, payment_reference text, notes text,
  paid_at timestamptz, verified_at timestamptz, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), created_by uuid, payment_url text, verified_amount numeric(12,2),
  callback_received_at timestamptz, payment_source text, hrdf_claim_id uuid,
  constraint invoice_payments_amount_check check (amount > 0),
  constraint invoice_payments_provider_check check (payment_provider = any (array['cash','bank_transfer','cheque','toyyibpay','other'])),
  constraint invoice_payments_status_check check (status = any (array['pending','successful','failed','cancelled','refunded','superseded']))
);
create index on public.invoice_payments (invoice_id);

-- ---- live trigger functions (verbatim) ----
CREATE OR REPLACE FUNCTION app.enforce_invoice_financial_immutability()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
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
     or new.tax_label_snapshot is distinct from old.tax_label_snapshot
     or new.tax_basis_snapshot is distinct from old.tax_basis_snapshot
     or new.sst_registration_number_snapshot is distinct from old.sst_registration_number_snapshot
     or new.sst_effective_date_snapshot is distinct from old.sst_effective_date_snapshot
  then
    raise exception 'invoice_financial_fields_immutable' using errcode = 'P0001';
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
$function$;

CREATE OR REPLACE FUNCTION app.enforce_toyyibpay_attempt_transition()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
begin
  if old.payment_provider <> 'toyyibpay' then
    raise exception 'invoice_payment_immutable' using errcode = 'P0001';
  end if;
  if old.status <> 'pending' then
    raise exception 'toyyibpay_attempt_terminal_immutable' using errcode = 'P0001';
  end if;
  if new.status not in ('successful', 'failed', 'superseded') then
    raise exception 'toyyibpay_attempt_illegal_transition' using errcode = 'P0001';
  end if;
  if new.invoice_id is distinct from old.invoice_id
     or new.payment_provider is distinct from old.payment_provider
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.provider_bill_code is distinct from old.provider_bill_code
     or new.payment_url is distinct from old.payment_url
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'toyyibpay_attempt_structural_fields_immutable' using errcode = 'P0001';
  end if;
  if new.status = 'successful' then
    if new.verified_amount is null or new.provider_transaction_id is null
       or new.verified_at is null or new.paid_at is null
    then
      raise exception 'toyyibpay_attempt_successful_requires_verification_fields' using errcode = 'P0001';
    end if;
  else
    if new.paid_at is not null or new.verified_amount is not null or new.provider_transaction_id is not null then
      raise exception 'toyyibpay_attempt_terminal_negative_fields_must_be_null' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.recompute_invoice_balance()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
declare
  v_amount_paid numeric(12,2);
  v_grand_total numeric(12,2);
  v_status text;
  v_balance numeric(12,2);
begin
  select coalesce(sum(
    case
      when payment_provider = 'toyyibpay' then verified_amount
      else amount
    end
  ), 0) into v_amount_paid
  from public.invoice_payments
  where invoice_id = new.invoice_id and status = 'successful';

  select grand_total, status into v_grand_total, v_status
  from public.invoices where id = new.invoice_id;

  v_balance := v_grand_total - v_amount_paid;

  perform set_config('app.invoice_trusted_write', 'on', true);
  update public.invoices
  set amount_paid = v_amount_paid,
      balance_due = v_balance,
      status = case
        when v_status = 'cancelled' then v_status
        when v_balance <= 0 and v_grand_total > 0 then 'paid'
        when v_amount_paid > 0 then 'partially_paid'
        else v_status
      end,
      paid_at = case when v_balance <= 0 and v_grand_total > 0 and paid_at is null then now() else paid_at end,
      updated_at = now()
  where id = new.invoice_id;

  return new;
end;
$function$;

create trigger trg_enforce_invoice_financial_immutability before update on public.invoices for each row execute function app.enforce_invoice_financial_immutability();
create trigger trg_enforce_toyyibpay_attempt_transition before update on public.invoice_payments for each row execute function app.enforce_toyyibpay_attempt_transition();
create trigger trg_recompute_invoice_balance after insert or update of status on public.invoice_payments for each row execute function app.recompute_invoice_balance();

CREATE OR REPLACE FUNCTION app.toyyibpay_system_actor(OUT actor_id uuid, OUT actor_email text)
 RETURNS record LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
  select id, email from public.profiles
  where role in ('super_admin', 'admin') and is_active = true
  order by (role = 'super_admin') desc, created_at asc
  limit 1;
$function$;

-- M-S7 wrapper (verbatim) and the unguarded supersede (verbatim) used by the app path
CREATE OR REPLACE FUNCTION public.mark_toyyibpay_attempt_superseded_unguarded(p_attempt_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
declare
  v_attempt record;
  v_invoice_no text;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  select email into v_actor_email from public.profiles where id = v_actor;
  select * into v_attempt from public.invoice_payments where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.status <> 'pending' then
    raise exception 'attempt_not_pending' using errcode = 'P0001';
  end if;
  select invoice_no into v_invoice_no from public.invoices where id = v_attempt.invoice_id;
  update public.invoice_payments
  set status = 'superseded',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('superseded_reason', 'manual_payment_recorded'),
      updated_at = now()
  where id = p_attempt_id;
  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay bill superseded for invoice %s (manual payment recorded)', coalesce(v_invoice_no, '?')),
    jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id));
  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'superseded');
end;
$function$;

insert into public.profiles (id, email, role, is_active) values
  ('00000000-0000-4000-8000-000000000001', 'admin@example.invalid', 'super_admin', true);
