-- AF1a (PKG-1d-B-DB-G1, P-AF1): a separate, durable financial record for additional funds received for a registration
-- that is already paid (a second genuine receipt), with database-enforced four-eyes verification.
--
-- Why: when a registration is already paid, the staff bank-transfer RPC must not create a second registration payment
-- (no second confirmation, no second seat), but a genuine second receipt of money must not disappear either. An audit
-- log entry alone is not financial accounting (owner decision on C1). This table is the separate ledger for it.
--
-- What:
--   * public.public_registration_additional_funds: one row per claimed receipt. States: claimed (staff A reports funds
--     seen on a TERAS receiving-account statement) -> verified | rejected (staff B, never A). 'settled' (refund or
--     transfer) is NOT part of this migration. The reference is information, never proof of receipt.
--   * Financial fields and the claim are immutable after insert; a decision is final; no DELETE (trigger + privileges).
--   * Durable idempotency: unique claim_request_id and unique decision_request_id.
--   * Four-eyes: CHECK decided_by <> claimed_by.
--   * RLS: admin read only; no client writes (writes only through the AF1b SECURITY DEFINER RPCs). Audit + updated_at.
--   * Never touches public_registrations, public_registration_payments, schedules or enrolments.
-- Idempotent and guarded. No DROP. Requires M1a (payment_receiving_accounts).

do $$
begin
  if to_regclass('public.payment_receiving_accounts') is null or to_regclass('public.public_registrations') is null then
    raise exception 'af1a_precondition_failed: receiving account registry or registrations table missing' using errcode = 'P0001';
  end if;
end $$;

create table if not exists public.public_registration_additional_funds (
  id                             uuid primary key default gen_random_uuid(),
  registration_id                uuid not null references public.public_registrations(id) on delete restrict,
  source                         text not null default 'bank_transfer',
  receiving_account_id           uuid not null references public.payment_receiving_accounts(id) on delete restrict,
  amount                         numeric(12, 2) not null,
  currency                       text not null default 'MYR',
  transferred_on                 date not null,
  payment_reference              text not null,
  status                         text not null default 'claimed',
  claim_request_id               uuid not null,
  related_payment_ids            uuid[] not null,
  duplicate_reference_candidates uuid[] not null default '{}'::uuid[],
  claimed_by                     uuid not null references public.profiles(id) on delete restrict,
  claimed_at                     timestamptz not null default now(),
  claim_notes                    text not null,
  decision_request_id            uuid,
  decided_by                     uuid references public.profiles(id) on delete restrict,
  decided_at                     timestamptz,
  decision_notes                 text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  constraint public_registration_additional_funds_claim_request_key unique (claim_request_id),
  constraint public_registration_additional_funds_decision_request_key unique (decision_request_id),
  constraint public_registration_additional_funds_source_check check (source in ('bank_transfer')),
  constraint public_registration_additional_funds_amount_check check (amount > 0),
  constraint public_registration_additional_funds_currency_check check (currency = 'MYR'),
  constraint public_registration_additional_funds_reference_check check (payment_reference ~ '^[A-Za-z0-9][A-Za-z0-9 /_.-]{2,63}$'),
  constraint public_registration_additional_funds_status_check check (status in ('claimed', 'verified', 'rejected')),
  constraint public_registration_additional_funds_related_check check (cardinality(related_payment_ids) >= 1),
  constraint public_registration_additional_funds_claim_notes_check
    check (length(claim_notes) <= 500 and length(regexp_replace(claim_notes, '[^[:alnum:]]', '', 'g')) >= 5),
  constraint public_registration_additional_funds_four_eyes check (decided_by is null or decided_by <> claimed_by),
  constraint public_registration_additional_funds_decision_check check (
    (status = 'claimed' and decision_request_id is null and decided_by is null and decided_at is null and decision_notes is null)
    or (status in ('verified', 'rejected') and decision_request_id is not null and decided_by is not null and decided_at is not null
        and decision_notes is not null and length(decision_notes) <= 500
        and length(regexp_replace(decision_notes, '[^[:alnum:]]', '', 'g')) >= 5))
);
alter table public.public_registration_additional_funds owner to postgres;
create index if not exists public_registration_additional_funds_registration_idx on public.public_registration_additional_funds (registration_id);
create index if not exists public_registration_additional_funds_account_idx on public.public_registration_additional_funds (receiving_account_id);
create index if not exists public_registration_additional_funds_claimed_by_idx on public.public_registration_additional_funds (claimed_by);
create index if not exists public_registration_additional_funds_decided_by_idx on public.public_registration_additional_funds (decided_by) where decided_by is not null;

-- af1_state_guard: claimed -> verified | rejected only; everything recorded at claim time is immutable; a decision is
-- final; rows are never deleted. ('settled' does not exist yet: a future, separately approved migration adds it.)
create or replace function app.public_registration_additional_funds_guard()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'additional_funds_delete_forbidden' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
     or new.registration_id is distinct from old.registration_id
     or new.source is distinct from old.source
     or new.receiving_account_id is distinct from old.receiving_account_id
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.transferred_on is distinct from old.transferred_on
     or new.payment_reference is distinct from old.payment_reference
     or new.claim_request_id is distinct from old.claim_request_id
     or new.related_payment_ids is distinct from old.related_payment_ids
     or new.duplicate_reference_candidates is distinct from old.duplicate_reference_candidates
     or new.claimed_by is distinct from old.claimed_by
     or new.claimed_at is distinct from old.claimed_at
     or new.claim_notes is distinct from old.claim_notes
     or new.created_at is distinct from old.created_at then
    raise exception 'additional_funds_claim_immutable' using errcode = 'P0001';
  end if;
  if old.status <> 'claimed' then
    raise exception 'additional_funds_decision_final' using errcode = 'P0001';
  end if;
  if new.status not in ('verified', 'rejected') then
    raise exception 'invalid_additional_funds_transition' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
alter function app.public_registration_additional_funds_guard() owner to postgres;
revoke all on function app.public_registration_additional_funds_guard() from public;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.public_registration_additional_funds'::regclass and tgname = 'trg_public_registration_additional_funds_guard') then
    create trigger trg_public_registration_additional_funds_guard before update or delete on public.public_registration_additional_funds
      for each row execute function app.public_registration_additional_funds_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.public_registration_additional_funds'::regclass and tgname = 'trg_public_registration_additional_funds_audit') then
    create trigger trg_public_registration_additional_funds_audit after insert or update on public.public_registration_additional_funds
      for each row execute function app.audit_trigger();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.public_registration_additional_funds'::regclass and tgname = 'trg_public_registration_additional_funds_updated_at') then
    create trigger trg_public_registration_additional_funds_updated_at before update on public.public_registration_additional_funds
      for each row execute function app.set_updated_at();
  end if;
end $$;

alter table public.public_registration_additional_funds enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'public_registration_additional_funds' and policyname = 'public_registration_additional_funds_admin_select') then
    create policy public_registration_additional_funds_admin_select on public.public_registration_additional_funds
      for select to authenticated using (app.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'public_registration_additional_funds' and policyname = 'public_registration_additional_funds_no_direct_client_access') then
    create policy public_registration_additional_funds_no_direct_client_access on public.public_registration_additional_funds
      for all to anon, authenticated using (false) with check (false);
  end if;
end $$;
revoke all on table public.public_registration_additional_funds from public, anon, authenticated, service_role;
grant select on table public.public_registration_additional_funds to authenticated, service_role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.public_registration_additional_funds'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'public_registration_additional_funds') <> 2
     or has_table_privilege('anon', 'public.public_registration_additional_funds', 'SELECT')
     or has_table_privilege('authenticated', 'public.public_registration_additional_funds', 'INSERT')
     or has_table_privilege('authenticated', 'public.public_registration_additional_funds', 'UPDATE')
     or has_table_privilege('authenticated', 'public.public_registration_additional_funds', 'DELETE')
     or has_table_privilege('service_role', 'public.public_registration_additional_funds', 'DELETE') then
    raise exception 'af1a_postcondition_failed: additional funds access is not as specified' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.public_registration_additional_funds'::regclass
                 and conname = 'public_registration_additional_funds_four_eyes') then
    raise exception 'af1a_postcondition_failed: four-eyes constraint missing' using errcode = 'P0001';
  end if;
end $$;
