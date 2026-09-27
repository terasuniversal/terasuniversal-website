-- Disposable local Supabase harness only; never run against STAGING or Production.
-- Apply after restoring staging-public-app-schema.sql and before certificate_i2_c5_security_contract.sql.
-- Supabase local role defaults grant TRUNCATE to anon/authenticated when the
-- schema-only fixture creates this table. The hosted post-170000 ACL instead
-- denies anon direct access and grants authenticated SELECT only.
DO $acl_fixture$
BEGIN
  IF to_regclass('public.certificate_verifications') IS NULL
    OR to_regclass('public.certificate_verifications_id_seq') IS NULL THEN
    RAISE EXCEPTION 'I2 ACL fixture requires restored verification table and sequence';
  END IF;
END;
$acl_fixture$;

REVOKE ALL PRIVILEGES ON TABLE public.certificate_verifications
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.certificate_verifications TO authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.certificate_verifications_id_seq
  FROM PUBLIC, anon, authenticated;

SELECT
  pg_catalog.has_table_privilege('anon', 'public.certificate_verifications', 'TRUNCATE') AS anon_truncate,
  pg_catalog.has_table_privilege('authenticated', 'public.certificate_verifications', 'TRUNCATE') AS authenticated_truncate,
  pg_catalog.has_table_privilege('authenticated', 'public.certificate_verifications', 'SELECT') AS authenticated_select,
  pg_catalog.has_table_privilege('anon', 'public.certificate_verifications', 'INSERT') AS anon_insert,
  pg_catalog.has_table_privilege('authenticated', 'public.certificate_verifications', 'INSERT') AS authenticated_insert,
  pg_catalog.has_table_privilege('anon', 'public.certificate_verifications', 'SELECT') AS anon_select;
