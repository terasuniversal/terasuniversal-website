# SECURITY FINDINGS — Production

Read-only audit of production functions, RLS, grants, and triggers.
Project: `iagzkrzeuawaxvacqprk`. Audit date: 2026-08-16.
**Nothing was changed. This report lists findings only; fixes require separate approval.**

## Inventory
- 78 functions/RPCs (34 `SECURITY DEFINER`, 0 SD functions lack an explicit `search_path`).
- 49 tables/relations with RLS enabled; **8 FORCE RLS**; 109 policies; 48 triggers.
- 7 extensions (`citext`, `pg_trgm`, `pgcrypto`, `pg_stat_statements`, `uuid-ossp`, `supabase_vault`, `plpgsql`).
- 6 enums: `user_role`, `content_status`, `schedule_status`, `company_status`, `media_kind`, `audit_action`.
- Roles: `anon`, `authenticated`, `service_role`, `postgres`, `supabase_admin`, `authenticator`, etc. (`service_role`/`postgres` have BYPASSRLS by default).

## Findings (ranked)

### CRITICAL
None confirmed. All SD functions have explicit `search_path`; no SD function exposes an obviously destructive path to `anon`.

### HIGH

**H1. Admin mutations exposed as `authenticated`-executable `SECURITY DEFINER` (bypass RLS, rely on in-body guards).**
Functions: `app.issue_certificate_with_skill_snapshot`, `app.duplicate_certificate_with_skill_snapshot`, `public.convert_lead_to_opportunity`, `public.accept_quotation`, `public.reject_quotation`, `public.mark_opportunity_lost`.
- Verified: each contains an internal `app.is_admin()` (or equivalent) check, so **today they are guarded**.
- Risk: they bypass RLS by design; a future edit that removes/weakens the in-body guard, or a role-hierarchy bug in `is_admin()`, silently widens access. This is the repo's documented deviation from "RLS is the enforcement boundary".
- Recommendation: keep; add a regression test asserting the guard exists; prefer tightening to `admin`-only grants if the app code never calls them as editor.

**H2. `public.teras_photo_next_id(...)` is `PUBLIC`-executable `SECURITY DEFINER`.**
- Returns the next photo id sequence value to anyone.
- Low impact (a sequence value is not sensitive), but it is the only app-owned PUBLIC-executable SD function; confirm it must be PUBLIC.

**H3. Photo-bot schema has no local migration.**
`photos`, `photo_*` tables + functions exist only as remote-only migrations. Any future `supabase db push`/CI from the repo would fail or drop coverage. (This is a baseline/reproducibility issue with security implications: grants/RLS for these objects cannot be reviewed from the repo.)

### MEDIUM

**M1. `public.verify_and_log(...)` is `anon`-executable SD, `search_path=public`.**
- Public certificate verification + audit logging. The audit-log write inside an SD anon-callable function is the intended design (prevents direct `audit_logs` forgery — `audit_insert` policy absent, no anon/authenticated INSERT grant). Keep, but note the `search_path=public` is fine here (no writable relation named like attackers could hijack in `public` that is not owned).

**M2. Public inbound RPCs (`submit_proposal_request`, `submit_public_enquiry`) are `anon` SD.**
- Expected for public forms. Both set `search_path=public`, validate inputs, and have rate-limit guards. `mark_proposal_delivery_status` correctly restricted to `service_role`/`postgres`.

**M3. `feedback_*` RPCs are `anon`/`authenticated` SD with `search_path=""` (empty).**
- `feedback_submit`, `feedback_get_by_token`, `feedback_generate_links`, `feedback_reopen`, `feedback_anonymous_stats`. Empty search_path is the safe pattern. Confirm token entropy and that `feedback_generate_links` can't be abused for enumeration beyond its schedule scoping.

**M4. RLS not FORCEd on most tables (41 of 49).**
- Only 8 tables FORCE RLS. Postgres owner + BYPASSRLS roles (service_role, postgres) bypass RLS regardless. This matches the platform default; acceptable, but any future "security-in-depth" goal should FORCE RLS on the most sensitive tables (`profiles`, `sales_*`, `certificates`, `participants`).

**M5. `admin_users`-gated legacy policy family coexists with `profiles.role`-based policies.**
- Some tables (certificates/participants/courses historically) have policies using `admin_users` membership; newer tables use `app.is_editor()`/`app.is_admin()`. Two independent authz models live side by side (documented in `DATABASE_AUDIT.md`/`SECURITY_REPORT.md`). Not exploitable, but a source of confusion and drift.

### LOW

**L1. `pg_trgm` installed in `public` schema** (extension + its functions PUBLIC-executable). Benign (informational search functions), but it widens the PUBLIC function surface.

**L2. Duplicate/orphan risk:** `cms_content`/`cms_media` generic tables are live but unused (superseded by `news_*`/`media_*`). Empty; harmless but dead weight.

**L3. `supabase_vault` extension present and unused by app code** — surface area with no current consumers.

**L4. `authenticated` has UPDATE on `proposal_requests` and `sales_lead_metadata` via RLS policies gated by `app.has_min_role('editor')`/`app.is_admin()`** — correct gating; verified.

**L5. `teras_photo_next_id` search_path hardening** applied out-of-band (`harden_teras_photo_next_id_search_path`) — consistent.

## Verified-good items (no action)
- `mark_proposal_delivery_status`: SD, `search_path=pg_catalog, public`, EXECUTE only `service_role`/`postgres`, 10-minute update window.
- `audit_logs`: no INSERT policy for anon/authenticated; logging channel is `app.log_event`/`log_event_as_service` (service-only).
- `v_sales_lead_inbox` / `v_certificate_eligibility`: `security_invoker=true`; no anon SELECT.
- All RLS helper functions (`app.is_*`, `app.has_min_role`, `app.current_role`) have explicit `search_path=public`.
- No dynamic SQL (string-built queries) found in privileged functions.

## Recommended remediation order (after this audit is approved)
1. Reproduce + test the H1 in-body guards (automated policy test).
2. Decide on `teras_photo_next_id` PUBLIC exposure.
3. Add the missing photo-bot/feedback migrations to the repo so the security surface is reviewable and replayable.
4. Introduce FORCE RLS on sensitive tables as a forward-only, additive migration.
5. Retire the `admin_users` policy family or document it as frozen (do NOT delete without explicit approval).
