-- M1a (PKG-1d-B-DB-G1, K3): trusted registry of TERAS receiving bank accounts, and the receiving account of a bank
-- transfer payment record.
--
-- Why: TERAS receives bank transfers into more than one account (owner decision K3). A staff-verified transfer must
-- name the account the money arrived in, from a trusted list, so that evidence and any future reference uniqueness are
-- scoped per account. No such registry existed (verified 22 Nov 2026: no bank table or column in public/app).
--
-- What:
--   * public.payment_receiving_accounts: stable uuid id + immutable code, bank name, display label, LAST FOUR digits
--     only (never a full account number), reference scheme, active flag, soft delete. Admin read (RLS app.is_admin());
--     no client writes; rows are maintained by migration or a future reviewed super_admin path. Audit + updated_at
--     triggers. This migration inserts NO account rows.
--   * public.public_registration_payments.receiving_account_id: nullable FK (existing ToyyibPay / legacy rows stay
--     NULL), bank_transfer rows only, immutable once set, indexed (CLAUDE.md section 13).
-- Idempotent and guarded. No DROP. No CRM table is touched.

create table if not exists public.payment_receiving_accounts (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  bank_name        text not null,
  account_label    text not null,
  account_last4    text not null,
  reference_scheme text not null default 'payer_reference',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint payment_receiving_accounts_code_key unique (code),
  constraint payment_receiving_accounts_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint payment_receiving_accounts_bank_name_check check (length(btrim(bank_name)) between 2 and 80),
  constraint payment_receiving_accounts_label_check check (length(btrim(account_label)) between 2 and 80),
  constraint payment_receiving_accounts_last4_check check (account_last4 ~ '^[0-9]{4}$'),
  constraint payment_receiving_accounts_scheme_check check (reference_scheme in ('payer_reference', 'bank_transaction_id'))
);
alter table public.payment_receiving_accounts owner to postgres;

-- The code identifies an account in evidence and audit metadata: it never changes, and rows are never deleted.
create or replace function app.payment_receiving_account_guard()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'receiving_account_delete_forbidden' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id or new.code is distinct from old.code or new.account_last4 is distinct from old.account_last4 then
    raise exception 'receiving_account_identity_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
alter function app.payment_receiving_account_guard() owner to postgres;
revoke all on function app.payment_receiving_account_guard() from public;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.payment_receiving_accounts'::regclass and tgname = 'trg_payment_receiving_accounts_guard') then
    create trigger trg_payment_receiving_accounts_guard before update or delete on public.payment_receiving_accounts
      for each row execute function app.payment_receiving_account_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.payment_receiving_accounts'::regclass and tgname = 'trg_payment_receiving_accounts_audit') then
    create trigger trg_payment_receiving_accounts_audit after insert or update on public.payment_receiving_accounts
      for each row execute function app.audit_trigger();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.payment_receiving_accounts'::regclass and tgname = 'trg_payment_receiving_accounts_updated_at') then
    create trigger trg_payment_receiving_accounts_updated_at before update on public.payment_receiving_accounts
      for each row execute function app.set_updated_at();
  end if;
end $$;

alter table public.payment_receiving_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_receiving_accounts' and policyname = 'payment_receiving_accounts_admin_select') then
    create policy payment_receiving_accounts_admin_select on public.payment_receiving_accounts
      for select to authenticated using (app.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_receiving_accounts' and policyname = 'payment_receiving_accounts_no_direct_client_access') then
    create policy payment_receiving_accounts_no_direct_client_access on public.payment_receiving_accounts
      for all to anon, authenticated using (false) with check (false);
  end if;
end $$;
revoke all on table public.payment_receiving_accounts from public, anon, authenticated, service_role;
grant select on table public.payment_receiving_accounts to authenticated, service_role;

-- Receiving account of a bank transfer payment record.
alter table public.public_registration_payments
  add column if not exists receiving_account_id uuid references public.payment_receiving_accounts(id) on delete restrict;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.public_registration_payments'::regclass
                 and conname = 'public_registration_payments_receiving_account_bank_only') then
    alter table public.public_registration_payments
      add constraint public_registration_payments_receiving_account_bank_only
      check (receiving_account_id is null or payment_provider = 'bank_transfer');
  end if;
end $$;
create index if not exists public_registration_payments_receiving_account_idx
  on public.public_registration_payments (receiving_account_id) where receiving_account_id is not null;

-- Once a payment record names its receiving account, that evidence never changes.
create or replace function app.public_registration_payment_receiving_account_guard()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $function$
begin
  if old.receiving_account_id is not null and new.receiving_account_id is distinct from old.receiving_account_id then
    raise exception 'payment_receiving_account_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
alter function app.public_registration_payment_receiving_account_guard() owner to postgres;
revoke all on function app.public_registration_payment_receiving_account_guard() from public;
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.public_registration_payments'::regclass
                 and tgname = 'trg_public_registration_payment_receiving_account_guard') then
    create trigger trg_public_registration_payment_receiving_account_guard before update on public.public_registration_payments
      for each row execute function app.public_registration_payment_receiving_account_guard();
  end if;
end $$;

do $$
begin
  if to_regclass('public.payment_receiving_accounts') is null
     or not (select relrowsecurity from pg_class where oid = 'public.payment_receiving_accounts'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'payment_receiving_accounts') <> 2
     or has_table_privilege('anon', 'public.payment_receiving_accounts', 'SELECT')
     or has_table_privilege('authenticated', 'public.payment_receiving_accounts', 'INSERT')
     or has_table_privilege('authenticated', 'public.payment_receiving_accounts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.payment_receiving_accounts', 'DELETE') then
    raise exception 'm1a_postcondition_failed: receiving account registry access is not as specified' using errcode = 'P0001';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payment_receiving_accounts'
      and column_name ~ '(account_no|account_number|iban|full)') > 0 then
    raise exception 'm1a_postcondition_failed: a full account number column exists' using errcode = 'P0001';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'public_registration_payments'
                 and column_name = 'receiving_account_id' and is_nullable = 'YES') then
    raise exception 'm1a_postcondition_failed: receiving_account_id column missing' using errcode = 'P0001';
  end if;
end $$;
