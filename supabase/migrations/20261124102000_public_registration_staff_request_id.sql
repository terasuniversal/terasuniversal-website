-- M2 (PKG-1d-B-DB-G1, K1): durable idempotency key for staff-verified bank transfer records.
--
-- Why: a staff form may be submitted twice (double click, retry after a timeout). One request must produce at most
-- one money record, enforced by the database rather than by searching audit logs (owner decision K1).
--
-- What: public.public_registration_payments.staff_request_id uuid (nullable: ToyyibPay, legacy and existing rows stay
-- NULL and never conflict), unique where not null, bank_transfer rows only, immutable once set.
-- Idempotent and guarded. No DROP.

alter table public.public_registration_payments add column if not exists staff_request_id uuid;
create unique index if not exists public_registration_payments_staff_request_key
  on public.public_registration_payments (staff_request_id) where staff_request_id is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.public_registration_payments'::regclass
                 and conname = 'public_registration_payments_staff_request_bank_only') then
    alter table public.public_registration_payments
      add constraint public_registration_payments_staff_request_bank_only
      check (staff_request_id is null or payment_provider = 'bank_transfer');
  end if;
end $$;

create or replace function app.public_registration_payment_staff_request_guard()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $function$
begin
  if old.staff_request_id is not null and new.staff_request_id is distinct from old.staff_request_id then
    raise exception 'payment_staff_request_id_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
alter function app.public_registration_payment_staff_request_guard() owner to postgres;
revoke all on function app.public_registration_payment_staff_request_guard() from public;
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.public_registration_payments'::regclass
                 and tgname = 'trg_public_registration_payment_staff_request_guard') then
    create trigger trg_public_registration_payment_staff_request_guard before update on public.public_registration_payments
      for each row execute function app.public_registration_payment_staff_request_guard();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'public_registration_payments'
                 and indexname = 'public_registration_payments_staff_request_key' and indexdef like 'CREATE UNIQUE INDEX%') then
    raise exception 'm2_postcondition_failed: unique staff_request_id index missing' using errcode = 'P0001';
  end if;
end $$;
