-- TERAS UNIVERSAL Phase 3: public registration/payment boundary.
-- Additive only. This migration is intentionally not applied by Codex.

-- A public session needs a price snapshot independent from the catalogue
-- price. Existing production course_schedules has no fee column; NULL means
-- that the session is not eligible for online public registration until staff
-- populate this value.
alter table public.course_schedules
  add column if not exists fee numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.course_schedules'::regclass
      and conname = 'course_schedules_fee_check'
  ) then
    alter table public.course_schedules
      add constraint course_schedules_fee_check check (fee is null or fee >= 0);
  end if;
end;
$$;

create table if not exists public.public_registrations (
  id uuid primary key default gen_random_uuid(),
  registration_reference text not null default (
    'TU-REG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  ),
  confirmation_token_hash text not null,
  schedule_id uuid not null references public.course_schedules(id) on delete restrict,
  course_id uuid not null references public.courses(id) on delete restrict,
  attendee_count integer not null,
  currency text not null default 'MYR',
  amount_snapshot numeric(12,2) not null,
  registration_status text not null default 'pending_payment',
  payment_status text not null default 'pending',
  idempotency_key_hash text not null,
  hold_expires_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint public_registrations_reference_key unique (registration_reference),
  constraint public_registrations_confirmation_token_key unique (confirmation_token_hash),
  constraint public_registrations_schedule_idempotency_key unique (schedule_id, idempotency_key_hash),
  constraint public_registrations_attendee_count_check check (attendee_count > 0 and attendee_count <= 100),
  constraint public_registrations_amount_check check (amount_snapshot >= 0),
  constraint public_registrations_currency_check check (currency = 'MYR'),
  constraint public_registrations_status_check check (
    registration_status in ('pending_payment', 'payment_pending', 'confirmed', 'failed', 'cancelled', 'expired')
  ),
  constraint public_registrations_payment_status_check check (
    payment_status in ('pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded')
  )
);

create index if not exists public_registrations_schedule_idx
  on public.public_registrations (schedule_id, registration_status, hold_expires_at);
create index if not exists public_registrations_status_idx
  on public.public_registrations (registration_status, payment_status);

create table if not exists public.public_registration_attendees (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.public_registrations(id) on delete cascade,
  full_name text not null,
  ic_passport_no text,
  identity_normalized text,
  email text,
  phone text,
  company text,
  participant_id uuid references public.participants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint public_registration_attendees_name_check check (char_length(btrim(full_name)) between 1 and 200),
  constraint public_registration_attendees_identity_check check (identity_normalized is null or char_length(identity_normalized) between 1 and 120),
  constraint public_registration_attendees_email_check check (email is null or char_length(email) between 3 and 254),
  constraint public_registration_attendees_phone_check check (phone is null or char_length(phone) between 3 and 40),
  constraint public_registration_attendees_company_check check (company is null or char_length(company) between 1 and 200)
);

create index if not exists public_registration_attendees_registration_idx
  on public.public_registration_attendees (registration_id);
create index if not exists public_registration_attendees_identity_idx
  on public.public_registration_attendees (identity_normalized)
  where identity_normalized is not null;

create table if not exists public.public_registration_payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.public_registrations(id) on delete restrict,
  payment_provider text not null,
  status text not null default 'pending',
  amount numeric(12,2) not null,
  currency text not null default 'MYR',
  provider_bill_code text,
  provider_transaction_id text,
  provider_reference text,
  payment_url text,
  bill_creation_state text not null default 'not_claimed',
  bill_creation_claimed_at timestamptz,
  verified_amount numeric(12,2),
  verified_at timestamptz,
  callback_received_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint public_registration_payments_provider_check check (payment_provider in ('toyyibpay', 'bank_transfer', 'cash', 'cheque', 'other')),
  constraint public_registration_payments_status_check check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded')),
  constraint public_registration_payments_bill_creation_state_check check (bill_creation_state in ('not_claimed', 'claimed', 'attached', 'failed', 'orphaned')),
  constraint public_registration_payments_amount_check check (amount > 0),
  constraint public_registration_payments_verified_amount_check check (verified_amount is null or verified_amount >= 0),
  constraint public_registration_payments_currency_check check (currency = 'MYR')
);

create index if not exists public_registration_payments_registration_idx
  on public.public_registration_payments (registration_id, created_at desc);
create unique index if not exists public_registration_payments_provider_bill_key
  on public.public_registration_payments (payment_provider, provider_bill_code)
  where provider_bill_code is not null;
create unique index if not exists public_registration_payments_provider_transaction_key
  on public.public_registration_payments (payment_provider, provider_transaction_id)
  where provider_transaction_id is not null;
create unique index if not exists public_registration_payments_one_active_toyyibpay
  on public.public_registration_payments (registration_id)
  where payment_provider = 'toyyibpay' and status in ('pending', 'processing');

alter table public.public_registrations enable row level security;
alter table public.public_registration_attendees enable row level security;
alter table public.public_registration_payments enable row level security;

revoke all on table public.public_registrations from anon, authenticated;
revoke all on table public.public_registration_attendees from anon, authenticated;
revoke all on table public.public_registration_payments from anon, authenticated;

drop policy if exists public_registrations_no_direct_client_access on public.public_registrations;
create policy public_registrations_no_direct_client_access on public.public_registrations
  for all to anon, authenticated using (false) with check (false);
drop policy if exists public_registration_attendees_no_direct_client_access on public.public_registration_attendees;
create policy public_registration_attendees_no_direct_client_access on public.public_registration_attendees
  for all to anon, authenticated using (false) with check (false);
drop policy if exists public_registration_payments_no_direct_client_access on public.public_registration_payments;
create policy public_registration_payments_no_direct_client_access on public.public_registration_payments
  for all to anon, authenticated using (false) with check (false);

drop trigger if exists trg_public_registrations_updated_at on public.public_registrations;
create trigger trg_public_registrations_updated_at
  before update on public.public_registrations
  for each row execute function app.set_updated_at();
drop trigger if exists trg_public_registration_attendees_updated_at on public.public_registration_attendees;
create trigger trg_public_registration_attendees_updated_at
  before update on public.public_registration_attendees
  for each row execute function app.set_updated_at();
drop trigger if exists trg_public_registration_payments_updated_at on public.public_registration_payments;
create trigger trg_public_registration_payments_updated_at
  before update on public.public_registration_payments
  for each row execute function app.set_updated_at();

drop trigger if exists trg_public_registrations_audit on public.public_registrations;
create trigger trg_public_registrations_audit
  after insert or update on public.public_registrations
  for each row execute function app.audit_trigger();
drop trigger if exists trg_public_registration_payments_audit on public.public_registration_payments;
create trigger trg_public_registration_payments_audit
  after insert or update on public.public_registration_payments
  for each row execute function app.audit_trigger();

comment on column public.course_schedules.fee is
  'Per-session MYR price snapshot for public registration. NULL disables paid public registration for the session.';
comment on table public.public_registrations is
  'Private public-registration aggregate. Access is through narrowly scoped RPCs, never direct client table access.';
