-- TERAS UNIVERSAL
-- Security Remediation Pack 1
--
-- Forward-only remediation for Baseline V1 blockers:
--   * remove anonymous/ordinary-client access to the legacy certificate lookup;
--   * remove ordinary-client access to the audit wrapper;
--   * make audit-log inserts trusted-server/trigger only;
--   * make future application-owned public objects opt-in by default.
--
-- This migration intentionally does not alter Staff User Management, Sales,
-- Certificate issuance, or other business workflows.

BEGIN;

-- The current public verification UI uses verify_and_log(), which returns the
-- approved safe response shape. The legacy function also accepts identity_no
-- and returns broader certificate data, so retain it for trusted service-role
-- compatibility but remove API-client execution.
REVOKE EXECUTE ON FUNCTION public.verify_certificate_by_value(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_certificate_by_value(text)
  TO service_role;

-- Public verification remains an explicit public endpoint. It does not expose
-- identity_no lookup and returns only the safe verification response.
REVOKE EXECUTE ON FUNCTION public.verify_and_log(text, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_and_log(text, text, text, text)
  TO anon, authenticated;

-- Browser/session clients must not submit arbitrary audit events. Existing
-- server-side audit callers are migrated to public.log_event_as_service().
REVOKE EXECUTE ON FUNCTION public.log_event(audit_action, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_event(audit_action, text, text, text, jsonb)
  TO service_role;

-- The old helper depends on auth.uid(), so it is no longer an ordinary-client
-- entry point. Trigger paths remain owned-server execution paths.
REVOKE EXECUTE ON FUNCTION app.log_event(audit_action, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.log_event(audit_action, text, text, text, jsonb)
  TO service_role;

-- Trusted server audit writer. Actor identity is supplied only by the
-- server-only application helper after it verifies the current session.
CREATE OR REPLACE FUNCTION public.log_event_as_service(
  p_actor_id uuid,
  p_actor_email text,
  p_action audit_action,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'audit_actor_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs
    (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  VALUES
    (p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
     p_summary, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.log_event_as_service(uuid, text, audit_action, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_event_as_service(uuid, text, audit_action, text, text, text, jsonb)
  TO service_role;

-- Remove direct client insertion. Trigger functions and SECURITY DEFINER
-- trusted writers remain able to insert; service_role retains explicit access.
DROP POLICY IF EXISTS audit_insert ON public.audit_logs;
REVOKE INSERT ON public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.audit_logs TO service_role;

-- Future application-owned public objects must opt in to browser access.
-- Platform-managed supabase_admin defaults are intentionally untouched.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMIT;
