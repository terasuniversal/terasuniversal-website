-- LOCAL/DISPOSABLE TEST FIXTURE ONLY. Never apply to a linked/shared DB.
BEGIN;

DO $$
DECLARE
  v_user_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_existing_role public.user_role;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated',
    'sales-integrity-admin@local.test', 'local-test-password-not-used', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ) ON CONFLICT (id) DO NOTHING;

  SELECT role INTO v_existing_role FROM public.profiles WHERE id = v_user_id;
  IF FOUND AND v_existing_role NOT IN ('editor'::public.user_role, 'admin'::public.user_role, 'super_admin'::public.user_role) THEN
    RAISE EXCEPTION 'incompatible disposable admin fixture already exists: %', v_user_id;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (v_user_id, 'sales-integrity-admin@local.test', 'Sales Integrity Disposable Admin', 'super_admin', true)
  ON CONFLICT (id) DO UPDATE
    SET role = 'super_admin', is_active = true;
END $$;

COMMIT;
