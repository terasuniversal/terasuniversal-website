-- ToyyibPay Phase 2A -- Database Foundation only.
-- No HTTP calls happen anywhere in this migration or the functions it
-- creates -- pg_net/http are NOT installed on this project (confirmed via
-- list_extensions before writing this file) and stay uninstalled. All
-- ToyyibPay network communication is Next.js server-layer work for a later
-- phase. This migration only extends invoice_payments (already sized for
-- 'toyyibpay' as a payment_provider since Invoice V1 Core) with the columns/
-- state machine needed to represent a ToyyibPay bill attempt, and adds the
-- narrow set of SECURITY DEFINER RPCs that later phases will call AFTER
-- their own HTTP call has already returned a result -- the DB never
-- initiates or waits on network I/O.

-- ---------------------------------------------------------------------
-- 1. invoice_payments: 3 new nullable columns. Everything else needed
-- (payment_provider already allows 'toyyibpay', status already allows
-- pending/failed, provider_bill_code/provider_transaction_id/
-- provider_reference/payment_reference/notes/metadata/verified_at already
-- exist) was already provisioned by Invoice V1 Core -- see the architecture
-- audit's field-by-field review. A dedicated "superseded_at"/"deactivated_at"
-- column was considered and rejected as redundant: updated_at already
-- unambiguously timestamps the one-and-only transition into 'superseded'
-- (see the state-machine trigger below), and the reason goes in metadata.
-- No attempt_created_at either -- the existing created_at column already
-- means "when this attempt row was created," unambiguously, for every
-- provider. Four timestamp columns, four distinct non-overlapping meanings
-- that must never blur into each other merely for convenience:
--   created_at            = local payment/attempt row creation (any
--                            provider, any status)
--   callback_received_at  = TERAS actually received a ToyyibPay callback
--                            POST for this attempt. NOT "the provider was
--                            queried", NOT "Get Bill Transactions was
--                            called", NOT "the return page or a
--                            reconciliation sweep checked the transaction"
--                            -- those are verified_at. Phase 2A has no
--                            callback route, so nothing in this migration
--                            ever sets this column to anything but NULL;
--                            see finalize_toyyibpay_payment/
--                            mark_toyyibpay_attempt_failed below for the
--                            explicit, callback-only-supplied parameter
--                            Phase 2C will use.
--   verified_at            = TERAS independently verified the provider's
--                            state (a Get Bill Transactions call
--                            completed, whether triggered by a callback,
--                            the return page, or reconciliation) --
--                            successful attempts only in this migration.
--   paid_at                = the payment actually succeeded -- see below,
--                            this is the field Invoice V1 Core got wrong
--                            for the ToyyibPay case and this migration
--                            corrects before anything is committed.
alter table public.invoice_payments add column if not exists payment_url text;
alter table public.invoice_payments add column if not exists verified_amount numeric(12,2);
alter table public.invoice_payments add column if not exists callback_received_at timestamptz;

-- ---------------------------------------------------------------------
-- 1a. paid_at correction. Invoice V1 Core defined this column as
-- `not null default now()` -- correct for manual payments (which always
-- explicitly pass their own p_payment_date, never actually relying on the
-- default) but semantically wrong for a ToyyibPay attempt: `paid_at` must
-- mean "the payment actually succeeded," and a freshly-created pending
-- attempt has not succeeded yet. Dropping the NOT NULL/DEFAULT is safe for
-- every existing writer:
--   * record_manual_payment() already always supplies an explicit
--     paid_at (coalesce(p_payment_date, current_date)) -- it has never
--     depended on the column default, so removing the default changes
--     nothing about its behaviour.
--   * record_toyyibpay_bill() (below) now explicitly inserts paid_at =
--     null for a pending attempt, instead of now() as it did in the first
--     draft of this migration -- caught and fixed before this file was
--     ever committed or applied anywhere but this staging QA pass.
--   * finalize_toyyibpay_payment() (below) is the only function that ever
--     sets paid_at on a ToyyibPay row, and only on the pending->successful
--     transition -- see the timestamp-source decision in that function's
--     comment.
-- Keeping the generic DEFAULT now() around after this fix would only mask
-- a *future* bug (some new insert path forgetting to pass paid_at would
-- silently get "now()" instead of the correct NULL) -- removed rather than
-- kept "just in case".
alter table public.invoice_payments alter column paid_at drop not null;
alter table public.invoice_payments alter column paid_at drop default;

-- ---------------------------------------------------------------------
-- 2. New terminal status: 'superseded' -- a pending ToyyibPay attempt that
-- was deactivated (via the future Inactive Bill API call) because the
-- invoice's balance changed out from under it, most commonly a manual
-- payment recorded while the bill was still outstanding.
alter table public.invoice_payments drop constraint if exists invoice_payments_status_check;
alter table public.invoice_payments add constraint invoice_payments_status_check
  check (status in ('pending', 'successful', 'failed', 'cancelled', 'refunded', 'superseded'));

-- ---------------------------------------------------------------------
-- 3. At most one active (pending) ToyyibPay attempt per invoice. This is
-- the actual idempotency guarantee for "repeated clicks on Pay with
-- ToyyibPay must not produce uncontrolled duplicate bills" -- a second
-- concurrent attempt to insert a pending row for the same invoice fails
-- this constraint outright, closing the double-click race at the DB level
-- rather than relying on app-layer discipline alone.
create unique index if not exists idx_invoice_payments_one_pending_toyyibpay
  on public.invoice_payments (invoice_id)
  where payment_provider = 'toyyibpay' and status = 'pending';

-- ---------------------------------------------------------------------
-- 4. State-machine trigger for ToyyibPay attempts. invoice_payments has
-- zero authenticated UPDATE grant (unchanged, verified below) so this is
-- defense-in-depth against a bug in the RPCs below, not a guard against
-- direct client tampering (that path is already closed by the grant
-- itself). Rows for every OTHER provider (cash/bank_transfer/cheque/other)
-- are never updated by any existing or new code path in this migration --
-- record_manual_payment() only ever INSERTs -- so this trigger blocks ANY
-- update to a non-ToyyibPay row outright, which costs nothing (no
-- legitimate caller needs it) and catches a future mistake early.
--
-- Hardened beyond the original draft: paid_at is deliberately REMOVED from
-- the structural-immutable field list below (it must be allowed to change,
-- exactly once, on the pending->successful transition -- that's the whole
-- point of the paid_at fix above), and two new content-level requirements
-- are DB-enforced rather than left to RPC discipline alone, per "prefer DB
-- enforcement if practical":
--   * pending->successful MUST carry verified_amount, provider_transaction_id,
--     verified_at, and paid_at all non-null -- a "successful" row with any
--     of these missing is not trustworthy and the DB now refuses to create
--     one, regardless of which RPC (today's or a future one) tries to.
--   * pending->failed / pending->superseded MUST NOT carry paid_at,
--     verified_amount, or provider_transaction_id -- a failed/superseded
--     attempt has no successful transaction to report, and the DB now
--     refuses to let one masquerade as if it did (the specific "must not
--     set a fake paid_at" requirement, generalised to the other two
--     fields that would be equally nonsensical on a non-success row).
create or replace function app.enforce_toyyibpay_attempt_transition() returns trigger
language plpgsql security definer set search_path = public, app as $$
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
    -- failed or superseded: must never carry a fake successful-payment signal
    if new.paid_at is not null or new.verified_amount is not null or new.provider_transaction_id is not null then
      raise exception 'toyyibpay_attempt_terminal_negative_fields_must_be_null' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_toyyibpay_attempt_transition on public.invoice_payments;
create trigger trg_enforce_toyyibpay_attempt_transition
  before update on public.invoice_payments
  for each row execute function app.enforce_toyyibpay_attempt_transition();

-- ---------------------------------------------------------------------
-- 5. Widen trg_recompute_invoice_balance's firing condition -- REQUIRED for
-- correctness, not optional. app.recompute_invoice_balance()'s own body is
-- byte-for-byte unchanged (still the only writer of invoices.amount_paid/
-- balance_due/status/paid_at, still sums status='successful' rows). But it
-- was previously AFTER INSERT ONLY, which was sufficient because
-- record_manual_payment() always INSERTs a row already at status=
-- 'successful'. ToyyibPay attempts are different by design: they are
-- INSERTed as 'pending' and later UPDATEd to 'successful'/'failed'/
-- 'superseded' once a later phase's HTTP verification confirms the
-- outcome. Without this widening, that UPDATE would never recompute the
-- invoice's balance -- a real bug, caught here rather than in Phase 2C.
-- `update of status` (a column-specific trigger) fires only when status is
-- actually part of the UPDATE, not on every metadata/verified_amount touch,
-- so this stays as narrow as the fix requires. This trigger has no
-- dependency on paid_at's nullability -- app.recompute_invoice_balance()
-- never reads or writes invoice_payments.paid_at, only invoices.paid_at
-- (a different column on a different table), so section 1a above changes
-- nothing about this trigger's behaviour.
drop trigger if exists trg_recompute_invoice_balance on public.invoice_payments;
create trigger trg_recompute_invoice_balance
  after insert or update of status on public.invoice_payments
  for each row execute function app.recompute_invoice_balance();

-- ---------------------------------------------------------------------
-- 6. RPC: read-only lookup of the active pending ToyyibPay attempt for an
-- invoice, if any. Exists to support the future manual-payment-vs-
-- ToyyibPay race orchestration (Phase 2C/2D, Next.js layer) -- Phase 2A
-- only provides the primitive; record_manual_payment() itself is
-- deliberately left untouched in this migration (see note at the bottom).
create or replace function public.get_active_toyyibpay_attempt(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_attempt record;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select id, provider_bill_code into v_attempt
  from public.invoice_payments
  where invoice_id = p_invoice_id and payment_provider = 'toyyibpay' and status = 'pending'
  limit 1;

  if v_attempt.id is null then
    return jsonb_build_object('has_active_attempt', false);
  end if;

  return jsonb_build_object('has_active_attempt', true, 'attempt_id', v_attempt.id, 'billcode', v_attempt.provider_bill_code);
end;
$$;

revoke all on function public.get_active_toyyibpay_attempt(uuid) from public;
grant execute on function public.get_active_toyyibpay_attempt(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. RPC: record a new pending ToyyibPay attempt. Called ONLY after the
-- (future, Phase 2B) Next.js layer's createBill HTTP call has already
-- succeeded and returned a real billcode/payment_url. paid_at is
-- explicitly NULL here -- a pending attempt has not been paid yet (see
-- section 1a). If the createBill HTTP call fails, this RPC is simply
-- never called, so there is no orphan "reserved but no billcode" row to
-- clean up on that side of the seam.
--
-- Provider-orphan risk on the OTHER side of the seam (createBill HTTP
-- succeeds, then THIS call fails) is a real, distinct risk this migration
-- does not and cannot fully solve at the DB layer -- see the compensation
-- design in this file's closing notes and public.log_toyyibpay_orphan_bill_event
-- below, which is the DB-side primitive that design depends on.
create or replace function public.record_toyyibpay_bill(
  p_invoice_id uuid,
  p_attempt_id uuid,
  p_billcode text,
  p_payment_url text,
  p_amount numeric
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice record;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_billcode is null or length(trim(p_billcode)) = 0 then
    raise exception 'invalid_billcode' using errcode = 'P0001';
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
  if round(p_amount, 2) <> round(v_invoice.balance_due, 2) then
    raise exception 'balance_mismatch' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.invoice_payments
    where invoice_id = p_invoice_id and payment_provider = 'toyyibpay' and status = 'pending'
  ) then
    raise exception 'active_attempt_exists' using errcode = 'P0001';
  end if;

  insert into public.invoice_payments (
    id, invoice_id, payment_provider, amount, currency, status,
    provider_bill_code, payment_url, paid_at, created_by
  ) values (
    p_attempt_id, p_invoice_id, 'toyyibpay', p_amount, v_invoice.currency, 'pending',
    p_billcode, p_payment_url, null, v_actor
  );

  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay bill created for invoice %s (%s)', v_invoice.invoice_no, p_billcode),
    jsonb_build_object('invoice_id', p_invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'amount', p_amount));

  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'pending');
end;
$$;

revoke all on function public.record_toyyibpay_bill(uuid, uuid, text, text, numeric) from public;
grant execute on function public.record_toyyibpay_bill(uuid, uuid, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 8. RPC: mark a pending attempt superseded. Called ONLY after the
-- (future) Next.js layer's Inactive Bill HTTP call has already confirmed
-- ToyyibPay deactivated the bill -- same "DB never initiates HTTP, only
-- records its already-confirmed outcome" rule as above. Never sets
-- paid_at/verified_amount/provider_transaction_id -- the state-machine
-- trigger above now DB-enforces that a superseded row can't carry any of
-- them, so this is belt-and-suspenders, not the only guard.
create or replace function public.mark_toyyibpay_attempt_superseded(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
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
$$;

revoke all on function public.mark_toyyibpay_attempt_superseded(uuid) from public;
grant execute on function public.mark_toyyibpay_attempt_superseded(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. RPC: mark a pending attempt failed. Same "called after HTTP already
-- confirmed the outcome" rule. Never sets paid_at/verified_amount/
-- provider_transaction_id, for the same reason as mark_toyyibpay_attempt_superseded
-- above -- the trigger now DB-enforces this regardless.
--
-- callback_received_at correction: the first draft of this function set
-- callback_received_at = now() unconditionally, which is wrong -- Phase 2A
-- has no callback route, so a Phase 2A caller of this function (a manual
-- admin action, or a future reconciliation sweep) has NOT received a
-- callback. p_callback_received_at is the smallest fix that keeps the
-- meaning exact: default null (every Phase 2A/reconciliation caller gets
-- this for free by passing nothing), and ONLY a future Phase 2C callback
-- route would ever pass a real value. No other new state, no new column.
--
-- Kept admin-gated (app.is_admin()) in Phase 2A only because there is no
-- caller for it yet -- see the note at the bottom of this file on why this
-- WILL need its authorization model redesigned before Phase 2C's
-- unauthenticated callback route can call it.
drop function if exists public.mark_toyyibpay_attempt_failed(uuid, text);

create or replace function public.mark_toyyibpay_attempt_failed(
  p_attempt_id uuid,
  p_reason text,
  p_callback_received_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
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
  set status = 'failed',
      callback_received_at = p_callback_received_at,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', p_reason),
      updated_at = now()
  where id = p_attempt_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay payment failed for invoice %s: %s', coalesce(v_invoice_no, '?'), coalesce(p_reason, 'no reason given')),
    jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'reason', p_reason));

  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'failed');
end;
$$;

revoke all on function public.mark_toyyibpay_attempt_failed(uuid, text, timestamptz) from public;
grant execute on function public.mark_toyyibpay_attempt_failed(uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 10. RPC: finalize a successful ToyyibPay payment. Called ONLY after the
-- (future) Next.js layer's Get Bill Transactions HTTP call has already
-- confirmed success -- this RPC does not re-derive that confirmation, it
-- only records it. Deliberately does NOT touch invoices directly: the
-- `update of status` recompute trigger above does that, exactly like
-- manual payments -- no balance logic is duplicated here.
--
-- paid_at source decision: ToyyibPay's callback documents a
-- `transaction_time` field of unconfirmed reliability (flagged, not yet
-- empirically verified against a real sandbox payload -- see the
-- architecture audit). Rather than block Phase 2A on that verification,
-- or hard-code an assumption about its format, this function accepts an
-- OPTIONAL p_provider_transaction_time: if a future caller supplies it
-- (once Phase 2C has verified it's trustworthy), it becomes paid_at;
-- otherwise paid_at falls back to now() -- the instant TERAS's own
-- server-side Get Bill Transactions verification actually completed. This
-- is the more conservative default (an instant this system directly
-- witnessed) and the function guarantees paid_at is never null on a
-- successful transition either way, satisfying the trigger's new
-- requirement unconditionally.
--
-- Also admin-gated for the same "no caller yet, will need redesigning
-- before an unauthenticated callback route can call it" reason as
-- mark_toyyibpay_attempt_failed above.
--
-- callback_received_at correction: the previous draft set
-- callback_received_at = now() unconditionally on every successful
-- finalization -- wrong, because Phase 2A has no callback route, and a
-- future Phase 2C finalization triggered by the return page or a
-- reconciliation sweep (neither of which received a callback) must NOT
-- claim one arrived. p_callback_received_at is the smallest fix: default
-- null (every Phase 2A/non-callback caller gets this for free), and ONLY
-- a future callback-route caller would ever pass a real value. This keeps
-- callback_received_at and verified_at meaningfully distinct -- verified_at
-- is unconditionally set to now() below because THIS function's own
-- Get-Bill-Transactions-equivalent confirmation is, by construction,
-- always a "TERAS independently verified" event, regardless of what
-- triggered the check.
--
-- Signature note: this function has now changed parameter list twice
-- (paid_at fix added p_provider_transaction_time; this fix adds
-- p_callback_received_at). CREATE OR REPLACE does not replace a function
-- whose parameter list changed -- it would silently create a new overload
-- and leave a stale prior-signature version still callable. The DROP
-- below targets the immediately preceding 5-argument signature; this
-- migration is only ever applied once to a given database (see this
-- file's own clean-baseline validation), so no earlier signature can
-- exist beyond that one.
drop function if exists public.finalize_toyyibpay_payment(uuid, numeric, text, jsonb, timestamptz);

create or replace function public.finalize_toyyibpay_payment(
  p_attempt_id uuid,
  p_verified_amount numeric,
  p_provider_transaction_id text,
  p_raw_response jsonb,
  p_provider_transaction_time timestamptz default null,
  p_callback_received_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_attempt record;
  v_invoice record;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_paid_at timestamptz;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_verified_amount is null or p_verified_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if p_provider_transaction_id is null or length(trim(p_provider_transaction_id)) = 0 then
    raise exception 'invalid_provider_transaction_id' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_attempt from public.invoice_payments where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.status <> 'pending' then
    raise exception 'attempt_not_pending' using errcode = 'P0001';
  end if;

  select * into v_invoice from public.invoices where id = v_attempt.invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if p_verified_amount > v_invoice.balance_due then
    raise exception 'amount_exceeds_balance' using errcode = 'P0001';
  end if;

  v_paid_at := coalesce(p_provider_transaction_time, now());

  update public.invoice_payments
  set status = 'successful',
      verified_amount = p_verified_amount,
      provider_transaction_id = p_provider_transaction_id,
      paid_at = v_paid_at,
      callback_received_at = p_callback_received_at,
      verified_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('raw_response', p_raw_response),
      updated_at = now()
  where id = p_attempt_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay payment verified successful for invoice %s (RM %s)', v_invoice.invoice_no, p_verified_amount),
    jsonb_build_object('invoice_id', v_invoice.id, 'attempt_id', p_attempt_id, 'verified_amount', p_verified_amount, 'provider_transaction_id', p_provider_transaction_id, 'paid_at', v_paid_at));

  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'successful');
end;
$$;

revoke all on function public.finalize_toyyibpay_payment(uuid, numeric, text, jsonb, timestamptz, timestamptz) from public;
grant execute on function public.finalize_toyyibpay_payment(uuid, numeric, text, jsonb, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 11. RPC: log a manual-payment-vs-ToyyibPay conflict event (e.g. Inactive
-- Bill reports a payment already in process) without mutating any
-- financial row. audit_logs only (via log_event_as_service) -- this
-- migration does not touch sales_activity_type_check at all; ToyyibPay
-- sales-domain activity events are deferred to whichever phase actually
-- has a real caller for them (see note at the bottom).
create or replace function public.log_toyyibpay_conflict(p_invoice_id uuid, p_attempt_id uuid, p_conflict_type text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice_no text;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_conflict_type not in ('in_progress', 'reconciliation_required') then
    raise exception 'invalid_conflict_type' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;
  select invoice_no into v_invoice_no from public.invoices where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay conflict (%s) for invoice %s -- manual payment blocked pending reconciliation', p_conflict_type, coalesce(v_invoice_no, '?')),
    jsonb_build_object('invoice_id', p_invoice_id, 'attempt_id', p_attempt_id, 'conflict_type', p_conflict_type));

  return jsonb_build_object('logged', true);
end;
$$;

revoke all on function public.log_toyyibpay_conflict(uuid, uuid, text) from public;
grant execute on function public.log_toyyibpay_conflict(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 12. RPC: log a provider-orphan-bill compensation event. This is the
-- DB-side primitive the Phase 2B orchestration's compensation strategy
-- depends on -- see the design note at the bottom of this file. No
-- invoice_payments row exists for an orphan bill (the whole point of the
-- failure is that the local write never happened), so this logs against
-- entity_type='invoices' rather than a nonexistent attempt id. Never
-- mutates any financial row -- audit_logs only, via log_event_as_service.
create or replace function public.log_toyyibpay_orphan_bill_event(
  p_invoice_id uuid,
  p_billcode text,
  p_compensation_status text,
  p_detail text
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice_no text;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_billcode is null or length(trim(p_billcode)) = 0 then
    raise exception 'invalid_billcode' using errcode = 'P0001';
  end if;
  if p_compensation_status not in ('deactivated', 'deactivation_failed') then
    raise exception 'invalid_compensation_status' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;
  select invoice_no into v_invoice_no from public.invoices where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
    case when p_compensation_status = 'deactivated'
      then format('ToyyibPay orphan bill (%s) for invoice %s compensated: provider confirmed deactivation after a local DB write failure', p_billcode, coalesce(v_invoice_no, '?'))
      else format('ToyyibPay orphan bill (%s) for invoice %s -- compensation FAILED, requires manual reconciliation', p_billcode, coalesce(v_invoice_no, '?'))
    end,
    jsonb_build_object('invoice_id', p_invoice_id, 'billcode', p_billcode, 'compensation_status', p_compensation_status, 'detail', p_detail));

  return jsonb_build_object('logged', true);
end;
$$;

revoke all on function public.log_toyyibpay_orphan_bill_event(uuid, text, text, text) from public;
grant execute on function public.log_toyyibpay_orphan_bill_event(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Provider-orphan-bill compensation design (Phase 2B orchestration, not
-- built in this migration -- this is the DESIGN that public.
-- log_toyyibpay_orphan_bill_event above exists to support):
--
-- Sequence: (1) fresh server-side eligibility read -- a plain SELECT
-- against invoices/invoice_payments, both already SELECT-granted to
-- authenticated, no new RPC needed for this step; (2) call ToyyibPay
-- createBill; (3) immediately call record_toyyibpay_bill. If step 3
-- succeeds, done -- normal path. If step 3 fails AFTER step 2 already
-- succeeded, a real ToyyibPay BillCode now exists with no local CRM
-- awareness of it (the "provider orphan"). Phase 2B's orchestration must:
-- retry step 3 a bounded number of times first (it's a plain INSERT,
-- idempotent-safe to retry against the same p_attempt_id/p_billcode --
-- most transient DB errors resolve on retry, which closes most of this
-- window without needing compensation at all); if it still fails,
-- immediately call ToyyibPay inactiveBill, verify the provider's
-- deactivation result, call log_toyyibpay_orphan_bill_event with
-- 'deactivated', and never surface that payment URL to the customer. If
-- inactiveBill itself fails, fail closed: call
-- log_toyyibpay_orphan_bill_event with 'deactivation_failed' (the billcode
-- is logged to audit_logs, not silently discarded), and surface an admin
-- reconciliation-required error rather than pretending the attempt was
-- never created.
--
-- Reservation-first alternative (reserve a local pending row with no
-- billcode yet -> call createBill -> attach the billcode), considered and
-- REJECTED: it moves the seam, it doesn't remove it. Its own late-attach
-- failure (HTTP succeeds, the attach UPDATE fails) is the exact same
-- provider-orphan problem, requiring the exact same inactiveBill
-- compensation regardless. What it would add is a NEW failure mode of its
-- own (reserve succeeds, createBill is never called or fails) that,
-- while lower-risk (no external ToyyibPay state exists yet), still needs
-- its own cleanup path and introduces a "creating" intermediate status
-- with no material safety benefit over compensation -- exactly the
-- outcome this task said to avoid ("do not add creating unless it
-- materially improves safety over compensation"). Compensation is the
-- smaller architecture and is kept.
--
-- ---------------------------------------------------------------------
-- Deliberately NOT done in this migration (scope notes, not oversights):
--
-- * record_manual_payment() is byte-for-byte unchanged. The manual-payment-
--   vs-ToyyibPay race policy (supersede the pending attempt via Inactive
--   Bill BEFORE calling record_manual_payment, or reject with
--   toyyibpay_payment_in_progress) is Next.js Server Action orchestration
--   that doesn't exist until the HTTP layer does (Phase 2C/2D). Adding a
--   DB-level hard block now, with no orchestration layer able to ever
--   clear it, would strand every manual payment behind a pending ToyyibPay
--   attempt with no way to unblock it -- worse than today's behaviour, not
--   safer. Today's get_active_toyyibpay_attempt/mark_toyyibpay_attempt_superseded/
--   log_toyyibpay_conflict RPCs are exactly the primitives that
--   orchestration will call.
--
-- * finalize_toyyibpay_payment() and mark_toyyibpay_attempt_failed() are
--   still app.is_admin()-gated here because Phase 2A has no caller for
--   them. Phase 2C's unauthenticated callback route cannot satisfy
--   app.is_admin() (there is no staff session on an incoming ToyyibPay
--   webhook) -- before that route is built, these two functions'
--   authorization model must be redesigned (billcode/order_id/amount-match
--   becomes the actual gate, replacing the role check, with a
--   narrowly-scoped anon execute grant). Flagged now, not solved now,
--   since the calling convention isn't decided until the route itself is
--   designed. This task's instruction to preserve that TODO rather than
--   weaken these RPCs now is followed exactly -- no anon/public grant was
--   added to either function in this pass.
--
-- * sales_activity_type_check is untouched. ToyyibPay sales-domain event
--   types (toyyibpay_bill_created etc.) are deferred to the phase that
--   actually emits them from a real, end-to-end-exercised call path.
