# Anon RLS remediation (A-series): LOCAL DESIGN ONLY, NOT A MIGRATION, NOT APPLIED

Prepared 2026-11-23. Separate from R1/R2/R3. Owner approval required for any SQL file, Staging apply or Production apply.
Ownership of the fix is still to be agreed with the website session (they run a parallel read-only P0 investigation).

## Root cause (VERIFIED on Staging, catalog-identical on Production)
`anon` SELECT on news_posts, faqs, news_categories, gallery_images, downloads -> `42501 permission denied for function is_editor`.
Staff policies are `TO public` and call `app.is_editor()` / `app.is_admin()` / `app.has_min_role()` / `has_module_access_level()`;
`anon` has no EXECUTE on those helpers (ACL postgres + authenticated) and no USAGE on schema `app`. PostgreSQL evaluates every
applicable permissive policy, so a staff policy breaks the anon query even when `*_public_read` would allow the row.

## Inventory (VERIFIED, pg_policies, roles && {public,anon}, expression uses a privileged helper)
| | Staging | Production |
|---|---|---|
| policies | 54 | 43 |
| tables | 16 | 17 |
| tables with `*_public_read` (anon meant to read published rows) | downloads, faqs, gallery_images, media, news_posts, company_profile | same 6 |
Tables in scope (both unless noted): certificate_templates, certificate_verifications (Production only), companies, company_profile,
downloads, faq_categories, faqs, gallery_categories, gallery_images, invoice_items, legacy_course_map, legacy_import_batches,
legacy_participant_staging, media, media_folders, news_categories, news_posts.
Difference: Staging has the R1 split/category policies (`*_editor_select/insert/update/delete`, module-aware); Production still has
`*_editor_all` FOR ALL policies (R1 not applied there). company_profile SELECT is only `company_profile_public_read` (true): anon works.

## A1 original broad option: SUPERSEDED (see "Converged minimal scope" below)
> Superseded 2026-11-23 (website finding F-A1-1). The text below described retargeting every policy in the inventory
> (54/43). The prepared migration covers ONLY the nine staff SELECT policies listed under "Converged minimal scope".
> Kept for history; do not implement from this section.
- `alter policy <name> on public.<table> to authenticated;` for every policy in the inventory. USING / WITH CHECK unchanged
  (verbatim), command unchanged. No helper grant to anon, no schema USAGE to anon.
- Effect: anon only evaluates `*_public_read` (no helper call) -> published rows for the 5 public tables, 0 rows elsewhere
  instead of 42501. authenticated / trainer / staff behaviour unchanged (trainer = authenticated). service_role bypasses RLS.
- Out of scope for A1 (track separately): category tables have no public read policy, so a future public category list would
  return 0 rows for anon; adding `*_public_read` to categories is a product decision, not a bug fix.
- Fail-closed preflight: every target policy's (table, name, cmd, roles = {public}, qual, with_check) must equal the captured
  text for THAT project (Staging and Production manifests differ); non-target policies snapshotted and re-checked.
- Postconditions: 0 policies with roles && {public,anon} whose expression references app.*/has_module_access*/has_min_role;
  every `*_public_read` unchanged; total policy count unchanged; fingerprints of non-target policies unchanged.
- Rollback: `alter policy ... to public` for the same names (exact inverse, captured list).
- Ordering: on Production, A1 must run AFTER R1 (A1 manifest must describe the post-R1 policy set) or be re-captured.

### Converged minimal scope (website P0 review, 2026-11-23; pending Owner decision)
Website probe adds media, faq_categories, gallery_categories, media_folders to the 42501 list (same message). Agreed minimal A1 =
retarget only the staff SELECT/ALL policies on 9 tables to `authenticated`:
Group A (has public_read): news_posts, faqs, gallery_images, downloads, media.
Group B (no public_read): news_categories, faq_categories, gallery_categories, media_folders.
Group C (internal, fails closed for anon: certificate_templates, companies, invoice_items, legacy_*) and the staff write
policies stay out of A1 (they already deny anon; optional consistency pass later). Proposed ownership: CRM owns the migration;
website provides independent review, anon/non-staff regression contract, and the public-content.ts `error` handling follow-up.

## A2 (defence in depth): reduce anon table privileges on content tables
- VERIFIED: anon holds INSERT/UPDATE/DELETE/TRUNCATE (plus REFERENCES/TRIGGER) on 52 Staging tables and 20 Production
  tables, including all content tables. RLS blocks DML but not TRUNCATE (PostgREST does not expose TRUNCATE; INFERRED low risk).
- Proposal: `revoke insert, update, delete, truncate, references, trigger on <content tables> from anon;` keep SELECT only where a
  `*_public_read` exists; revoke SELECT where anon has no legitimate read (decide per table with the website owner).
- Must first confirm no public route writes these tables with the anon key (public forms use RPCs / API routes; verify again).
- Separate migration from A1; same fail-closed + exact-inverse rollback pattern (re-grant the captured privilege set).

## Rejected
- GRANT EXECUTE on app.is_editor / USAGE on schema app to anon (widens surface to silence an error).

## Contract tests required (before any apply)
1. Static: manifest of target policies per project equals live capture; migration changes roles only (no qual/with_check diff).
2. Static: no `grant ... to anon` / `usage on schema app` in the A1/A2 files.
3. Persona (rolled-back, separate approval): anon SELECT on the 5 public tables returns published rows only, no 42501; anon
   DML -> DENY_PRIV_TABLE (after A2) or DENY_RLS; super_admin / Custom editor results identical to the R1 Tier A/B baselines.
4. Website regression (joint): every public route still renders; a CMS-backed preview of getPublishedFaqs / getGallery returns rows.

## Public website dependencies (VERIFIED in code at main 5b8a77ad)
/faq, /insights, /gallery read `data/*.js`; `lib/public-content.ts` helpers have 0 callers; public schedules use
`get_public_upcoming_schedules` (SECURITY DEFINER). Current runtime impact: none. Future CMS pages are blocked until A1 lands,
and would fail silently today (`data ?? []` ignores `error`).
