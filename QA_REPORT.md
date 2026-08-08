# QA Report — Module: Participants (pre-fix baseline)

Tested against the live, connected Supabase project. No code was modified to produce this report. This is the "before" baseline for the fix currently in progress — see `MODULE_REPORT.md` once the fix lands for the "after" state.

Rating scale: **PASS** / **WARNING** (works but with a caveat) / **FAIL**.

| Feature | Rating | Evidence |
|---|---|---|
| List page loads | WARNING | Renders; pagination/search/filter/sort controls are all present and wired correctly against the live `participants` table's existing columns (`full_name`, `company`, `created_at`) |
| Pagination | PASS | `Pagination` component, `.range()`-based, correct |
| Search | PASS | Works for `full_name`/`company`; searches `participant_id`/`ic_passport_no` too but those columns don't exist live, so those two clauses in the `.or()` silently contribute nothing rather than erroring (PostgREST tolerates unknown columns in an `.or()` string only if the column truly doesn't exist — **needs live re-verification, flagged as a WARNING not a confirmed PASS** for the two designed-only columns) |
| Sorting | WARNING | `SORTABLE` map includes `id: "participant_id"`, a column that doesn't exist live — sorting by "Participant ID" will error |
| Filter (status) | FAIL | Filter dropdown offers `registered/confirmed/attended/no_show/cancelled` — the live `status` CHECK constraint only permits `active`/`inactive`; filtering by any of the 5 designed values returns zero rows even if matching data existed under a different label |
| Filter (company) | PASS | `company` is a real live column |
| **Create** | **FAIL** | `createParticipant` writes `ic_passport_no`, `nationality`, `gender`, `date_of_birth`, `emergency_contact_name`, `emergency_contact_phone`, `registration_date`, `company_id` — **none exist on the live table**. Every submission is rejected by PostgREST with an unknown-column error |
| **Edit** | **FAIL** | Same root cause as Create — `updateParticipant` writes the same non-existent columns |
| Delete (soft) | PASS | `softDeleteParticipant` only touches `deleted_at`, which is live — works in isolation |
| Restore | PASS | `restoreParticipant` only touches `deleted_at` — works in isolation |
| Bulk delete/restore | PASS | Same live column, same result |
| Validation (Zod) | PASS | `participantSchema.safeParse()` runs before every write — correctly implemented, just validating a shape the database doesn't accept |
| Server Actions | WARNING | Correctly guarded (`requireRole("admin")` for writes, `"editor"` for read) and structured (guard → validate → mutate → revalidate) — the pattern is right, the target schema is wrong |
| Supabase queries | FAIL | List/detail/create/update queries reference `participant_id`, `ic_passport_no`, `nationality`, `gender`, `date_of_birth`, `registration_date`, `emergency_contact_name/_phone`, `company_id` — none exist live |
| Detail page — core fields | WARNING | `full_name`, `phone`, `email`, `company`, `position`, `address` render correctly (live columns); `participant_id`, `ic_passport_no`, `nationality`, `gender`, `date_of_birth`, `registration_date` render as blank (`—`) since the underlying columns don't exist and `.select("*")` simply omits them |
| Detail page — Training History | FAIL | Queries `schedule_participants` and `training_schedules` — neither exists live; always shows "No training history yet" regardless of real data |
| Detail page — Certificates | FAIL | Queries `certificates.certificate_number` — doesn't exist live (`certificate_no` does); always shows "No certificates issued yet" |
| Detail page — Attendance | FAIL | Queries `attendance.attendance_status` and joins `training_schedules` — neither exists live; always empty |
| Detail page — Assessment | FAIL | Queries `assessments.assessment_type`/`result`/`overall_score` — none exist live; always empty |
| Create/edit form — company dropdown | FAIL | `loadCompanyOptions()` queries `companies` — table doesn't exist live; dropdown is always empty |
| Create/edit form — schedule dropdown | WARNING | `loadScheduleOptions()` queries `schedules` — a table that doesn't exist in *either* live schema track (not even the designed one, which superseded it with `training_schedules`); dropdown is always empty. Field is explicitly optional and the code's own comment marks it "legacy... remains for backward compatibility," so this degrades gracefully rather than erroring |
| Import (CSV) | FAIL | Same root cause — `participants/import/importActions.ts` writes the same non-existent columns as Create |
| Export (CSV/Excel) | WARNING | Export route needs live-testing separately; likely selects `*` or a similar broad column set and would either error or silently omit the designed-only columns, consistent with the detail page's behavior |
| Loading state | WARNING | No route-level `loading.tsx` anywhere in the app (confirmed repo-wide) — page blocks until the full server fetch resolves rather than showing a skeleton. Not specific to Participants |
| Empty state | PASS | `EmptyState` component renders correctly when a query legitimately returns zero rows |
| Error state | WARNING | No inline "this query failed" surfaced anywhere on this module's pages — a failed cross-reference query (Training History, Certificates, Attendance, Assessment) is visually indistinguishable from "this participant genuinely has none," because `{ error }` is never checked/surfaced on any of these `Promise.all` queries |
| Success notification | WARNING | No toast — success is implicit via redirect to the list/detail page. Moot for Create/Edit today since they never reach success (FAIL above) |
| Role protection | PASS | `requireRole("editor")` for read, `requireRole("admin")` for every write — correctly enforced at the page/action level |
| Navigation | PASS | Sidebar entry present, all internal links resolve to the correct routes |
| UI consistency | PASS | Uses the shared `Card`/`Field`/`Badge`/`Pagination`/`EmptyState` primitives consistently with the rest of the admin area — no bespoke styling |

## Summary

**4 FAIL-rated features block this module from being usable at all: Create, Edit, Import, and 4 of the detail page's 5 information cards.** Per your instruction, these are being fixed now before continuing to Module 2 — see `MODULE_REPORT.md` for what was changed, why, and how it was verified once the fix is complete.
