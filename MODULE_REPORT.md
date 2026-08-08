# Module Report — Module 1: Participants

## Files changed

**None in the application codebase.** Per your instruction to prefer existing patterns and avoid unnecessary refactoring: the Participants module's forms, Server Actions, and Zod schema were already written correctly against the designed schema — inspection confirmed `participants/actions.ts`, `ParticipantForm.tsx`, `page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`, and `lib/validation/schemas.ts`'s `participantSchema`/`participantImportRowSchema` all already reference the exact field set this fix makes real. Nothing there needed to change.

**One database migration applied directly to production** (`fix_participants_module_foundation`), approved by you after Supabase branching turned out to require a Pro-plan upgrade this project doesn't have. Full SQL is in the migration history under that name; summary:

- `public.participants` — added `participant_id`, `ic_passport_no`, `nationality`, `gender`, `date_of_birth`, `registration_date`, `emergency_contact_name`, `emergency_contact_phone`, `company_id` (all `ADD COLUMN IF NOT EXISTS`); expanded the `status` CHECK constraint additively (kept `active`/`inactive` for the legacy `/api/admin/certificates` route, added `registered`/`confirmed`/`attended`/`no_show`/`cancelled` for this module); added a `participant_id` auto-generator (`TU-000001` format, sequence-backed trigger).
- `public.companies` — **new table**, created because `ParticipantForm.tsx`'s "Linked company" dropdown and `participants.company_id` both require it. Built from the already-designed shape (migration `0019` in the repo's numbered lineage), with RLS using the `profiles.role` model (`app.is_editor()`/`app.is_admin()`) from the start, since it's a brand-new table with no legacy policy to preserve.
- `public.audit_logs` — **new table** + `app.audit_trigger()`/`app.set_updated_at()`/`app.stamp_actor()` generic trigger functions, created because both `participants` and the new `companies` table are staff-mutable and `CLAUDE.md`'s own rule requires an audit trigger on such tables. These are generic, reusable helpers — later modules needing the same pattern won't need to re-create them.

Every statement was `IF NOT EXISTS`-guarded or additive. Nothing was dropped, renamed, or destructively altered.

## Why

`QA_REPORT.md` (produced immediately before this fix, documenting the pre-fix state) found Create, Edit, and Import completely non-functional, and 4 of the participant detail page's 5 information cards permanently empty — all because the live `participants` table was missing 9 columns the already-written admin code depends on, and had no `companies` table for the FK the code also depends on. Per the schema-direction decision you made at the start of this fix phase (migrate the database forward to match the code, not rewrite the code to match the database), the fix was schema-side.

## What was fixed

- Participant **Create** and **Edit** now succeed — verified by simulating the exact insert/update payload shape `createParticipant`/`updateParticipant` send.
- Participant **List**, **search**, **filter (status)**, and **sort (including "Participant ID")** now operate against real columns instead of partially non-existent ones.
- **Soft delete** and **Restore** — were already working before this fix (they only ever touched the live `deleted_at` column); re-verified still correct after the schema change.
- The **"Linked company" dropdown** now has a real table to query (currently empty of rows — no companies have been entered yet, which is expected and correct; the dropdown will populate once Company records exist).
- **CSV/Excel export** (`participants/export/route.ts`) — its column list already matched the newly-added columns exactly; now returns real data instead of blank cells.
- **Discovery made during testing, not previously known**: `DATABASE_AUDIT.md`'s live-data snapshot stated `participants` had 0 rows. It does not — **125 real participant rows exist in production** (Malaysian names, real IC numbers on ~most rows). This means `DATABASE_AUDIT.md` is stale on this specific point (real data was evidently added to the live project after that report was last verified, within this session's timeframe). All 125 rows were confirmed intact after the migration — the additive backfill correctly populated their new `participant_id` (`TU-000001`–`TU-000125`) and `ic_passport_no` (copied from the legacy `identity_no` where present) columns without touching any existing data. **Flagging this for you directly: `DATABASE_AUDIT.md` should be refreshed before it's relied on again for row-count assumptions.**

## How tested

No browser/UI test was run (no dev server session in this environment) — verification was done at the database layer by simulating each Server Action's exact query shape directly against the live project, then cleaning up:

1. **Create**: inserted a test row with the exact field set `createParticipant` sends → succeeded, `participant_id` auto-generated as `TU-000126` (next in sequence after the 125 real rows).
2. **Edit**: updated the test row's `position`/`status` exactly as `updateParticipant` would → succeeded.
3. **List query**: ran the list page's exact `select` + `.or()` search + `.eq()` status filter + `.order()` sort, matching the test row → returned the correct row with all columns populated.
4. **Soft delete → Restore**: set then cleared `deleted_at` on the test row → both operations succeeded, matching `softDeleteParticipant`/`restoreParticipant`'s exact behavior.
5. **Cleanup**: deleted the test row entirely; confirmed zero rows remain matching it. **The 125 real participant rows were not touched by any test step** — only read (to confirm they survived the migration intact) and previously, correctly, backfilled by the migration itself.
6. **Role/permission guards**: not independently re-tested (no code changed in `actions.ts`, and `requireRole("admin")`/`requireRole("editor")` guard logic was already verified correct in this session's earlier `SYSTEM_AUDIT.md` pass) — no reason to expect regression, but this is a real gap versus an actual logged-in-as-each-role browser test. Flagged under Remaining Issues.

## Remaining issues

- **Not independently tested in a real browser** — all verification above is at the SQL layer, simulating what the Next.js Server Actions do. A real click-through (as editor, as admin, as a non-staff user hitting `/admin/participants` directly) has not been performed this session. Recommend doing this before considering Participants fully closed out, even though the underlying data-layer fix is confirmed correct.
- **"Course / Schedule" dropdown remains empty** — `loadScheduleOptions()` queries a table (`schedules`) that doesn't exist in either live or designed-final schema (it was superseded by `training_schedules` before the designed schema was ever applied). This field is explicitly optional and the code's own comment marks it "legacy... remains for backward compatibility," so it degrades gracefully (empty dropdown, not an error) rather than blocking anything. **Deferred to Module 10 (Schedules)** — fixing it properly means the `training_schedules` table existing, which is that module's own scope.
- **Company dropdown will stay empty until real companies exist** — the table now exists, but no admin UI has been used to populate it yet (Companies is Module 8, not yet reached). Not a bug — expected state.
- **Participant detail page's Training History / Certificates / Attendance / Assessment cards will continue showing "no records yet"** even for participants who do have them, until Schedules, Certificates, Attendance, and Assessment (Modules 3, 6, 7, 10) are fixed in their own turns — these queries fail gracefully (confirmed: Supabase client returns `null` data rather than throwing) rather than erroring, but they don't show real data yet either.
- **Unbounded `.limit(100000)` fetch in the CSV import duplicate-check** (`participants/import/importActions.ts:46`, flagged in `PERFORMANCE_REPORT.md`) was **not** fixed in this pass — it's a scale/performance concern, not a functional break, and fixing it wasn't part of what `QA_REPORT.md` flagged as FAIL. Noting it here rather than silently leaving it out of the record.
- **`DATABASE_AUDIT.md` needs a refresh** — see the discovery noted above (125 real participant rows, not 0). I have not updated that file; flagging it for your decision on whether to fix now or batch it with a later documentation pass.

---

Stopping here per your instruction. Waiting for approval before continuing to **Module 2: Courses**.
