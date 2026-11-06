-- PROPOSED (local only, NOT applied anywhere): the Super-Admin-only identity-correction workflow.
-- One logical change: assess / request / approve / apply / cancel / enable, as app.* SECURITY DEFINER
-- functions following the existing contract (auth + role check INSIDE the body; thin public.* SQL wrappers;
-- EXECUTE for `authenticated` only, never PUBLIC/anon/service_role).
--
-- Safety properties (each is exercised by scripts/identity-correction/run.sh):
--   * inert until identity_audit.policy.enabled_at is set, which the CHECK constraint only permits once the
--     sealing key, anchor sink and notification sink are configured (decision 8);
--   * the new value is supplied in the request, never as a free parameter of apply;
--   * every certificate of the participant must be listed with an explicit decision; Class C (legacy, IC
--     displayed live from the profile) additionally needs accept_display_change / pin_old / materialize_new;
--   * identity changes need collision + Working-at-Height duplicate-release checks, document-backed evidence
--     (reuse of one document hash for a different participant is refused), a waiting period (PROVISIONAL
--     24h / 72h test defaults) and, if the policy says so, a second Super Admin;
--   * apply is one transaction: ledger row first, then the guarded UPDATE, then a preservation check that no
--     other column of any touched row changed. Any failure rolls everything back.

do $$
begin
  if to_regprocedure('identity_audit.authorized(text,uuid,text,text,text)') is null
     or to_regprocedure('identity_audit.record(uuid,text,uuid,uuid,uuid,text,text,text,uuid)') is null then
    raise exception 'workflow pre-check failed: run 01 and 02 first';
  end if;
  if to_regprocedure('public.log_event(public.audit_action,text,text,text,jsonb)') is null
     and to_regprocedure('app.log_event(public.audit_action,text,text,text,jsonb)') is null then
    raise exception 'workflow pre-check failed: app.log_event is missing';
  end if;
end $$;

create or replace function identity_audit.sha(p text) returns text
language sql immutable set search_path = pg_catalog as
$$ select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(p, '<null>'), 'UTF8')), 'hex') $$;

-- A: has a snapshot. B: legacy with a stored IC. C: legacy whose IC is shown live from the profile. none: nothing to decide.
-- The renderer's live fallback reads ONLY participants.ic_passport_no (certData.ts: snapshot -> certificate -> that column),
-- so a profile that stores its identity only in identity_no does not make a certificate Class C.
create or replace function identity_audit.identity_class(p_certificate uuid) returns text
language sql stable security definer set search_path = pg_catalog as
$$ select case
     when exists (select 1 from public.certificate_issuance_snapshots s where s.certificate_id = c.id) then 'A'
     when nullif(btrim(c.identity_no), '') is not null then 'B'
     when nullif(btrim(p.ic_passport_no), '') is not null then 'C'
     else 'none' end
   from public.certificates c join public.participants p on p.id = c.participant_id where c.id = p_certificate $$;

-- Fingerprints of every identity location of one participant. Taken at request time and compared at
-- apply time: any difference (including a newly issued certificate) makes the request stale.
create or replace function identity_audit.baseline(p_participant uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog as
$$ select pg_catalog.jsonb_build_object(
     'profile', (select pg_catalog.jsonb_build_object('full_name', identity_audit.sha(p.full_name), 'ic', identity_audit.sha(p.ic_passport_no),
                    'identity_no', identity_audit.sha(p.identity_no), 'last4', identity_audit.sha(p.identity_last4), 'deleted', p.deleted_at is not null)
                   from public.participants p where p.id = p_participant),
     'certificates', coalesce((select pg_catalog.jsonb_object_agg(c.id::text, pg_catalog.jsonb_build_object(
                    'holder', identity_audit.sha(c.holder_name), 'pname', identity_audit.sha(c.participant_name),
                    'ic', identity_audit.sha(c.identity_no), 'last4', identity_audit.sha(c.identity_last4),
                    'has_snapshot', s.certificate_id is not null,
                    's_holder', identity_audit.sha(s.holder_name), 's_ic', identity_audit.sha(s.identity_no),
                    's_last4', identity_audit.sha(s.identity_last4),
                    'rp_holder', identity_audit.sha(s.render_payload ->> 'holder_name'),
                    'rp_ic', identity_audit.sha(s.render_payload ->> 'identity_no')))
                   from public.certificates c left join public.certificate_issuance_snapshots s on s.certificate_id = c.id
                  where c.participant_id = p_participant and c.deleted_at is null), '{}'::jsonb)) $$;

create or replace function identity_audit.audit(p_summary text, p_entity text, p_id text, p_meta jsonb) returns void
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform app.log_event('create'::public.audit_action, p_entity, p_id, p_summary, p_meta);
end $$;

-- ---------------------------------------------------------------------------------------------------
create or replace function app.identity_correction_assess(p_participant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not app.is_super_admin() then
    raise exception 'Not authorized to assess identity corrections.' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_build_object(
      'participant_id', p.id,
      'has_ic_passport_no', nullif(btrim(p.ic_passport_no), '') is not null,
      'has_identity_no', nullif(btrim(p.identity_no), '') is not null,
      'open_request_id', (select r.id from identity_audit.requests r where r.participant_id = p.id and r.status = 'pending'),
      'controls_ready', identity_audit.controls_ready(),
      'certificates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'certificate_id', c.id, 'certificate_number', c.certificate_number, 'status', c.status,
            'has_snapshot', s.certificate_id is not null,
            'identity_class', identity_audit.identity_class(c.id),
            'stored_identity_present', nullif(btrim(c.identity_no), '') is not null,
            'public_verification_enabled', c.public_verification_enabled,
            'schedule_enrolled', c.schedule_id is not null and exists (select 1 from public.schedule_participants sp
                where sp.participant_id = c.participant_id and sp.schedule_id = c.schedule_id
                  and sp.deleted_at is null and sp.registration_status <> 'cancelled')) order by c.certificate_number)
          from public.certificates c left join public.certificate_issuance_snapshots s on s.certificate_id = c.id
         where c.participant_id = p.id and c.deleted_at is null), '[]'::jsonb))
    into v_result from public.participants p where p.id = p_participant_id and p.deleted_at is null;
  if v_result is null then raise exception 'Participant not found.' using errcode = 'P0002'; end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------------------------------
create or replace function app.identity_correction_request(
  p_participant_id uuid, p_change_kind text, p_new_full_name text, p_new_identity text,
  p_apply_to_profile boolean, p_reason text, p_evidence jsonb, p_decisions jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_actor uuid := auth.uid();
  v_pol identity_audit.policy%rowtype;
  v_part public.participants%rowtype;
  v_id uuid := gen_random_uuid();
  v_name text := nullif(btrim(p_new_full_name), '');
  v_ic text := nullif(btrim(p_new_identity), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_types text[];
  v_need_types int;
  v_touch_weak boolean := false;
  v_effect boolean := coalesce(p_apply_to_profile, false);
  v_has_gov boolean;
  v_wait interval;
  r record; d jsonb; e jsonb;
  v_name_dec text; v_id_dec text; v_dec_reason text; v_class text;
  v_modifying boolean; v_enrolled boolean; v_seen uuid[] := '{}'; v_rows jsonb := '[]'::jsonb;
  v_n int;
begin
  if v_actor is null or not app.is_super_admin() then
    raise exception 'Not authorized to request identity corrections.' using errcode = '42501';
  end if;
  if not identity_audit.controls_ready() then
    raise exception 'IDC_CONTROLS_NOT_CONFIGURED: the identity-correction controls have not been enabled.' using errcode = 'P0001';
  end if;
  select * into v_pol from identity_audit.policy where singleton;

  if p_change_kind is null or p_change_kind not in ('name', 'identity', 'combined') then
    raise exception 'IDC_BAD_KIND: change kind must be name, identity or combined.' using errcode = 'P0001';
  end if;
  if (p_change_kind = 'name' and (v_name is null or v_ic is not null))
     or (p_change_kind = 'identity' and (v_ic is null or v_name is not null))
     or (p_change_kind = 'combined' and (v_ic is null or v_name is null)) then
    raise exception 'IDC_BAD_VALUES: the supplied new values do not match the change kind.' using errcode = 'P0001';
  end if;
  if p_apply_to_profile is null then
    raise exception 'IDC_BAD_VALUES: apply_to_profile must be explicit.' using errcode = 'P0001';
  end if;
  if char_length(v_reason) < 20 then
    raise exception 'IDC_REASON_REQUIRED: a reason of at least 20 characters is mandatory.' using errcode = 'P0001';
  end if;

  select * into v_part from public.participants where id = p_participant_id and deleted_at is null for update;
  if not found then raise exception 'Participant not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from identity_audit.requests q where q.participant_id = p_participant_id and q.status = 'pending') then
    raise exception 'IDC_REQUEST_ALREADY_OPEN: this participant already has an open correction request.' using errcode = 'P0001';
  end if;

  if v_name is not null then
    if char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
      raise exception 'IDC_BAD_NAME: the new name is too long or contains control characters.' using errcode = 'P0001';
    end if;
    if v_name = btrim(v_part.full_name) then
      raise exception 'IDC_NO_CHANGE: the new name equals the current name.' using errcode = 'P0001';
    end if;
  end if;
  if v_ic is not null then
    if nullif(btrim(v_part.ic_passport_no), '') is null and nullif(btrim(v_part.identity_no), '') is null then
      raise exception 'IDC_NO_EXISTING_IDENTITY: setting a first identity number is not a correction.' using errcode = 'P0001';
    end if;
    if nullif(btrim(v_part.ic_passport_no), '') is not null and nullif(btrim(v_part.identity_no), '') is not null
       and identity_audit.norm(v_part.ic_passport_no) <> identity_audit.norm(v_part.identity_no) then
      raise exception 'IDC_PROFILE_IDENTITY_INCONSISTENT: the profile holds two different identity numbers.' using errcode = 'P0001';
    end if;
    perform identity_audit.validate_identity_change(p_participant_id, v_ic);
  end if;

  -- ---- evidence: document-backed, never string similarity -----------------------------------------
  if p_evidence is null or pg_catalog.jsonb_typeof(p_evidence) <> 'array' or pg_catalog.jsonb_array_length(p_evidence) = 0 then
    raise exception 'IDC_EVIDENCE_REQUIRED: document-backed evidence is mandatory.' using errcode = 'P0001';
  end if;
  for e in select value from pg_catalog.jsonb_array_elements(p_evidence) loop
    if pg_catalog.jsonb_typeof(e) <> 'object'
       or (e ->> 'type') is null or (e ->> 'type') not in ('national_id', 'passport', 'birth_certificate', 'employer_letter',
            'signed_declaration', 'training_registration_form', 'other_official')
       or char_length(btrim(coalesce(e ->> 'reference', ''))) < 3 or char_length(e ->> 'reference') > 120
       or coalesce(e ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
       or coalesce(e ->> 'reviewed_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'IDC_EVIDENCE_INVALID: each evidence item needs a known type, a reference, a sha256 and a reviewed_on date.' using errcode = 'P0001';
    end if;
    if (e ->> 'reviewed_on')::date > current_date then
      raise exception 'IDC_EVIDENCE_INVALID: reviewed_on cannot be in the future.' using errcode = 'P0001';
    end if;
    if exists (select 1 from identity_audit.requests q, pg_catalog.jsonb_array_elements(q.evidence) x
                where q.participant_id <> p_participant_id and x.value ->> 'sha256' = e ->> 'sha256') then
      raise exception 'IDC_EVIDENCE_REUSED: a document already used for a different participant cannot be reused.' using errcode = 'P0001';
    end if;
  end loop;
  select array_agg(distinct x.value ->> 'type') into v_types from pg_catalog.jsonb_array_elements(p_evidence) x;
  v_has_gov := v_types && array['national_id', 'passport', 'birth_certificate'];

  -- ---- explicit decision for EVERY non-deleted certificate ----------------------------------------
  if p_decisions is null or pg_catalog.jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'IDC_DECISION_MISSING: a decision for every certificate is mandatory.' using errcode = 'P0001';
  end if;
  perform 1 from public.certificates where participant_id = p_participant_id and deleted_at is null order by id for update;

  for r in select c.id, c.certificate_number, c.schedule_id from public.certificates c
            where c.participant_id = p_participant_id and c.deleted_at is null order by c.id loop
    select x.value into d from pg_catalog.jsonb_array_elements(p_decisions) x where x.value ->> 'certificate_id' = r.id::text;
    if d is null then
      raise exception 'IDC_DECISION_MISSING: certificate % has no decision.', r.certificate_number using errcode = 'P0001';
    end if;
    v_seen := v_seen || r.id;
    v_class := identity_audit.identity_class(r.id);
    v_name_dec := d ->> 'name_decision';
    v_id_dec := d ->> 'identity_decision';
    v_dec_reason := nullif(btrim(coalesce(d ->> 'reason', '')), '');

    if v_name is not null then
      if v_name_dec is null or v_name_dec not in ('correct', 'leave') then
        raise exception 'IDC_DECISION_INVALID: certificate % needs name_decision correct|leave.', r.certificate_number using errcode = 'P0001';
      end if;
    elsif v_name_dec is not null then
      raise exception 'IDC_DECISION_INVALID: certificate % has a name decision but the request does not change the name.', r.certificate_number using errcode = 'P0001';
    end if;

    if v_ic is not null then
      if v_class in ('A', 'B') then
        if v_id_dec is null or v_id_dec not in ('correct', 'leave') then
          raise exception 'IDC_DECISION_INVALID: certificate % needs identity_decision correct|leave.', r.certificate_number using errcode = 'P0001';
        end if;
      elsif v_class = 'C' then
        if p_apply_to_profile then
          if v_id_dec is null or v_id_dec not in ('accept_display_change', 'pin_old', 'materialize_new') then
            raise exception 'IDC_CLASS_C_DECISION_REQUIRED: legacy certificate % shows its IC live from the profile; choose accept_display_change, pin_old or materialize_new.', r.certificate_number using errcode = 'P0001';
          end if;
        elsif v_id_dec is null or v_id_dec not in ('leave', 'materialize_new') then
          raise exception 'IDC_DECISION_INVALID: legacy certificate % needs identity_decision leave|materialize_new.', r.certificate_number using errcode = 'P0001';
        end if;
      elsif v_id_dec is not null then
        raise exception 'IDC_DECISION_INVALID: certificate % has no identity to decide on.', r.certificate_number using errcode = 'P0001';
      end if;
    elsif v_id_dec is not null then
      raise exception 'IDC_DECISION_INVALID: certificate % has an identity decision but the request does not change the identity.', r.certificate_number using errcode = 'P0001';
    end if;

    v_modifying := v_name_dec = 'correct' or v_id_dec in ('correct', 'materialize_new', 'pin_old', 'accept_display_change');
    if (v_name_dec is not null and v_name_dec <> 'correct') or (v_id_dec is not null and v_id_dec <> 'correct') then
      if v_dec_reason is null or char_length(v_dec_reason) < 10 then
        raise exception 'IDC_DECISION_REASON_REQUIRED: certificate % needs a reason (10+ characters) for a non-default decision.', r.certificate_number using errcode = 'P0001';
      end if;
    end if;
    if v_modifying then
      if v_id_dec in ('correct', 'materialize_new', 'pin_old') or v_name_dec = 'correct' then v_effect := true; end if;
      v_enrolled := r.schedule_id is not null and exists (select 1 from public.schedule_participants sp
          where sp.participant_id = p_participant_id and sp.schedule_id = r.schedule_id
            and sp.deleted_at is null and sp.registration_status <> 'cancelled');
      if v_class in ('B', 'C') or not v_enrolled then v_touch_weak := true; end if;
      if r.schedule_id is not null and not v_enrolled then
        raise exception 'IDC_NOT_ENROLLED: certificate % points to a schedule the participant is not enrolled in.', r.certificate_number using errcode = 'P0001';
      end if;
    end if;
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('certificate_id', r.id, 'identity_class', v_class,
        'name_decision', v_name_dec, 'identity_decision', v_id_dec, 'decision_reason', v_dec_reason));
  end loop;
  if coalesce(array_length(v_seen, 1), 0) = 0 then
    raise exception 'IDC_NO_CERTIFICATES: this participant has no active certificate; use the ordinary profile edit.' using errcode = 'P0001';
  end if;
  select count(*) into v_n from pg_catalog.jsonb_array_elements(p_decisions) x;
  if v_n <> coalesce(array_length(v_seen, 1), 0) then
    raise exception 'IDC_DECISION_FOREIGN_CERT: the decisions list a certificate that is not an active certificate of this participant.' using errcode = 'P0001';
  end if;
  if not v_effect then
    raise exception 'IDC_NO_EFFECT: the request would not change the profile or any certificate.' using errcode = 'P0001';
  end if;

  v_need_types := case when p_change_kind = 'name' and not v_touch_weak then 1 else 2 end;
  if coalesce(array_length(v_types, 1), 0) < v_need_types then
    raise exception 'IDC_EVIDENCE_INSUFFICIENT: at least % different evidence types are required for this request.', v_need_types using errcode = 'P0001';
  end if;
  if p_change_kind in ('identity', 'combined') and not v_has_gov then
    raise exception 'IDC_EVIDENCE_INSUFFICIENT: identity changes need a national_id, passport or birth_certificate document.' using errcode = 'P0001';
  end if;

  v_wait := case when p_change_kind = 'name' and not v_touch_weak then v_pol.wait_name else v_pol.wait_identity end;
  insert into identity_audit.requests (id, participant_id, change_kind, requested_by, earliest_apply_at, apply_to_profile,
      new_full_name, new_identity, reason, evidence, baseline)
  values (v_id, p_participant_id, p_change_kind, v_actor, clock_timestamp() + v_wait, p_apply_to_profile,
      v_name, v_ic, v_reason, p_evidence, identity_audit.baseline(p_participant_id));
  insert into identity_audit.request_certificates (request_id, certificate_id, identity_class, name_decision, identity_decision, decision_reason)
  select v_id, (x.value ->> 'certificate_id')::uuid, x.value ->> 'identity_class', x.value ->> 'name_decision',
         x.value ->> 'identity_decision', x.value ->> 'decision_reason'
    from pg_catalog.jsonb_array_elements(v_rows) x;
  insert into identity_audit.outbox (kind, request_id) values ('request_created', v_id);
  perform identity_audit.audit('Identity correction requested', 'identity_correction_requests', v_id::text,
    pg_catalog.jsonb_build_object('participant_id', p_participant_id, 'change_kind', p_change_kind,
      'certificates', pg_catalog.array_length(v_seen, 1), 'waiting_period', v_wait::text));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
create or replace function app.identity_correction_approve(p_request_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare v_actor uuid := auth.uid(); v_req identity_audit.requests%rowtype;
begin
  if v_actor is null or not app.is_super_admin() then
    raise exception 'Not authorized to approve identity corrections.' using errcode = '42501';
  end if;
  if not identity_audit.controls_ready() then
    raise exception 'IDC_CONTROLS_NOT_CONFIGURED: the identity-correction controls have not been enabled.' using errcode = 'P0001';
  end if;
  select * into v_req from identity_audit.requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then raise exception 'IDC_REQUEST_NOT_PENDING' using errcode = 'P0001'; end if;
  if v_req.requested_by = v_actor then
    raise exception 'IDC_SELF_APPROVAL: the requester cannot be the second approver.' using errcode = '42501';
  end if;
  update identity_audit.requests set second_approver = v_actor, second_approved_at = clock_timestamp() where id = p_request_id;
  perform identity_audit.audit('Identity correction second approval', 'identity_correction_requests', p_request_id::text,
    pg_catalog.jsonb_build_object('participant_id', v_req.participant_id));
end $$;

create or replace function app.identity_correction_cancel(p_request_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare v_actor uuid := auth.uid(); v_req identity_audit.requests%rowtype;
begin
  if v_actor is null or not app.is_super_admin() then
    raise exception 'Not authorized to cancel identity corrections.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'IDC_REASON_REQUIRED: a cancellation reason is mandatory.' using errcode = 'P0001';
  end if;
  select * into v_req from identity_audit.requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then raise exception 'IDC_REQUEST_NOT_PENDING' using errcode = 'P0001'; end if;
  update identity_audit.requests set status = 'cancelled', cancelled_by = v_actor, cancelled_at = clock_timestamp(),
      cancel_reason = btrim(p_reason), new_full_name = null, new_identity = null where id = p_request_id;
  perform identity_audit.audit('Identity correction cancelled', 'identity_correction_requests', p_request_id::text,
    pg_catalog.jsonb_build_object('participant_id', v_req.participant_id));
end $$;

-- ---------------------------------------------------------------------------------------------------
create or replace function app.identity_correction_apply(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_actor uuid := auth.uid();
  v_txid bigint := pg_catalog.pg_current_xact_id()::text::bigint;
  v_pol identity_audit.policy%rowtype;
  v_req identity_audit.requests%rowtype;
  v_part public.participants%rowtype;
  v_c public.certificates%rowtype; v_c2 public.certificates%rowtype;
  v_s public.certificate_issuance_snapshots%rowtype; v_s2 public.certificate_issuance_snapshots%rowtype;
  rc identity_audit.request_certificates%rowtype;
  v_new_name text; v_new_ic text; v_new_l4 text;
  v_tgt_ic text; v_set_name boolean; v_set_ic boolean; v_set_l4 boolean;
  v_rp jsonb; v_rp_changed boolean; v_snap_changed boolean;
  v_cert_n int := 0; v_snap_n int := 0; v_ledger_n int := 0; v_rows int;
  v_expected_l4 text; v_clean text;
  v_pre jsonb; v_post jsonb;
  k_c_skip text[] := array['holder_name', 'participant_name', 'identity_no', 'identity_last4', 'updated_at'];
  k_s_skip text[] := array['holder_name', 'identity_no', 'identity_last4', 'render_payload'];
begin
  if v_actor is null or not app.is_super_admin() then
    raise exception 'Not authorized to apply identity corrections.' using errcode = '42501';
  end if;
  if not identity_audit.controls_ready() then
    raise exception 'IDC_CONTROLS_NOT_CONFIGURED: the identity-correction controls have not been enabled.' using errcode = 'P0001';
  end if;
  select * into v_pol from identity_audit.policy where singleton;
  select * into v_req from identity_audit.requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then raise exception 'IDC_REQUEST_NOT_PENDING' using errcode = 'P0001'; end if;
  if v_pol.require_second_approver and (v_req.second_approver is null or v_req.second_approver = v_req.requested_by) then
    raise exception 'IDC_SECOND_APPROVAL_REQUIRED' using errcode = 'P0001';
  end if;
  if clock_timestamp() < v_req.earliest_apply_at then
    raise exception 'IDC_WAITING_PERIOD: this request cannot be applied before %.', v_req.earliest_apply_at using errcode = 'P0001';
  end if;

  select * into v_part from public.participants where id = v_req.participant_id for update;
  if not found or v_part.deleted_at is not null then
    raise exception 'IDC_STALE_REQUEST: the participant is no longer active.' using errcode = 'P0001';
  end if;
  perform 1 from public.certificates where participant_id = v_part.id and deleted_at is null order by id for update;
  if identity_audit.baseline(v_part.id) is distinct from v_req.baseline then
    raise exception 'IDC_STALE_REQUEST: the participant or a certificate changed after the request was made.' using errcode = 'P0001';
  end if;

  v_new_name := v_req.new_full_name;
  v_new_ic := v_req.new_identity;
  if v_new_ic is not null then
    perform identity_audit.validate_identity_change(v_part.id, v_new_ic);
    v_clean := identity_audit.norm(v_new_ic);
    v_new_l4 := case when char_length(v_clean) >= 4 then upper(right(v_clean, 4)) end;
  end if;

  update identity_audit.requests set applying_txid = v_txid where id = p_request_id;

  for rc in select q.* from identity_audit.request_certificates q where q.request_id = p_request_id order by q.certificate_id loop
    select * into v_c from public.certificates where id = rc.certificate_id;
    select * into v_s from public.certificate_issuance_snapshots where certificate_id = rc.certificate_id;
    v_pre := pg_catalog.to_jsonb(v_c) - k_c_skip;
    v_set_name := rc.name_decision = 'correct';
    v_tgt_ic := case rc.identity_decision when 'correct' then v_new_ic when 'materialize_new' then v_new_ic
                  when 'pin_old' then nullif(btrim(v_part.ic_passport_no), '') end;
    v_set_ic := v_tgt_ic is not null and (
        (rc.identity_decision = 'correct' and nullif(btrim(v_c.identity_no), '') is not null)
        or (rc.identity_decision in ('materialize_new', 'pin_old') and nullif(btrim(v_c.identity_no), '') is null));
    v_set_ic := v_set_ic and v_c.identity_no is distinct from v_tgt_ic;
    v_set_l4 := rc.identity_decision = 'correct' and v_set_ic and v_c.identity_last4 is not null
                and v_new_l4 is not null and v_c.identity_last4 is distinct from v_new_l4;

    if v_set_name and v_c.holder_name is distinct from v_new_name then
      perform identity_audit.record(p_request_id, 'certificate', v_c.id, v_c.id, v_part.id, 'holder_name', v_c.holder_name, v_new_name, v_actor);
      v_ledger_n := v_ledger_n + 1;
    end if;
    if v_set_name and v_c.participant_name is distinct from v_new_name then
      perform identity_audit.record(p_request_id, 'certificate', v_c.id, v_c.id, v_part.id, 'participant_name', v_c.participant_name, v_new_name, v_actor);
      v_ledger_n := v_ledger_n + 1;
    end if;
    if v_set_ic then
      perform identity_audit.record(p_request_id, 'certificate', v_c.id, v_c.id, v_part.id, 'identity_no', v_c.identity_no, v_tgt_ic, v_actor);
      v_ledger_n := v_ledger_n + 1;
    end if;
    if v_set_l4 then
      perform identity_audit.record(p_request_id, 'certificate', v_c.id, v_c.id, v_part.id, 'identity_last4', v_c.identity_last4, v_new_l4, v_actor);
      v_ledger_n := v_ledger_n + 1;
    end if;
    if v_set_name or v_set_ic or v_set_l4 then
      update public.certificates set
          holder_name = case when v_set_name then v_new_name else holder_name end,
          participant_name = case when v_set_name then v_new_name else participant_name end,
          identity_no = case when v_set_ic then v_tgt_ic else identity_no end,
          identity_last4 = case when v_set_l4 then v_new_l4 else identity_last4 end
        where id = v_c.id;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then raise exception 'IDC_APPLY_FAILED: certificate update affected % rows.', v_rows using errcode = 'P0001'; end if;
      v_cert_n := v_cert_n + 1;
    end if;

    -- Snapshot (Class A) follows the certificate for the fields that were corrected on it.
    if v_s.certificate_id is not null and rc.identity_class = 'A' then
      v_rp := v_s.render_payload; v_rp_changed := false; v_snap_changed := false;
      v_pre := v_pre || pg_catalog.jsonb_build_object('_snap', pg_catalog.to_jsonb(v_s) - k_s_skip, '_rp', v_s.render_payload - array['holder_name', 'identity_no']);
      if v_set_name then
        if v_s.holder_name is distinct from v_new_name then
          perform identity_audit.record(p_request_id, 'snapshot', v_c.id, v_c.id, v_part.id, 'holder_name', v_s.holder_name, v_new_name, v_actor);
          v_ledger_n := v_ledger_n + 1; v_snap_changed := true;
        end if;
        if v_s.render_payload ? 'holder_name' and (v_s.render_payload ->> 'holder_name') is distinct from v_new_name then
          perform identity_audit.record(p_request_id, 'snapshot_render_payload', v_c.id, v_c.id, v_part.id, 'holder_name', v_s.render_payload ->> 'holder_name', v_new_name, v_actor);
          v_ledger_n := v_ledger_n + 1;
          v_rp := pg_catalog.jsonb_set(v_rp, '{holder_name}', pg_catalog.to_jsonb(v_new_name)); v_rp_changed := true;
        end if;
      end if;
      if rc.identity_decision = 'correct' and v_new_ic is not null then
        if nullif(btrim(v_s.identity_no), '') is not null and v_s.identity_no is distinct from v_new_ic then
          perform identity_audit.record(p_request_id, 'snapshot', v_c.id, v_c.id, v_part.id, 'identity_no', v_s.identity_no, v_new_ic, v_actor);
          v_ledger_n := v_ledger_n + 1; v_snap_changed := true;
        end if;
        if v_s.identity_last4 is not null and v_new_l4 is not null and v_s.identity_last4 is distinct from v_new_l4 then
          perform identity_audit.record(p_request_id, 'snapshot', v_c.id, v_c.id, v_part.id, 'identity_last4', v_s.identity_last4, v_new_l4, v_actor);
          v_ledger_n := v_ledger_n + 1; v_snap_changed := true;
        end if;
        if v_s.render_payload ? 'identity_no' and (v_s.render_payload ->> 'identity_no') is distinct from v_new_ic then
          perform identity_audit.record(p_request_id, 'snapshot_render_payload', v_c.id, v_c.id, v_part.id, 'identity_no', v_s.render_payload ->> 'identity_no', v_new_ic, v_actor);
          v_ledger_n := v_ledger_n + 1;
          v_rp := pg_catalog.jsonb_set(v_rp, '{identity_no}', pg_catalog.to_jsonb(v_new_ic)); v_rp_changed := true;
        end if;
      end if;
      if v_snap_changed or v_rp_changed then
        update public.certificate_issuance_snapshots set
            holder_name = case when v_set_name then v_new_name else holder_name end,
            identity_no = case when rc.identity_decision = 'correct' and v_new_ic is not null and nullif(btrim(identity_no), '') is not null then v_new_ic else identity_no end,
            identity_last4 = case when rc.identity_decision = 'correct' and v_new_l4 is not null and identity_last4 is not null then v_new_l4 else identity_last4 end,
            render_payload = v_rp
          where certificate_id = v_c.id;
        get diagnostics v_rows = row_count;
        if v_rows <> 1 then raise exception 'IDC_APPLY_FAILED: snapshot update affected % rows.', v_rows using errcode = 'P0001'; end if;
        v_snap_n := v_snap_n + 1;
      end if;
    end if;

    -- Preservation: nothing but the corrected identity fields may differ on any touched row.
    select * into v_c2 from public.certificates where id = rc.certificate_id;
    if (pg_catalog.to_jsonb(v_c2) - k_c_skip) is distinct from (v_pre - array['_snap', '_rp']) then
      raise exception 'IDC_PRESERVATION_FAILED: a non-identity certificate column changed.' using errcode = 'P0001';
    end if;
    if v_pre ? '_snap' then
      select * into v_s2 from public.certificate_issuance_snapshots where certificate_id = rc.certificate_id;
      if (pg_catalog.to_jsonb(v_s2) - k_s_skip) is distinct from (v_pre -> '_snap')
         or (v_s2.render_payload - array['holder_name', 'identity_no']) is distinct from (v_pre -> '_rp') then
        raise exception 'IDC_PRESERVATION_FAILED: a non-identity snapshot column changed.' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  if v_req.apply_to_profile then
    if v_new_name is not null and v_part.full_name is distinct from v_new_name then
      perform identity_audit.record(p_request_id, 'participant', v_part.id, null, v_part.id, 'full_name', v_part.full_name, v_new_name, v_actor);
      v_ledger_n := v_ledger_n + 1;
    end if;
    if v_new_ic is not null then
      if nullif(btrim(v_part.ic_passport_no), '') is not null then
        perform identity_audit.record(p_request_id, 'participant', v_part.id, null, v_part.id, 'ic_passport_no', v_part.ic_passport_no, v_new_ic, v_actor);
        v_ledger_n := v_ledger_n + 1;
      end if;
      if nullif(btrim(v_part.identity_no), '') is not null then
        perform identity_audit.record(p_request_id, 'participant', v_part.id, null, v_part.id, 'identity_no', v_part.identity_no, v_new_ic, v_actor);
        v_ledger_n := v_ledger_n + 1;
        -- sync_participant_last4() derives identity_last4 from identity_no; authorise exactly that value.
        v_expected_l4 := case when char_length(v_clean) >= 4 then upper(right(v_clean, 4)) else v_part.identity_last4 end;
        if v_expected_l4 is distinct from v_part.identity_last4 then
          perform identity_audit.record(p_request_id, 'participant', v_part.id, null, v_part.id, 'identity_last4', v_part.identity_last4, v_expected_l4, v_actor);
          v_ledger_n := v_ledger_n + 1;
        end if;
      end if;
    end if;
    update public.participants set
        full_name = case when v_new_name is not null then v_new_name else full_name end,
        ic_passport_no = case when v_new_ic is not null and nullif(btrim(ic_passport_no), '') is not null then v_new_ic else ic_passport_no end,
        identity_no = case when v_new_ic is not null and nullif(btrim(identity_no), '') is not null then v_new_ic else identity_no end
      where id = v_part.id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'IDC_APPLY_FAILED: participant update affected % rows.', v_rows using errcode = 'P0001'; end if;
  end if;

  update identity_audit.requests set status = 'applied', applied_by = v_actor, applied_at = clock_timestamp(),
      new_full_name = null, new_identity = null where id = p_request_id;
  insert into identity_audit.outbox (kind, request_id) values ('request_applied', p_request_id);
  perform identity_audit.record_anchor();
  perform identity_audit.audit('Identity correction applied', 'identity_correction_requests', p_request_id::text,
    pg_catalog.jsonb_build_object('participant_id', v_part.id, 'certificates_corrected', v_cert_n,
      'snapshots_corrected', v_snap_n, 'profile_updated', v_req.apply_to_profile, 'ledger_rows', v_ledger_n));
  return pg_catalog.jsonb_build_object('request_id', p_request_id, 'certificates_corrected', v_cert_n,
    'snapshots_corrected', v_snap_n, 'profile_updated', v_req.apply_to_profile, 'ledger_rows', v_ledger_n);
end $$;

-- ---------------------------------------------------------------------------------------------------
create or replace function app.identity_correction_enable() returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare v_pol identity_audit.policy%rowtype;
begin
  if auth.uid() is null or not app.is_super_admin() then
    raise exception 'Not authorized to enable identity corrections.' using errcode = '42501';
  end if;
  select * into v_pol from identity_audit.policy where singleton for update;
  if v_pol.sealing_public_key is null or v_pol.anchor_sink_configured_at is null or v_pol.notification_sink_configured_at is null then
    raise exception 'IDC_CONTROLS_NOT_CONFIGURED: sealing key, anchor sink and notification sink must be configured first.' using errcode = 'P0001';
  end if;
  begin
    perform extensions.pgp_pub_encrypt('identity-correction-selftest', extensions.dearmor(v_pol.sealing_public_key));
  exception when others then
    raise exception 'IDC_SEALING_KEY_INVALID: the configured sealing key cannot encrypt.' using errcode = 'P0001';
  end;
  update identity_audit.policy set enabled_at = clock_timestamp(), updated_at = clock_timestamp() where singleton;
  perform identity_audit.audit('Identity correction workflow enabled', 'identity_correction_policy', 'singleton', '{}'::jsonb);
end $$;

create or replace function app.identity_correction_disable() returns void
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if auth.uid() is null or not app.is_super_admin() then
    raise exception 'Not authorized to disable identity corrections.' using errcode = '42501';
  end if;
  update identity_audit.policy set enabled_at = null, updated_at = clock_timestamp() where singleton;
  perform identity_audit.audit('Identity correction workflow disabled', 'identity_correction_policy', 'singleton', '{}'::jsonb);
end $$;

-- ---- public wrappers (same contract as public.revoke_certificate) --------------------------------------
create or replace function public.identity_correction_assess(p_participant_id uuid) returns jsonb
language sql stable set search_path = pg_catalog, app as $$ select app.identity_correction_assess(p_participant_id) $$;
create or replace function public.identity_correction_request(
  p_participant_id uuid, p_change_kind text, p_new_full_name text, p_new_identity text,
  p_apply_to_profile boolean, p_reason text, p_evidence jsonb, p_decisions jsonb) returns uuid
language sql set search_path = pg_catalog, app as
$$ select app.identity_correction_request(p_participant_id, p_change_kind, p_new_full_name, p_new_identity, p_apply_to_profile, p_reason, p_evidence, p_decisions) $$;
create or replace function public.identity_correction_approve(p_request_id uuid) returns void
language sql set search_path = pg_catalog, app as $$ select app.identity_correction_approve(p_request_id) $$;
create or replace function public.identity_correction_cancel(p_request_id uuid, p_reason text) returns void
language sql set search_path = pg_catalog, app as $$ select app.identity_correction_cancel(p_request_id, p_reason) $$;
create or replace function public.identity_correction_apply(p_request_id uuid) returns jsonb
language sql set search_path = pg_catalog, app as $$ select app.identity_correction_apply(p_request_id) $$;
create or replace function public.identity_correction_enable() returns void
language sql set search_path = pg_catalog, app as $$ select app.identity_correction_enable() $$;
create or replace function public.identity_correction_disable() returns void
language sql set search_path = pg_catalog, app as $$ select app.identity_correction_disable() $$;

-- ---- privileges: authenticated only (each body re-checks Super Admin) ---------------------------------
revoke all on function
  app.identity_correction_assess(uuid), app.identity_correction_request(uuid, text, text, text, boolean, text, jsonb, jsonb),
  app.identity_correction_approve(uuid), app.identity_correction_cancel(uuid, text), app.identity_correction_apply(uuid),
  app.identity_correction_enable(), app.identity_correction_disable(),
  public.identity_correction_assess(uuid), public.identity_correction_request(uuid, text, text, text, boolean, text, jsonb, jsonb),
  public.identity_correction_approve(uuid), public.identity_correction_cancel(uuid, text), public.identity_correction_apply(uuid),
  public.identity_correction_enable(), public.identity_correction_disable()
  from public, anon, authenticated, service_role;
grant execute on function
  app.identity_correction_assess(uuid), app.identity_correction_request(uuid, text, text, text, boolean, text, jsonb, jsonb),
  app.identity_correction_approve(uuid), app.identity_correction_cancel(uuid, text), app.identity_correction_apply(uuid),
  app.identity_correction_enable(), app.identity_correction_disable(),
  public.identity_correction_assess(uuid), public.identity_correction_request(uuid, text, text, text, boolean, text, jsonb, jsonb),
  public.identity_correction_approve(uuid), public.identity_correction_cancel(uuid, text), public.identity_correction_apply(uuid),
  public.identity_correction_enable(), public.identity_correction_disable()
  to authenticated;
revoke all on all functions in schema identity_audit from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.proname like 'identity_correction\_%' and n.nspname in ('app', 'public')
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
                and a.grantee <> (select oid from pg_roles where rolname = 'authenticated')) then
    raise exception 'workflow post-check failed: a role other than authenticated can execute a workflow function';
  end if;
end $$;
