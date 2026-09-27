-- I3E: isolate lifecycle SECURITY DEFINER execution from hosted postgres
-- (BYPASSRLS). Apply only after 20260924170000; never disable RLS.
-- Keep role creation, temporary SET membership, ownership changes, ACLs,
-- policies, postconditions, and temporary-membership cleanup atomic.
BEGIN;

DO $executor_role_setup$
DECLARE r record;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'I3E requires migration role postgres'; END IF;
  SELECT * INTO r FROM pg_roles WHERE rolname='certificate_lifecycle_executor';
  IF NOT FOUND THEN
    EXECUTE 'CREATE ROLE certificate_lifecycle_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  END IF;
  SELECT * INTO r FROM pg_roles WHERE rolname='certificate_lifecycle_executor';
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolinherit THEN
    RAISE EXCEPTION 'I3E executor role attributes unsafe';
  END IF;
  IF NOT pg_has_role(current_user,'certificate_lifecycle_executor','SET') THEN
    EXECUTE 'GRANT certificate_lifecycle_executor TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  END IF;
END;
$executor_role_setup$;

DO $pre$
DECLARE r record; f text; o oid; t text;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'I3E requires migration role postgres'; END IF;
  SELECT * INTO r FROM pg_roles WHERE rolname=current_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'I3E migration role missing'; END IF;
  IF NOT r.rolcreaterole OR r.rolsuper THEN RAISE EXCEPTION 'I3E requires non-superuser CREATEROLE'; END IF;
  IF to_regnamespace('app') IS NULL OR to_regnamespace('public') IS NULL
     OR to_regnamespace('auth') IS NULL OR to_regnamespace('extensions') IS NULL
     OR to_regclass('public.certificate_number_seq') IS NULL
     OR to_regclass('public.v_certificate_eligibility') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('app.is_active()') IS NULL
     OR to_regprocedure('app.is_admin()') IS NULL
     OR to_regprocedure('app.is_editor()') IS NULL
     OR to_regprocedure('app.current_role()') IS NULL
     OR to_regprocedure('public.has_module_access_level(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'I3E lifecycle dependency missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.v_certificate_eligibility'::regclass AND relkind='v' AND 'security_invoker=true'=ANY(reloptions)) THEN
    RAISE EXCEPTION 'I3E eligibility view must remain SECURITY INVOKER';
  END IF;
  FOREACH t IN ARRAY ARRAY['certificates','certificate_branches','certificate_issuance_snapshots','certificate_reissue_events','certificate_skill_results','participant_skill_results','course_schedules','courses','participants','schedule_participants','schedule_groups','trainers','schedule_assessors','assessors','certificate_templates','attendance','assessments'] LOOP
    IF to_regclass(format('public.%I',t)) IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass(format('public.%I',t))) THEN
      RAISE EXCEPTION 'I3E requires existing RLS-enabled relation public.%',t;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)','app.duplicate_certificate_with_skill_snapshot(uuid)','app.reissue_certificate(uuid,text,text,jsonb)','app.revoke_certificate(uuid,text)','app.update_certificate_metadata(uuid,date,text)','app.set_certificate_deleted(uuid,boolean)','app.set_certificate_verification_enabled(uuid,boolean)','app.import_legacy_certificate(uuid,uuid,jsonb)',
    'public.issue_certificate_with_skill_snapshot(uuid,uuid,text)','public.duplicate_certificate_with_skill_snapshot(uuid)','public.reissue_certificate(uuid,text,text,jsonb)','public.revoke_certificate(uuid,text)','public.update_certificate_metadata(uuid,date,text)','public.set_certificate_deleted(uuid,boolean)','public.set_certificate_verification_enabled(uuid,boolean)','public.import_legacy_certificate(uuid,uuid,jsonb)'
  ] LOOP
    o:=to_regprocedure(f);
    IF o IS NULL THEN RAISE EXCEPTION 'I3E requires candidate function %',f; END IF;
    IF (SELECT rolname FROM pg_roles WHERE oid=(SELECT proowner FROM pg_proc WHERE oid=o))<>'postgres' THEN RAISE EXCEPTION 'I3E unexpected owner for %',f; END IF;
  END LOOP;
  SELECT * INTO r FROM pg_roles WHERE rolname='certificate_lifecycle_executor';
  IF NOT FOUND THEN RAISE EXCEPTION 'I3E executor creation failed'; END IF;
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolinherit THEN
    RAISE EXCEPTION 'I3E executor role attributes unsafe';
  END IF;
  IF NOT pg_has_role(current_user,'certificate_lifecycle_executor','SET') THEN
    RAISE EXCEPTION 'I3E migration role lacks temporary executor SET ROLE membership';
  END IF;
  IF pg_has_role('anon','certificate_lifecycle_executor','MEMBER') OR pg_has_role('authenticated','certificate_lifecycle_executor','MEMBER') OR pg_has_role('service_role','certificate_lifecycle_executor','MEMBER') THEN
    RAISE EXCEPTION 'I3E executor cannot inherit an API caller role';
  END IF;
END;
$pre$;
GRANT USAGE, CREATE ON SCHEMA app, public TO certificate_lifecycle_executor;
GRANT USAGE ON SCHEMA extensions TO certificate_lifecycle_executor;
GRANT EXECUTE ON FUNCTION app.is_active() TO certificate_lifecycle_executor;
GRANT EXECUTE ON FUNCTION app.is_admin() TO certificate_lifecycle_executor;
GRANT EXECUTE ON FUNCTION app.is_editor() TO certificate_lifecycle_executor;
GRANT EXECUTE ON FUNCTION app.current_role() TO certificate_lifecycle_executor;
GRANT EXECUTE ON FUNCTION public.has_module_access_level(text,text) TO certificate_lifecycle_executor;
GRANT USAGE, SELECT ON SEQUENCE public.certificate_number_seq TO certificate_lifecycle_executor;
GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(integer) TO certificate_lifecycle_executor;

-- Read only the trusted PostgREST JWT GUCs. This helper deliberately has no
-- auth-schema dependency and returns NULL for absent, empty, or malformed sub.
CREATE OR REPLACE FUNCTION app.request_actor_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $actor$
DECLARE
  v_subject text;
  v_claims text;
BEGIN
  v_subject := NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '');
  IF v_subject IS NULL THEN
    v_claims := NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '');
    IF v_claims IS NULL THEN RETURN NULL; END IF;
    BEGIN
      v_subject := (v_claims::pg_catalog.jsonb ->> 'sub');
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NULL;
    END;
  END IF;
  IF v_subject IS NULL OR pg_catalog.btrim(v_subject) = '' THEN RETURN NULL; END IF;
  BEGIN
    RETURN v_subject::pg_catalog.uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$actor$;
REVOKE ALL ON FUNCTION app.request_actor_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.request_actor_id() TO certificate_lifecycle_executor, authenticated;

-- Preserve the already-reviewed business logic verbatim, changing only the
-- executor-context actor source in the explicitly enumerated lifecycle RPCs.
DO $actor_rewrite$
DECLARE
  v_fn regprocedure;
  v_definition text;
  v_rewritten text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'::regprocedure,
    'app.duplicate_certificate_with_skill_snapshot(uuid)'::regprocedure,
    'app.reissue_certificate(uuid,text,text,jsonb)'::regprocedure,
    'app.revoke_certificate(uuid,text)'::regprocedure,
    'app.update_certificate_metadata(uuid,date,text)'::regprocedure,
    'app.set_certificate_deleted(uuid,boolean)'::regprocedure,
    'app.set_certificate_verification_enabled(uuid,boolean)'::regprocedure
  ] LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_fn);
    IF pg_catalog.strpos(v_definition,'auth.uid()') = 0 THEN
      RAISE EXCEPTION 'I3E expected direct auth.uid dependency in %',v_fn;
    END IF;
    v_rewritten := pg_catalog.replace(v_definition,'auth.uid()','app.request_actor_id()');
    EXECUTE v_rewritten;
  END LOOP;
END;
$actor_rewrite$;

-- Explicit audited table dependencies; no grants to anon/authenticated.
GRANT SELECT ON public.v_certificate_eligibility,public.course_schedules,public.courses,public.participants,public.certificate_branches,public.schedule_participants,public.schedule_groups,public.trainers,public.schedule_assessors,public.assessors,public.certificate_templates,public.attendance,public.assessments,public.participant_skill_results,public.certificates,public.certificate_skill_results,public.certificate_issuance_snapshots,public.certificate_reissue_events TO certificate_lifecycle_executor;
GRANT UPDATE(id) ON public.course_schedules TO certificate_lifecycle_executor;
GRANT INSERT(participant_id,schedule_id,course_id,template_id,certificate_number,holder_name,participant_name,participant_code_snapshot,company_snapshot,course_name,course_code,schedule_code,exam_date,training_start_date,training_end_date,venue,trainer_name,branch_id,branch_code,branch_name,branch_address,effective_assessor_name,status,issue_date,issued_by,certificate_no,identity_last4,expiry_date,instructor,certificate_file_url,public_verification_enabled,identity_no,metadata,remarks,replaces_certificate_id) ON public.certificates TO certificate_lifecycle_executor;
GRANT UPDATE(verification_url,status,remarks,expiry_date,deleted_at,verification_enabled,public_verification_enabled) ON public.certificates TO certificate_lifecycle_executor;
GRANT INSERT(certificate_id,area,status,score,notes,source_skill_result_id) ON public.certificate_skill_results TO certificate_lifecycle_executor;
GRANT INSERT(certificate_id,snapshot_version,renderer_version,holder_name,identity_no,identity_last4,company_snapshot,participant_code_snapshot,course_name,course_code,schedule_code,training_start_date,training_end_date,exam_date,venue,branch_id,branch_code,branch_name,branch_address,trainer_name,effective_trainer_id,effective_assessor_id,effective_assessor_name,group_id,group_name,assessment_result,competency_status,issue_date,template_id,template_name,template_config,signature_reference,verification_metadata,render_payload,created_by) ON public.certificate_issuance_snapshots TO certificate_lifecycle_executor;
GRANT INSERT(certificate_id,reissued_by,event_type,reason,notes) ON public.certificate_reissue_events TO certificate_lifecycle_executor;

-- Policies make RLS apply as executor. The three previously-FORCE relations
-- remain FORCE; other source tables remain ENABLE-only to avoid unrelated
-- table-owner behavior changes. Admin/module checks remain mandatory.
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['course_schedules','courses','participants','schedule_participants','schedule_groups','trainers','schedule_assessors','assessors','certificate_templates','attendance','assessments','participant_skill_results'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS i3e_certificate_executor_read ON public.%I',t);
    EXECUTE format('CREATE POLICY i3e_certificate_executor_read ON public.%I FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level(''certificates'',''admin''))',t);
  END LOOP;
  EXECUTE 'DROP POLICY IF EXISTS i3e_certificate_executor_schedule_lock ON public.course_schedules';
  EXECUTE 'CREATE POLICY i3e_certificate_executor_schedule_lock ON public.course_schedules FOR UPDATE TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level(''certificates'',''admin'')) WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level(''certificates'',''admin''))';
END;
$policies$;

DROP POLICY IF EXISTS certificate_branches_lifecycle_rpc_read ON public.certificate_branches;
CREATE POLICY certificate_branches_lifecycle_rpc_read ON public.certificate_branches FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));
DROP POLICY IF EXISTS cert_issuance_snapshot_definer_read ON public.certificate_issuance_snapshots;
DROP POLICY IF EXISTS certificate_issuance_snapshots_lifecycle_rpc_insert ON public.certificate_issuance_snapshots;
CREATE POLICY cert_issuance_snapshot_definer_read ON public.certificate_issuance_snapshots FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));
CREATE POLICY certificate_issuance_snapshots_lifecycle_rpc_insert ON public.certificate_issuance_snapshots FOR INSERT TO certificate_lifecycle_executor WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin') AND created_by=app.request_actor_id());
DROP POLICY IF EXISTS certificate_reissue_events_lifecycle_rpc_read ON public.certificate_reissue_events;
DROP POLICY IF EXISTS certificate_reissue_events_lifecycle_rpc_insert ON public.certificate_reissue_events;
CREATE POLICY certificate_reissue_events_lifecycle_rpc_read ON public.certificate_reissue_events FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));
CREATE POLICY certificate_reissue_events_lifecycle_rpc_insert ON public.certificate_reissue_events FOR INSERT TO certificate_lifecycle_executor WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin') AND reissued_by=app.request_actor_id());
DROP POLICY IF EXISTS i3e_certificate_executor_read ON public.certificates;
DROP POLICY IF EXISTS i3e_certificate_executor_insert ON public.certificates;
DROP POLICY IF EXISTS i3e_certificate_executor_update ON public.certificates;
CREATE POLICY i3e_certificate_executor_read ON public.certificates FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));
CREATE POLICY i3e_certificate_executor_insert ON public.certificates FOR INSERT TO certificate_lifecycle_executor WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin') AND issued_by=app.request_actor_id());
CREATE POLICY i3e_certificate_executor_update ON public.certificates FOR UPDATE TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin')) WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));
DROP POLICY IF EXISTS i3e_certificate_skill_executor_read ON public.certificate_skill_results;
DROP POLICY IF EXISTS i3e_certificate_skill_executor_insert ON public.certificate_skill_results;
CREATE POLICY i3e_certificate_skill_executor_read ON public.certificate_skill_results FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));
CREATE POLICY i3e_certificate_skill_executor_insert ON public.certificate_skill_results FOR INSERT TO certificate_lifecycle_executor WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));

-- Legacy import records the authenticated actor explicitly for INSERT RLS.
CREATE OR REPLACE FUNCTION app.import_legacy_certificate(p_participant_id uuid,p_course_id uuid,p_certificate jsonb)
RETURNS TABLE(id uuid,certificate_number text,verification_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app,extensions
AS $$
DECLARE
  v_actor uuid:=app.request_actor_id(); v_id uuid; v_certificate_number text; v_token text;
  v_status text:=coalesce(nullif(btrim(p_certificate->>'status'),''),'valid');
  v_certificate_no text:=nullif(btrim(p_certificate->>'certificate_no'),'');
  v_participant_name text:=nullif(btrim(p_certificate->>'participant_name'),'');
  v_course_name text:=nullif(btrim(p_certificate->>'course_name'),'');
  v_course_date date; v_course_end_date date; v_expiry_date date;
BEGIN
  IF v_actor IS NULL OR NOT app.is_active() OR NOT app.is_admin() OR NOT public.has_module_access_level('certificates','admin') THEN
    RAISE EXCEPTION 'Not authorized to import legacy certificates.' USING ERRCODE='42501';
  END IF;
  IF v_certificate_no IS NULL OR v_participant_name IS NULL OR v_course_name IS NULL THEN RAISE EXCEPTION 'Legacy certificate provenance fields are required.' USING ERRCODE='22023'; END IF;
  IF v_status NOT IN ('valid','expired','revoked') THEN RAISE EXCEPTION 'Invalid legacy certificate status.' USING ERRCODE='22023'; END IF;
  BEGIN
    v_course_date:=nullif(btrim(p_certificate->>'course_date'),'')::date;
    v_course_end_date:=nullif(btrim(p_certificate->>'course_end_date'),'')::date;
    v_expiry_date:=nullif(btrim(p_certificate->>'expiry_date'),'')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid legacy certificate date.' USING ERRCODE='22023'; END;
  IF v_course_date IS NULL THEN RAISE EXCEPTION 'Legacy certificate issue date is required.' USING ERRCODE='22023'; END IF;
  IF v_course_end_date IS NOT NULL AND v_course_end_date<v_course_date THEN RAISE EXCEPTION 'Legacy certificate end date cannot precede its start date.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.certificates(certificate_no,participant_name,identity_last4,course_name,training_start_date,training_end_date,issue_date,expiry_date,status,trainer_name,venue,participant_id,course_id,identity_no,instructor,certificate_file_url,public_verification_enabled,metadata,issued_by)
  VALUES(upper(v_certificate_no),v_participant_name,right(nullif(btrim(p_certificate->>'identity_no'),''),4),v_course_name,v_course_date,v_course_end_date,v_course_date,v_expiry_date,v_status,nullif(btrim(p_certificate->>'instructor'),''),nullif(btrim(p_certificate->>'venue'),''),p_participant_id,p_course_id,upper(nullif(btrim(p_certificate->>'identity_no'),'')),nullif(btrim(p_certificate->>'instructor'),''),nullif(btrim(p_certificate->>'certificate_file_url'),''),coalesce((p_certificate->>'public_verification_enabled')::boolean,true),jsonb_set(coalesce(p_certificate->'metadata','{}'::jsonb),'{provenance}','"legacy_import"'::jsonb,true),v_actor)
  RETURNING certificates.id,certificates.certificate_number,certificates.verification_token INTO v_id,v_certificate_number,v_token;
  RETURN QUERY SELECT v_id,v_certificate_number,v_token;
END;
$$;

-- Only the wrapper security mode changes. Business rules remain in app.*.
CREATE OR REPLACE FUNCTION public.issue_certificate_with_skill_snapshot(p_schedule_id uuid,p_participant_id uuid,p_certificate_number text DEFAULT NULL) RETURNS TABLE(id uuid,verification_token text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM app.issue_certificate_with_skill_snapshot(p_schedule_id,p_participant_id,p_certificate_number); $$;
CREATE OR REPLACE FUNCTION public.duplicate_certificate_with_skill_snapshot(p_source_certificate_id uuid) RETURNS TABLE(id uuid,verification_token text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM app.duplicate_certificate_with_skill_snapshot(p_source_certificate_id); $$;
CREATE OR REPLACE FUNCTION public.reissue_certificate(p_certificate_id uuid,p_event_type text DEFAULT 'reissue',p_reason text DEFAULT NULL,p_notes jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(id uuid,certificate_id uuid,certificate_number text,event_type text,reissued_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM app.reissue_certificate(p_certificate_id,p_event_type,p_reason,p_notes); $$;
CREATE OR REPLACE FUNCTION public.revoke_certificate(p_certificate_id uuid,p_remarks text DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.revoke_certificate(p_certificate_id,p_remarks); $$;
CREATE OR REPLACE FUNCTION public.update_certificate_metadata(p_certificate_id uuid,p_expiry_date date DEFAULT NULL,p_remarks text DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.update_certificate_metadata(p_certificate_id,p_expiry_date,p_remarks); $$;
CREATE OR REPLACE FUNCTION public.set_certificate_deleted(p_certificate_id uuid,p_deleted boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.set_certificate_deleted(p_certificate_id,p_deleted); $$;
CREATE OR REPLACE FUNCTION public.set_certificate_verification_enabled(p_certificate_id uuid,p_enabled boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.set_certificate_verification_enabled(p_certificate_id,p_enabled); $$;
CREATE OR REPLACE FUNCTION public.import_legacy_certificate(p_participant_id uuid,p_course_id uuid,p_certificate jsonb) RETURNS TABLE(id uuid,certificate_number text,verification_token text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM app.import_legacy_certificate(p_participant_id,p_course_id,p_certificate); $$;

DO $owners$
DECLARE f text; o regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['app.issue_certificate_with_skill_snapshot(uuid,uuid,text)','app.duplicate_certificate_with_skill_snapshot(uuid)','app.reissue_certificate(uuid,text,text,jsonb)','app.revoke_certificate(uuid,text)','app.update_certificate_metadata(uuid,date,text)','app.set_certificate_deleted(uuid,boolean)','app.set_certificate_verification_enabled(uuid,boolean)','app.import_legacy_certificate(uuid,uuid,jsonb)','public.issue_certificate_with_skill_snapshot(uuid,uuid,text)','public.duplicate_certificate_with_skill_snapshot(uuid)','public.reissue_certificate(uuid,text,text,jsonb)','public.revoke_certificate(uuid,text)','public.update_certificate_metadata(uuid,date,text)','public.set_certificate_deleted(uuid,boolean)','public.set_certificate_verification_enabled(uuid,boolean)','public.import_legacy_certificate(uuid,uuid,jsonb)'] LOOP
    o:=to_regprocedure(f); EXECUTE format('ALTER FUNCTION %s OWNER TO certificate_lifecycle_executor',o);
  END LOOP;
END;
$owners$;
ALTER FUNCTION app.request_actor_id() OWNER TO certificate_lifecycle_executor;

SET LOCAL ROLE certificate_lifecycle_executor;
REVOKE ALL ON FUNCTION app.issue_certificate_with_skill_snapshot(uuid,uuid,text),app.duplicate_certificate_with_skill_snapshot(uuid),app.reissue_certificate(uuid,text,text,jsonb),app.revoke_certificate(uuid,text),app.update_certificate_metadata(uuid,date,text),app.set_certificate_deleted(uuid,boolean),app.set_certificate_verification_enabled(uuid,boolean),app.import_legacy_certificate(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.issue_certificate_with_skill_snapshot(uuid,uuid,text),public.duplicate_certificate_with_skill_snapshot(uuid),public.reissue_certificate(uuid,text,text,jsonb),public.revoke_certificate(uuid,text),public.update_certificate_metadata(uuid,date,text),public.set_certificate_deleted(uuid,boolean),public.set_certificate_verification_enabled(uuid,boolean),public.import_legacy_certificate(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_certificate_with_skill_snapshot(uuid,uuid,text),public.duplicate_certificate_with_skill_snapshot(uuid),public.reissue_certificate(uuid,text,text,jsonb),public.revoke_certificate(uuid,text),public.update_certificate_metadata(uuid,date,text),public.set_certificate_deleted(uuid,boolean),public.set_certificate_verification_enabled(uuid,boolean),public.import_legacy_certificate(uuid,uuid,jsonb) TO authenticated;
RESET ROLE;
GRANT certificate_lifecycle_executor TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET FALSE GRANTED BY postgres;
REVOKE CREATE ON SCHEMA app,public FROM certificate_lifecycle_executor;
DO $post$
DECLARE r record; f text; o oid; t text; v_source text;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname='certificate_lifecycle_executor';
  IF NOT FOUND THEN RAISE EXCEPTION 'I3E executor role missing after migration'; END IF;
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolinherit THEN RAISE EXCEPTION 'I3E executor role postcondition failed'; END IF;
  IF EXISTS (
       SELECT 1 FROM pg_namespace n
       CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
       WHERE n.nspname='auth' AND a.grantee='certificate_lifecycle_executor'::regrole
     ) OR EXISTS (
       SELECT 1 FROM pg_proc p
       CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
       WHERE p.oid='auth.uid()'::regprocedure AND a.grantee='certificate_lifecycle_executor'::regrole
     ) THEN
    RAISE EXCEPTION 'I3E executor must not have direct auth schema/function grants';
  END IF;
  IF NOT has_schema_privilege('certificate_lifecycle_executor','extensions','USAGE') OR NOT has_function_privilege('certificate_lifecycle_executor','app.request_actor_id()','EXECUTE') OR NOT has_function_privilege('certificate_lifecycle_executor','app.is_editor()','EXECUTE') OR NOT has_function_privilege('certificate_lifecycle_executor','app.current_role()','EXECUTE') THEN
    RAISE EXCEPTION 'I3E executor helper privilege postcondition failed (extensions_schema=%, request_actor_id=%, app_is_editor=%, app_current_role=%)',
      has_schema_privilege('certificate_lifecycle_executor','extensions','USAGE'),
      has_function_privilege('certificate_lifecycle_executor','app.request_actor_id()','EXECUTE'),
      has_function_privilege('certificate_lifecycle_executor','app.is_editor()','EXECUTE'),
      has_function_privilege('certificate_lifecycle_executor','app.current_role()','EXECUTE');
  END IF;
  IF pg_has_role('postgres','certificate_lifecycle_executor','SET') THEN RAISE EXCEPTION 'I3E migration role retains SET ROLE capability'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles target ON target.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE target.rolname='certificate_lifecycle_executor' AND member.rolname='postgres' AND (m.set_option OR m.inherit_option)) THEN RAISE EXCEPTION 'I3E migration membership retains SET or INHERIT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles target ON target.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE target.rolname='certificate_lifecycle_executor' AND member.rolname='postgres' AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option) THEN RAISE EXCEPTION 'I3E bootstrap ADMIN membership was not preserved in least-capability state'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles target ON target.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE target.rolname='certificate_lifecycle_executor' AND member.rolname IN ('anon','authenticated','service_role')) THEN RAISE EXCEPTION 'I3E executor directly granted to an application role'; END IF;
  FOREACH f IN ARRAY ARRAY['app.issue_certificate_with_skill_snapshot(uuid,uuid,text)','app.duplicate_certificate_with_skill_snapshot(uuid)','app.reissue_certificate(uuid,text,text,jsonb)','app.revoke_certificate(uuid,text)','app.update_certificate_metadata(uuid,date,text)','app.set_certificate_deleted(uuid,boolean)','app.set_certificate_verification_enabled(uuid,boolean)','app.import_legacy_certificate(uuid,uuid,jsonb)'] LOOP
    o:=to_regprocedure(f);
    IF (SELECT rolname FROM pg_roles WHERE oid=(SELECT proowner FROM pg_proc WHERE oid=o))<>'certificate_lifecycle_executor' OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=o) OR has_function_privilege('anon',o,'EXECUTE') OR has_function_privilege('authenticated',o,'EXECUTE') OR has_function_privilege('service_role',o,'EXECUTE') THEN RAISE EXCEPTION 'I3E internal function postcondition failed: %',f; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.issue_certificate_with_skill_snapshot(uuid,uuid,text)','public.duplicate_certificate_with_skill_snapshot(uuid)','public.reissue_certificate(uuid,text,text,jsonb)','public.revoke_certificate(uuid,text)','public.update_certificate_metadata(uuid,date,text)','public.set_certificate_deleted(uuid,boolean)','public.set_certificate_verification_enabled(uuid,boolean)','public.import_legacy_certificate(uuid,uuid,jsonb)'] LOOP
    o:=to_regprocedure(f);
    IF (SELECT rolname FROM pg_roles WHERE oid=(SELECT proowner FROM pg_proc WHERE oid=o))<>'certificate_lifecycle_executor' OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=o) OR NOT has_function_privilege('authenticated',o,'EXECUTE') OR has_function_privilege('anon',o,'EXECUTE') OR has_function_privilege('service_role',o,'EXECUTE') THEN RAISE EXCEPTION 'I3E wrapper postcondition failed: %',f; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['app.issue_certificate_with_skill_snapshot(uuid,uuid,text)','app.duplicate_certificate_with_skill_snapshot(uuid)','app.reissue_certificate(uuid,text,text,jsonb)','app.revoke_certificate(uuid,text)','app.update_certificate_metadata(uuid,date,text)','app.set_certificate_deleted(uuid,boolean)','app.set_certificate_verification_enabled(uuid,boolean)','app.import_legacy_certificate(uuid,uuid,jsonb)','public.issue_certificate_with_skill_snapshot(uuid,uuid,text)','public.duplicate_certificate_with_skill_snapshot(uuid)','public.reissue_certificate(uuid,text,text,jsonb)','public.revoke_certificate(uuid,text)','public.update_certificate_metadata(uuid,date,text)','public.set_certificate_deleted(uuid,boolean)','public.set_certificate_verification_enabled(uuid,boolean)','public.import_legacy_certificate(uuid,uuid,jsonb)'] LOOP
    o:=to_regprocedure(f);
    v_source:=(SELECT prosrc FROM pg_proc WHERE oid=o);
    IF v_source ~* '(^|[^[:alnum:]_.])"?auth"?[[:space:]]*[.][[:space:]]*"?[a-z_][a-z_0-9]*"?' THEN RAISE EXCEPTION 'I3E protected lifecycle function retains direct auth schema reference: %',f; END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['public.certificate_branches','public.certificate_issuance_snapshots','public.certificate_reissue_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(t) AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'I3E FORCE RLS postcondition failed: %',t; END IF;
  END LOOP;
  IF has_table_privilege('certificate_lifecycle_executor','public.certificates','DELETE') OR has_table_privilege('certificate_lifecycle_executor','public.certificate_issuance_snapshots','UPDATE') OR has_table_privilege('certificate_lifecycle_executor','public.certificate_reissue_events','UPDATE') THEN RAISE EXCEPTION 'I3E executor received excess write privileges'; END IF;
END;
$post$;
COMMIT;
