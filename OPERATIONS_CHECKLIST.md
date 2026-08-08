# TERAS CMS — Operations Checklist

Routine checks for keeping the production admin CMS (`https://www.terasuniversal.com.my/admin`) healthy after the `v1.2.2-production-baseline` release. Pair with `KNOWN_ISSUES.md` (don't re-report anything already listed there as new) and `docs/release/PRODUCTION_BASELINE_2026-08-08.md` for context on what was verified at baseline.

## Daily

- [ ] **Dashboard** loads without error; published-course, participant, and certificate-issued counts look plausible (no unexplained jump to 0).
- [ ] **New participant records** registered today appear correctly in the Participants list with correct name/IC-passport/company fields.
- [ ] **Attendance** for any session run today was recorded and saved correctly.
- [ ] **Certificate generation** — any certificates issued today show up in the Certificates list with status "Valid" and a correct certificate number.
- [ ] **QR verification** — spot-check one certificate issued today at `/verify` and confirm it resolves as valid with the correct participant/course/date.

## Weekly

- [ ] **Exports** — run a CSV and Excel export from the Certificates module; confirm both download successfully (no HTTP error) and the row count matches the visible register.
- [ ] **Reports** — open Reports & Analytics; confirm "Certificates issued" matches the Certificates module's own "Issued" stat card (they must always agree — this was the root cause of Defect 1).
- [ ] **Audit logs** — review `/admin/audit` for unexpected actions (unrecognized actor, bulk deletes, role changes).
- [ ] **Certificate counts** — cross-check Dashboard, Reports, and Certificates module counts against each other; they should always be identical.
- [ ] **Backups** — confirm Supabase's managed backups are current (Backups module / Supabase dashboard) — this app does not trigger backups itself.
- [ ] **Failed/error records** — check for any participants, certificates, or attendance rows in an obviously broken state (missing required fields, orphaned references).

## Monthly

- [ ] **Data quality review** — spot-check `category`/`featured` population on Courses, and confirm no new pattern of empty required-looking fields has emerged.
- [ ] **Duplicate monitoring** — run a quick check for new duplicate courses (same title/slug, multiple rows) to confirm Defect 3's prevention is still holding; total course count should not silently balloon. Do **not** act on the known 121 pre-existing legacy duplicates (see `KNOWN_ISSUES.md` §1) without a separate, explicit approval.
- [ ] **Dependency/security review** — run `npm audit`; review and plan any new advisories. Re-confirm `package.json`'s pinned Node version still matches what's actually deployed.
- [ ] **Storage usage** — check Supabase Storage bucket usage (media, downloads, private) against plan limits.
- [ ] **Vercel deployment health** — confirm the latest production deployment is Ready, review recent build logs for new warnings, and confirm the deployed commit matches `origin/main`.

## Escalation

If any daily/weekly check fails unexpectedly (not one of the items already tracked in `KNOWN_ISSUES.md`), stop and investigate before assuming it will self-resolve — do not silently work around it. Do not attempt schema changes, bulk data cleanup, or force-pushes as part of routine operations; those require the same explicit-approval process used to reach this baseline.
