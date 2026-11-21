-- PROPOSED (local only, NOT applied anywhere): read-only RPCs and a `reject` action for the identity-correction UI.
-- One logical change: what the Super Admin screen needs that 01-06 do not provide.
--   * the API roles have no privilege on schema identity_audit, so the UI cannot read requests or history
--     directly; these functions are the only read path (app.* SECURITY DEFINER + thin public.* wrappers,
--     same contract as 03, Super Admin re-checked inside every body, EXECUTE for `authenticated` only);
--   * a request can be declined by a reviewer: status `rejected` (cancel stays "withdrawn by the requester").
--     The closure columns cancelled_by / cancelled_at / cancel_reason are reused, so the immutability
--     whitelist of requests_guard does not widen.
--
-- What the read functions never return: sealed old/new values, salts, fingerprints, a full IC/Passport
-- number, or evidence document hashes beyond a 12-character prefix. A pending request's new IC is shown
-- masked (last four characters); the new name is shown in full because the requester typed it.
--
-- Audit-anchor integrity: the whole file is ONE transaction. It first refuses to run on a ledger or guard set that no
-- longer matches the last anchor (IDC_GUARD_DRIFT), then, after its changes, proves that the only audit object it changed
-- is identity_audit.requests_guard() (and only on an installation made with the earlier 01) before it records the matching
-- anchor. Any other difference raises and rolls everything back, so unrelated changes are never silently approved. On a
-- fresh install (01 already final) nothing changes and no anchor is recorded.
-- Unsafe historical text: get_request withholds any free text that looks like, or contains, an identity number
-- (identity_audit.safe_text) instead of returning it. Nothing is deleted or rewritten.

begin;

do $$
begin
  if to_regprocedure('app.identity_correction_cancel(uuid,text)') is null
     or to_regprocedure('identity_audit.baseline(uuid)') is null
     or to_regprocedure('identity_audit.identity_class(uuid)') is null
     or to_regclass('identity_audit.requests') is null
     or to_regprocedure('identity_audit.finish_guard_transition(jsonb,text[],boolean,boolean)') is null
     or to_regprocedure('identity_audit.safe_text(text,text[])') is null then
    raise exception 'read/reject pre-check failed: run 01 to 03 (with the current 02) first';
  end if;
end $$;

-- refuse to build on drift (raises IDC_GUARD_DRIFT), then remember the state this migration started from
select identity_audit.assert_guards_clean();
create temporary table _idc_before on commit drop as select identity_audit.guard_snapshot() as snap;

-- ---- status `rejected` (upgrade path) ----------------------------------------------------------------------
-- 01 now creates the table with the `rejected` status and the final requests_guard(), so on a fresh install the next
-- two statements change nothing. They exist for an installation made with the earlier 01 (three statuses, older guard).
-- Keeping the guard body identical to 01's means re-running 01 after 07 can never downgrade it.
alter table identity_audit.requests drop constraint if exists requests_status_check;
alter table identity_audit.requests add constraint requests_status_check
  check (status in ('pending', 'applied', 'cancelled', 'rejected'));

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
  if new.status in ('applied', 'cancelled', 'rejected') and (new.new_full_name is not null or new.new_identity is not null) then
    raise exception 'identity_audit terminal requests must not retain the new values' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---- internal helper: masked identity (never the full number) ----------------------------------------
create or replace function identity_audit.mask(p text) returns text
language sql immutable set search_path = pg_catalog as
$$ select case when nullif(identity_audit.norm(p), '') is null then null
               when char_length(identity_audit.norm(p)) <= 4 then '****'
               else '****' || right(identity_audit.norm(p), 4) end $$;

-- ---- reject --------------------------------------------------------------------------------------------
create or replace function app.identity_correction_reject(p_request_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare v_actor uuid := auth.uid(); v_req identity_audit.requests%rowtype;
begin
  if v_actor is null or not app.is_super_admin() then
    raise exception 'Not authorized to reject identity corrections.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'IDC_REASON_REQUIRED: a rejection reason is mandatory.' using errcode = 'P0001';
  end if;
  select * into v_req from identity_audit.requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then raise exception 'IDC_REQUEST_NOT_PENDING' using errcode = 'P0001'; end if;
  update identity_audit.requests set status = 'rejected', cancelled_by = v_actor, cancelled_at = clock_timestamp(),
      cancel_reason = btrim(p_reason), new_full_name = null, new_identity = null where id = p_request_id;
  insert into identity_audit.outbox (kind, request_id) values ('request_rejected', p_request_id);
  perform identity_audit.audit('Identity correction rejected', 'identity_correction_requests', p_request_id::text,
    pg_catalog.jsonb_build_object('participant_id', v_req.participant_id));
end $$;

-- ---- read: policy / readiness banner -------------------------------------------------------------------
create or replace function app.identity_correction_policy() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v identity_audit.policy%rowtype;
begin
  if auth.uid() is null or not app.is_super_admin() then
    raise exception 'Not authorized to read the identity-correction policy.' using errcode = '42501';
  end if;
  select * into v from identity_audit.policy where singleton;
  return pg_catalog.jsonb_build_object(
    'controls_ready', identity_audit.controls_ready(),
    'wait_name_hours', extract(epoch from v.wait_name) / 3600,
    'wait_identity_hours', extract(epoch from v.wait_identity) / 3600,
    'require_second_approver', v.require_second_approver,
    'sealing_key_configured', v.sealing_public_key is not null,
    'anchor_sink_configured', v.anchor_sink_configured_at is not null,
    'notification_sink_configured', v.notification_sink_configured_at is not null);
end $$;

-- ---- read: find a certificate to correct (sanitised, minimum 3 characters, at most 20 rows) ------------
create or replace function app.identity_correction_search_certificates(p_query text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_q text; v_result jsonb;
begin
  if auth.uid() is null or not app.is_super_admin() then
    raise exception 'Not authorized to search certificates for identity correction.' using errcode = '42501';
  end if;
  -- structural / wildcard characters become spaces so user input cannot widen the match
  v_q := btrim(pg_catalog.regexp_replace(coalesce(p_query, ''), '[%_,()\\]', ' ', 'g'));
  if char_length(v_q) < 3 or char_length(v_q) > 60 then
    raise exception 'IDC_QUERY_INVALID: enter between 3 and 60 characters of the certificate number.' using errcode = 'P0001';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'certificate_id', x.id, 'certificate_number', x.certificate_number, 'status', x.status, 'course_name', x.course_name,
      'issue_date', x.issue_date, 'participant_id', x.participant_id, 'participant_code', x.participant_code,
      'holder_name', x.holder, 'identity_masked', identity_audit.mask(x.ident),
      'identity_class', identity_audit.identity_class(x.id),
      'open_request_id', (select r.id from identity_audit.requests r where r.participant_id = x.participant_id and r.status = 'pending'))
      order by x.certificate_number), '[]'::jsonb)
    into v_result
    from (select c.id, c.certificate_number, c.status, c.course_name, c.issue_date, c.participant_id, p.participant_code,
                 coalesce(c.holder_name, c.participant_name) as holder,
                 coalesce(nullif(btrim(c.identity_no), ''), nullif(btrim(p.ic_passport_no), ''), nullif(btrim(p.identity_no), '')) as ident
            from public.certificates c join public.participants p on p.id = c.participant_id
           where c.deleted_at is null and c.certificate_number ilike '%' || v_q || '%'
           order by c.certificate_number limit 20) x;
  return v_result;
end $$;

-- ---- read: request list --------------------------------------------------------------------------------
create or replace function app.identity_correction_list_requests(p_status text default null, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_result jsonb; v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null or not app.is_super_admin() then
    raise exception 'Not authorized to list identity corrections.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('pending', 'applied', 'cancelled', 'rejected') then
    raise exception 'IDC_BAD_STATUS: status must be pending, applied, cancelled or rejected.' using errcode = 'P0001';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', r.id, 'participant_id', r.participant_id, 'participant_code', p.participant_code, 'change_kind', r.change_kind,
      'status', r.status, 'requested_by', r.requested_by, 'requested_at', r.requested_at, 'earliest_apply_at', r.earliest_apply_at,
      'apply_to_profile', r.apply_to_profile,
      'certificate_count', (select count(*) from identity_audit.request_certificates rc where rc.request_id = r.id),
      'second_approved', r.second_approver is not null,
      'closed_at', coalesce(r.applied_at, r.cancelled_at)) order by r.requested_at desc), '[]'::jsonb)
    into v_result
    from (select * from identity_audit.requests q where p_status is null or q.status = p_status
           order by q.requested_at desc limit v_limit) r
    join public.participants p on p.id = r.participant_id;
  return v_result;
end $$;

-- ---- read: one request ---------------------------------------------------------------------------------
create or replace function app.identity_correction_get_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare
  r identity_audit.requests%rowtype; v_pol identity_audit.policy%rowtype; v_code text; v_ids text[];
  v_stale boolean; v_wait_done boolean; v_second_ok boolean;
begin
  if auth.uid() is null or not app.is_super_admin() then
    raise exception 'Not authorized to read identity corrections.' using errcode = '42501';
  end if;
  select * into r from identity_audit.requests where id = p_request_id;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  select * into v_pol from identity_audit.policy where singleton;
  select p.participant_code, array[r.new_identity, p.ic_passport_no, p.identity_no] into v_code, v_ids from public.participants p where p.id = r.participant_id;
  v_stale := r.status = 'pending' and identity_audit.baseline(r.participant_id) is distinct from r.baseline;
  v_wait_done := clock_timestamp() >= r.earliest_apply_at;
  v_second_ok := not v_pol.require_second_approver or (r.second_approver is not null and r.second_approver <> r.requested_by);
  return pg_catalog.jsonb_build_object(
    'id', r.id, 'participant_id', r.participant_id, 'participant_code', v_code, 'change_kind', r.change_kind, 'status', r.status,
    'requested_by', r.requested_by, 'requested_at', r.requested_at, 'earliest_apply_at', r.earliest_apply_at,
    'waiting_elapsed', v_wait_done, 'apply_to_profile', r.apply_to_profile, 'reason', identity_audit.safe_text(r.reason, v_ids),
    'new_full_name', r.new_full_name, 'new_identity_masked', identity_audit.mask(r.new_identity),
    'requires_second_approval', v_pol.require_second_approver, 'second_approver', r.second_approver, 'second_approved_at', r.second_approved_at,
    'applied_by', r.applied_by, 'applied_at', r.applied_at,
    'closed_by', r.cancelled_by, 'closed_at', r.cancelled_at, 'closure_reason', identity_audit.safe_text(r.cancel_reason, v_ids),
    'stale', v_stale,
    'can_apply', r.status = 'pending' and v_wait_done and not v_stale and v_second_ok and identity_audit.controls_ready(),
    'evidence', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'type', e.value ->> 'type', 'reference', identity_audit.safe_text(e.value ->> 'reference', v_ids), 'reviewed_on', e.value ->> 'reviewed_on',
          'sha256_prefix', left(e.value ->> 'sha256', 12)))
        from pg_catalog.jsonb_array_elements(r.evidence) e), '[]'::jsonb),
    'certificates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'certificate_id', rc.certificate_id, 'certificate_number', c.certificate_number, 'identity_class', rc.identity_class,
          'name_decision', rc.name_decision, 'identity_decision', rc.identity_decision, 'decision_reason', identity_audit.safe_text(rc.decision_reason, v_ids))
          order by c.certificate_number)
        from identity_audit.request_certificates rc join public.certificates c on c.id = rc.certificate_id
       where rc.request_id = r.id), '[]'::jsonb));
end $$;

-- ---- read: correction history of one certificate (who/when/which field -- never values) ---------------
create or replace function app.identity_correction_history(p_certificate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  if auth.uid() is null or not app.is_super_admin() then
    raise exception 'Not authorized to read identity-correction history.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.certificates c where c.id = p_certificate_id) then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  return pg_catalog.jsonb_build_object(
    'certificate_id', p_certificate_id,
    'requests', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'request_id', r.id, 'status', r.status, 'change_kind', r.change_kind, 'requested_at', r.requested_at, 'requested_by', r.requested_by,
          'closed_at', coalesce(r.applied_at, r.cancelled_at), 'identity_class', rc.identity_class,
          'name_decision', rc.name_decision, 'identity_decision', rc.identity_decision) order by r.requested_at desc)
        from identity_audit.request_certificates rc join identity_audit.requests r on r.id = rc.request_id
       where rc.certificate_id = p_certificate_id), '[]'::jsonb),
    'ledger', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'seq', k.seq, 'request_id', k.request_id, 'target', k.target, 'field', k.field,
          'applied_by', k.applied_by, 'applied_at', k.applied_at) order by k.seq desc)
        from identity_audit.corrections k where k.certificate_id = p_certificate_id), '[]'::jsonb));
end $$;

-- ---- public wrappers (same contract as 03) ---------------------------------------------------------------
create or replace function public.identity_correction_reject(p_request_id uuid, p_reason text) returns void
language sql set search_path = pg_catalog, app as $$ select app.identity_correction_reject(p_request_id, p_reason) $$;
create or replace function public.identity_correction_policy() returns jsonb
language sql stable set search_path = pg_catalog, app as $$ select app.identity_correction_policy() $$;
create or replace function public.identity_correction_search_certificates(p_query text) returns jsonb
language sql stable set search_path = pg_catalog, app as $$ select app.identity_correction_search_certificates(p_query) $$;
create or replace function public.identity_correction_list_requests(p_status text default null, p_limit integer default 50) returns jsonb
language sql stable set search_path = pg_catalog, app as $$ select app.identity_correction_list_requests(p_status, p_limit) $$;
create or replace function public.identity_correction_get_request(p_request_id uuid) returns jsonb
language sql stable set search_path = pg_catalog, app as $$ select app.identity_correction_get_request(p_request_id) $$;
create or replace function public.identity_correction_history(p_certificate_id uuid) returns jsonb
language sql stable set search_path = pg_catalog, app as $$ select app.identity_correction_history(p_certificate_id) $$;

-- ---- privileges: authenticated only (each body re-checks Super Admin) -----------------------------------
revoke all on function
  app.identity_correction_reject(uuid, text), app.identity_correction_policy(), app.identity_correction_search_certificates(text),
  app.identity_correction_list_requests(text, integer), app.identity_correction_get_request(uuid), app.identity_correction_history(uuid),
  public.identity_correction_reject(uuid, text), public.identity_correction_policy(), public.identity_correction_search_certificates(text),
  public.identity_correction_list_requests(text, integer), public.identity_correction_get_request(uuid), public.identity_correction_history(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  app.identity_correction_reject(uuid, text), app.identity_correction_policy(), app.identity_correction_search_certificates(text),
  app.identity_correction_list_requests(text, integer), app.identity_correction_get_request(uuid), app.identity_correction_history(uuid),
  public.identity_correction_reject(uuid, text), public.identity_correction_policy(), public.identity_correction_search_certificates(text),
  public.identity_correction_list_requests(text, integer), public.identity_correction_get_request(uuid), public.identity_correction_history(uuid)
  to authenticated;
revoke all on all functions in schema identity_audit from public, anon, authenticated, service_role;

-- the only audit object this migration may change is requests_guard() (and only on an installation made with the earlier 01)
select identity_audit.finish_guard_transition((select snap from _idc_before), array['fn:identity_audit.requests_guard()'], true, true);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.proname like 'identity_correction\_%' and n.nspname in ('app', 'public')
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
                and a.grantee <> (select oid from pg_roles where rolname = 'authenticated')) then
    raise exception 'read/reject post-check failed: a role other than authenticated can execute a workflow function';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where n.nspname = 'identity_audit' and a.grantee <> p.proowner and a.privilege_type = 'EXECUTE') then
    raise exception 'read/reject post-check failed: a non-owner can execute an internal function';
  end if;
end $$;

commit;
