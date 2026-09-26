-- I3C authorization probe. Run only in the disposable local PostgreSQL harness;
-- all synthetic users, access rows, and attempted RPC calls are rolled back.
\set ON_ERROR_STOP on
BEGIN;

DO $seed$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id BETWEEN 'a3c00000-0000-4000-8000-000000000001' AND 'a3c00000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'I3C synthetic user collision; refusing to write test rows';
  END IF;
END;
$seed$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a3c00000-0000-4000-8000-000000000001', 'i3c-no-module@example.invalid', '{"full_name":"I3C No Module"}'::jsonb),
  ('a3c00000-0000-4000-8000-000000000002', 'i3c-inactive-admin@example.invalid', '{"full_name":"I3C Inactive Admin"}'::jsonb),
  ('a3c00000-0000-4000-8000-000000000003', 'i3c-active-editor@example.invalid', '{"full_name":"I3C Active Editor"}'::jsonb);

INSERT INTO public.profiles (id, email, full_name, role, is_active, access_control_enabled) VALUES
  ('a3c00000-0000-4000-8000-000000000001', 'i3c-no-module@example.invalid', 'I3C No Module', 'admin', true, true),
  ('a3c00000-0000-4000-8000-000000000002', 'i3c-inactive-admin@example.invalid', 'I3C Inactive Admin', 'admin', false, true),
  ('a3c00000-0000-4000-8000-000000000003', 'i3c-active-editor@example.invalid', 'I3C Active Editor', 'editor', true, true)
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
VALUES
  ('a3c00000-0000-4000-8000-000000000002', 'certificates', 'admin'),
  ('a3c00000-0000-4000-8000-000000000003', 'certificates', 'admin')
ON CONFLICT (user_id, module_key) DO UPDATE SET access_level = excluded.access_level;

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claim.role = 'anon';
SET LOCAL request.jwt.claims = '{"role":"anon","aud":"anon"}';
DO $anon_matrix$
DECLARE
  v_call text;
BEGIN
  FOREACH v_call IN ARRAY ARRAY[
    $$SELECT * FROM public.issue_certificate_with_skill_snapshot('a3c00000-0000-4000-8000-000000000099','a3c00000-0000-4000-8000-000000000099','I3C-DENIED')$$,
    $$SELECT * FROM public.duplicate_certificate_with_skill_snapshot('a3c00000-0000-4000-8000-000000000099')$$,
    $$SELECT * FROM public.reissue_certificate('a3c00000-0000-4000-8000-000000000099','reissue','I3C denied','{}'::jsonb)$$,
    $$SELECT public.revoke_certificate('a3c00000-0000-4000-8000-000000000099','I3C denied')$$,
    $$SELECT public.update_certificate_metadata('a3c00000-0000-4000-8000-000000000099',NULL,'I3C denied')$$,
    $$SELECT public.set_certificate_deleted('a3c00000-0000-4000-8000-000000000099',true)$$,
    $$SELECT public.set_certificate_verification_enabled('a3c00000-0000-4000-8000-000000000099',false)$$
  ] LOOP
    BEGIN
      EXECUTE v_call;
      RAISE EXCEPTION 'I3C anon unexpectedly executed %', v_call USING ERRCODE = 'ZX001';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'anon denied: %', split_part(v_call, '(', 1);
    END;
  END LOOP;
END;
$anon_matrix$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $auth_matrix$
DECLARE
  v_user uuid;
  v_call text;
  v_claims jsonb;
BEGIN
  FOREACH v_user IN ARRAY ARRAY[
    'a3c00000-0000-4000-8000-000000000001'::uuid,
    'a3c00000-0000-4000-8000-000000000002'::uuid,
    'a3c00000-0000-4000-8000-000000000003'::uuid
  ] LOOP
    v_claims := jsonb_build_object('sub', v_user, 'role', 'authenticated', 'aud', 'authenticated');
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', v_claims::text, true);
    FOREACH v_call IN ARRAY ARRAY[
      $$SELECT * FROM public.issue_certificate_with_skill_snapshot('a3c00000-0000-4000-8000-000000000099','a3c00000-0000-4000-8000-000000000099','I3C-DENIED')$$,
      $$SELECT * FROM public.duplicate_certificate_with_skill_snapshot('a3c00000-0000-4000-8000-000000000099')$$,
      $$SELECT * FROM public.reissue_certificate('a3c00000-0000-4000-8000-000000000099','reissue','I3C denied','{}'::jsonb)$$,
      $$SELECT public.revoke_certificate('a3c00000-0000-4000-8000-000000000099','I3C denied')$$,
      $$SELECT public.update_certificate_metadata('a3c00000-0000-4000-8000-000000000099',NULL,'I3C denied')$$,
      $$SELECT public.set_certificate_deleted('a3c00000-0000-4000-8000-000000000099',true)$$,
      $$SELECT public.set_certificate_verification_enabled('a3c00000-0000-4000-8000-000000000099',false)$$
    ] LOOP
      BEGIN
        EXECUTE v_call;
        RAISE EXCEPTION 'I3C authenticated user % unexpectedly executed %', v_user, v_call USING ERRCODE = 'ZX001';
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'authenticated % denied: %', v_user, split_part(v_call, '(', 1);
      END;
    END LOOP;
  END LOOP;
END;
$auth_matrix$;

RESET ROLE;
ROLLBACK;
