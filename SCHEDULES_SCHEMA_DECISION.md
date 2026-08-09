# Schedules — Live Schema Decision & Migration Plan

**Status: AUDIT / ARCHITECTURE DECISION ONLY. No tables created, no migrations run, no data modified, nothing committed.**

Every claim below is grounded in either (a) a live query against the connected Supabase project (`iagzkrzeuawaxvacqprk`) run this session, or (b) a specific file/line read this session. Where the two disagree, that disagreement is the headline finding of this document — see §0.

---

## 0. Headline finding — the premise needs correcting before anything else

The task brief assumes the minimum live schema for Schedules is a new `training_schedules` + `schedule_participants` pair. **That is not what the live database supports, and building it that way would violate this repo's own CLAUDE.md §11 rule 3** ("Never create a second implementation of a table/feature that already exists under a different name... This codebase has three different 'schedule' tables (`schedules`, `course_schedules`, `training_schedules`) as a direct result of exactly this pattern.").

Live query results (this session):

| Table | Live? | Rows |
|---|---|---|
| `training_schedules` | **No** | — |
| `schedule_participants` | **No** | — |
| `schedules` | **No** | — |
| `course_schedules` | **Yes** | 0 |
| `attendance` | **Yes** | 0 |
| `assessments` | **Yes** | 0 |
| `trainers` | **No** | — |

`course_schedules` was created by `supabase/migrations/20260721030829_production_cms_additive_compatibility.sql`, with its own comment making the intent explicit:

```sql
-- Separate training-session table; legacy certificates continue to use their
-- existing course link and can optionally reference a session in future.
create table if not exists public.course_schedules (...)
```

That same migration, in the same statement block, already wired live FKs:

```
attendance.schedule_id      -> course_schedules(id)   [not null, on delete cascade]
assessments.schedule_id     -> course_schedules(id)   [nullable, on delete set null]
participants.schedule_id    -> course_schedules(id)   [nullable, on delete set null]
```

So `course_schedules` **is** the live "Schedules" concept — not a placeholder, not a stale/rejected design. It was deliberately built, deliberately FK-wired to three other live tables, and deliberately named to avoid colliding with the (never-applied) numbered-track `training_schedules`. Meanwhile, `app/admin/(protected)/schedules/**` and everything downstream of it (`attendance/**`, `assessment/**`, `certificates/actions.ts`, `reports/**`, `trainers/[id]`, `companies/[id]`) was written entirely against the numbered-track `training_schedules`/`schedule_participants` design (`supabase/migrations/0013`–`0020`), which was **never applied**.

**Conclusion carried through the rest of this document:** the correct "minimum live schema for Schedules" is *additive changes to the already-live `course_schedules`/`attendance`/`assessments` tables* to bring them in line with what the application code needs, plus *one genuinely new table* (`schedule_participants`, a real gap — see §6) — not a parallel `training_schedules` table. Every section below is written against this conclusion; where the original 17-point brief assumed `training_schedules`, I've mapped its intent onto `course_schedules` instead and flagged the delta explicitly.

This is the single most important decision in this document and should be confirmed with you before any migration is drafted, even in a follow-up session — see §17 for the explicit open decision.

---

## 1. Application-code schedule dependencies (traced this session, file-by-file)

Full trace performed by a dedicated research pass over `app/admin/(protected)/{schedules,attendance,assessment,certificates,reports,trainers,companies}/**` and `lib/validation/schemas.ts`. Condensed findings (all against `training_schedules`/`schedule_participants` — the code has zero references to `course_schedules` except one orphaned embed in `ParticipantsTable.tsx`, see §12):

**`schedules/**`** (the module itself): full CRUD (`page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`, `new/`, `calendar/page.tsx`, `export/route.ts`, `actions.ts`, `ScheduleForm.tsx`, `AssignParticipants.tsx`, `options.ts`) queries/writes `training_schedules` columns: `id, schedule_id (text business code), course_id, course_name, trainer, trainer_id, venue, training_mode, start_date, end_date, start_time, end_time, max_participants, registered_participants, seats_remaining (generated), status, remarks, deleted_at, created_at/by, updated_at/by`. Assign/remove participants goes through `schedule_participants` (`upsert` on `(schedule_id, participant_id)` with `ignoreDuplicates: true`; `delete().eq("id", assignmentId)`).

**`attendance/**`**: queries `training_schedules` for the list/detail header, and a separate `attendance` table keyed by `schedule_id` with columns `id, attendance_id (sortable business code), attendance_status (6-value enum), check_in_time, check_out_time, remarks, deleted_at`, joined to `participants` by `participant_id`.

**`assessment/**`**: same pattern — `assessments` table with `id, assessment_id, assessment_type, theory_score, practical_score, overall_score (generated), result, competency_status, remarks, locked, locked_at, locked_by, assessment_date, assessor_id, deleted_at`, keyed by `schedule_id` + `participant_id`.

**`certificates/actions.ts`**: `generateCertificate`/`bulkGenerate` read from a view `v_certificate_eligibility` (defined only in the never-applied `0016_certificate_engine.sql`) exposing `schedule_id, participant_id, course_id, course_name, holder_name, attendance_status, result, competency_status, eligible`, joining `schedule_participants ⋈ training_schedules ⋈ participants ⋈ attendance ⋈ assessments`.

**`reports/**`**: head-counts and 6 reporting views (`v_schedules_per_month`, `v_attendance_trend`, `v_top_courses`, `v_trainer_workload`, `v_attendance_breakdown`, `v_assessment_passfail`) all defined only in the never-applied `0020_reporting_views.sql`, all joining `training_schedules`.

**`trainers/[id]/page.tsx`**: `.eq("trainer_id", id)` directly against `training_schedules.trainer_id` — a **direct FK to `trainers.id`**, never through `profiles`.

**`companies/[id]/page.tsx`**: `schedule_participants.select("training_schedules(id, schedule_id, course_name, start_date, status)").in("participant_id", pIds)` — confirms the app expects a many-to-many junction with a default-named PostgREST embed back to `training_schedules`.

**`lib/validation/schemas.ts`** — `scheduleSchema` (already exists, fully built, currently unused because nothing calls it — same "orphaned schema" pattern CLAUDE.md §10 already flags for `certificateSchema`):
```ts
course_id: uuid, optional/nullable
trainer_id: uuid, optional/nullable
course_name: string, trim, min 2, max 200          // required
trainer: string, trim, max 160, optional
venue: string, trim, max 200, optional
training_mode: string, trim, max 40, optional
start_date / end_date: date string                  // required, end >= start (refine)
start_time / end_time: string, optional
max_participants: coerced int >= 0, default 0
status: enum [draft, open, full, completed, cancelled, archived], default draft
remarks: string, trim, max 2000, optional
```
No `schedule_participants`/assignment schema exists anywhere — that insert is built ad hoc with no Zod layer today (`{schedule_id, participant_id}` only).

**Full per-file trace (60+ call sites with line numbers, exact query shapes, and every status literal) is preserved in this session's research output and can be re-produced on request** — omitted here for length; every column/status claim in §5–§12 below is sourced from it.

---

## 2. Migration-file schema definitions (never applied — design reference only)

Confirmed present in `supabase/migrations/0013_training_schedules.sql` through `0020_reporting_views.sql` (local files only, **not live**):

- `0013`: `training_schedules` (as summarized in §1) + `schedule_participants` (`id, schedule_id, participant_id, assigned_at, assigned_by`, unique `(schedule_id, participant_id)`) + enum `training_status` (`draft|open|full|completed|cancelled|archived`) + trigger `app.sync_schedule_seats()` (recomputes `registered_participants`/flips `open`↔`full`).
- `0014`: `attendance` (numbered-track version — different from the live one, see §8) + enum `attendance_status` (`pending|present|absent|late|medical_leave|excused`) + trigger `app.create_attendance_on_assign()` (auto-creates an attendance row when a participant is assigned).
- `0015`: `assessments` (numbered-track version — different from live, see §9) + enums `assessment_type` (`theory|practical|combined`), `competency_status` (`pending_review|competent|not_yet_competent`) + trigger auto-creating an assessment row on attendance insert.
- `0016`: repoints `certificates.schedule_id` to `training_schedules(id)`; defines `v_certificate_eligibility`.
- `0018`: adds `training_schedules.trainer_id uuid references public.trainers(id) on delete set null`.
- `0020`: the 6 reporting views listed in §1.

**These are internally consistent with each other and with the admin route code** — i.e., someone designed this whole stack coherently, it just never got applied, and a second, independent, also-coherent design (`course_schedules`/`attendance`/`assessments` via the compatibility migration) got applied instead. Per CLAUDE.md §11 rule 2, do not treat these files as live state under any circumstance.

---

## 3. Live related-table schema (verified via `information_schema` + `pg_constraint`, this session)

| Table | PK type | Relevant columns Schedules would reference |
|---|---|---|
| `courses` | `id uuid` | `course_name text`, `title text` (both exist — legacy dual-naming), `status text` (check: `draft/published/archived`), `active boolean`, `deleted_at` |
| `participants` | `id uuid` | `full_name`, `status text` (check: `active/inactive/registered/confirmed/attended/no_show/cancelled` — see §7), `schedule_id uuid → course_schedules(id)`, `company_id uuid → companies(id)`, `deleted_at`, `participant_id text` (business code) |
| `companies` | `id uuid` | `company_name`, `status USER-DEFINED company_status` (check via enum: `active/inactive/prospect/archived`), `created_by/updated_by → profiles(id)`, `deleted_at` |
| `profiles` | `id uuid` (= `auth.users.id`) | `role USER-DEFINED user_role` (`super_admin/admin/editor/trainer/client/participant`), `is_active boolean` |
| `certificates` | `id uuid` | `course_id uuid → courses(id) NOT NULL`, `participant_id uuid → participants(id) NOT NULL`, `schedule_id uuid` — **nullable, and currently has no FK constraint at all** (confirmed via `pg_constraint`: no `certificates_schedule_id_fkey` exists), `status text` (check: `valid/expired/revoked/draft/issued/archived`), `template_id uuid → certificate_templates(id)`, `issued_by uuid → profiles(id)`, `deleted_at` |
| `course_schedules` | `id uuid` | see §5 |
| `attendance` | `id uuid` | see §8 |
| `assessments` | `id uuid` | see §9 |
| `trainers` | — | **does not exist** |

Critical: `certificates.schedule_id` is a live column but **has no foreign key today** — it's an untyped-by-constraint uuid. Any Schedules migration should add `certificates_schedule_id_fkey → course_schedules(id)` as part of making Schedules real (small, safe, additive — see §16).

---

## 4. Trainers dependency — recommendation

`trainers` does not exist live. `training_schedules.trainer_id` (numbered-track) and every trainer-detail-page query (`trainers/[id]/page.tsx: .eq("trainer_id", id)`) assume a **direct FK to `trainers.id`**, never through `profiles`. `course_schedules` (live) only has `trainer_name text` — no FK at all, consistent with trainers not existing when that migration was written.

Per the task's own framing (A/B/C), the evidence supports:

**Recommendation: B — `trainer_id` should be nullable and deferred, added as a follow-up migration once a real `trainers` table exists.** Reasoning:
- Option A (build trainers first) is defensible but expands this phase's scope beyond "minimum schema for Schedules" — `trainers/**` has its own full CRUD module (`TrainerForm`, `export`, options loader) that would need its own audit pass, matching this document's own §16 conclusion that trainers should be a *separate, prior* migration if the business genuinely needs a trainer directory now — not bundled into the Schedules migration.
- Option C (temporarily alias `profiles.role = 'trainer'` as the trainer entity) is explicitly **not recommended** — it would require `training_schedules.trainer_id` to FK to `profiles(id)`, which conflicts with every piece of app code that already expects `trainer_id` to be a `trainers.id` uuid distinct from any user account (a trainer is a roster entity with `trainer_id` business code, `status` (active/inactive/retired/on_leave), qualifications, etc. — not necessarily a login user). Silently repointing this FK would be exactly the kind of "invent a workaround silently" the task explicitly forbids.
- Practically: `course_schedules` already has `trainer_name text` (nullable) live today, which covers the "who's teaching this" need in the short term with zero new schema. **Do not add `trainer_id` to `course_schedules` in the first Schedules migration.** Add it as `add column if not exists trainer_id uuid references public.trainers(id) on delete set null` in a distinct, later, one-logical-change migration once Trainers is built (matches CLAUDE.md §11 rule 6: one migration, one logical change).

---

## 5. Minimum schema for the Schedules table — proposed as ALTERs to live `course_schedules`, not a new `training_schedules`

Live `course_schedules` today (all confirmed via `information_schema.columns` + `pg_constraint`, this session):

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `course_id` | uuid → `courses(id)` | no | — |
| `trainer_name` | text | yes | — |
| `venue` | text | yes | — |
| `start_date` | date | no | — |
| `end_date` | date | no | — |
| `capacity` | integer | no | 0 |
| `seats_taken` | integer | no | 0 |
| `status` | `schedule_status` enum | no | `'open'` |
| `notes` | text | yes | — |
| `is_published` | boolean | no | `true` |
| `created_by`/`updated_by` | uuid → `profiles(id)` | yes | — |
| `created_at`/`updated_at` | timestamptz | no | `now()` |
| `deleted_at` | timestamptz | yes | — |

Checks live today: `capacity >= 0`, `seats_taken >= 0 and seats_taken <= capacity`, `end_date >= start_date`. Indexes live: `course_schedules_course_idx (course_id) where deleted_at is null`, `course_schedules_start_idx (start_date) where deleted_at is null`.

Gap vs. what `schedules/**` app code needs, column by column:

| App code expects | Live equivalent | Gap / proposed action | Used by |
|---|---|---|---|
| `schedule_id` (text business code, e.g. `TS-000001`) | none | **Add**: `schedule_id text unique`, generated the same way `participants.participant_code`/`attendance_id` are (a default expression or trigger — match whichever pattern the live `participants.participant_code` default uses: `('TS-'::text \|\| upper(substr(...)))`) | list/detail/export/`ScheduleForm` display, all filters |
| `course_name` (text snapshot) | not present — `courses.course_name`/`title` reachable via `course_id` join | **Do not add.** App code should join `courses` instead of relying on a denormalized snapshot column — the snapshot pattern is a numbered-track artifact, not something the live schema uses anywhere else. Flag as an app-code fix, not a schema addition. | list/detail/export/reports |
| `trainer` (text) | `trainer_name` | **Rename mapping only** — same concept, different name. Either rename the live column (safe, 0 rows) or adjust app code to read/write `trainer_name`. Recommend **keep the live name `trainer_name`** and fix the app code — it's the newer, deliberately-chosen live convention. | schedules module, trainer conflict check |
| `venue` | `venue` | No gap. | list/detail/export |
| `training_mode` | none | **Add**: `training_mode text` (free text — app code already treats it as a suggestion list, not an enum) | `ScheduleForm` |
| `start_time`/`end_time` | none | **Add**: `start_time time`, `end_time time` (both nullable) | `ScheduleForm`, calendar |
| `max_participants` | `capacity` | Same concept, different name — same recommendation as `trainer`/`trainer_name`: keep live name, fix app code. | schedule creation, seats math |
| `registered_participants` | `seats_taken` | Same — keep live name (`seats_taken`), fix app code. Live already has the correct `seats_taken <= capacity` check that the numbered track re-derives via a generated `seats_remaining` column — **recommend adding `seats_remaining integer generated always as (greatest(capacity - seats_taken, 0)) stored`** since app code already displays it and it's a trivial, safe additive column. | list, export, dashboard |
| `status` | `status` (`schedule_status` enum) | **Value mismatch, not a schema gap** — see §7. Live enum lacks `draft`/`archived`, has `in_progress` which app code never uses. Must resolve before writing any CHECK/enum migration. | everywhere |
| `remarks` | `notes` | Same concept, different name — keep live name (`notes`), fix app code. | `ScheduleForm`, export |
| `deleted_at` | `deleted_at` | No gap. | soft-delete filters everywhere |
| `created_at`/`updated_at`/`created_by`/`updated_by` | present | No gap. | audit |
| `trainer_id` | none | **Deferred — see §4.** Not part of this migration. | trainer conflict check, trainer detail page |

**Net new columns needed on live `course_schedules`:** `schedule_id` (business code, unique), `training_mode`, `start_time`, `end_time`, `seats_remaining` (generated). Everything else is either already live under a different name (fix the app code, don't duplicate the column) or deferred (`trainer_id`).

---

## 6. Minimum schema for `schedule_participants` — genuinely new, not a duplicate

Unlike `training_schedules`, there is **no live equivalent** of a schedule↔participant many-to-many junction — `participants.schedule_id` is a single nullable FK (one participant row can reference at most one schedule at a time), not a junction table. So `schedule_participants` is not "a second implementation of something that exists" — it's a real, currently-missing capability, **if** the many-to-many model is actually the intended business flow (see §17 open question — this is the one place this audit cannot resolve the ambiguity from code alone).

Proposed minimum (matches what `schedules/actions.ts` `assignParticipants`/`removeParticipant` and the `companies`/`trainers`/`participants` detail-page joins actually use):

| Column | Type | Nullable | Default | Used by |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | removal handle (`delete().eq("id", assignmentId)`) |
| `schedule_id` | uuid → `course_schedules(id)` on delete cascade | no | — | assign/remove, all joins |
| `participant_id` | uuid → `participants(id)` on delete cascade | no | — | assign/remove, all joins |
| `assigned_at` | timestamptz | no | `now()` | ordering in schedule detail page |
| `assigned_by` | uuid → `profiles(id)` | yes | — | **flagged low-confidence** — no app code was found that ever sets this; it would rely entirely on a default/trigger. Include the column (matches the numbered-track design and audit-friendliness) but do not block the migration on wiring it — nothing reads it today either. |

Uniqueness: **`unique (schedule_id, participant_id)`** — directly required by `assignParticipants`'s `upsert(rows, {onConflict: "schedule_id,participant_id", ignoreDuplicates: true})`. No app code was found assigning the same participant to the same schedule twice deliberately, and no code was found needing a *soft-deleted* assignment history (no `deleted_at` reference anywhere in the assign/remove trace) — so a plain `unique (schedule_id, participant_id)` is sufficient; **do not add a `deleted_at`-qualified partial unique index here**, since `removeParticipant` hard-deletes the row (`delete().eq("id", assignmentId)`), not soft-deletes it. This is a deliberate deviation from this repo's usual soft-delete convention — see §15.

---

## 7. Status semantics — inventory and required reconciliation

| Column | Values used by app code | Values live today (where applicable) | Resolution needed |
|---|---|---|---|
| Schedule status | `draft, open, full, completed, cancelled, archived` (6, exhaustive in `ScheduleForm`/list filter/`scheduleSchema`) | `open, full, in_progress, completed, cancelled` (live `schedule_status` enum — 5, **no `draft`, no `archived`, has `in_progress` which app code never references**) | **Must pick one canonical set before any CHECK/enum migration.** Recommend: add `draft` and `archived` to the live `schedule_status` enum (`alter type schedule_status add value if not exists ...` — safe, additive, no data to migrate since 0 rows), and either add `in_progress` to the app-code list or drop it from the live enum (enums can't drop values without a rebuild — recommend just adding it to the app code's status list/filter instead, cheaper and non-destructive). |
| Attendance status | `pending, present, absent, late, medical_leave, excused` (6, exhaustive in `attendance/actions.ts`) | live `attendance` has no status column at all — only `present boolean` | **Structural gap, not just a value gap** — see §8. |
| Assessment result | `pending, pass, fail` (app code) | live `assessments.result` CHECK: `pending, competent, not_yet_competent, pass, fail` (5 — **a merged union of the app's separate `result` and `competency_status` concepts, live in one column**) | See §9 — this is the clearest evidence live `assessments` was built to a simpler single-field model than the app code assumes. |
| Assessment competency | `pending_review, competent, not_yet_competent` (app code, separate column) | not a separate column live — folded into `result` above | Same as above. |
| Certificate status | app code writes `valid` (never `issued`) in `generateCertificate`/`reissueCertificate`/`duplicateCertificate`(`draft`)/`revokeCertificate`(`revoked`); reads filter on `valid` in dashboard/reports | live CHECK: `valid, expired, revoked, draft, issued, archived` (6 — **live already includes `valid`**, so no live mismatch here, just an unused `issued` value nobody writes) | No action needed for Schedules migration — noted for completeness since certificates was traced as part of §10. Live schema already matches app code's actual usage; `issued` is simply dead in the enum. |
| Participant status | live CHECK: `active, inactive, registered, confirmed, attended, no_show, cancelled` (7 — mixes person-level and enrollment-level states in one column) | — | Not part of the Schedules migration, but directly informs §17's open question about whether `participants` rows model a person or a single enrollment. |

**Do not write any `CHECK`/enum constraint for schedule status, attendance status, or assessment result/competency until you've confirmed the canonical value sets above with the business** — this is exactly the kind of thing the task brief's §7 asked to gate on, and the evidence shows genuine, non-trivial disagreement between the live DB and the app code that a migration author can't safely guess at.

---

## 8. Attendance relationship

Live `attendance` (from `20260721030829_production_cms_additive_compatibility.sql`, confirmed via `information_schema`):

```
id uuid PK, schedule_id uuid not null → course_schedules(id) on delete cascade,
participant_id uuid not null → participants(id) on delete cascade,
session_date date not null, present boolean not null default false,
remarks text, recorded_by uuid → profiles(id),
created_at/updated_at timestamptz,
unique (participant_id, session_date)
```

This is a **materially different model** from what `attendance/**` app code assumes:
- Live has `session_date` + a `unique(participant_id, session_date)` constraint — designed for **multi-session attendance** (recording attendance per training day across a multi-day course). App code (`attendance/[scheduleId]/page.tsx`, `AttendanceTable.tsx`) has **no concept of `session_date` anywhere** — it reads/writes one attendance row per `(schedule_id, participant_id)` pair, full stop, as if each schedule has exactly one attendance-taking event.
- Live has `present boolean`; app code needs a 6-value status.
- Live has no `check_in_time`/`check_out_time`, no `deleted_at`, no sortable business `attendance_id` code.

**How to unblock Attendance without rewriting it unnecessarily:**
1. **Resolve `session_date` first, explicitly** — this is a business-logic question this audit cannot answer from code alone: does this training company track attendance per-day for multi-day courses, or once per course? If once-per-course (matches 100% of the app code found), the live `unique(participant_id, session_date)` constraint should become `unique(schedule_id, participant_id)` instead (additive: add the new unique index, and decide whether to drop the old one — dropping requires the destructive-op sign-off per CLAUDE.md §11 rule 5, even on an empty table, per this repo's own stated bar of "no 'probably fine' here"). If per-day, the app code (not the schema) needs a `session_date` field added to its forms/queries — a real feature gap, not a migration gap.
2. Additively `alter table attendance add column if not exists attendance_status text` (+ a CHECK once §7's value-set question is resolved), `add column if not exists check_in_time timestamptz`, `add column if not exists check_out_time timestamptz`, `add column if not exists deleted_at timestamptz`, `add column if not exists attendance_id text unique` (business code, same pattern as `participants.participant_code`).
3. Keep `present boolean` — either derive it from `attendance_status` via a generated column/trigger for backward compat, or have the app code stop reading/writing it and drop it in a later, separate, sign-off migration. **Do not silently repurpose it.**
4. This is entirely additive on a 0-row table — no data migration needed, low risk. The only genuinely open question is #1 (session semantics), which blocks writing the final DDL, not the decision to extend rather than replace.

---

## 9. Assessment relationship

Live `assessments`:
```
id uuid PK, schedule_id uuid → course_schedules(id) on delete set null [nullable],
participant_id uuid not null → participants(id) on delete cascade,
assessment_type text, score numeric(5,2), max_score numeric(5,2) default 100,
result text not null default 'pending' check (result in ('pending','competent','not_yet_competent','pass','fail')),
assessed_at date, remarks text, created_at/updated_at timestamptz
```

App code (`assessment/**`) needs: `theory_score`/`practical_score` (two scores, not one `score`/`max_score` pair), a generated `overall_score`, `result` and `competency_status` as **two separate columns** (live folds both into one `result` CHECK, confirmed by the CHECK definition itself containing both `pass/fail`-style and `competent/not_yet_competent`-style values together), `locked`/`locked_at`/`locked_by`, `assessor_id`, `deleted_at`, a sortable `assessment_id` business code. Also: live `schedule_id` is **nullable**; app code treats it as always-present (every query filters `.eq("schedule_id", scheduleId)`).

**How proposed Schedules schema fits:**
1. `assessments.schedule_id` should become `not null` once Schedules is real — safe on a 0-row table, but confirm no other consumer expects a schedule-less assessment before doing so (none found in this trace).
2. Split `result` (live, merged) into two columns: keep `result` scoped to `pending/pass/fail` and add `competency_status text` (`pending_review/competent/not_yet_competent`) as a new column — then narrow the existing `result` CHECK to drop the now-redundant `competent`/`not_yet_competent` values (a constraint tightening, not data-destructive, since 0 rows exist).
3. Additively add: `theory_score numeric(5,2)`, `practical_score numeric(5,2)`, `overall_score numeric(5,2) generated always as (round((coalesce(theory_score,0)+coalesce(practical_score,0))/2, 2)) stored` (or whatever exact averaging rule the business wants — app code never computes it client-side, it's always read as already-generated, so the exact formula needs a decision, not an assumption), `locked boolean default false`, `locked_at timestamptz`, `locked_by uuid → profiles(id)`, `assessor_id uuid → profiles(id)`, `deleted_at timestamptz`, `assessment_id text unique`.
4. Decide the fate of live `score`/`max_score` — either keep as a legacy/simple-mode pair alongside the new `theory_score`/`practical_score`, or plan (separately, with sign-off) to retire them. No app code reads them today, so keeping them costs nothing short-term.

---

## 10. Certificate generation — schema Schedules must supply

Traced `certificates/actions.ts` `generateCertificate`/`bulkGenerate` and the `v_certificate_eligibility` view definition (`0016`, never applied):

`generateCertificate(scheduleId, participantId)` requires a view/query returning, per `(schedule_id, participant_id)`: `eligible (boolean)`, `course_id`, `holder_name` — and the UI (`certificates/generate/[scheduleId]/page.tsx`) additionally renders `attendance_status`, `result`, `competency_status` from the same row. The view's `eligible` computation in `0016` is:
```sql
(att.attendance_status='present' and asm.result='pass' and asm.competency_status='competent')
```
which directly depends on §8's `attendance_status` and §9's split `result`/`competency_status` existing first. **`v_certificate_eligibility` cannot be built until §8 and §9's additive columns exist** — this is a real ordering dependency, not just a nice-to-have sequencing choice (see §16).

Also confirmed: `certificates.schedule_id` has **no live FK** (§3) — add `certificates_schedule_id_fkey → course_schedules(id) on delete set null` (nullable, matches existing column nullability, matches the `0016` migration's own choice of `on delete set null` over `cascade` — a certificate should survive its schedule being removed).

Per the task instruction, **the view itself is not being built in this phase** — this section only documents the contract so the Schedules DDL doesn't block it later.

---

## 11. Reports dependency — downstream contract only

Every reporting query found (`reports/page.tsx`, `reports/export/route.ts`) either head-counts `training_schedules`/`course_schedules` directly (trivial — works against `course_schedules` as-is once §5's columns exist) or reads one of 6 views defined only in the never-applied `0020_reporting_views.sql`: `v_schedules_per_month`, `v_attendance_trend`, `v_top_courses`, `v_trainer_workload`, `v_attendance_breakdown`, `v_assessment_passfail`. All 6 join `course_schedules`/`attendance`/`assessments`/`trainers` and therefore inherit the same ordering dependency as §10 — none of them are buildable until the attendance/assessment column gaps are closed and (for `v_trainer_workload`) until Trainers exists (§4). Not building these views now, per instructions — documenting only so today's `course_schedules` column choices (§5) don't foreclose them (they don't; every column these views need is already in the §5 proposal).

---

## 12. Companies / Trainers detail dependency

`companies/[id]/page.tsx`: `schedule_participants.select("training_schedules(id, schedule_id, course_name, start_date, status)").in("participant_id", pIds)` — expects the embed name `training_schedules`. Since we're using `course_schedules` as the live table (§0), **the PostgREST embed name in this query needs to change from `training_schedules(...)` to `course_schedules(...)`** as part of the app-code compatibility pass (§16 step 7) — this is a one-line query fix per call site, not a schema question, but it's a real, necessary code change flagged here so it isn't missed.

Also in the same file: `participants.select("id, participant_id, full_name, status, schedule_id").eq("company_id", id)` — this already works against live `participants.schedule_id → course_schedules(id)` with zero changes needed.

`trainers/[id]/page.tsx` — out of scope until Trainers exists (§4); its `training_schedules.trainer_id` queries would become `course_schedules.trainer_id` queries once that deferred column is added.

`app/admin/(protected)/participants/[id]/page.tsx` (adjacent, found in the same trace, directly relevant): expects `schedule_participants.select("id, assigned_at, training_schedules(schedule_id, course_name, start_date, status, courses(title))").eq("participant_id", id)` — same embed-name fix needed, plus confirms `training_schedules(...courses(title))` nested embed, meaning `course_schedules` must keep its live `course_id → courses(id)` FK (it does) for this two-level embed to keep working once renamed.

`components/admin/.../ParticipantsTable.tsx` — the one place live `course_schedules` is already referenced by name (`participant.course_schedules?.start_date`), but per the earlier research pass this looks orphaned/dead: the query feeding this component (`participants/page.tsx`) does not appear to select a `course_schedules` embed at all, so this prop is likely always `undefined` today. Flagging as a pre-existing bug adjacent to this work, not something to fix as part of the Schedules migration — but worth a follow-up ticket.

---

## 13. RLS / auth model

Current live RLS on the relevant tables (via `pg_policies`, this session):

| Table | Policy | Command | Role check |
|---|---|---|---|
| `course_schedules` | `course_schedules_staff_all` | ALL | `{authenticated}` — **no `profiles.role`/`is_active` check at all**, any logged-in user (any role) can do anything |
| `attendance` | `attendance_staff_all` | ALL | same — blanket `{authenticated}` |
| `assessments` | `assessments_staff_all` | ALL | same — blanket `{authenticated}` |
| `certificates` | 5 separate policies (`Admins can {read,insert,update,delete}...`, `Deny anonymous...`) | SELECT/INSERT/UPDATE/DELETE split | role-scoped (not inspected in full this session, but structurally correct — split by command, not blanket) |
| `companies` | 4 separate policies (`companies_admin_{insert,update,delete}`, `companies_staff_read`) | split | role-scoped, matches CLAUDE.md's described pattern |
| `courses`, `participants` | blanket `ALL` to `{authenticated}` (+ anon-deny) | ALL | **also blanket**, same gap as `course_schedules`/`attendance`/`assessments` |

So the **existing live pattern for schedule-adjacent tables is already the broad, no-role-check "any authenticated user" policy** — this is a known, pre-existing gap (not something this migration introduces), but per CLAUDE.md §6/§8/§12, any *new* policy this work adds must not perpetuate it, and per the task's own instruction ("do not copy a known-broken legacy admin_users pattern blindly"), the recommendation is:

**Proposed policies for the additive changes in this plan** (new `schedule_participants` table; tightened policies on `course_schedules`/`attendance`/`assessments` if in scope for this work — flag as a decision, since tightening existing live policies is a behavior change beyond pure schema addition):
```sql
-- schedule_participants (new table)
create policy schedule_participants_read on public.schedule_participants
  for select to authenticated
  using (app.is_editor());          -- matches MODULE_ACCESS minimum for Schedules-adjacent modules

create policy schedule_participants_write on public.schedule_participants
  for insert, update, delete to authenticated
  using (app.is_editor())
  with check (app.is_editor());
```
using this repo's existing `app.is_editor()`/`app.is_admin()`/`app.has_min_role()` helper functions (per CLAUDE.md §6/§8 — confirmed these are the established pattern, not re-verified this session which exact helpers exist in the `app` schema; **verify `app.is_editor()` etc. actually exist live before writing this DDL** — the earlier attempt to query `information_schema.routines where routine_schema='app'` this session hit a transient connection error and wasn't retried; re-run it before the real migration).

Whether to also tighten `course_schedules`/`attendance`/`assessments`'s existing blanket policies is a separate decision — recommend doing it in the same migration that adds their new columns (one logical change: "bring schedule-adjacent tables' RLS in line with the rest of the app"), rather than silently leaving the gap in place while adding a properly-scoped policy only to the new table next to it.

---

## 14. Indexes

Proposed (avoiding over-indexing — only what the traced queries actually filter/join on):

| Table | Index | Rationale |
|---|---|---|
| `course_schedules` | `course_id` — **already exists** (`course_schedules_course_idx`) | join target |
| `course_schedules` | `start_date` — **already exists** (`course_schedules_start_idx`) | list/calendar filters |
| `course_schedules` | `trainer_id` (once added, §4) | `trainerConflict()`, trainer detail page — both filter `.eq("trainer_id", ...)` |
| `course_schedules` | `status` | list filter dropdown (`.eq("status", ...)`), reporting head-counts — worth a partial index `where deleted_at is null` given every query already filters that too |
| `schedule_participants` | unique `(schedule_id, participant_id)` | required by `upsert(...onConflict:"schedule_id,participant_id")`, §6 |
| `schedule_participants` | `participant_id` | companies/participants detail-page joins filter `.in("participant_id", pIds)` — the unique index above already covers `schedule_id` lookups but not participant-first lookups; a composite unique index on `(schedule_id, participant_id)` does **not** efficiently serve `participant_id`-only filters, so a separate index is warranted |
| `attendance` | `schedule_id` | already implied by the live FK but Postgres does not auto-index FK columns (CLAUDE.md §13) — every attendance query filters `.eq("schedule_id", ...)`, needs an explicit index |
| `attendance` | `participant_id` | `participants/[id]` training-history join filters `.eq("participant_id", id)` |
| `assessments` | `schedule_id`, `participant_id` | same reasoning as `attendance` |

Do not add indexes on `venue`, `remarks`/`notes`, `training_mode`, or any text field only ever used in `.ilike()`/`.or()` search — none of the traced search UIs (`schedules/page.tsx`'s `.or("schedule_id.ilike...,course_name.ilike...,trainer.ilike...")`) are high-enough-volume (9 live courses, 0 schedules today) to justify a trigram/GIN index at this stage.

---

## 15. Soft delete

**Confirm: both `course_schedules` (already has `deleted_at`, live) and the new `schedule_participants` should follow the same convention — but with one deliberate, evidence-based exception.**

- `course_schedules`: keep `deleted_at`, keep filtering `where deleted_at is null` (already the live pattern, already what every traced query does).
- `attendance`/`assessments`: **add** `deleted_at` (currently missing live — see §8/§9) to match every other CMS-managed table and because the app code already filters `.is("deleted_at", null)` against them (meaning the app code was written assuming this column exists, even though it doesn't live today).
- `schedule_participants`: **do not add `deleted_at`.** This is the one deliberate deviation from the blanket "everything soft-deletes" convention, because the actual app code (`removeParticipant`) hard-deletes assignment rows (`delete().eq("id", assignmentId)`), and no code anywhere reads or expects a soft-deleted assignment to still show up (e.g., in "assignment history"). Adding a `deleted_at` column that nothing sets or filters on would be exactly the kind of unused, misleading column CLAUDE.md §3 warns against ("no dead code left 'just in case'"). If a future requirement needs assignment history, add it then, with the code that actually uses it — matches CLAUDE.md §3's "no premature abstraction" principle.

---

## 16. Proposed migration order

Revised from the task brief's suggested order to reflect §0's finding (extend `course_schedules`, don't create `training_schedules`) and the real dependency chain surfaced in §8–§11:

1. **Confirm the §0 reframing and the two open decisions in §17 with the business/user** — blocks everything else; writing DDL against unresolved semantics (session-based vs. course-based attendance; single-enrollment vs. many-to-many participant model) risks a second round of the exact "designed but never reconciled with live" problem this whole document exists to prevent.
2. **`course_schedules` additive migration** (§5): add `schedule_id` (business code), `training_mode`, `start_time`, `end_time`, `seats_remaining` (generated); extend `schedule_status` enum with `draft`/`archived` (§7, pending value-set sign-off); add `status`-plus-`deleted_at` partial index (§14).
3. **`schedule_participants` new table** (§6): create table, unique `(schedule_id, participant_id)` index, `participant_id` index, RLS (§13), audit trigger per CLAUDE.md §11 rule 7 (staff-mutable table).
4. **`attendance` additive migration** (§8): add `attendance_status`, `check_in_time`, `check_out_time`, `deleted_at`, `attendance_id`; resolve `session_date` uniqueness question first (§8 step 1) since it determines whether the existing `unique(participant_id, session_date)` constraint needs to change in this same migration or a later, separately-signed-off one.
5. **`assessments` additive migration** (§9): add `theory_score`, `practical_score`, `overall_score` (generated, formula TBD), `competency_status`, `locked`/`locked_at`/`locked_by`, `assessor_id`, `deleted_at`, `assessment_id`; narrow `result` CHECK; make `schedule_id not null`.
6. **`certificates.schedule_id` FK** (§3/§10): add the missing `certificates_schedule_id_fkey → course_schedules(id) on delete set null`.
7. **Trainers table, if/when scoped** (§4) — deliberately sequenced *after* Schedules core, as its own migration; only then add `course_schedules.trainer_id`.
8. **App-code compatibility pass** (not a migration): rename every `training_schedules` reference to `course_schedules` across `schedules/**`, `attendance/**`, `assessment/**`, `certificates/actions.ts`, `reports/**`, `trainers/[id]`, `companies/[id]`, `participants/[id]`; fix the `trainer`/`max_participants`/`registered_participants`/`remarks` naming mismatches (§5) to use the live column names; fix the `training_schedules(...)` PostgREST embed names to `course_schedules(...)` (§12).
9. **`v_certificate_eligibility` view** (§10) — only buildable after steps 4–5 land.
10. **6 reporting views** (§11) — only buildable after steps 4–5 (and 7, for `v_trainer_workload`) land.
11. **Regression pass**: Attendance, then Assessment, then Certificate generation, then Reports, per the task brief's own suggested order — each only meaningfully testable once its upstream dependency (previous numbered step) is live.
12. **`lib/supabase/database.types.ts` regeneration** (CLAUDE.md §11 rule 8) after each schema-changing step, not just at the end — several existing files (`assessment/export/route.ts`, `attendance/[scheduleId]/import/importActions.ts`) already carry explicit code comments acknowledging they're working around a stale generated-types file for exactly this reason; don't let that list grow.

No seed/test data step is proposed for production per the task's own instruction; if a non-production branch is used for validation, create it via the Supabase `create_branch` tool rather than seeding the live project.

---

## 17. Open decisions this audit cannot resolve from code alone

1. **§0/whole document**: confirm extending `course_schedules` (not creating `training_schedules`) is the right call before any DDL is written. This is the load-bearing decision everything else depends on.
2. **§6/§17**: is the participant↔schedule relationship genuinely many-to-many (one participant attends multiple trainings over time, tracked via a `schedule_participants` junction), or is the live `participants.schedule_id` single-FK design (one participant *row* per enrollment, re-created per training) the actual intended business model? Evidence points both ways: the live `participants.status` CHECK (`active/inactive/registered/confirmed/attended/no_show/cancelled`) mixes person-level and enrollment-level states in one column, suggesting single-enrollment-per-row; but the recent "enforce normalized participant identity uniqueness" work (this repo's own recent history) suggests participant *identity* is meant to be deduplicated/stable, which only makes sense if a stable identity can enroll in multiple schedules — which requires a junction table. **This needs a business-side answer, not a code-derived one.**
3. **§8**: does attendance get recorded once per course, or once per session/day within a multi-day course? Live schema (`unique(participant_id, session_date)`) assumes the latter; 100% of the traced app code assumes the former.
4. **§9**: exact `overall_score` averaging formula (simple average of theory+practical? weighted? one mandatory, one optional depending on `assessment_type`?) — app code always treats it as already-computed/read-only, never computes it, so there's no code evidence of the intended formula.
5. **§4**: is a real Trainers module (with its own `active/inactive/retired/on_leave` roster, distinct from any user login) actually needed now, or can `course_schedules.trainer_name` (free text, live today) suffice for longer? This determines whether step 7 in §16 happens soon or gets deferred indefinitely.

**Migration-history note carried over from the previous phase of this work**: the last migration committed to this repo (`20260808160000_add_courses_active_slug_unique.sql`) was found to have a **local filename timestamp that doesn't match the version Supabase's own `schema_migrations` history recorded for the equivalent applied change** (local `20260808160000` vs. live-recorded `20260808100255`). Whatever new migration files come out of this Schedules work should be double-checked against `list_migrations` immediately after being applied (not just after being written) to catch the same drift early — don't assume a locally-authored timestamp will match what ends up recorded live if there's any manual/out-of-band application step involved.
