-- HRDF Claim Tracking Phase 1
-- Forward-only. No historical claim backfill and no invoice/payment rewrite.
-- Eligibility is read exclusively from immutable invoice_items.hrdf_claim.

insert into public.staff_module_catalog (module_key, label, group_key, min_role, is_active)
values ('hrdf_claims', 'HRDF Claims', 'sales', 'editor', true)
on conflict (module_key) do update set label = excluded.label, group_key = excluded.group_key,
  min_role = excluded.min_role, is_active = true;

alter table public.invoice_payments
  add column if not exists payment_source text,
  add column if not exists hrdf_claim_id uuid;

alter table public.invoice_payments
  add constraint invoice_payments_payment_source_check
  check (payment_source is null or payment_source in ('customer', 'hrdf'));

create table if not exists public.hrdf_claims (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null unique references public.invoices(id) on delete restrict,
  training_schedule_id uuid null references public.course_schedules(id) on delete set null,
  status text not null default 'grant_pending'
    check (status in (
      'grant_pending', 'grant_approved', 'grant_rejected',
      'training_in_progress', 'training_completed', 'claim_ready',
      'claim_submitted', 'claim_approved', 'claim_rejected',
      'payment_received', 'cancelled'
    )),
  hrdf_items_snapshot jsonb not null,
  invoice_number_snapshot text not null,
  invoice_total_snapshot numeric(12,2) not null check (invoice_total_snapshot >= 0),
  currency text not null,
  grant_reference text,
  grant_application_date date,
  grant_approved_date date,
  grant_amount numeric(12,2) check (grant_amount is null or grant_amount >= 0),
  claim_reference text,
  claim_submitted_date date,
  claim_amount numeric(12,2) check (claim_amount is null or claim_amount >= 0),
  approved_amount numeric(12,2) check (approved_amount is null or approved_amount >= 0),
  claim_approved_date date,
  claim_rejected_date date,
  rejection_reason text,
  payment_received_date date,
  payment_received_amount numeric(12,2) not null default 0 check (payment_received_amount >= 0),
  payment_reference text,
  remarks text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hrdf_claims_items_snapshot_array_check check (jsonb_typeof(hrdf_items_snapshot) = 'array')
);

alter table public.invoice_payments
  add constraint invoice_payments_hrdf_claim_id_fkey
  foreign key (hrdf_claim_id) references public.hrdf_claims(id) on delete restrict;
alter table public.invoice_payments
  add constraint invoice_payments_hrdf_source_pair_check
  check (payment_source is distinct from 'hrdf' or hrdf_claim_id is not null);

create unique index if not exists hrdf_claims_grant_reference_key
  on public.hrdf_claims(grant_reference) where grant_reference is not null;
create unique index if not exists hrdf_claims_claim_reference_key
  on public.hrdf_claims(claim_reference) where claim_reference is not null;
create unique index if not exists invoice_payments_hrdf_reference_key
  on public.invoice_payments(hrdf_claim_id, payment_reference)
  where payment_source = 'hrdf' and payment_reference is not null;
create index if not exists hrdf_claims_status_idx on public.hrdf_claims(status);
create index if not exists hrdf_claims_training_schedule_idx on public.hrdf_claims(training_schedule_id);

alter table public.hrdf_claims enable row level security;
revoke all on public.hrdf_claims from anon, authenticated;
grant select on public.hrdf_claims to authenticated;
drop policy if exists hrdf_claims_select on public.hrdf_claims;
create policy hrdf_claims_select on public.hrdf_claims
  for select to authenticated
  using (public.has_module_access_level('hrdf_claims', 'view'));

create or replace function app.hrdf_claim_touch_updated_at() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hrdf_claims_updated_at on public.hrdf_claims;
create trigger trg_hrdf_claims_updated_at before update on public.hrdf_claims
for each row execute function app.hrdf_claim_touch_updated_at();

create or replace function public.create_hrdf_claim_for_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice record;
  v_claim_id uuid;
  v_items jsonb;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then raise exception 'invoice_not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from public.hrdf_claims where invoice_id = p_invoice_id) then
    raise exception 'hrdf_claim_already_exists' using errcode = 'P0001';
  end if;
  select jsonb_agg(jsonb_build_object(
    'course_id_snapshot', course_id_snapshot,
    'course_name_snapshot', course_name_snapshot,
    'hrdf_claim', hrdf_claim,
    'package_includes_snapshot', package_includes_snapshot,
    'quantity', quantity,
    'unit', unit,
    'unit_price', unit_price,
    'discount', discount,
    'line_total', line_total
  ) order by sort_order) into v_items
  from public.invoice_items where invoice_id = p_invoice_id and hrdf_claim = true;
  if v_items is null then raise exception 'hrdf_not_applicable' using errcode = 'P0001'; end if;
  select email into v_actor_email from public.profiles where id = v_actor;
  insert into public.hrdf_claims (
    invoice_id, status, hrdf_items_snapshot, invoice_number_snapshot,
    invoice_total_snapshot, currency, created_by, updated_by
  ) values (
    p_invoice_id, 'grant_pending', v_items, v_invoice.invoice_no,
    v_invoice.grand_total, v_invoice.currency, v_actor, v_actor
  ) returning id into v_claim_id;
  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action,
    'hrdf_claims', v_claim_id::text, format('HRDF claim created for invoice %s', v_invoice.invoice_no),
    jsonb_build_object('claim_id', v_claim_id, 'invoice_id', p_invoice_id, 'status', 'grant_pending'));
  return v_claim_id;
end;
$$;

create or replace function public.transition_hrdf_claim(
  p_claim_id uuid, p_to_status text, p_payload jsonb default '{}'::jsonb
) returns public.hrdf_claims language plpgsql security definer set search_path = public, app as $$
declare
  v_claim public.hrdf_claims;
  v_invoice record;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_old_status text;
  v_amount numeric;
  v_date date;
  v_text text;
begin
  if not app.is_admin() then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  select * into v_claim from public.hrdf_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'hrdf_claim_not_found' using errcode = 'P0001'; end if;
  v_old_status := v_claim.status;
  select * into v_invoice from public.invoices where id = v_claim.invoice_id for update;

  if not (
    (v_claim.status = 'grant_pending' and p_to_status in ('grant_approved','grant_rejected')) or
    (v_claim.status = 'grant_rejected' and p_to_status = 'grant_pending') or
    (v_claim.status = 'grant_approved' and p_to_status = 'training_in_progress') or
    (v_claim.status = 'training_in_progress' and p_to_status = 'training_completed') or
    (v_claim.status = 'training_completed' and p_to_status = 'claim_ready') or
    (v_claim.status = 'claim_ready' and p_to_status = 'claim_submitted') or
    (v_claim.status = 'claim_submitted' and p_to_status in ('claim_approved','claim_rejected')) or
    (v_claim.status = 'claim_rejected' and p_to_status = 'claim_ready') or
    (p_to_status = 'cancelled' and v_claim.status not in ('payment_received','cancelled'))
  ) then raise exception 'invalid_hrdf_claim_transition' using errcode = 'P0001'; end if;

  if p_to_status = 'grant_approved' then
    v_text := nullif(trim(p_payload->>'grant_reference'), '');
    v_date := nullif(p_payload->>'grant_approved_date', '')::date;
    v_amount := nullif(p_payload->>'grant_amount', '')::numeric;
    if v_text is null or v_date is null or v_amount is null or v_amount < 0 then raise exception 'grant_approval_fields_required' using errcode = 'P0001'; end if;
    update public.hrdf_claims set status = p_to_status, grant_reference = v_text,
      grant_approved_date = v_date, grant_amount = v_amount, rejection_reason = null,
      updated_by = v_actor where id = p_claim_id returning * into v_claim;
  elsif p_to_status = 'grant_rejected' then
    v_text := nullif(trim(p_payload->>'rejection_reason'), '');
    if v_text is null then raise exception 'rejection_reason_required' using errcode = 'P0001'; end if;
    update public.hrdf_claims set status = p_to_status, claim_rejected_date = null,
      rejection_reason = v_text, updated_by = v_actor where id = p_claim_id returning * into v_claim;
  elsif p_to_status = 'grant_pending' then
    update public.hrdf_claims set status = p_to_status, rejection_reason = null, updated_by = v_actor where id = p_claim_id returning * into v_claim;
  elsif p_to_status = 'training_in_progress' then
    update public.hrdf_claims set status = p_to_status,
      training_schedule_id = nullif(p_payload->>'training_schedule_id','')::uuid,
      updated_by = v_actor where id = p_claim_id returning * into v_claim;
  elsif p_to_status = 'claim_submitted' then
    v_text := nullif(trim(p_payload->>'claim_reference'), '');
    v_date := nullif(p_payload->>'claim_submitted_date', '')::date;
    v_amount := nullif(p_payload->>'claim_amount', '')::numeric;
    if v_text is null or v_date is null or v_amount is null or v_amount < 0 then raise exception 'claim_submission_fields_required' using errcode = 'P0001'; end if;
    update public.hrdf_claims set status = p_to_status, claim_reference = v_text,
      claim_submitted_date = v_date, claim_amount = v_amount, rejection_reason = null,
      updated_by = v_actor where id = p_claim_id returning * into v_claim;
  elsif p_to_status = 'claim_approved' then
    v_date := nullif(p_payload->>'claim_approved_date', '')::date;
    v_amount := nullif(p_payload->>'approved_amount', '')::numeric;
    if v_date is null or v_amount is null or v_amount < 0 or v_claim.claim_amount is null or v_amount > v_claim.claim_amount then raise exception 'approved_amount_invalid' using errcode = 'P0001'; end if;
    update public.hrdf_claims set status = p_to_status, claim_approved_date = v_date,
      approved_amount = v_amount, rejection_reason = null, updated_by = v_actor where id = p_claim_id returning * into v_claim;
  elsif p_to_status = 'claim_rejected' or p_to_status = 'cancelled' then
    v_text := nullif(trim(p_payload->>'rejection_reason'), '');
    if v_text is null then raise exception 'rejection_reason_required' using errcode = 'P0001'; end if;
    update public.hrdf_claims set status = p_to_status,
      claim_rejected_date = case when p_to_status = 'claim_rejected' then current_date else claim_rejected_date end,
      rejection_reason = v_text,
      updated_by = v_actor where id = p_claim_id returning * into v_claim;
  else
    update public.hrdf_claims set status = p_to_status, updated_by = v_actor where id = p_claim_id returning * into v_claim;
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;
  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action,
    'hrdf_claims', p_claim_id::text, format('HRDF claim status changed to %s', p_to_status),
    jsonb_build_object('claim_id', p_claim_id, 'invoice_id', v_claim.invoice_id,
      'old_status', v_old_status, 'new_status', p_to_status, 'payload', p_payload));
  return v_claim;
end;
$$;

create or replace function public.record_hrdf_payment(
  p_claim_id uuid, p_amount numeric, p_payment_provider text,
  p_payment_method text, p_payment_date date, p_payment_reference text, p_notes text
) returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  v_claim public.hrdf_claims;
  v_invoice record;
  v_payment_id uuid;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_received numeric;
  v_status text;
begin
  if not app.is_admin() then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  if nullif(trim(p_payment_reference), '') is null then raise exception 'payment_reference_required' using errcode = 'P0001'; end if;
  if p_payment_provider not in ('cash','bank_transfer','cheque','other') then raise exception 'invalid_payment_provider' using errcode = 'P0001'; end if;
  select * into v_claim from public.hrdf_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'hrdf_claim_not_found' using errcode = 'P0001'; end if;
  if v_claim.status not in ('claim_approved','payment_received') then raise exception 'hrdf_claim_not_approved' using errcode = 'P0001'; end if;
  select * into v_invoice from public.invoices where id = v_claim.invoice_id for update;
  if p_amount > v_invoice.balance_due then raise exception 'payment_exceeds_balance' using errcode = 'P0001'; end if;
  if v_claim.approved_amount is not null and v_claim.payment_received_amount + p_amount > v_claim.approved_amount then raise exception 'payment_exceeds_approved_amount' using errcode = 'P0001'; end if;
  if exists (select 1 from public.invoice_payments where hrdf_claim_id = p_claim_id and payment_source = 'hrdf' and payment_reference = p_payment_reference) then raise exception 'duplicate_hrdf_payment_reference' using errcode = 'P0001'; end if;

  insert into public.invoice_payments (
    invoice_id, payment_provider, payment_method, amount, currency, status,
    payment_reference, notes, paid_at, created_by, payment_source, hrdf_claim_id
  ) values (
    v_claim.invoice_id, p_payment_provider, p_payment_method, p_amount, v_invoice.currency,
    'successful', p_payment_reference, p_notes, coalesce(p_payment_date, current_date)::timestamptz,
    v_actor, 'hrdf', p_claim_id
  ) returning id into v_payment_id;

  select amount_paid, status into v_received, v_status from public.invoices where id = v_claim.invoice_id;
  update public.hrdf_claims set status = 'payment_received',
    payment_received_date = coalesce(p_payment_date, current_date),
    payment_received_amount = payment_received_amount + p_amount,
    payment_reference = p_payment_reference, updated_by = v_actor
  where id = p_claim_id returning * into v_claim;
  select email into v_actor_email from public.profiles where id = v_actor;
  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action,
    'invoice_payments', v_payment_id::text, format('HRDF payment of RM %s recorded', p_amount),
    jsonb_build_object('payment_id', v_payment_id, 'claim_id', p_claim_id,
      'invoice_id', v_claim.invoice_id, 'amount', p_amount, 'status', v_status));
  return jsonb_build_object('payment_id', v_payment_id, 'amount_paid', v_received,
    'invoice_status', v_status, 'claim_status', v_claim.status);
end;
$$;

revoke all on function public.create_hrdf_claim_for_invoice(uuid) from public;
revoke all on function public.create_hrdf_claim_for_invoice(uuid) from anon;
revoke all on function public.transition_hrdf_claim(uuid, text, jsonb) from public;
revoke all on function public.transition_hrdf_claim(uuid, text, jsonb) from anon;
revoke all on function public.record_hrdf_payment(uuid, numeric, text, text, date, text, text) from public;
revoke all on function public.record_hrdf_payment(uuid, numeric, text, text, date, text, text) from anon;
grant execute on function public.create_hrdf_claim_for_invoice(uuid) to authenticated;
grant execute on function public.transition_hrdf_claim(uuid, text, jsonb) to authenticated;
grant execute on function public.record_hrdf_payment(uuid, numeric, text, text, date, text, text) to authenticated;
