-- I3A end-to-end lifecycle probe for an isolated local PostgreSQL 17 instance.
-- Run as a disposable bootstrap owner; lifecycle calls run as authenticated.
-- All fixture writes are rolled back. With -v render_fixture=1, emits one
-- machine-readable synthetic render record; the harness must keep it in memory.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN ('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000005'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN ('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000005'))
    OR EXISTS (SELECT 1 FROM public.certificate_branches WHERE id = 'a3000000-0000-4000-8000-000000000010')
    OR EXISTS (SELECT 1 FROM public.certificate_templates WHERE id = 'a3000000-0000-4000-8000-000000000011')
    OR EXISTS (SELECT 1 FROM public.courses WHERE id = 'a3000000-0000-4000-8000-000000000012')
    OR EXISTS (SELECT 1 FROM public.course_schedules WHERE id IN ('a3000000-0000-4000-8000-000000000013', 'a3000000-0000-4000-8000-000000000014'))
    OR EXISTS (SELECT 1 FROM public.participants WHERE id IN ('a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000016'))
    OR EXISTS (SELECT 1 FROM public.certificates WHERE id BETWEEN 'a3000000-0000-4000-8000-000000000101' AND 'a3000000-0000-4000-8000-000000000109')
    OR EXISTS (SELECT 1 FROM public.certificates WHERE verification_token LIKE 'I3A-TOKEN-%')
    OR EXISTS (SELECT 1 FROM public.certificate_verifications WHERE query_value LIKE 'I3A-%') THEN
    RAISE EXCEPTION 'I3A synthetic fixture collision; refusing to write test rows';
  END IF;
END;
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a3000000-0000-4000-8000-000000000001', 'i3a-admin@example.invalid', '{"full_name":"I3A Admin"}'::jsonb),
  ('a3000000-0000-4000-8000-000000000002', 'i3a-no-module@example.invalid', '{"full_name":"I3A No Module"}'::jsonb),
  ('a3000000-0000-4000-8000-000000000003', 'i3a-inactive@example.invalid', '{"full_name":"I3A Inactive"}'::jsonb),
  ('a3000000-0000-4000-8000-000000000004', 'i3a-cross-admin@example.invalid', '{"full_name":"I3A Cross Admin"}'::jsonb),
  ('a3000000-0000-4000-8000-000000000005', 'i3a-editor@example.invalid', '{"full_name":"I3A Editor"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;

INSERT INTO public.profiles (id, email, full_name, role, is_active, access_control_enabled)
VALUES
  ('a3000000-0000-4000-8000-000000000001', 'i3a-admin@example.invalid', 'I3A Admin', 'admin', true, true),
  ('a3000000-0000-4000-8000-000000000002', 'i3a-no-module@example.invalid', 'I3A No Module', 'admin', true, true),
  ('a3000000-0000-4000-8000-000000000003', 'i3a-inactive@example.invalid', 'I3A Inactive', 'admin', false, true),
  ('a3000000-0000-4000-8000-000000000004', 'i3a-cross-admin@example.invalid', 'I3A Cross Admin', 'admin', true, true),
  ('a3000000-0000-4000-8000-000000000005', 'i3a-editor@example.invalid', 'I3A Editor', 'editor', true, true)
ON CONFLICT (id) DO UPDATE SET
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  is_active = excluded.is_active,
  access_control_enabled = excluded.access_control_enabled;

INSERT INTO public.staff_module_catalog (module_key, label, group_key, min_role, is_active)
VALUES ('certificates', 'Certificates', 'certification', 'trainer', true)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO public.staff_module_access (user_id, module_key, access_level)
VALUES ('a3000000-0000-4000-8000-000000000001', 'certificates', 'admin'),
       ('a3000000-0000-4000-8000-000000000003', 'certificates', 'admin'),
       ('a3000000-0000-4000-8000-000000000004', 'certificates', 'admin'),
       ('a3000000-0000-4000-8000-000000000005', 'certificates', 'view')
ON CONFLICT (user_id, module_key) DO NOTHING;

INSERT INTO public.certificate_branches (id, branch_code, branch_name, display_address, is_active)
VALUES ('a3000000-0000-4000-8000-000000000010', 'I3A', 'I3A Captured Branch', 'Historical branch address', true);

INSERT INTO public.certificate_templates (id, name, orientation, paper_size, config, is_active, is_default)
VALUES (
  'a3000000-0000-4000-8000-000000000011',
  'I3A Captured Template',
  'landscape',
  'A4',
  '{"design_variant":"standard_scaffold_certificate","certificate_title":"I3A Certificate","show_back_page":true,"show_qr":true,"show_skills_record":false,"objectives_text":"I3A HISTORICAL PAGE TWO OBJECTIVE — captured at issuance","coverage_items":["I3A HISTORICAL COVERAGE — captured at issuance"],"learning_outcomes":["I3A HISTORICAL OUTCOME — captured at issuance"],"assessment_methods":["I3A HISTORICAL ASSESSMENT — captured at issuance"]}'::jsonb,
  true,
  false
);

INSERT INTO public.courses (
  id, course_code, course_name, title, duration, active, status,
  certificate_generation_enabled, certificate_template_id, attendance_min_percent,
  assessment_required, competency_required
)
VALUES (
  'a3000000-0000-4000-8000-000000000012', 'I3A-CERT', 'I3A Captured Course', 'I3A Captured Course', '1 day', true, 'published',
  true, 'a3000000-0000-4000-8000-000000000011', 100, false, false
);

INSERT INTO public.course_schedules (
  id, course_id, start_date, end_date, status, is_published, capacity, seats_taken,
  venue, trainer_name, schedule_code, branch_id
)
VALUES
  ('a3000000-0000-4000-8000-000000000013', 'a3000000-0000-4000-8000-000000000012', CURRENT_DATE - 5, CURRENT_DATE - 5, 'completed', true, 10, 1, 'I3A Captured Venue', 'I3A Captured Trainer', 'I3A-GOOD', 'a3000000-0000-4000-8000-000000000010'),
  ('a3000000-0000-4000-8000-000000000014', 'a3000000-0000-4000-8000-000000000012', CURRENT_DATE - 4, CURRENT_DATE - 4, 'completed', true, 10, 1, 'I3A Ineligible Venue', 'I3A Captured Trainer', 'I3A-BAD', 'a3000000-0000-4000-8000-000000000010');

INSERT INTO public.participants (id, participant_code, full_name, identity_no, identity_last4, status, company)
VALUES
  ('a3000000-0000-4000-8000-000000000015', 'I3A-PARTICIPANT-5678', 'I3A Historical Holder', '111111-11-1234', '1234', 'active', 'I3A Historical Company'),
  ('a3000000-0000-4000-8000-000000000016', 'I3A-INELIGIBLE-1234', 'I3A Ineligible Holder', '222222-22-9876', '9876', 'active', 'I3A Historical Company');

INSERT INTO public.schedule_participants (schedule_id, participant_id, registration_status)
VALUES
  ('a3000000-0000-4000-8000-000000000013', 'a3000000-0000-4000-8000-000000000015', 'confirmed'),
  ('a3000000-0000-4000-8000-000000000014', 'a3000000-0000-4000-8000-000000000016', 'confirmed');

INSERT INTO public.attendance (schedule_id, participant_id, session_date, present, attendance_status)
VALUES ('a3000000-0000-4000-8000-000000000013', 'a3000000-0000-4000-8000-000000000015', CURRENT_DATE - 5, true, 'present');

-- Synthetic public-verification boundary rows (no snapshots; transaction-scoped).
INSERT INTO public.certificates (
  id, certificate_no, certificate_number, verification_token, participant_name,
  holder_name, participant_id, course_id, course_name, issue_date, expiry_date,
  status, verification_enabled, public_verification_enabled, deleted_at
) VALUES
  ('a3000000-0000-4000-8000-000000000101', 'I3A-EXPIRED', 'I3A-EXPIRED', 'I3A-TOKEN-EXPIRED', 'I3A Holder', 'I3A Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Course', CURRENT_DATE - 10, CURRENT_DATE - 1, 'expired', true, true, null),
  ('a3000000-0000-4000-8000-000000000102', 'I3A-EXPIRY-DATE', 'I3A-EXPIRY-DATE', 'I3A-TOKEN-EXPIRY-DATE', 'I3A Holder', 'I3A Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Course', CURRENT_DATE - 10, CURRENT_DATE - 1, 'valid', true, true, null),
  ('a3000000-0000-4000-8000-000000000103', 'I3A-DRAFT', 'I3A-DRAFT', 'I3A-TOKEN-DRAFT', 'I3A Holder', 'I3A Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Course', CURRENT_DATE - 10, null, 'draft', true, true, null),
  ('a3000000-0000-4000-8000-000000000104', 'I3A-ARCHIVED', 'I3A-ARCHIVED', 'I3A-TOKEN-ARCHIVED', 'I3A Holder', 'I3A Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Course', CURRENT_DATE - 10, null, 'archived', true, true, null),
  ('a3000000-0000-4000-8000-000000000105', 'I3A-DELETED', 'I3A-DELETED', 'I3A-TOKEN-DELETED', 'I3A Holder', 'I3A Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Course', CURRENT_DATE - 10, null, 'valid', true, true, CURRENT_TIMESTAMP),
  ('a3000000-0000-4000-8000-000000000106', 'I3A-VERIFY-DISABLED', 'I3A-VERIFY-DISABLED', 'I3A-TOKEN-VERIFY-DISABLED', 'I3A Holder', 'I3A Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Course', CURRENT_DATE - 10, null, 'valid', false, true, null),
  ('a3000000-0000-4000-8000-000000000107', 'I3A-PUBLIC-DISABLED', 'I3A-PUBLIC-DISABLED', 'I3A-TOKEN-PUBLIC-DISABLED', 'I3A Holder', 'I3A Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Course', CURRENT_DATE - 10, null, 'valid', true, false, null),
  ('a3000000-0000-4000-8000-000000000108', 'I3A-BOTH-DISABLED', 'I3A-BOTH-DISABLED', 'I3A-TOKEN-BOTH-DISABLED', 'I3A Holder', 'I3A Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Course', CURRENT_DATE - 10, null, 'valid', false, false, null),
  ('a3000000-0000-4000-8000-000000000109', 'I3A-LEGACY', 'I3A-LEGACY', 'I3A-TOKEN-LEGACY', 'I3A Legacy Holder', 'I3A Legacy Holder', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000012', 'I3A Legacy Course', CURRENT_DATE - 10, null, 'valid', true, true, null);

CREATE TEMP TABLE i3a_result (
  certificate_id uuid,
  verification_token text,
  original_state jsonb,
  render_data jsonb
) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON i3a_result TO authenticated;

-- A transaction-scoped invoker trigger records the effective role and JWT
-- actor seen by real lifecycle writes. This proves SECURITY DEFINER execution
-- is the dedicated non-bypass executor, not postgres.
CREATE TABLE public.i3e_executor_observations (
  execution_role name NOT NULL,
  actor_id uuid,
  table_name text NOT NULL,
  operation text NOT NULL
);
GRANT SELECT, INSERT ON public.i3e_executor_observations TO authenticated, certificate_lifecycle_executor;
CREATE FUNCTION public.i3e_capture_executor_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO public.i3e_executor_observations(execution_role, actor_id, table_name, operation)
  VALUES (current_user, app.request_actor_id(), TG_TABLE_NAME, TG_OP);
  RETURN NEW;
END;
$$;
CREATE TRIGGER i3e_capture_certificate_executor
  BEFORE INSERT OR UPDATE ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.i3e_capture_executor_context();
CREATE TRIGGER i3e_capture_snapshot_executor
  BEFORE INSERT ON public.certificate_issuance_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.i3e_capture_executor_context();
CREATE TRIGGER i3e_capture_reissue_executor
  BEFORE INSERT ON public.certificate_reissue_events
  FOR EACH ROW EXECUTE FUNCTION public.i3e_capture_executor_context();

-- Exercise FORCE RLS through real executor-owned RPC calls. SET ROLE to the
-- executor is intentionally unavailable after the atomic migration commits.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.certificate_branches'::regclass AND relrowsecurity AND relforcerowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.certificate_issuance_snapshots'::regclass AND relrowsecurity AND relforcerowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.certificate_reissue_events'::regclass AND relrowsecurity AND relforcerowsecurity)
     OR pg_has_role('postgres','certificate_lifecycle_executor','SET') THEN
    RAISE EXCEPTION 'I3E FORCE RLS or post-migration SET cleanup is missing';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a3000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  v_count integer;
  v_id uuid;
  v_token text;
  v_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
  v_event_count integer;
  v_rows_matched integer;
  v_rows_changed integer;
  v_rows_after integer;
  v_before_fingerprint text;
  v_after_fingerprint text;
  v_duplicate_id uuid;
  v_legacy_id uuid;
  v_verify record;
  v_sqlstate text;
begin
  if not app.is_active() or not app.is_admin() or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'I3A authorized fixture did not satisfy module/admin checks';
  end if;
  IF auth.uid() IS DISTINCT FROM app.request_actor_id()
     OR app.request_actor_id() IS DISTINCT FROM 'a3000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'I3E authenticated helper does not match auth.uid()';
  END IF;

  if has_function_privilege('anon', 'public.issue_certificate_with_skill_snapshot(uuid,uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.duplicate_certificate_with_skill_snapshot(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.reissue_certificate(uuid,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.revoke_certificate(uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.update_certificate_metadata(uuid,date,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_certificate_deleted(uuid,boolean)', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_certificate_verification_enabled(uuid,boolean)', 'EXECUTE') then
    raise exception 'I3B anon gained EXECUTE on an administrative lifecycle wrapper';
  end if;
  if not has_function_privilege('authenticated', 'public.issue_certificate_with_skill_snapshot(uuid,uuid,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.duplicate_certificate_with_skill_snapshot(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.reissue_certificate(uuid,text,text,jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.revoke_certificate(uuid,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.update_certificate_metadata(uuid,date,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_certificate_deleted(uuid,boolean)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_certificate_verification_enabled(uuid,boolean)', 'EXECUTE') then
    raise exception 'I3B authenticated is missing intended lifecycle wrapper EXECUTE';
  end if;

  SELECT count(*) INTO v_count FROM public.certificate_branches WHERE id = 'a3000000-0000-4000-8000-000000000010';
  IF v_count <> 1 THEN RAISE EXCEPTION 'I3A authorized lifecycle branch read failed'; END IF;

  BEGIN
    PERFORM * FROM public.issue_certificate_with_skill_snapshot(
      'a3000000-0000-4000-8000-000000000014',
      'a3000000-0000-4000-8000-000000000016',
      'I3A/2026/INELIGIBLE'
    );
    RAISE EXCEPTION 'I3A ineligible participant was issued a certificate';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  INSERT INTO pg_temp.i3a_result (certificate_id, verification_token)
  SELECT id, verification_token
  FROM public.issue_certificate_with_skill_snapshot(
    'a3000000-0000-4000-8000-000000000013',
    'a3000000-0000-4000-8000-000000000015',
    'I3A/2026/0001'
  );

  SELECT count(*) INTO v_count FROM pg_temp.i3a_result;
  IF v_count <> 1 THEN RAISE EXCEPTION 'I3A eligible issuance did not return exactly one certificate'; END IF;

  SELECT r.certificate_id, r.verification_token INTO v_id, v_token FROM pg_temp.i3a_result r;
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id=v_id AND issued_by=auth.uid()) THEN
    RAISE EXCEPTION 'I3E issued_by did not preserve the authenticated request actor';
  END IF;
  SELECT id INTO v_legacy_id FROM public.import_legacy_certificate(
    'a3000000-0000-4000-8000-000000000015',
    'a3000000-0000-4000-8000-000000000012',
    '{"certificate_no":"I3E-LEGACY-IMPORT","participant_name":"I3A Historical Holder","course_name":"I3A Captured Course","course_date":"2026-01-05","course_end_date":"2026-01-05","status":"valid"}'::jsonb
  );
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id=v_legacy_id AND issued_by=auth.uid() AND metadata->>'provenance'='legacy_import') THEN
    RAISE EXCEPTION 'I3E legacy import lost request actor or provenance';
  END IF;
  SELECT to_jsonb(s) INTO v_snapshot FROM public.certificate_issuance_snapshots s WHERE s.certificate_id = v_id;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'I3A issuance did not create its snapshot'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.certificate_issuance_snapshots WHERE certificate_id=v_id AND created_by=auth.uid()) THEN
    RAISE EXCEPTION 'I3E snapshot created_by did not preserve the authenticated request actor';
  END IF;
  SELECT count(*) INTO v_count FROM public.certificate_issuance_snapshots WHERE certificate_id = v_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'I3A issuance did not create exactly one snapshot'; END IF;
  IF v_snapshot->>'holder_name' <> 'I3A Historical Holder' OR v_snapshot->>'identity_no' <> '111111-11-1234' THEN
    RAISE EXCEPTION 'I3A issuance snapshot did not capture the original participant state';
  END IF;
  IF v_snapshot->'template_config'->>'objectives_text' NOT LIKE 'I3A HISTORICAL PAGE TWO OBJECTIVE%' THEN
    RAISE EXCEPTION 'I3A issuance snapshot did not capture historical Page 2 content';
  END IF;
  IF v_snapshot->'template_config'->>'show_back_page' <> 'true' OR v_snapshot->'template_config'->>'show_qr' <> 'true' THEN
    RAISE EXCEPTION 'I3A issuance snapshot did not capture historical page visibility';
  END IF;
  SELECT id INTO v_duplicate_id
  FROM public.duplicate_certificate_with_skill_snapshot(v_id);
  IF v_duplicate_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.certificate_issuance_snapshots WHERE certificate_id = v_duplicate_id
  ) THEN
    RAISE EXCEPTION 'I3B public duplicate RPC did not create a snapshot-backed certificate';
  END IF;

  v_before := (
    SELECT jsonb_build_object(
      'certificate_number', c.certificate_number,
      'certificate_no', c.certificate_no,
      'status', c.status,
      'issue_date', c.issue_date,
      'verification_token', c.verification_token,
      'issued_by', c.issued_by,
      'snapshot_created_at', s.created_at,
      'render_payload', s.render_payload,
      'template_config', s.template_config
    )
    FROM public.certificates c
    JOIN public.certificate_issuance_snapshots s ON s.certificate_id = c.id
    WHERE c.id = v_id
  );
  UPDATE pg_temp.i3a_result SET original_state = v_before WHERE certificate_id = v_id;
  UPDATE pg_temp.i3a_result r SET render_data = (
    SELECT jsonb_build_object(
      'certificate', jsonb_build_object(
        'id', c.id,
        'certificate_number', c.certificate_number,
        'certificate_no', c.certificate_no,
        'participant_id', c.participant_id,
        'course_id', c.course_id,
        'schedule_id', c.schedule_id,
        'holder_name', c.holder_name,
        'participant_name', c.participant_name,
        'course_name', c.course_name,
        'issue_date', c.issue_date,
        'training_start_date', c.training_start_date,
        'training_end_date', c.training_end_date,
        'expiry_date', c.expiry_date,
        'status', c.status,
        'verification_token', c.verification_token,
        'verification_url', c.verification_url,
        'verification_enabled', c.verification_enabled,
        'public_verification_enabled', c.public_verification_enabled,
        'certificate_templates', jsonb_build_object('config', s.template_config),
        'courses', jsonb_build_object('title', co.title, 'duration', co.duration),
        'participants', jsonb_build_object('participant_id', p.participant_id, 'full_name', p.full_name, 'ic_passport_no', p.ic_passport_no)
      ),
      'snapshot', to_jsonb(s),
      'skills', coalesce((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.area) FROM public.certificate_skill_results k WHERE k.certificate_id = c.id), '[]'::jsonb)
    )
    FROM public.certificates c
    JOIN public.certificate_issuance_snapshots s ON s.certificate_id = c.id
    JOIN public.courses co ON co.id = c.course_id
    JOIN public.participants p ON p.id = c.participant_id
    WHERE c.id = r.certificate_id
  );

  BEGIN
    INSERT INTO public.certificate_issuance_snapshots (certificate_id, holder_name, course_name, created_by)
    VALUES (v_id, 'Unauthorized direct snapshot', 'Unauthorized direct course', auth.uid());
    RAISE EXCEPTION 'I3A authenticated direct snapshot INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE EXCEPTION 'Direct snapshot INSERT SQLSTATE was %',v_sqlstate; END IF;
    RAISE NOTICE 'I3E direct snapshot INSERT denied: SQLSTATE %',v_sqlstate;
  END;

  BEGIN
    INSERT INTO public.certificate_reissue_events (certificate_id, reissued_by, event_type, reason)
    VALUES (v_id, auth.uid(), 'reissue', 'Unauthorized direct event');
    RAISE EXCEPTION 'I3A authenticated direct event INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE EXCEPTION 'Direct event INSERT SQLSTATE was %',v_sqlstate; END IF;
    RAISE NOTICE 'I3E direct event INSERT denied: SQLSTATE %',v_sqlstate;
  END;

  SELECT count(*), md5(coalesce(string_agg(to_jsonb(s)::text, E'\n' ORDER BY to_jsonb(s)::text), ''))
  INTO v_rows_matched, v_before_fingerprint
  FROM public.certificate_issuance_snapshots s
  WHERE s.certificate_id = v_id;
  IF v_rows_matched <> 1 THEN
    RAISE EXCEPTION 'I3A direct snapshot UPDATE precondition failed: expected exactly one target row, found %', v_rows_matched;
  END IF;
  v_rows_changed := 0;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.certificate_issuance_snapshots SET holder_name = 'Unauthorized mutation' WHERE certificate_id = v_id;
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE; END IF;
    v_rows_changed := 0;
  END;
  IF v_sqlstate IS NULL AND v_rows_changed <> 0 THEN
    RAISE EXCEPTION 'I3A unauthorized snapshot UPDATE returned without error but affected % rows', v_rows_changed;
  END IF;
  SELECT count(*), md5(coalesce(string_agg(to_jsonb(s)::text, E'\n' ORDER BY to_jsonb(s)::text), ''))
  INTO v_rows_after, v_after_fingerprint
  FROM public.certificate_issuance_snapshots s
  WHERE s.certificate_id = v_id;
  IF v_rows_after <> 1 OR v_rows_matched <> v_rows_after OR v_rows_changed <> 0
    OR v_before_fingerprint IS DISTINCT FROM v_after_fingerprint THEN
    RAISE EXCEPTION 'I3A authenticated snapshot mutation changed protected data (matched %, changed %, after %, before fingerprint %, after fingerprint %)',
      v_rows_matched, v_rows_changed, v_rows_after, v_before_fingerprint, v_after_fingerprint;
  END IF;
  RAISE NOTICE 'DIRECT_SNAPSHOT_MUTATION_BLOCKED: PASS matched=% changed=% before_fingerprint=% after_fingerprint=% sqlstate=%',
    v_rows_matched, v_rows_changed, v_before_fingerprint, v_after_fingerprint, v_sqlstate;

  BEGIN
    DELETE FROM public.certificate_issuance_snapshots WHERE certificate_id = v_id;
    RAISE EXCEPTION 'I3E authenticated direct snapshot DELETE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE EXCEPTION 'Direct snapshot DELETE SQLSTATE was %',v_sqlstate; END IF;
    RAISE NOTICE 'I3E direct snapshot DELETE denied: SQLSTATE %',v_sqlstate;
  END;
  BEGIN
    UPDATE public.certificate_reissue_events SET reason = 'Unauthorized mutation' WHERE certificate_id = v_id;
    RAISE EXCEPTION 'I3E authenticated direct event UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE EXCEPTION 'Direct event UPDATE SQLSTATE was %',v_sqlstate; END IF;
    RAISE NOTICE 'I3E direct event UPDATE denied: SQLSTATE %',v_sqlstate;
  END;
  BEGIN
    DELETE FROM public.certificate_reissue_events WHERE certificate_id = v_id;
    RAISE EXCEPTION 'I3E authenticated direct event DELETE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE EXCEPTION 'Direct event DELETE SQLSTATE was %',v_sqlstate; END IF;
    RAISE NOTICE 'I3E direct event DELETE denied: SQLSTATE %',v_sqlstate;
  END;
  BEGIN
    UPDATE public.certificates SET status = 'revoked' WHERE id = v_id;
    RAISE EXCEPTION 'I3E authenticated direct lifecycle mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE EXCEPTION 'Direct certificate lifecycle UPDATE SQLSTATE was %',v_sqlstate; END IF;
    RAISE NOTICE 'I3E direct certificate lifecycle UPDATE denied: SQLSTATE %',v_sqlstate;
  END;

  PERFORM * FROM public.reissue_certificate(v_id, 'reprint', 'I3A runtime reprint', '{"source":"i3a-local"}'::jsonb);
  PERFORM * FROM public.reissue_certificate(v_id, 'reissue', 'I3A runtime reissue', '{"source":"i3a-local"}'::jsonb);

  BEGIN
    PERFORM * FROM public.reissue_certificate(v_id, 'invalid-lifecycle', 'I3C error probe', '{}'::jsonb);
    RAISE EXCEPTION 'I3C invalid reissue lifecycle unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'Invalid reissue event type.' THEN RAISE; END IF;
    RAISE NOTICE 'I3C server-side invalid lifecycle detail: SQLSTATE %, %', SQLSTATE, SQLERRM;
  END;
  BEGIN
    PERFORM public.revoke_certificate('a3c00000-0000-4000-8000-000000000099', 'I3C missing-certificate probe');
    RAISE EXCEPTION 'I3C missing certificate revoke unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'Certificate not found.' THEN RAISE; END IF;
    RAISE NOTICE 'I3C server-side missing certificate detail: SQLSTATE %, %', SQLSTATE, SQLERRM;
  END;

  PERFORM public.update_certificate_metadata(v_duplicate_id, CURRENT_DATE + 365, 'I3B metadata update');
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id = v_duplicate_id AND expiry_date = CURRENT_DATE + 365 AND remarks = 'I3B metadata update') THEN
    RAISE EXCEPTION 'I3B public metadata update did not persist';
  END IF;
  PERFORM public.set_certificate_verification_enabled(v_duplicate_id, false);
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id = v_duplicate_id AND verification_enabled = false) THEN
    RAISE EXCEPTION 'I3B public verification toggle did not disable verification';
  END IF;
  PERFORM public.set_certificate_verification_enabled(v_duplicate_id, true);
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id = v_duplicate_id AND verification_enabled = true) THEN
    RAISE EXCEPTION 'I3B public verification toggle did not re-enable verification';
  END IF;
  PERFORM public.set_certificate_deleted(v_duplicate_id, true);
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id = v_duplicate_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'I3B public soft-delete did not persist';
  END IF;
  PERFORM public.set_certificate_deleted(v_duplicate_id, false);
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id = v_duplicate_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'I3B public restore did not persist';
  END IF;

  SELECT count(*) INTO v_event_count FROM public.certificate_reissue_events WHERE certificate_id = v_id;
  IF v_event_count <> 2 THEN RAISE EXCEPTION 'I3A reprint/reissue did not create exactly two events'; END IF;
  IF (SELECT count(*) FROM public.certificate_reissue_events WHERE certificate_id = v_id AND reissued_by = auth.uid() AND event_type = 'reprint') <> 1 THEN
    RAISE EXCEPTION 'I3A reprint event actor/type mismatch';
  END IF;
  IF (SELECT count(*) FROM public.certificate_reissue_events WHERE certificate_id = v_id AND reissued_by = auth.uid() AND event_type = 'reissue') <> 1 THEN
    RAISE EXCEPTION 'I3A reissue event actor/type mismatch';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000004', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  SELECT count(*) INTO v_count FROM public.certificate_reissue_events WHERE certificate_id = v_id;
  IF v_count <> 2 THEN RAISE EXCEPTION 'I3E authorized cross-admin could not read legitimate reissue history'; END IF;
  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000002', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  SELECT count(*) INTO v_count FROM public.certificate_reissue_events WHERE certificate_id=v_id;
  IF v_count <> 0 THEN RAISE EXCEPTION 'I3E user without certificate module permission read reissue history'; END IF;
  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  v_after := (
    SELECT jsonb_build_object(
      'certificate_number', c.certificate_number,
      'certificate_no', c.certificate_no,
      'status', c.status,
      'issue_date', c.issue_date,
      'verification_token', c.verification_token,
      'issued_by', c.issued_by,
      'snapshot_created_at', s.created_at,
      'render_payload', s.render_payload,
      'template_config', s.template_config
    )
    FROM public.certificates c
    JOIN public.certificate_issuance_snapshots s ON s.certificate_id = c.id
    WHERE c.id = v_id
  );
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'I3A reprint/reissue mutated original issuance data'; END IF;

  EXECUTE 'RESET ROLE';
  UPDATE public.participants SET full_name = 'I3A LIVE MUTATED HOLDER', company = 'I3A LIVE MUTATED COMPANY' WHERE id = 'a3000000-0000-4000-8000-000000000015';
  UPDATE public.courses SET course_name = 'I3A LIVE MUTATED COURSE', title = 'I3A LIVE MUTATED COURSE' WHERE id = 'a3000000-0000-4000-8000-000000000012';
  UPDATE public.certificate_templates SET config = '{"show_back_page":false,"show_qr":false,"objectives_text":"I3A LIVE MUTATED PAGE TWO MUST NOT APPEAR"}'::jsonb WHERE id = 'a3000000-0000-4000-8000-000000000011';
  UPDATE public.course_schedules SET venue = 'I3A LIVE MUTATED VENUE', trainer_name = 'I3A LIVE MUTATED TRAINER' WHERE id = 'a3000000-0000-4000-8000-000000000013';
  UPDATE public.certificate_branches SET branch_name = 'I3A LIVE MUTATED BRANCH', display_address = 'I3A LIVE MUTATED ADDRESS' WHERE id = 'a3000000-0000-4000-8000-000000000010';
  UPDATE pg_temp.i3a_result r
  SET render_data = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(r.render_data, '{certificate,courses,title}', to_jsonb(co.title)),
        '{certificate,participants,full_name}', to_jsonb(p.full_name), true
      ),
      '{certificate,certificate_templates,config}', to_jsonb(t.config)
    ),
    '{snapshot}', to_jsonb(s)
  )
  FROM public.certificates c
  JOIN public.courses co ON co.id = c.course_id
  JOIN public.participants p ON p.id = c.participant_id
  JOIN public.certificate_templates t ON t.id = co.certificate_template_id
  JOIN public.certificate_issuance_snapshots s ON s.certificate_id = c.id
  WHERE r.certificate_id = c.id;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000003', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  BEGIN
    PERFORM * FROM public.issue_certificate_with_skill_snapshot(
      'a3000000-0000-4000-8000-000000000013',
      'a3000000-0000-4000-8000-000000000015',
      'I3A/2026/INACTIVE'
    );
    RAISE EXCEPTION 'I3E inactive admin lifecycle issuance unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE EXCEPTION 'I3E inactive admin denial SQLSTATE was %',v_sqlstate; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000002', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  SELECT count(*) INTO v_count FROM public.certificate_branches WHERE id = 'a3000000-0000-4000-8000-000000000010';
  IF v_count <> 0 THEN RAISE EXCEPTION 'I3A unauthorized authenticated user gained branch access'; END IF;
  BEGIN
    PERFORM * FROM public.issue_certificate_with_skill_snapshot(
      'a3000000-0000-4000-8000-000000000013',
      'a3000000-0000-4000-8000-000000000015',
      'I3A/2026/UNAUTHORIZED'
    );
    RAISE EXCEPTION 'I3A unauthorized lifecycle issuance unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN PERFORM * FROM public.duplicate_certificate_with_skill_snapshot(v_id); RAISE EXCEPTION 'I3B no-module duplicate unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.reissue_certificate(v_id, 'reprint', 'unauthorized', '{}'::jsonb); RAISE EXCEPTION 'I3B no-module reprint unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.revoke_certificate(v_id, 'unauthorized'); RAISE EXCEPTION 'I3B no-module revoke unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.update_certificate_metadata(v_id, null, 'unauthorized'); RAISE EXCEPTION 'I3B no-module metadata update unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.set_certificate_deleted(v_id, true); RAISE EXCEPTION 'I3B no-module delete unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.set_certificate_verification_enabled(v_id, false); RAISE EXCEPTION 'I3B no-module verification toggle unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000005', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
  IF NOT app.is_editor() OR public.has_module_access_level('certificates','admin') THEN
    RAISE EXCEPTION 'I3E editor fixture does not represent insufficient admin-level certificate access';
  END IF;
  BEGIN
    PERFORM * FROM public.issue_certificate_with_skill_snapshot(
      'a3000000-0000-4000-8000-000000000013',
      'a3000000-0000-4000-8000-000000000015',
      'I3A/2026/EDITOR-DENIED'
    );
    RAISE EXCEPTION 'I3E editor without admin module permission unexpectedly issued a certificate';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN RAISE EXCEPTION 'I3E insufficient editor permission SQLSTATE was %',v_sqlstate; END IF;
  END;

  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  IF auth.uid() IS NOT NULL OR app.request_actor_id() IS NOT NULL THEN
    RAISE EXCEPTION 'I3E anonymous request unexpectedly has an authenticated actor';
  END IF;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.revoke_certificate(v_id, 'I3B anon attempt');
    RAISE EXCEPTION 'I3B anon administrative RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT * INTO v_verify FROM public.verify_and_log(v_token, 'token', NULL, NULL);
  IF NOT FOUND OR NOT v_verify.found OR v_verify.status <> 'valid' OR NOT v_verify.is_valid THEN
    RAISE EXCEPTION 'I3A public verification did not accept the actually issued certificate';
  END IF;
  IF v_verify.certificate_number <> 'I3A/2026/0001' THEN RAISE EXCEPTION 'I3A public verifier changed certificate number'; END IF;
  IF v_verify.holder_name <> 'I3A Historical Holder' THEN RAISE EXCEPTION 'I3A public verifier exposed live mutated holder data'; END IF;
  IF v_verify.participant_code_masked = 'I3A-PARTICIPANT-5678' OR position('I3A-' in coalesce(v_verify.participant_code_masked, '')) > 0 THEN
    RAISE EXCEPTION 'I3A public verifier did not mask participant code';
  END IF;
  IF to_jsonb(v_verify)::text LIKE '%111111-11-1234%' OR to_jsonb(v_verify)::text LIKE '%222222-22-9876%' THEN
    RAISE EXCEPTION 'I3A public verifier exposed an IC/passport value';
  END IF;

  IF has_table_privilege('anon', 'public.certificate_verifications', 'SELECT') THEN
    RAISE EXCEPTION 'I3A anon unexpectedly has direct verification-log SELECT';
  END IF;
  BEGIN
    PERFORM count(*) FROM public.certificate_verifications;
    RAISE EXCEPTION 'I3A anon direct verification-log read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-EXPIRED', 'token', NULL, NULL);
  IF NOT FOUND OR NOT v_verify.found OR v_verify.status <> 'expired' OR v_verify.is_valid THEN
    RAISE EXCEPTION 'I3A expired certificate was not returned as expired/invalid';
  END IF;
  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-EXPIRY-DATE', 'token', NULL, NULL);
  IF NOT FOUND OR NOT v_verify.found OR v_verify.status <> 'expired' OR v_verify.is_valid THEN
    RAISE EXCEPTION 'I3A past expiry date was not returned as expired/invalid';
  END IF;
  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-DRAFT', 'token', NULL, NULL);
  IF FOUND THEN RAISE EXCEPTION 'I3A draft certificate was publicly disclosed'; END IF;
  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-ARCHIVED', 'token', NULL, NULL);
  IF FOUND THEN RAISE EXCEPTION 'I3A archived certificate was publicly disclosed'; END IF;
  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-DELETED', 'token', NULL, NULL);
  IF FOUND THEN RAISE EXCEPTION 'I3A deleted certificate was publicly disclosed'; END IF;
  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-VERIFY-DISABLED', 'token', NULL, NULL);
  IF FOUND THEN RAISE EXCEPTION 'I3A verification_enabled=false was publicly disclosed'; END IF;
  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-PUBLIC-DISABLED', 'token', NULL, NULL);
  IF FOUND THEN RAISE EXCEPTION 'I3A public_verification_enabled=false was publicly disclosed'; END IF;
  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-BOTH-DISABLED', 'token', NULL, NULL);
  IF FOUND THEN RAISE EXCEPTION 'I3A verification disabled by neither flag was enforced'; END IF;
  SELECT * INTO v_verify FROM public.verify_and_log('I3A-TOKEN-LEGACY', 'token', NULL, NULL);
  IF NOT FOUND OR NOT v_verify.found OR NOT v_verify.is_valid OR v_verify.status <> 'valid'
    OR v_verify.holder_name <> 'I3A Legacy Holder'
    OR v_verify.participant_code_masked = 'I3A-PARTICIPANT-5678'
    OR to_jsonb(v_verify)::text LIKE '%111111-11-1234%' THEN
    RAISE EXCEPTION 'I3A legacy certificate without a snapshot did not verify safely';
  END IF;

  IF current_user <> 'anon' THEN RAISE EXCEPTION 'I3A verifier was not called as anon'; END IF;

  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  PERFORM public.revoke_certificate(v_id, 'I3A runtime revoke');
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id = v_id AND status = 'revoked') THEN
    RAISE EXCEPTION 'I3A revoke did not update certificate state';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT * INTO v_verify FROM public.verify_and_log(v_token, 'token', NULL, NULL);
  IF NOT FOUND OR NOT v_verify.found OR v_verify.status <> 'revoked' OR v_verify.is_valid THEN
    RAISE EXCEPTION 'I3A public verification did not fail closed after revoke';
  END IF;
  IF current_user <> 'anon' THEN RAISE EXCEPTION 'I3A revoked verifier was not called as anon'; END IF;

  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  IF NOT EXISTS (
    SELECT 1 FROM public.i3e_executor_observations
    WHERE execution_role = 'certificate_lifecycle_executor'
      AND actor_id = 'a3000000-0000-4000-8000-000000000001'
      AND table_name = 'certificates' AND operation = 'INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.i3e_executor_observations
    WHERE execution_role = 'certificate_lifecycle_executor'
      AND actor_id = 'a3000000-0000-4000-8000-000000000001'
      AND table_name = 'certificate_issuance_snapshots' AND operation = 'INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.i3e_executor_observations
    WHERE execution_role = 'certificate_lifecycle_executor'
      AND actor_id = 'a3000000-0000-4000-8000-000000000001'
      AND table_name = 'certificate_reissue_events' AND operation = 'INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.i3e_executor_observations
    WHERE execution_role = 'certificate_lifecycle_executor'
      AND actor_id = 'a3000000-0000-4000-8000-000000000001'
      AND table_name = 'certificates' AND operation = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'I3E lifecycle writes did not execute as the dedicated owner with authenticated JWT actor context';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.i3e_executor_observations
    WHERE execution_role <> 'certificate_lifecycle_executor'
       OR actor_id IS DISTINCT FROM 'a3000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'I3E lifecycle write escaped the dedicated executor or JWT actor context';
  END IF;
END;
$$;

-- The live source rows were mutated above before the production loader fixture
-- was rehydrated; verify the captured snapshot is still the historical source.
RESET ROLE;

DO $$
DECLARE
  v_id uuid;
  v_state jsonb;
  v_snapshot jsonb;
BEGIN
  SELECT certificate_id, original_state INTO v_id, v_state FROM pg_temp.i3a_result;
  SELECT to_jsonb(s) INTO v_snapshot FROM public.certificate_issuance_snapshots s WHERE s.certificate_id = v_id;
  IF v_snapshot IS NULL OR v_snapshot->>'holder_name' <> 'I3A Historical Holder' THEN
    RAISE EXCEPTION 'I3A snapshot changed after live participant mutation';
  END IF;
  IF v_snapshot->>'course_name' <> 'I3A Captured Course' OR v_snapshot->>'venue' <> 'I3A Captured Venue' OR v_snapshot->>'trainer_name' <> 'I3A Captured Trainer' THEN
    RAISE EXCEPTION 'I3A snapshot changed after live course/schedule mutation';
  END IF;
  IF v_snapshot->'template_config'->>'objectives_text' NOT LIKE 'I3A HISTORICAL PAGE TWO OBJECTIVE%' THEN
    RAISE EXCEPTION 'I3A Page 2 snapshot changed after live template mutation';
  END IF;
  IF v_snapshot->'template_config'->>'show_back_page' <> 'true' OR v_snapshot->'template_config'->>'show_qr' <> 'true' THEN
    RAISE EXCEPTION 'I3A historical page visibility changed after live template mutation';
  END IF;
  IF (SELECT render_data->'certificate'->'participants'->>'full_name' FROM pg_temp.i3a_result) <> 'I3A LIVE MUTATED HOLDER'
    OR (SELECT render_data->'certificate'->'courses'->>'title' FROM pg_temp.i3a_result) <> 'I3A LIVE MUTATED COURSE'
    OR (SELECT render_data->'certificate'->'certificate_templates'->'config'->>'show_back_page' FROM pg_temp.i3a_result) <> 'false'
    OR (SELECT render_data->'snapshot'->>'holder_name' FROM pg_temp.i3a_result) <> 'I3A Historical Holder'
    OR (SELECT render_data->'snapshot'->'template_config'->>'show_back_page' FROM pg_temp.i3a_result) <> 'true' THEN
    RAISE EXCEPTION 'I3A production loader input does not combine mutated live rows with the immutable historical snapshot';
  END IF;

  IF current_setting('render_fixture', true) = '1' THEN
    RAISE NOTICE 'render fixture requested; handled by the outer SQL script';
  END IF;
END;
$$;

-- Output is captured by the Node harness, never echoed to terminal logs. It
-- contains only this synthetic local fixture and is held in memory for PDF/QR proof.
\if :{?render_fixture}
SELECT 'I3A_RENDER_DATA=' || render_data::text FROM pg_temp.i3a_result;
\endif

ROLLBACK;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN ('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000005'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN ('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000005'))
    OR EXISTS (SELECT 1 FROM public.certificates WHERE id BETWEEN 'a3000000-0000-4000-8000-000000000101' AND 'a3000000-0000-4000-8000-000000000109')
    OR EXISTS (SELECT 1 FROM public.certificates WHERE verification_token LIKE 'I3A-TOKEN-%')
    OR EXISTS (SELECT 1 FROM public.certificate_verifications WHERE query_value LIKE 'I3A-%') THEN
    RAISE EXCEPTION 'I3A runtime fixture rollback verification failed';
  END IF;
END;
$$;
