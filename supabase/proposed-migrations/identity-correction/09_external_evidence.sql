-- PROPOSED (local only, NOT applied anywhere): database side of the External Audit Anchor (Phase 3A prototype).
-- One logical change: the least-privilege surface an independent evidence worker needs, plus a fail-closed gate.
--
-- What this adds
--   * public.identity_evidence_snapshot()   READ-ONLY. Executable only by role idc_evidence_reader. Returns anchors, the ledger
--       hash chain (seq / prev_hash / row_hash only), acknowledgements and freshness. Never returns salts, fingerprints of
--       personal data, sealed bytes, request or participant identifiers, names or identity numbers.
--   * public.identity_evidence_ack(...) and public.identity_evidence_heartbeat(...)   the ONLY writes, executable only by a
--       SEPARATE role idc_evidence_acker: each inserts one validated row into an append-only table. The verification worker
--       does not hold the acker credential; a separate, smaller step does.
--   * identity_audit.external_evidence_ready() + a gate on identity_audit.requests: a NEW request, and the start of an apply, is
--       refused (IDC_EXTERNAL_EVIDENCE_REQUIRED) unless the latest external verification is 'ok' and recent
--       (policy.verification_max_age, default 36 h) and EVERY anchor has been acknowledged. Approve / cancel / reject stay possible.
--
-- Honest limit (also in EXTERNAL_ANCHOR_DESIGN.md): acknowledgements and heartbeats are written by a database role, so someone
-- with database-owner rights can forge them. They exist for OPERATIONAL fail-closed behaviour. Tamper DETECTION lives entirely in
-- the externally stored, signed, hash-chained evidence, which that person cannot rewrite under the assumed credential separation.
--
-- Role creation is a cluster-level, owner-controlled step (credential custody) and is deliberately NOT done here:
--   create role idc_evidence_reader nologin;   create role idc_evidence_acker nologin;
-- then grant each to its own LOGIN role, with its own secret, held only by the process that needs it.
--
-- Integrity: ONE transaction; refuses to run on drift (IDC_GUARD_DRIFT); afterwards proves that the only audit objects it changed
-- are its own seven components before recording the anchor.

begin;

do $$
begin
  if to_regprocedure('identity_audit.finish_guard_transition(jsonb,text[],boolean,boolean)') is null
     or to_regprocedure('identity_audit.anchors_immutable()') is null
     or to_regclass('identity_audit.anchors') is null or to_regclass('identity_audit.requests') is null
     or to_regclass('identity_audit.policy') is null then
    raise exception 'external-evidence pre-check failed: run 01 to 08 (current versions) first';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'idc_evidence_reader')
     or not exists (select 1 from pg_roles where rolname = 'idc_evidence_acker') then
    raise exception 'external-evidence pre-check failed: create the roles first (create role idc_evidence_reader nologin; create role idc_evidence_acker nologin;)';
  end if;
  if exists (select 1 from pg_roles where rolname = 'idc_evidence_reader' and (rolcanlogin or rolsuper or rolcreaterole or rolcreatedb or rolbypassrls))
     or exists (select 1 from pg_roles where rolname = 'idc_evidence_acker' and (rolcanlogin or rolsuper or rolcreaterole or rolcreatedb or rolbypassrls)) then
    raise exception 'external-evidence pre-check failed: the evidence roles must be plain NOLOGIN group roles';
  end if;
  if pg_has_role('idc_evidence_reader', 'idc_evidence_acker', 'member') or pg_has_role('idc_evidence_acker', 'idc_evidence_reader', 'member') then
    raise exception 'external-evidence pre-check failed: the reader and acker roles must be separate (neither a member of the other)';
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname in ('idc_evidence_reader', 'idc_evidence_acker')) then
    raise exception 'external-evidence pre-check failed: the evidence group roles must not be members of any other role (they could inherit privileges)';
  end if;
end $$;

select identity_audit.assert_guards_clean();
create temporary table _idc_before on commit drop as select identity_audit.guard_snapshot() as snap;

-- ---- policy: freshness windows ----------------------------------------------------------------------------------------
alter table identity_audit.policy add column if not exists verification_max_age interval not null default interval '36 hours';
-- throttle: whatever the gate says, at most this many requests (of any outcome) may be created in 24 hours, which bounds the damage of a forged gate
alter table identity_audit.policy add column if not exists max_requests_per_day integer not null default 20;
alter table identity_audit.policy drop constraint if exists policy_evidence_windows_positive;
alter table identity_audit.policy add constraint policy_evidence_windows_positive
  check (verification_max_age > interval '0' and max_requests_per_day between 1 and 1000);

-- ---- append-only evidence tables --------------------------------------------------------------------------------------
create table if not exists identity_audit.evidence_acks (
  anchor_seq bigint primary key references identity_audit.anchors(seq) on delete restrict,
  evidence_seq bigint not null unique check (evidence_seq >= 1),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  evidence_ref text not null check (evidence_ref ~ '^[0-9a-f]{7,64}$'),
  acked_at timestamptz not null default clock_timestamp()
);
create table if not exists identity_audit.evidence_verifications (
  id bigint generated always as identity primary key,
  verified_at timestamptz not null default clock_timestamp(),
  status text not null check (status in ('ok', 'alert')),
  evidence_seq bigint not null check (evidence_seq >= 0),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  anchors_checked bigint not null check (anchors_checked >= 0),
  findings text[] not null default '{}' check (cardinality(findings) <= 20)
);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'evidence_acks_immutable' and tgrelid = 'identity_audit.evidence_acks'::regclass) then
    create trigger evidence_acks_immutable before update or delete on identity_audit.evidence_acks
      for each row execute function identity_audit.anchors_immutable();
    create trigger evidence_acks_no_truncate before truncate on identity_audit.evidence_acks
      for each statement execute function identity_audit.anchors_immutable();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'evidence_verifications_immutable' and tgrelid = 'identity_audit.evidence_verifications'::regclass) then
    create trigger evidence_verifications_immutable before update or delete on identity_audit.evidence_verifications
      for each row execute function identity_audit.anchors_immutable();
    create trigger evidence_verifications_no_truncate before truncate on identity_audit.evidence_verifications
      for each statement execute function identity_audit.anchors_immutable();
  end if;
end $$;

-- ---- readiness + gate ------------------------------------------------------------------------------------------------
create or replace function identity_audit.external_evidence_ready() returns boolean
language sql stable security definer set search_path = pg_catalog as
$$ select exists (select 1 from (select v.status, v.verified_at from identity_audit.evidence_verifications v order by v.id desc limit 1) l
                    join identity_audit.policy p on p.singleton
                   where l.status = 'ok' and l.verified_at >= clock_timestamp() - p.verification_max_age)
      and not exists (select 1 from identity_audit.anchors a
                       where not exists (select 1 from identity_audit.evidence_acks k where k.anchor_seq = a.seq)) $$;

create or replace function identity_audit.evidence_gate() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and not (old.applying_txid is null and new.applying_txid is not null) then return new; end if;
  if not identity_audit.external_evidence_ready() then
    raise exception 'IDC_EXTERNAL_EVIDENCE_REQUIRED: external audit evidence is missing, stale or unacknowledged; corrections are refused until it is restored.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    -- transaction-scoped lock: a concurrent request waits for this one to commit, then counts it (no check-then-insert race)
    perform pg_advisory_xact_lock(pg_catalog.hashtext('identity_audit.request_throttle'));
  end if;
  if tg_op = 'INSERT' and (select count(*) from identity_audit.requests r where r.requested_at > clock_timestamp() - interval '24 hours')
       >= (select p.max_requests_per_day from identity_audit.policy p where p.singleton) then
    raise exception 'IDC_REQUEST_RATE_LIMIT: too many correction requests in the last 24 hours.' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'requests_evidence_gate_ins' and tgrelid = 'identity_audit.requests'::regclass) then
    create trigger requests_evidence_gate_ins before insert on identity_audit.requests
      for each row execute function identity_audit.evidence_gate();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'requests_evidence_gate_apply' and tgrelid = 'identity_audit.requests'::regclass) then
    create trigger requests_evidence_gate_apply before update of applying_txid on identity_audit.requests
      for each row execute function identity_audit.evidence_gate();
  end if;
end $$;

-- ---- the read-only snapshot (reader role only) -----------------------------------------------------------------------
create or replace function public.identity_evidence_snapshot() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_pol identity_audit.policy%rowtype;
begin
  select * into v_pol from identity_audit.policy where singleton;
  return pg_catalog.jsonb_build_object(
    'generated_at', clock_timestamp(),
    'policy', pg_catalog.jsonb_build_object('enabled', v_pol.enabled_at is not null,
        'verification_max_age_s', extract(epoch from v_pol.verification_max_age)),
    'ready', identity_audit.external_evidence_ready(),
    'anchors', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('seq', a.seq, 'ledger_rows', a.ledger_rows,
          'ledger_head', a.ledger_head, 'guard_fingerprint', a.guard_fingerprint, 'created_at', a.created_at) order by a.seq)
        from identity_audit.anchors a), '[]'::jsonb),
    'acks', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('anchor_seq', k.anchor_seq, 'evidence_seq', k.evidence_seq,
          'evidence_hash', k.evidence_hash, 'acked_at', k.acked_at) order by k.anchor_seq)
        from identity_audit.evidence_acks k), '[]'::jsonb),
    'ledger', pg_catalog.jsonb_build_object('rows', (select count(*) from identity_audit.corrections),
        'chain', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('seq', c.seq, 'prev_hash', c.prev_hash, 'row_hash', c.row_hash) order by c.seq)
            from identity_audit.corrections c), '[]'::jsonb)),
    -- EVERY heartbeat, in full, so the external worker can match each one field for field against a signed record (and notice a truncated list)
    'verifications', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'verified_at', x.verified_at, 'status', x.status,
          'evidence_seq', x.evidence_seq, 'evidence_hash', x.evidence_hash, 'anchors_checked', x.anchors_checked, 'findings', x.findings) order by x.id)
        from identity_audit.evidence_verifications x), '[]'::jsonb),
    'verifications_total', (select count(*) from identity_audit.evidence_verifications));
end $$;

-- ---- the two minimal writes (acker role only) --------------------------------------------------------------------------
create or replace function public.identity_evidence_ack(p_anchor_seq bigint, p_evidence_seq bigint, p_evidence_hash text, p_evidence_ref text) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare v_existing identity_audit.evidence_acks%rowtype; v_next bigint; v_max bigint;
begin
  if p_anchor_seq is null or p_evidence_seq is null or p_evidence_seq < 1
     or p_evidence_hash is null or p_evidence_hash !~ '^[0-9a-f]{64}$'
     or p_evidence_ref is null or p_evidence_ref !~ '^[0-9a-f]{7,64}$' then
    raise exception 'IDC_EVIDENCE_ACK_INVALID: malformed acknowledgement.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtext('identity_audit.evidence_acks'));
  select * into v_existing from identity_audit.evidence_acks where anchor_seq = p_anchor_seq;
  if found then
    if v_existing.evidence_seq = p_evidence_seq and v_existing.evidence_hash = p_evidence_hash and v_existing.evidence_ref = p_evidence_ref then return; end if;
    raise exception 'IDC_EVIDENCE_CONFLICT: this anchor was already acknowledged with different evidence.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from identity_audit.anchors where seq = p_anchor_seq) then
    raise exception 'IDC_EVIDENCE_UNKNOWN_ANCHOR: no such anchor.' using errcode = 'P0001';
  end if;
  select min(a.seq) into v_next from identity_audit.anchors a where not exists (select 1 from identity_audit.evidence_acks k where k.anchor_seq = a.seq);
  if p_anchor_seq <> v_next then
    raise exception 'IDC_EVIDENCE_OUT_OF_ORDER: anchors must be acknowledged in order (next is %).', v_next using errcode = 'P0001';
  end if;
  select coalesce(max(evidence_seq), 0) into v_max from identity_audit.evidence_acks;
  if p_evidence_seq <= v_max then
    raise exception 'IDC_EVIDENCE_SEQUENCE: the evidence sequence must increase (last is %).', v_max using errcode = 'P0001';
  end if;
  insert into identity_audit.evidence_acks (anchor_seq, evidence_seq, evidence_hash, evidence_ref)
  values (p_anchor_seq, p_evidence_seq, p_evidence_hash, p_evidence_ref);
end $$;

create or replace function public.identity_evidence_heartbeat(p_status text, p_evidence_seq bigint, p_evidence_hash text, p_anchors_checked bigint, p_findings text[]) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare v_last bigint; f text;
begin
  if p_status is null or p_status not in ('ok', 'alert') or p_evidence_seq is null or p_evidence_seq < 0
     or p_evidence_hash is null or p_evidence_hash !~ '^[0-9a-f]{64}$' or p_anchors_checked is null or p_anchors_checked < 0 then
    raise exception 'IDC_EVIDENCE_HEARTBEAT_INVALID: malformed heartbeat.' using errcode = 'P0001';
  end if;
  p_findings := coalesce(p_findings, '{}'::text[]);
  if cardinality(p_findings) > 20 then raise exception 'IDC_EVIDENCE_HEARTBEAT_INVALID: too many findings.' using errcode = 'P0001'; end if;
  foreach f in array p_findings loop
    if f is null or f !~ '^[A-Z][A-Z0-9_]{2,39}$' then
      raise exception 'IDC_EVIDENCE_HEARTBEAT_INVALID: a finding must be an upper-case code.' using errcode = 'P0001';
    end if;
    -- a heartbeat may only be "ok" if every finding is a warning (WARN_*); anything else must be reported as an alert
    if p_status = 'ok' and f !~ '^WARN_' then
      raise exception 'IDC_EVIDENCE_HEARTBEAT_INVALID: an ok heartbeat may carry warnings only.' using errcode = 'P0001';
    end if;
  end loop;
  perform pg_advisory_xact_lock(pg_catalog.hashtext('identity_audit.evidence_verifications'));
  select coalesce(max(evidence_seq), 0) into v_last from identity_audit.evidence_verifications;
  if p_evidence_seq < v_last then
    raise exception 'IDC_EVIDENCE_SEQUENCE: the evidence sequence cannot go backwards (last is %).', v_last using errcode = 'P0001';
  end if;
  -- an 'ok' heartbeat must have seen every anchor that exists now: a stale 'ok' cannot be replayed after a new anchor
  if p_status = 'ok' and p_anchors_checked <> (select count(*) from identity_audit.anchors) then
    raise exception 'IDC_EVIDENCE_HEARTBEAT_STALE: the verification did not cover all current anchors.' using errcode = 'P0001';
  end if;
  insert into identity_audit.evidence_verifications (status, evidence_seq, evidence_hash, anchors_checked, findings)
  values (p_status, p_evidence_seq, p_evidence_hash, p_anchors_checked, p_findings);
end $$;

-- ---- privileges: exactly one role per function, nothing for any API role ---------------------------------------------
revoke all on function identity_audit.external_evidence_ready(), identity_audit.evidence_gate(),
  public.identity_evidence_snapshot(), public.identity_evidence_ack(bigint, bigint, text, text),
  public.identity_evidence_heartbeat(text, bigint, text, bigint, text[]) from public, anon, authenticated, service_role;
revoke all on table identity_audit.evidence_acks, identity_audit.evidence_verifications from public, anon, authenticated, service_role;
grant execute on function public.identity_evidence_snapshot() to idc_evidence_reader;
grant execute on function public.identity_evidence_ack(bigint, bigint, text, text) to idc_evidence_acker;
grant execute on function public.identity_evidence_heartbeat(text, bigint, text, bigint, text[]) to idc_evidence_acker;
revoke all on all functions in schema identity_audit from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where n.nspname = 'identity_audit' and a.grantee <> p.proowner and a.privilege_type = 'EXECUTE') then
    raise exception 'external-evidence post-check failed: a non-owner can execute an internal audit function';
  end if;
  if (select string_agg(p.proname || '=' || coalesce(r.rolname, 'PUBLIC'), ',' order by p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
             lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             left join pg_roles r on r.oid = a.grantee
       where n.nspname = 'public' and p.proname like 'identity\_evidence\_%' and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner)
     is distinct from 'identity_evidence_ack=idc_evidence_acker,identity_evidence_heartbeat=idc_evidence_acker,identity_evidence_snapshot=idc_evidence_reader' then
    raise exception 'external-evidence post-check failed: unexpected EXECUTE grants on the evidence functions';
  end if;
  if exists (select 1 from information_schema.role_table_grants g
              where g.table_schema = 'identity_audit' and g.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role', 'idc_evidence_reader', 'idc_evidence_acker')) then
    raise exception 'external-evidence post-check failed: a role holds a table privilege on identity_audit';
  end if;
end $$;

select identity_audit.finish_guard_transition((select snap from _idc_before),
  array['fn:identity_audit.evidence_gate()', 'fn:identity_audit.external_evidence_ready()',
        'fn:public.identity_evidence_snapshot()', 'fn:public.identity_evidence_ack(bigint,bigint,text,text)',
        'fn:public.identity_evidence_heartbeat(text,bigint,text,bigint,text[])',
        'trg:identity_audit.requests.requests_evidence_gate_ins', 'trg:identity_audit.requests.requests_evidence_gate_apply'],
  true, true);

commit;
