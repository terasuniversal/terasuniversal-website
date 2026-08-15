-- TERAS UNIVERSAL
-- Security Remediation Pack 1 — Revision A
--
-- PostgreSQL grants PUBLIC EXECUTE to newly created functions by default.
-- A schema-scoped default ACL cannot revoke that global default, so this
-- owner-global revocation is required for functions created by postgres.

BEGIN;

-- Applies only to future functions owned by postgres. Existing functions and
-- their explicit public-RPC grants are unchanged.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
