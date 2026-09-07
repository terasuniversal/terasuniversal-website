-- Phase 3 staging/runtime repair: manual verification hashes registration
-- secrets with pgcrypto.digest(), which is installed in the extensions schema.
-- This additive repair preserves the existing function contract and CRM flow.
alter function public.verify_public_registration_manual_payment(
  text, text, numeric, text, text, uuid
) set search_path = pg_catalog, public, app, extensions;
