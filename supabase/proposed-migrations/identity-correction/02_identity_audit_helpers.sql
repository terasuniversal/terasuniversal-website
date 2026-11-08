-- PROPOSED (local only, NOT applied anywhere): internal helpers for identity correction.
-- One logical change: owner-only helper functions. Nothing here is callable by an API role and
-- nothing here changes certificate/participant behaviour by itself (no guard is installed).
--
-- The central helper is identity_audit.authorized(): it answers "is THIS exact old->new change on
-- THIS row authorised by a ledger row written in the CURRENT transaction by the correction
-- function?". There is no session flag or setting a caller can set to make it true: the only way
-- to satisfy it is to insert into identity_audit.corrections, which only the owner-run
-- workflow function can do.

do $$
begin
  if to_regclass('identity_audit.corrections') is null or to_regclass('identity_audit.requests') is null
     or to_regclass('identity_audit.policy') is null then
    raise exception 'identity_audit helpers pre-check failed: run 01_identity_audit_schema.sql first';
  end if;
end $$;

create or replace function identity_audit.norm(p text) returns text
language sql immutable set search_path = pg_catalog as
$$ select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')) $$;

create or replace function identity_audit.fp(p_salt text, p_value text) returns text
language sql immutable set search_path = pg_catalog as
$$ select case when p_value is null then null
               else pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_salt || '|' || p_value, 'UTF8')), 'hex') end $$;

create or replace function identity_audit.compute_row_hash(
  p_seq bigint, p_request uuid, p_target text, p_row uuid, p_field text, p_old_fp text, p_new_fp text,
  p_old_sealed bytea, p_new_sealed bytea, p_txid bigint, p_actor uuid, p_at timestamptz, p_prev text) returns text
language sql immutable set search_path = pg_catalog as
$$ select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|',
     p_seq, p_request, p_target, p_row, p_field, coalesce(p_old_fp, ''), coalesce(p_new_fp, ''),
     pg_catalog.encode(pg_catalog.sha256(coalesce(p_old_sealed, ''::bytea)), 'hex'),
     pg_catalog.encode(pg_catalog.sha256(coalesce(p_new_sealed, ''::bytea)), 'hex'),
     p_txid, p_actor, p_at, p_prev), 'UTF8')), 'hex') $$;

-- Rebuild the chain trigger on top of the shared hash function so verification uses the same formula.
create or replace function identity_audit.ledger_chain() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare v_prev text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('identity_audit.corrections'));
  select c.row_hash into v_prev from identity_audit.corrections c order by c.seq desc limit 1;
  new.prev_hash := coalesce(v_prev, 'GENESIS');
  new.row_hash := identity_audit.compute_row_hash(new.seq, new.request_id, new.target, new.row_id, new.field,
    new.old_fp, new.new_fp, new.old_sealed, new.new_sealed, new.txid, new.applied_by, new.applied_at, new.prev_hash);
  return new;
end $$;

create or replace function identity_audit.controls_ready() returns boolean
language sql stable security definer set search_path = pg_catalog as
$$ select coalesce((select p.enabled_at is not null from identity_audit.policy p where p.singleton), false) $$;

create or replace function identity_audit.seal(p_value text) returns bytea
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_key text;
begin
  if p_value is null then return null; end if;
  select p.sealing_public_key into v_key from identity_audit.policy p where p.singleton;
  if v_key is null then raise exception 'IDC_SEALING_KEY_NOT_CONFIGURED' using errcode = 'P0001'; end if;
  return extensions.pgp_pub_encrypt(p_value, extensions.dearmor(v_key));
end $$;

create or replace function identity_audit.record(
  p_request uuid, p_target text, p_row uuid, p_certificate uuid, p_participant uuid,
  p_field text, p_old text, p_new text, p_actor uuid) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare v_salt text := pg_catalog.encode(extensions.gen_random_bytes(16), 'hex');
begin
  if p_old is not distinct from p_new then
    raise exception 'IDC_NOOP_FIELD: % is unchanged', p_field using errcode = 'P0001';
  end if;
  insert into identity_audit.corrections
    (request_id, target, row_id, certificate_id, participant_id, field, old_sealed, new_sealed, salt, old_fp, new_fp, applied_by)
  values (p_request, p_target, p_row, p_certificate, p_participant, p_field,
          identity_audit.seal(p_old), identity_audit.seal(p_new), v_salt,
          identity_audit.fp(v_salt, p_old), identity_audit.fp(v_salt, p_new), p_actor);
end $$;

create or replace function identity_audit.authorized(p_target text, p_row uuid, p_field text, p_old text, p_new text) returns boolean
language sql stable security definer set search_path = pg_catalog as
$$ select exists (
     select 1
       from identity_audit.corrections c
       join identity_audit.requests r on r.id = c.request_id
      where c.target = p_target and c.row_id = p_row and c.field = p_field
        and c.txid = pg_catalog.pg_current_xact_id()::text::bigint
        and r.status = 'pending' and r.applying_txid = c.txid
        and c.old_fp is not distinct from identity_audit.fp(c.salt, p_old)
        and c.new_fp is not distinct from identity_audit.fp(c.salt, p_new)) $$;

-- Identity collision / WAH duplicate-prevention checks for a proposed IC/Passport change.
create or replace function identity_audit.validate_identity_change(p_participant uuid, p_new_identity text) returns void
language plpgsql stable security definer set search_path = pg_catalog as $$
declare
  v_new text := identity_audit.norm(p_new_identity);
  v_old_ic text; v_old_id text;
begin
  if char_length(v_new) < 6 or char_length(v_new) > 20 then
    raise exception 'IDC_IDENTITY_FORMAT: the identity number must have 6-20 letters or digits' using errcode = 'P0001';
  end if;
  select identity_audit.norm(p.ic_passport_no), identity_audit.norm(p.identity_no)
    into v_old_ic, v_old_id from public.participants p where p.id = p_participant;
  if not found then raise exception 'IDC_PARTICIPANT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_new in (v_old_ic, v_old_id) then
    raise exception 'IDC_NO_CHANGE: the new identity equals the current identity' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.participants o
              where o.id <> p_participant
                -- soft-deleted participants count too: they are real people and could be restored later
                and v_new in (identity_audit.norm(o.identity_no), identity_audit.norm(o.ic_passport_no)))
     or exists (select 1 from public.certificates c
                 where c.participant_id <> p_participant and c.deleted_at is null
                   and identity_audit.norm(c.identity_no) = v_new) then
    raise exception 'IDC_IDENTITY_COLLISION: the new identity already belongs to another participant or certificate' using errcode = 'P0001';
  end if;

  -- A correction must not release a participant from a Working at Height duplicate hold.
  if exists (
    select 1
      from public.certificates c
      left join public.participants holder on holder.id = c.participant_id
      cross join lateral (values (identity_audit.norm(c.identity_no)), (identity_audit.norm(holder.identity_no)),
                                 (identity_audit.norm(holder.ic_passport_no))) as known(v)
     where c.deleted_at is null and c.status <> 'revoked' and c.participant_id <> p_participant
       and app.is_wah_legacy_target(c.course_id, c.course_name)
       and known.v <> '' and known.v in (v_old_ic, v_old_id)) then
    raise exception 'IDC_WAH_DUPLICATE_RELEASE_BLOCKED: the current identity matches another Working at Height certificate holder' using errcode = 'P0001';
  end if;
end $$;

-- Fingerprint of the guard functions and the enabled state of the guard/ledger triggers. A
-- privileged user can still change them; this makes such a change DETECTABLE against an anchor.
-- The guard fingerprint is built from per-object components so a migration can prove WHICH objects it changed
-- (identity_audit.finish_guard_transition) instead of re-anchoring whatever happens to differ.
create or replace function identity_audit.guard_components() returns table (k text, v text)
language sql stable security definer set search_path = pg_catalog as
$$ select 'fn:' || f.sig, coalesce((select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) || ':' || p.proowner::pg_catalog.regrole::pg_catalog.text || ':' || coalesce(p.proacl::pg_catalog.text, '')
                                       from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure(f.sig)), 'MISSING')
     from (values ('app.certificate_historical_update_guard()'), ('app.certificate_legacy_identity_guard()'),
                  ('app.snapshot_identity_guard()'), ('app.participant_identity_guard()'),
                  ('identity_audit.authorized(text,uuid,text,text,text)'), ('identity_audit.ledger_chain()'),
                  ('identity_audit.append_only()'), ('identity_audit.requests_guard()'),
                  ('identity_audit.text_has_identity(text)'), ('identity_audit.text_leaks_identity(text,text[])'),
                  ('identity_audit.safe_text(text,text[])'), ('identity_audit.fold_text(text)'),
                  ('identity_audit.guard_components()'), ('identity_audit.guard_fingerprint()'), ('identity_audit.guard_snapshot()'),
                  ('identity_audit.guard_state_clean()'), ('identity_audit.assert_guards_clean()'),
                  ('identity_audit.finish_guard_transition(jsonb,text[],boolean,boolean)'),
                  ('identity_audit.verify_ledger()'), ('identity_audit.record_anchor()'),
                  ('identity_audit.requests_text_guard()'), ('identity_audit.request_certificates_text_guard()'),
                  ('identity_audit.evidence_gate()'), ('identity_audit.external_evidence_ready()'),
                  ('public.identity_evidence_snapshot()'), ('public.identity_evidence_ack(bigint,bigint,text,text)'),
                  ('public.identity_evidence_heartbeat(text,bigint,text,bigint,text[])')) as f(sig)
   union all
   select 'trg:' || t.rel || '.' || t.name, coalesce((
       select x.tgenabled::text || ':' || pg_catalog.md5(pg_catalog.pg_get_triggerdef(x.oid))
         from pg_catalog.pg_trigger x where x.tgname = t.name and x.tgrelid = pg_catalog.to_regclass(t.rel) and not x.tgisinternal), 'MISSING')
     from (values ('public.certificates', 'trg_certificate_historical_update_guard'),
                  ('public.certificates', 'trg_certificate_legacy_identity_guard'),
                  ('public.certificate_issuance_snapshots', 'trg_snapshot_identity_guard'),
                  ('public.participants', 'trg_participant_identity_guard'),
                  ('identity_audit.corrections', 'corrections_chain'),
                  ('identity_audit.corrections', 'corrections_append_only'),
                  ('identity_audit.corrections', 'corrections_no_truncate'),
                  ('identity_audit.requests', 'requests_guard'),
                  ('identity_audit.requests', 'requests_text_guard'),
                  ('identity_audit.request_certificates', 'request_certificates_text_guard'),
                  ('identity_audit.requests', 'requests_evidence_gate_ins'),
                  ('identity_audit.requests', 'requests_evidence_gate_apply')) as t(rel, name) $$;

create or replace function identity_audit.guard_fingerprint() returns text
language sql stable security definer set search_path = pg_catalog as
$$ select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.string_agg(c.k || ':' || c.v, E'\n' order by c.k, c.v), 'UTF8')), 'hex')
   from identity_audit.guard_components() c $$;

create or replace function identity_audit.guard_snapshot() returns jsonb
language sql stable security definer set search_path = pg_catalog as
$$ select pg_catalog.jsonb_object_agg(c.k, c.v) from identity_audit.guard_components() c $$;

create or replace function identity_audit.record_anchor() returns bigint
language plpgsql security definer set search_path = pg_catalog as $$
declare v_rows bigint; v_head text; v_seq bigint;
begin
  select count(*), (select c.row_hash from identity_audit.corrections c order by c.seq desc limit 1)
    into v_rows, v_head from identity_audit.corrections;
  insert into identity_audit.anchors (ledger_rows, ledger_head, guard_fingerprint)
  values (v_rows, coalesce(v_head, 'GENESIS'), identity_audit.guard_fingerprint()) returning seq into v_seq;
  return v_seq;
end $$;

create or replace function identity_audit.verify_ledger() returns table (check_name text, ok boolean, detail text)
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_bad bigint; v_anchor record; v_actual text; v_fp text := identity_audit.guard_fingerprint(); v_anchored bigint;
begin
  select count(*) into v_bad from (
    select c.*, lag(c.row_hash) over (order by c.seq) as expected_prev from identity_audit.corrections c) r
   where r.row_hash is distinct from identity_audit.compute_row_hash(r.seq, r.request_id, r.target, r.row_id, r.field,
           r.old_fp, r.new_fp, r.old_sealed, r.new_sealed, r.txid, r.applied_by, r.applied_at, r.prev_hash)
      or r.prev_hash is distinct from coalesce(r.expected_prev, 'GENESIS');
  check_name := 'ledger_chain'; ok := v_bad = 0; detail := v_bad || ' broken row(s)'; return next;

  v_bad := 0;
  for v_anchor in select * from identity_audit.anchors order by seq loop
    select r.row_hash into v_actual from (
      select c.row_hash, row_number() over (order by c.seq) as rn from identity_audit.corrections c) r
     where r.rn = v_anchor.ledger_rows;
    if v_anchor.ledger_rows > 0 and v_actual is distinct from v_anchor.ledger_head then v_bad := v_bad + 1; end if;
  end loop;
  check_name := 'anchors_match_ledger'; ok := v_bad = 0; detail := v_bad || ' anchor(s) disagree with the ledger'; return next;

  select a.guard_fingerprint into v_actual from identity_audit.anchors a order by a.seq desc limit 1;
  check_name := 'guard_fingerprint_matches_latest_anchor';
  ok := v_actual is null or v_actual = v_fp;
  detail := case when v_actual is null then 'no anchor yet' when v_actual = v_fp then 'unchanged' else 'guard functions or triggers changed since the latest anchor' end;
  return next;

  -- Every applied correction records an anchor in the same transaction, so ledger rows beyond the latest
  -- anchor mean something wrote to the ledger outside the workflow (a privileged writer is detected here).
  select coalesce((select a.ledger_rows from identity_audit.anchors a order by a.seq desc limit 1), 0) into v_anchored;
  select count(*) into v_bad from identity_audit.corrections;
  check_name := 'no_ledger_rows_beyond_latest_anchor';
  ok := v_bad = v_anchored; detail := (v_bad - v_anchored) || ' ledger row(s) not covered by the latest anchor'; return next;

  check_name := 'guard_triggers_present_and_enabled';
  select count(*) into v_bad from (values ('public.certificates', 'trg_certificate_historical_update_guard', false),
         ('public.certificates', 'trg_certificate_legacy_identity_guard', false),
         ('public.certificate_issuance_snapshots', 'trg_snapshot_identity_guard', false),
         ('public.participants', 'trg_participant_identity_guard', false),
         ('identity_audit.requests', 'requests_text_guard', true),
         ('identity_audit.request_certificates', 'request_certificates_text_guard', true)) as t(rel, name, optional)
   where (not t.optional or pg_catalog.to_regprocedure('identity_audit.requests_text_guard()') is not null)
     and not exists (select 1 from pg_catalog.pg_trigger x where x.tgname = t.name and x.tgrelid = pg_catalog.to_regclass(t.rel)
                        and x.tgenabled = 'O' and not x.tgisinternal);
  ok := v_bad = 0; detail := v_bad || ' guard trigger(s) missing or disabled'; return next;
end $$;

-- ---- free-text identity detection (pure; used by 07 to withhold unsafe text and by 08 to refuse it) -------------
-- The text is FOLDED first (Unicode NFKC, invisible/format characters removed, digits of Arabic-Indic, Extended Arabic-Indic,
-- Devanagari, Bengali, Tamil and Thai scripts mapped to 0-9), then matched. Shapes: IC (6-2-4 digits with up to 3 separator
-- characters of any kind, or 12 contiguous digits), 12 digits each separated by 1-2 characters, 4 groups of 3 digits, and
-- passport numbers (1 letter + 8 digits, 2 letters + 7 digits, optional hyphen). The same folding and rules, with the same
-- test vectors, are in lib/validation/identity-text.ts. Digits of other scripts are NOT recognised (documented limit).
-- translate() source characters, in order, ten digits each starting at: U+0660 Arabic-Indic, U+06F0 Extended Arabic-Indic,
-- U+0966 Devanagari, U+09E6 Bengali, U+0BE6 Tamil, U+0E50 Thai. Format characters removed: U+00AD, U+180E, U+200B-U+200F,
-- U+202A-U+202E, U+2060-U+2064, U+FEFF.
create or replace function identity_audit.fold_text(p_text text) returns text
language sql immutable set search_path = pg_catalog as
$$ select translate(
        regexp_replace(normalize(coalesce(p_text, ''), NFKC), '[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]', '', 'g'),
        '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९০১২৩৪৫৬৭৮৯௦௧௨௩௪௫௬௭௮௯๐๑๒๓๔๕๖๗๘๙',
        '012345678901234567890123456789012345678901234567890123456789') $$;

create or replace function identity_audit.text_has_identity(p_text text) returns boolean
language sql immutable set search_path = pg_catalog as
$$ select coalesce(
        identity_audit.fold_text(p_text) ~ '(^|[^0-9])\d{6}[^A-Za-z0-9]{0,3}\d{2}[^A-Za-z0-9]{0,3}\d{4}([^0-9]|$)'
     or identity_audit.fold_text(p_text) ~ '(^|[^0-9])(\d[^A-Za-z0-9]{1,2}){11}\d([^0-9]|$)'
     or identity_audit.fold_text(p_text) ~ '(^|[^0-9])\d{3}[^A-Za-z0-9]{1,2}\d{3}[^A-Za-z0-9]{1,2}\d{3}[^A-Za-z0-9]{1,2}\d{3}([^0-9]|$)'
     or identity_audit.fold_text(p_text) ~ '(^|[^A-Za-z0-9])[A-Za-z]-?\d{8}([^0-9]|$)'
     or identity_audit.fold_text(p_text) ~ '(^|[^A-Za-z0-9])[A-Za-z]{2}-?\d{7}([^0-9]|$)', false) $$;

create or replace function identity_audit.text_leaks_identity(p_text text, p_identities text[]) returns boolean
language sql immutable set search_path = pg_catalog as
$$ select identity_audit.text_has_identity(p_text)
        or exists (select 1 from unnest(p_identities) i
                    where char_length(identity_audit.norm(identity_audit.fold_text(i))) >= 6
                      and position(identity_audit.norm(identity_audit.fold_text(i)) in identity_audit.norm(identity_audit.fold_text(p_text))) > 0) $$;

create or replace function identity_audit.safe_text(p_text text, p_identities text[]) returns text
language sql immutable set search_path = pg_catalog as
$$ select case when p_text is null then null
               when identity_audit.text_leaks_identity(p_text, p_identities) then '[withheld: may contain an identity number]'
               else p_text end $$;

-- ---- guarded transitions (used by 07 and 08, and by their rollbacks) --------------------------------------------
create or replace function identity_audit.guard_state_clean() returns boolean
language sql stable security definer set search_path = pg_catalog as
$$ select not exists (select 1 from identity_audit.verify_ledger() v where not v.ok) $$;

-- Call BEFORE a migration touches a guard: refuses to build on a ledger or guard set that no longer matches the last anchor.
create or replace function identity_audit.assert_guards_clean() returns void
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if not identity_audit.guard_state_clean() then
    raise exception 'IDC_GUARD_DRIFT: the audit guards or the ledger do not match the last anchor; investigate before changing them. Nothing was changed.' using errcode = 'P0001';
  end if;
end $$;

-- Call AFTER the change. p_expected lists the only component keys (see guard_components) the migration may have changed.
-- Strict (install): any other change raises, which rolls the whole migration back. Not strict (rollback): never blocks,
-- but an unexpected change, or a state that was already unclean, is NOT anchored -- it stays visible to verify_ledger().
-- An anchor is recorded only for a verified, expected transition, and only when an anchor chain already exists.
create or replace function identity_audit.finish_guard_transition(p_before jsonb, p_expected text[], p_was_clean boolean, p_strict boolean) returns text
language plpgsql security definer set search_path = pg_catalog as $$
declare v_after jsonb := identity_audit.guard_snapshot(); v_changed text[]; v_unexpected text[];
begin
  select coalesce(array_agg(x.k order by x.k), '{}') into v_changed from (
    select coalesce(a.key, b.key) as k from jsonb_each_text(v_after) a full join jsonb_each_text(coalesce(p_before, '{}'::jsonb)) b on a.key = b.key
     where a.value is distinct from b.value) x;
  select coalesce(array_agg(c), '{}') into v_unexpected from unnest(v_changed) c where not (c = any (p_expected));
  if cardinality(v_unexpected) > 0 then
    if p_strict then
      raise exception 'IDC_UNEXPECTED_GUARD_CHANGE: this migration changed audit objects it is not allowed to change (%).', array_to_string(v_unexpected, ', ') using errcode = 'P0001';
    end if;
    raise warning 'IDC_UNEXPECTED_GUARD_CHANGE: unexpected audit object change (%); no anchor recorded.', array_to_string(v_unexpected, ', ');
    return 'unanchored';
  end if;
  if cardinality(v_changed) = 0 then return 'unchanged'; end if;
  if not p_was_clean then
    raise warning 'IDC_GUARD_DRIFT: the audit state was not clean before this change; no anchor recorded.';
    return 'unanchored';
  end if;
  if exists (select 1 from identity_audit.anchors) then
    perform identity_audit.record_anchor();
    return 'anchored';
  end if;
  return 'no_anchor_yet';
end $$;

revoke all on all functions in schema identity_audit from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where n.nspname = 'identity_audit' and a.grantee <> p.proowner and a.privilege_type = 'EXECUTE') then
    raise exception 'identity_audit helpers post-check failed: a non-owner can execute an internal function';
  end if;
end $$;
