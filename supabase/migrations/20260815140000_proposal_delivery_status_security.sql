-- Security remediation: proposal delivery status is an internal server-side
-- operation. Public form visitors may submit a proposal, but must never be
-- able to alter delivery flags on proposal_requests directly.

CREATE OR REPLACE FUNCTION public.mark_proposal_delivery_status(
  p_id uuid,
  p_email_sent boolean,
  p_sheets_synced boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.proposal_requests
  SET email_sent = p_email_sent,
      sheets_synced = p_sheets_synced,
      updated_at = now()
  WHERE id = p_id
    AND created_at > now() - interval '10 minutes';
$$;

REVOKE ALL ON FUNCTION public.mark_proposal_delivery_status(uuid, boolean, boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_proposal_delivery_status(uuid, boolean, boolean)
  TO service_role;
