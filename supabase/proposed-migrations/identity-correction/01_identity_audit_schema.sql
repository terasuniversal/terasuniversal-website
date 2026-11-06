-- PROPOSED (local only, NOT applied anywhere): identity-correction evidence schema.
-- One logical change: the protected evidence store. It installs NO guard and NO callable workflow,
-- so on its own it changes nothing about how certificates or participants behave.
--
-- Design rules enforced here:
--   * schema `identity_audit` is owner-only: no API role has USAGE or table privileges;
--   * the ledger is append-only (trigger + no privileges); a hash chain gives tamper EVIDENCE only --
--     it is not a defence against a privileged writer, which is why anchors/guard fingerprints exist;
--   * original/new values are sealed with the owner's PGP PUBLIC key (pgcrypto); the database
--     can encrypt but not decrypt them. The private key never enters the database or this repository;
--   * the workflow is disabled until the sealing key, anchor sink and notification sink are
--     configured and enable_identity_correction() has verified them (policy CHECK constraint).

-- ---- pre-checks (fail closed, change nothing) -------------------------------------------------
do $$
begin
  if to_regnamespace('app') is null then raise exception 'identity_audit pre-check failed: schema app is missing'; end if;
  if to_regclass('public.participants') is null or to_regclass('public.certificates') is null
     or to_regclass('public.certificate_issuance_snapshots') is null or to_regclass('public.audit_logs') is null then
    raise exception 'identity_audit pre-check failed: required public tables are missing';
  end if;
  if to_regprocedure('extensions.pgp_pub_encrypt(text,bytea)') is null or to_regprocedure('extensions.dearmor(text)') is null then
    raise exception 'identity_audit pre-check failed: pgcrypto (pgp_pub_encrypt, dearmor) is not installed in schema extensions';
  end if;
  if to_regclass('identity_audit.corrections') is null
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'identity_audit') then
    raise exception 'identity_audit pre-check failed: schema exists in a partial state; resolve manually';
  end if;
end $$;

create schema if not exists identity_audit;
revoke all on schema identity_audit from public, anon, authenticated, service_role;

-- ---- policy (singleton) ----------------------------------------------------------------------
create table if not exists identity_audit.policy (
  singleton boolean primary key default true check (singleton),
  -- PROVISIONAL test defaults. They are NOT approved Production policy.
  wait_name interval not null default interval '24 hours',
  wait_identity interval not null default interval '72 hours',
  require_second_approver boolean not null default false,
  sealing_public_key text,
  anchor_sink_configured_at timestamptz,
  notification_sink_configured_at timestamptz,
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint policy_no_private_key check (sealing_public_key is null or sealing_public_key !~* 'PRIVATE KEY'),
  constraint policy_enabled_requires_controls check (
    enabled_at is null
    or (sealing_public_key is not null and anchor_sink_configured_at is not null and notification_sink_configured_at is not null))
);
insert into identity_audit.policy (singleton) values (true) on conflict do nothing;

-- ---- requests --------------------------------------------------------------------------------
create table if not exists identity_audit.requests (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete restrict,
  change_kind text not null check (change_kind in ('name', 'identity', 'combined')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'cancelled')),
  requested_by uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  earliest_apply_at timestamptz not null,
  apply_to_profile boolean not null,
  new_full_name text,          -- cleared when the request becomes terminal
  new_identity text,           -- cleared when the request becomes terminal
  reason text not null check (char_length(btrim(reason)) >= 20),
  evidence jsonb not null,
  baseline jsonb not null,
  second_approver uuid,
  second_approved_at timestamptz,
  applying_txid bigint,
  applied_by uuid,
  applied_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  constraint requests_kind_values check (
    (change_kind = 'name' and new_full_name is not null and new_identity is null)
    or (change_kind = 'identity' and new_identity is not null and new_full_name is null)
    or (change_kind = 'combined' and new_identity is not null and new_full_name is not null)
    or status <> 'pending')
);
create unique index if not exists requests_one_open_per_participant
  on identity_audit.requests (participant_id) where status = 'pending';

create table if not exists identity_audit.request_certificates (
  request_id uuid not null references identity_audit.requests(id) on delete restrict,
  certificate_id uuid not null references public.certificates(id) on delete restrict,
  identity_class text not null check (identity_class in ('A', 'B', 'C', 'none')),
  name_decision text check (name_decision in ('correct', 'leave')),
  identity_decision text check (identity_decision in ('correct', 'leave', 'accept_display_change', 'pin_old', 'materialize_new')),
  decision_reason text,
  primary key (request_id, certificate_id)
);

-- ---- ledger ----------------------------------------------------------------------------------
create table if not exists identity_audit.corrections (
  seq bigint generated always as identity primary key,
  request_id uuid not null references identity_audit.requests(id) on delete restrict,
  target text not null check (target in ('certificate', 'snapshot', 'snapshot_render_payload', 'participant')),
  row_id uuid not null,
  certificate_id uuid,
  participant_id uuid not null,
  field text not null,
  old_sealed bytea,
  new_sealed bytea,
  salt text not null,
  old_fp text,
  new_fp text,
  txid bigint not null default (pg_current_xact_id()::text::bigint),
  applied_by uuid not null,
  applied_at timestamptz not null default clock_timestamp(),
  prev_hash text not null,
  row_hash text not null
);
create index if not exists corrections_lookup on identity_audit.corrections (target, row_id, field, txid);

create table if not exists identity_audit.anchors (
  seq bigint generated always as identity primary key,
  ledger_rows bigint not null,
  ledger_head text not null,
  guard_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists identity_audit.outbox (
  id bigint generated always as identity primary key,
  kind text not null,
  request_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz
);

-- ---- append-only / state-machine triggers -----------------------------------------------------
create or replace function identity_audit.ledger_chain() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare v_prev text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('identity_audit.corrections'));
  select c.row_hash into v_prev from identity_audit.corrections c order by c.seq desc limit 1;
  new.prev_hash := coalesce(v_prev, 'GENESIS');
  new.row_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.concat_ws('|',
      new.seq, new.request_id, new.target, new.row_id, new.field, coalesce(new.old_fp, ''), coalesce(new.new_fp, ''),
      pg_catalog.encode(extensions.digest(coalesce(new.old_sealed, ''::bytea), 'sha256'), 'hex'),
      pg_catalog.encode(extensions.digest(coalesce(new.new_sealed, ''::bytea), 'sha256'), 'hex'),
      new.txid, new.applied_by, new.applied_at, new.prev_hash), 'UTF8'), 'sha256'), 'hex');
  return new;
end $$;

create or replace function identity_audit.append_only() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'identity_audit.% is append-only', tg_table_name using errcode = '42501';
end $$;

create or replace function identity_audit.requests_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then raise exception 'identity_audit.requests rows cannot be deleted' using errcode = '42501'; end if;
  if old.status <> 'pending' then raise exception 'identity_audit request is already terminal' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['status', 'new_full_name', 'new_identity', 'second_approver', 'second_approved_at', 'applying_txid',
        'applied_by', 'applied_at', 'cancelled_by', 'cancelled_at', 'cancel_reason'])
     is distinct from
     (to_jsonb(old) - array['status', 'new_full_name', 'new_identity', 'second_approver', 'second_approved_at', 'applying_txid',
        'applied_by', 'applied_at', 'cancelled_by', 'cancelled_at', 'cancel_reason']) then
    raise exception 'identity_audit request evidence is immutable' using errcode = '42501';
  end if;
  if new.status in ('applied', 'cancelled') and (new.new_full_name is not null or new.new_identity is not null) then
    raise exception 'identity_audit terminal requests must not retain the new values' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function identity_audit.anchors_immutable() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'identity_audit.% rows are immutable', tg_table_name using errcode = '42501';
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'corrections_chain' and tgrelid = 'identity_audit.corrections'::regclass) then
    create trigger corrections_chain before insert on identity_audit.corrections for each row execute function identity_audit.ledger_chain();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'corrections_append_only' and tgrelid = 'identity_audit.corrections'::regclass) then
    create trigger corrections_append_only before update or delete on identity_audit.corrections for each row execute function identity_audit.append_only();
    create trigger corrections_no_truncate before truncate on identity_audit.corrections for each statement execute function identity_audit.append_only();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'anchors_immutable' and tgrelid = 'identity_audit.anchors'::regclass) then
    create trigger anchors_immutable before update or delete on identity_audit.anchors for each row execute function identity_audit.anchors_immutable();
    create trigger anchors_no_truncate before truncate on identity_audit.anchors for each statement execute function identity_audit.anchors_immutable();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'requests_guard' and tgrelid = 'identity_audit.requests'::regclass) then
    create trigger requests_guard before update or delete on identity_audit.requests for each row execute function identity_audit.requests_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'request_certificates_guard' and tgrelid = 'identity_audit.request_certificates'::regclass) then
    create trigger request_certificates_guard before update or delete on identity_audit.request_certificates for each row execute function identity_audit.anchors_immutable();
  end if;
end $$;

-- ---- privileges: nothing for any API role ------------------------------------------------------
revoke all on all tables in schema identity_audit from public, anon, authenticated, service_role;
revoke all on all sequences in schema identity_audit from public, anon, authenticated, service_role;
revoke all on all functions in schema identity_audit from public, anon, authenticated, service_role;
alter default privileges in schema identity_audit revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema identity_audit revoke all on functions from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from information_schema.role_table_grants g
              where g.table_schema = 'identity_audit' and g.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) then
    raise exception 'identity_audit post-check failed: an API role holds a table privilege';
  end if;
  if has_schema_privilege('authenticated', 'identity_audit', 'USAGE') or has_schema_privilege('service_role', 'identity_audit', 'USAGE')
     or has_schema_privilege('anon', 'identity_audit', 'USAGE') then
    raise exception 'identity_audit post-check failed: an API role has schema USAGE';
  end if;
end $$;
