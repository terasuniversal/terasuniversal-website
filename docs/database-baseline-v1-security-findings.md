# TERAS Database Baseline V1 — Final Candidate Security Findings

Snapshot: `2026-08-15T04:18:21.761Z` (`2026-08-15T12:18:25.725+08:00` MYT). Production project: `iagzkrzeuawaxvacqprk`. Production application SHA: `f4c2387559da1208468251f0d1236b8d930bc363`.

This report is read-only production evidence. It does not approve production migration-history adoption.

## Resolved in production

The following former Baseline V1 blockers are **RESOLVED_IN_PRODUCTION** and are represented in `supabase/baseline/v1/schema.sql`.

| Finding | Final observed state |
| --- | --- |
| `public.verify_certificate_by_value(text)` | `anon` and `authenticated` cannot execute; `service_role` can execute. |
| `public.log_event(...)` | `anon` and `authenticated` cannot execute; `service_role` can execute. |
| `app.log_event(...)` | Ordinary client roles cannot execute; `service_role` can execute. |
| `public.audit_logs` direct forgery | `audit_insert` policy is absent; `anon` and `authenticated` have no direct `INSERT` grant. |
| `public.log_event_as_service(...)` | `anon` and `authenticated` cannot execute; `service_role` can execute. |
| `postgres` future object defaults | Public-schema table and sequence defaults are restricted; future function defaults do not grant `PUBLIC EXECUTE`. `supabase_admin` defaults were not changed. |
| `public.mark_proposal_delivery_status(uuid, boolean, boolean)` | `anon` and `authenticated` cannot execute; `service_role` can execute. It remains `SECURITY DEFINER`, returns `void`, has `search_path=pg_catalog, public`, and retains the ten-minute update predicate. |

No previously resolved issue is counted as an active High finding.

## Current security inventory

- Application schema scope: `public`, `app`.
- Tables with RLS: `47`; FORCE RLS: `8`; policies: `109`.
- `SECURITY DEFINER` functions: `33`.
- `SECURITY DEFINER` functions with effective `PUBLIC EXECUTE`: `5`; executable by `anon`: `14`; executable by `authenticated`: `26`.
- `SECURITY DEFINER` functions lacking an explicit `search_path` setting: `0`.
- Both observed application views are `security_invoker=true`; `anon` lacks `SELECT` on both.

These are catalog counts, not an allowlist approval. The remaining executable privileged routines require the existing final-freeze review and fresh-environment negative-test gate.

## Remaining non-blocking backlog

| Classification | Item | Evidence and required follow-up |
| --- | --- | --- |
| POST_BASELINE_SECURITY_HARDENING | `feedback_anonymous_stats(uuid)`, `feedback_generate_links(uuid)`, `feedback_reopen(uuid)` | Each is `SECURITY DEFINER` and executable by `anon`/`authenticated`. Their explicit functional authorization and abuse-resistant public contract require per-RPC allowlist and negative tests. No confirmed privilege-escalation exploit was observed in this snapshot collection. |
| POST_BASELINE_SECURITY_HARDENING | Search-path hardening review | Several `SECURITY DEFINER` routines retain explicit `search_path=public` or empty search path rather than the stronger `pg_catalog, <required schemas>` pattern. Preserve live semantics in Baseline V1; harden individual routines in reviewed follow-up migrations. |
| PLATFORM_CONFIGURATION | Leaked-password protection | Supabase Auth configuration, not application-owned database schema. Requires security/product configuration decision. |
| STALE_DENY_ALL_ACCEPTABLE | Photo tables with RLS and no policies | `photo_activity_log`, `photo_ai_analysis`, `photo_categories`, `photo_events`, `photo_id_sequences`, `photo_usage_types`, `photo_usages`, and `photos` are deny-all to ordinary API roles. Feature intent remains a product decision; do not invent policies in the baseline. |
| PLATFORM_CONFIGURATION | Storage mismatch | Private `teras-photos` exists with zero observed `storage.objects` policies, while current application media code refers to `media`. Storage configuration and path conventions require a separate artifact and fresh-environment test. No Storage object rows are in the snapshot. |
| POST_BASELINE_SECURITY_HARDENING | `pg_trgm` placement/dependency | Installed in `public`; direct application dependency and desired extension placement require review before the active baseline migration is authored. |

## Security gate result

There are no known active High baseline blockers in this candidate. Remaining entries must stay explicit in the post-baseline backlog and must not be silently accepted as a public-RPC allowlist. Production migration-history adoption remains blocked until the final active-chain fresh-environment reconstruction and security test matrix pass.
