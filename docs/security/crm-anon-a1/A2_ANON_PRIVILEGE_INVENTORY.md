# A2: anon privilege inventory (READ-ONLY, 2026-11-23). NOT IMPLEMENTED.

Separate track from A1. No revoke is proposed for execution here; this is the evidence base for an A2 design.

## Table / view privileges held by anon (has_table_privilege, schema public)
| | Staging eokiaehn | Production iagzkrzeuawaxvacqprk |
|---|---|---|
| relations with any anon privilege | 52 | 20 |
| with INSERT/UPDATE/DELETE/TRUNCATE | 52 | 20 |
| with TRUNCATE (not governed by RLS) | 52 | 20 |
| anon-readable views | `v_certificate_eligibility` (VIEW, RLS does not apply to views; investigate separately) | none |
| tables without RLS that anon can read/write | none | none |

Tables where anon is meant to read (a SELECT policy for public/anon that does not call a privileged helper):
- Content: company_profile, downloads, faqs, gallery_images, media, news_posts (both projects).
- Website / PKG-1 owned (do not touch from CRM): public_rate_limits, public_registration_attendees,
  public_registration_payments, public_registrations (both); payment_receiving_accounts,
  public_registration_additional_funds (Staging only, DB-G1).

## Functions anon can EXECUTE
- SECURITY DEFINER (public entry points): Staging 8 = feedback_get_by_token, feedback_submit,
  get_public_registration_schedule, get_public_registration_status, get_public_upcoming_schedules,
  submit_proposal_request, submit_public_enquiry, verify_and_log.
  Production 11 = the same 8 + **feedback_reopen, feedback_generate_links, feedback_anonymous_stats** (staff RPCs).
  - Production drift: these three are anon-EXECUTE on Production but not on Staging. Their bodies guard internally with
    `app.has_min_role('editor')` (reopen raises 42501, generate_links returns nothing), so they fail closed for anon
    (INFERRED from source; not executed). Revoking anon EXECUTE is defence in depth (R5 overlap).
- SECURITY INVOKER that contain INSERT/UPDATE/DELETE text: `teras_photo_next_id` (EXECUTE also granted to PUBLIC) on both.
  Runs with the caller's privileges, so it is bounded by anon's table privileges; review before revoking table grants.

## Proposed A2 shape (for a later, separately approved design)
1. Content tables (the 9 A1 tables + company_profile, courses, cms_*): revoke INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
   TRIGGER from anon; keep SELECT only on the six tables with a public read policy.
2. CRM-internal tables with no anon read policy: revoke all from anon (per-table list, captured manifest, exact re-grant
   rollback). Coordinate any table also read by public flows.
3. Leave website / PKG-1 tables and their RPC grants to the website track.
4. Before any revoke: confirm no anon caller writes the table directly (website reports: main has no direct anon writes,
   all public flows use RPCs) and review SECURITY INVOKER functions executable by anon.
5. Production: revoke anon EXECUTE on feedback_reopen / feedback_generate_links / feedback_anonymous_stats (align with Staging).
