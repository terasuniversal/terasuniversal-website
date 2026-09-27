-- I3E catalog/security contract. Run after migrations through 180000 on a
-- disposable PostgreSQL/Supabase-compatible database; this file is read-only.
DO $i3e$
DECLARE
  v_role record;
  v_fn text;
  v_app_functions text[] := ARRAY[
    'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)',
    'app.duplicate_certificate_with_skill_snapshot(uuid)',
    'app.reissue_certificate(uuid,text,text,jsonb)',
    'app.revoke_certificate(uuid,text)',
    'app.update_certificate_metadata(uuid,date,text)',
    'app.set_certificate_deleted(uuid,boolean)',
    'app.set_certificate_verification_enabled(uuid,boolean)',
    'app.import_legacy_certificate(uuid,uuid,jsonb)'
  ];
  v_public_functions text[] := ARRAY[
    'public.issue_certificate_with_skill_snapshot(uuid,uuid,text)',
    'public.duplicate_certificate_with_skill_snapshot(uuid)',
    'public.reissue_certificate(uuid,text,text,jsonb)',
    'public.revoke_certificate(uuid,text)',
    'public.update_certificate_metadata(uuid,date,text)',
    'public.set_certificate_deleted(uuid,boolean)',
    'public.set_certificate_verification_enabled(uuid,boolean)',
    'public.import_legacy_certificate(uuid,uuid,jsonb)'
  ];
  v_protected_functions text[] := v_app_functions || v_public_functions;
  v_rls_tables text[] := ARRAY[
    'public.certificates','public.certificate_branches',
    'public.certificate_issuance_snapshots','public.certificate_reissue_events',
    'public.certificate_skill_results','public.participant_skill_results',
    'public.course_schedules','public.courses','public.participants',
    'public.schedule_participants','public.schedule_groups','public.trainers',
    'public.schedule_assessors','public.assessors','public.certificate_templates',
    'public.attendance','public.assessments'
  ];
  v_force_tables text[] := ARRAY[
    'public.certificate_branches',
    'public.certificate_issuance_snapshots','public.certificate_reissue_events'
  ];
  v_oid regprocedure;
  v_table text;
  v_function_source text;
BEGIN
  SELECT * INTO v_role FROM pg_roles WHERE rolname='certificate_lifecycle_executor';
  IF NOT FOUND THEN RAISE EXCEPTION 'I3E executor role is missing'; END IF;
  IF v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolbypassrls
     OR v_role.rolcreaterole OR v_role.rolcreatedb OR v_role.rolinherit THEN
    RAISE EXCEPTION 'I3E executor role missing or has unsafe role attributes';
  END IF;
  IF pg_has_role('postgres','certificate_lifecycle_executor','SET')
     OR pg_has_role('postgres','certificate_lifecycle_executor','USAGE') THEN
    RAISE EXCEPTION 'I3E migration role must have neither SET nor INHERIT capability after cleanup';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles target ON target.oid=m.roleid
    JOIN pg_roles member ON member.oid=m.member
    WHERE target.rolname='certificate_lifecycle_executor'
      AND member.rolname='postgres'
      AND (m.set_option OR m.inherit_option)
  ) THEN
    RAISE EXCEPTION 'I3E migration membership retains SET or INHERIT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles target ON target.oid=m.roleid
    JOIN pg_roles member ON member.oid=m.member
    WHERE target.rolname='certificate_lifecycle_executor'
      AND member.rolname IN ('anon','authenticated','service_role')
  ) THEN
    RAISE EXCEPTION 'I3E executor must not be granted to an application role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles target ON target.oid=m.roleid
    JOIN pg_roles member ON member.oid=m.member
    WHERE target.rolname='certificate_lifecycle_executor'
      AND member.rolname='postgres'
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
  ) THEN
    RAISE EXCEPTION 'I3E unavoidable bootstrap ADMIN grant must remain non-INHERIT and non-SET';
  END IF;
  RAISE NOTICE 'MIGRATION_ADMIN_POSTCONDITION: PASS';
  IF EXISTS (
       SELECT 1 FROM pg_namespace n
       CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
       WHERE n.nspname='auth' AND a.grantee='certificate_lifecycle_executor'::regrole
     ) OR EXISTS (
       SELECT 1 FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       WHERE p.oid='auth.uid()'::regprocedure AND a.grantee='certificate_lifecycle_executor'::regrole
     ) OR NOT has_schema_privilege('certificate_lifecycle_executor','extensions','USAGE')
     OR NOT has_function_privilege('certificate_lifecycle_executor','app.request_actor_id()','EXECUTE')
     OR NOT has_function_privilege('certificate_lifecycle_executor','app.is_active()','EXECUTE')
     OR NOT has_function_privilege('certificate_lifecycle_executor','app.is_admin()','EXECUTE')
     OR NOT has_function_privilege('certificate_lifecycle_executor','app.is_editor()','EXECUTE')
     OR NOT has_function_privilege('certificate_lifecycle_executor','app.current_role()','EXECUTE')
     OR NOT has_function_privilege('authenticated','app.request_actor_id()','EXECUTE')
     OR has_function_privilege('anon','app.request_actor_id()','EXECUTE')
     OR has_function_privilege('service_role','app.request_actor_id()','EXECUTE') THEN
    RAISE EXCEPTION 'I3E executor helper privilege is unsafe or missing';
  END IF;
  IF (SELECT p.proowner FROM pg_proc p WHERE p.oid='app.request_actor_id()'::regprocedure)
       <> 'certificate_lifecycle_executor'::regrole
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid='app.request_actor_id()'::regprocedure)
     OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid='app.request_actor_id()'::regprocedure)<>'s'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='app.request_actor_id()'::regprocedure AND 'search_path=""'=ANY(p.proconfig))
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid='app.request_actor_id()'::regprocedure) ~* 'auth[.]' THEN
    RAISE EXCEPTION 'I3E request actor helper ownership/security contract failed';
  END IF;
  FOREACH v_fn IN ARRAY v_protected_functions LOOP
    v_oid := to_regprocedure(v_fn);
    v_function_source := (SELECT p.prosrc FROM pg_proc p WHERE p.oid=v_oid);
    IF v_function_source ~* '(^|[^[:alnum:]_.])"?auth"?[[:space:]]*[.][[:space:]]*"?[a-z_][a-z_0-9]*"?' THEN
      RAISE EXCEPTION 'I3E protected lifecycle function retains direct auth schema reference: %',v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY v_app_functions LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'Missing lifecycle implementation %',v_fn; END IF;
    IF (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=v_oid)
       <> 'certificate_lifecycle_executor' OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_oid) THEN
      RAISE EXCEPTION 'Lifecycle implementation % has wrong owner or is not SECURITY DEFINER',v_fn;
    END IF;
    IF has_function_privilege('anon',v_oid,'EXECUTE')
       OR has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR has_function_privilege('service_role',v_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Lifecycle implementation % is directly executable by a client role',v_fn;
    END IF;
    IF NOT has_function_privilege('certificate_lifecycle_executor',v_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Executor lacks execute privilege on %',v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY v_public_functions LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'Missing public lifecycle wrapper %',v_fn; END IF;
    IF (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=v_oid)
       <> 'certificate_lifecycle_executor' OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_oid) THEN
      RAISE EXCEPTION 'Public wrapper % is not SECURITY DEFINER owned by executor',v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR has_function_privilege('anon',v_oid,'EXECUTE')
       OR has_function_privilege('service_role',v_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Public wrapper % has incorrect anon/authenticated/service_role ACL',v_fn;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_rls_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c WHERE c.oid=to_regclass(v_table)
        AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'RLS is not enabled on %',v_table; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass(v_table)
        AND 'certificate_lifecycle_executor'::regrole = ANY(p.polroles)
    ) THEN RAISE EXCEPTION 'No executor-scoped RLS policy on %',v_table; END IF;
  END LOOP;
  FOREACH v_table IN ARRAY v_force_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c WHERE c.oid=to_regclass(v_table)
        AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN RAISE EXCEPTION 'FORCE RLS is not preserved on %',v_table; END IF;
  END LOOP;
  IF has_table_privilege('certificate_lifecycle_executor','public.certificates','DELETE')
     OR has_table_privilege('certificate_lifecycle_executor','public.certificate_issuance_snapshots','UPDATE')
     OR has_table_privilege('certificate_lifecycle_executor','public.certificate_issuance_snapshots','DELETE')
     OR has_table_privilege('certificate_lifecycle_executor','public.certificate_reissue_events','UPDATE')
     OR has_table_privilege('certificate_lifecycle_executor','public.certificate_reissue_events','DELETE') THEN
    RAISE EXCEPTION 'Executor has lifecycle table privileges beyond required operations';
  END IF;
END
$i3e$;

-- Hosted-compatible request context: auth.uid(), auth.jwt(), and the actor
-- helper agree when transaction-local claims are installed as PostgREST does.
BEGIN;
SET LOCAL ROLE authenticated;
DO $actor$
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
  IF current_user <> 'authenticated'
     OR auth.uid() IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid
     OR auth.jwt()->>'sub' IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'
     OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated'
     OR app.request_actor_id() IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Hosted auth helpers and app request actor disagree for transaction-local claims';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  PERFORM set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
  IF auth.uid() IS DISTINCT FROM '22222222-2222-4222-8222-222222222222'::uuid
     OR auth.jwt()->>'sub' IS DISTINCT FROM '22222222-2222-4222-8222-222222222222'
     OR app.request_actor_id() IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Hosted auth helpers and app request actor disagree for second request context';
  END IF;

  -- Exercise the app helper's JSON fallback independently. A deliberately
  -- inconsistent GUC pair is not used to assert auth.uid() behavior.
  PERFORM set_config('request.jwt.claim.sub','',true);
  IF app.request_actor_id() IS DISTINCT FROM '22222222-2222-4222-8222-222222222222'::uuid THEN
    RAISE EXCEPTION 'I3E request actor JSON fallback did not return the valid subject';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claim.role','anon',true);
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  IF auth.uid() IS NOT NULL OR auth.jwt()->>'role' IS DISTINCT FROM 'anon' OR app.request_actor_id() IS NOT NULL THEN
    RAISE EXCEPTION 'I3E anonymous request actor did not fail closed';
  END IF;

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','',true);
  IF app.request_actor_id() IS NOT NULL THEN
    RAISE EXCEPTION 'I3E missing-claims actor did not fail closed';
  END IF;

  PERFORM set_config('request.jwt.claims','not-json',true);
  IF app.request_actor_id() IS NOT NULL THEN
    RAISE EXCEPTION 'I3E malformed claims JSON did not fail closed';
  END IF;

  PERFORM set_config('request.jwt.claims','{"sub":""}',true);
  IF app.request_actor_id() IS NOT NULL THEN
    RAISE EXCEPTION 'I3E empty JWT subject did not fail closed';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','not-a-uuid',true);
  PERFORM set_config('request.jwt.claims','{"sub":"not-a-uuid"}',true);
  IF app.request_actor_id() IS NOT NULL THEN
    RAISE EXCEPTION 'I3E malformed JWT subject did not fail closed';
  END IF;
  RAISE NOTICE 'HOSTED_AUTH_CONTEXT_CONTRACT: PASS';
END;
$actor$;
ROLLBACK;
