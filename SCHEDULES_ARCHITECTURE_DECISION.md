# Schedules — Final Architecture Decision

**Status: DESIGN / DECISION PHASE ONLY. No DDL executed, no production data modified, nothing committed.**

This document finalizes the open questions left in `SCHEDULES_SCHEMA_DECISION.md` (§17 of that file), now that explicit business direction has been given: `course_schedules` is canonical (no `training_schedules`), the participant↔schedule relationship is genuinely many-to-many, attendance must eventually support per-day tracking, and Trainers is explicitly deferred. Every column/row-count claim below was re-verified live against project `iagzkrzeuawaxvacqprk` this session; everything else carries forward from the file trace performed in the prior phase (60+ call sites across `app/admin/(protected)/{schedules,attendance,assessment,certificates,reports,trainers,companies,participants}/**`).

---

## A. Final schedule architecture

```
course_schedules  (canonical training-session table — already live, extended additively)
      ↕ (new, many-to-many junction)
schedule_participants
      ↕
participants  (existing, live — participants.schedule_id kept as legacy/deprecated, unused)

attendance    → schedule_id (course_schedules), participant_id — extended additively, per-session-date
assessments   → schedule_id (course_schedules), participant_id — extended additively, nullable scores
certificates  → schedule_id gets its first-ever FK, added → course_schedules(id)
```

No `training_schedules`. No `trainers` table in this phase. `course_schedules.trainer_name` (text, already live) remains the sole trainer representation for now.

---

## B. `course_schedules` compatibility mapping

| App code expects | Live column | Decision | Rationale |
|---|---|---|---|
| `training_schedules.id` | `course_schedules.id` | **A** — rename every table reference in code | Direct table swap, no semantic gap |
| `trainer` (text) | `trainer_name` | **A** — change app code | Identical concept, live name is fine, avoids a duplicate column |
| `max_participants` | `capacity` | **A** — change app code | Identical concept |
| `registered_participants` | `seats_taken` | **A** — change app code, *and* see §K (becomes derived) | Identical concept |
| `remarks` | `notes` | **A** — change app code | Identical concept |
| `venue` | `venue` | No change | Already matches |
| `start_date`/`end_date` | `start_date`/`end_date` | No change | Already matches |
| `status` | `status` (`schedule_status` enum) | **A** — change app code to the reconciled value set, see §L | Same column, values must be reconciled first |
| `deleted_at`, `created_at`/`updated_at`, `created_by`/`updated_by` | same names, live | No change | Already matches |
| `schedule_id` (text business code, e.g. `TS-000001`) | *none* | **B** — add `schedule_id text unique` | No live equivalent; every list/detail/export screen displays it |
| `course_name` (text snapshot) | *none* — reachable via `course_id → courses.course_name/title` | **A** — change app code to join `courses` instead | Live schema deliberately normalizes this via the FK; adding a redundant snapshot column would be exactly the "duplicate column, same meaning" the task says to avoid |
| `training_mode` | *none* | **B** — add `training_mode text` (free text, matches how the app already treats it — a suggestion list, not an enforced enum) | Real gap, no live substitute |
| `start_time`/`end_time` | *none* | **B** — add both, nullable `time` | Real gap, used by `ScheduleForm`/calendar |
| `trainer_id` | *none* | **Deferred**, see §F | Explicit business direction: don't create Trainers now |
| `seats_remaining` (generated, app-displayed) | *none* | **B** — add as a generated column once `capacity`/`seats_taken` semantics are settled (§K) | Trivial, safe, matches existing display need |

**Net schema additions to `course_schedules`:** `schedule_id` (business code), `training_mode`, `start_time`, `end_time`, `seats_remaining` (generated, pending §K). Everything else is an app-code fix, not a new column — this avoids creating a single duplicate-meaning column anywhere on this table.

---

## C. `schedule_participants` — final proposed schema

| Column | Type | Nullable | Default | Rationale |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK; `removeParticipant` already keys off `.eq("id", assignmentId)` |
| `schedule_id` | uuid → `course_schedules(id)` on delete cascade | no | — | canonical link |
| `participant_id` | uuid → `participants(id)` on delete cascade | no | — | canonical link |
| `registration_status` | text | no | `'registered'` | see §M — separate from attendance/assessment, per explicit instruction not to confuse these |
| `enrolled_at` | timestamptz | no | `now()` | ordering (already used: `schedules/[id]/page.tsx` orders by `assigned_at`) — renamed from the numbered-track's `assigned_at` to `enrolled_at` for clarity against `registration_status`, purely a naming choice, flag for confirmation |
| `notes` | text | yes | — | not found in any traced app code today, but included because per-enrollment notes (e.g. "sponsored by X", "transferred from schedule Y") is a realistic near-term need and costs nothing on an empty table — **only add if you want it now; genuinely optional, drop if you'd rather add it when first needed** |
| `created_at`/`updated_at` | timestamptz | no | `now()` | standard audit columns, matches every other CMS table |
| `deleted_at` | *not added* | — | — | see rationale below |

**`deleted_at` is deliberately omitted**, same reasoning as the prior audit: `removeParticipant` today hard-deletes (`delete().eq("id", assignmentId)`), and no code reads a soft-deleted enrollment. Since `registration_status` now carries a `cancelled` value (§M), "removing" a participant going forward should mean **setting `registration_status = 'cancelled'`**, not deleting the row — this preserves enrollment history for reporting/audit without needing a separate soft-delete column. **This is a behavior change to `removeParticipant`** (currently a hard delete) — flagged as a required business-logic change in §P, not a silent scope-add.

**Duplicate-active-enrollment protection** (required by the business rule):
```sql
create unique index schedule_participants_active_unique
  on public.schedule_participants (schedule_id, participant_id)
  where registration_status <> 'cancelled';
```
A partial unique index scoped to non-cancelled registrations — this is the direct answer to "one active participant per schedule": a participant can be re-enrolled in the same schedule after a cancellation (a new row, or the same row flipped back to `registered`), but can never have two simultaneously-active enrollment rows for the same schedule.

---

## D. Participant many-to-many decision

Confirmed by explicit business rule: a participant attends many schedules over their lifetime; a schedule holds many participants. `schedule_participants` (§C) is the canonical join. This resolves open question §17.2 from the prior audit in favor of the many-to-many model — the earlier ambiguity (live `participants.status` mixing person-level and enrollment-level states) is now understood as a legacy artifact of the single-enrollment design being superseded, not evidence against the new model.

Going forward, **`registration_status` on `schedule_participants` is the enrollment-level status**; `participants.status` should be treated as describing the *person* (`active`/`inactive` at minimum) — the enrollment-flavored values currently in its CHECK (`registered/confirmed/attended/no_show/cancelled`) become vestigial once `schedule_participants.registration_status` exists, but **do not narrow or touch that CHECK constraint in this phase** — it's live, might have real data depending on values in the 126 existing participant rows (not queried this session; check before any future constraint change), and touching it isn't required to unblock Schedules.

---

## E. `participants.schedule_id` transition plan

Live query this session: **126 total participants, 0 have `schedule_id` set.** The column is fully unused in live data today — there is no migration burden, only a decision to leave it alone.

Plan:
1. **Keep the column exactly as-is** in this migration phase — no rename, no drop, no backfill.
2. **Do not write any new code against it.** All new Schedules/Attendance/Assessment/Certificate code targets `schedule_participants` exclusively.
3. **Fix the one place that currently reads it** — `companies/[id]/page.tsx`'s `participants.select("...schedule_id")` (§P) — this becomes a `schedule_participants` join instead, since it's the only live consumer and it's already effectively broken (the embed name mismatch noted in the prior audit means this data likely never rendered correctly anyway).
4. **Future, separately-approved migration** (not in scope now): once `schedule_participants` has been live and in active use for a full operational cycle, revisit whether to drop `participants.schedule_id` entirely. Requires explicit sign-off per CLAUDE.md §11 rule 5 (no `DROP COLUMN` without backup + sign-off) even though it's currently empty — don't assume "it's empty today" still holds true whenever that future migration is written; re-check row counts then.

---

## F. Trainer decision

Confirmed: **do not create a `trainers` table in this phase.** `course_schedules.trainer_name` (text, already live) is retained as the sole trainer representation. Every place app code currently expects `trainer_id` (a uuid FK) is deferred:

- `schedules/actions.ts`'s `trainerConflict()` (double-booking check) — **cannot be implemented against a free-text name reliably** (name typos/variants would silently defeat the conflict check). Recommend: either drop this check entirely for now (simplest, matches "don't build for a table that doesn't exist"), or implement a weaker version that matches on exact `trainer_name` string equality, explicitly documented as a stopgap that will misbehave on name variants. **This is a real, immediate product-behavior tradeoff worth a quick decision, not a pure implementation detail** — flagged in §R.
- `trainers/[id]/page.tsx` — the entire Trainer detail page is **out of scope**; it has no live table to query against regardless of Schedules' shape. Leave it as-is (already broken/ScaffoldPage-equivalent) until Trainers is built as its own project.
- **Do not** repoint `trainer_id` to `profiles.id` as a stand-in — explicitly forbidden by the instruction, and for the same reason as the prior audit: a trainer is a roster entity (qualifications, `active/inactive/retired/on_leave` status), not necessarily a login account, and every piece of app code that expects a `trainers.id` FK would silently get wrong semantics if pointed at `profiles`.

**Trainers is documented here as a later, separate normalization project**, triggered whenever the business needs trainer-level reporting (`v_trainer_workload`), qualification tracking, or the double-booking check to be reliable — not before.

---

## G. Attendance model

**Recommendation: Option B — add `attendance_status`, keep `present boolean` for backward compatibility, do not discard the live model.**

Live `attendance` today: `id, schedule_id (not null → course_schedules), participant_id (not null → participants), session_date (not null), present (boolean, not null, default false), remarks, recorded_by, created_at/updated_at`, with `unique(participant_id, session_date)`.

Proposed additive columns:
```
attendance_status text not null default 'absent'   -- 4-value set, see below
check_in_time  timestamptz  (nullable)
check_out_time timestamptz  (nullable)
deleted_at     timestamptz  (nullable)
attendance_id  text unique  (business code, same generation pattern as participants.participant_code)
```

**Status value set** — the business requirement lists exactly 4 states (Present / Absent / Late / Excused); the app code's existing 6-value list (`pending, present, absent, late, medical_leave, excused`) is a numbered-track artifact, not a confirmed business need. Recommend the canonical set be:
```
present, absent, late, excused
```
— drop `pending` (an enrollment hasn't happened yet if there's no row; once a row exists for a session, it has a real status, defaulting to `absent` until marked otherwise) and fold `medical_leave` into `excused` unless the business specifically needs to distinguish them for reporting (cheap to add back later if so — ask, don't assume, see §R).

`present boolean` stays as a **generated, derived column** rather than a second independently-writable field (avoids the exact "two fields, one meaning, can drift apart" problem the task is trying to avoid elsewhere):
```sql
present boolean generated always as (attendance_status = 'present') stored
```
This requires dropping the current `not null default false` plain column and replacing it with a generated one — safe on 0 rows, and it means any old code still reading `present` keeps working with zero behavior change, while all new code reads/writes `attendance_status`.

---

## H. Multi-day attendance model

Business requirement: a participant on a 10-day course needs one attendance record **per day**, no duplicates per day, scoped per schedule.

Live constraint today — `unique(participant_id, session_date)` — is **almost right but has a real gap**: it's scoped to `participant_id` + `session_date` only, **not** `schedule_id`. That means if the same participant is enrolled in two different schedules that happen to run on overlapping calendar dates, the second schedule's attendance-taking would collide with the first (a real, if narrow, correctness bug already latent in the live constraint).

**Recommendation:** replace the live unique constraint with:
```sql
alter table public.attendance drop constraint attendance_participant_id_session_date_key; -- name may differ, verify exact name before writing DDL
alter table public.attendance add constraint attendance_schedule_participant_session_unique
  unique (schedule_id, participant_id, session_date);
```
This is a **strictly more correct** version of the same idea — same protection against duplicate per-day entries, now correctly scoped per schedule too. Safe on 0 live rows; this is a schema *correction*, not just an addition, so per CLAUDE.md §11 rule 6 it should be its own clearly-labeled step even though it's non-destructive (dropping a constraint on an empty table carries no data risk, but is still worth calling out explicitly rather than bundling silently into a bigger ALTER).

This directly answers the multi-day requirement: one row per `(schedule_id, participant_id, session_date)`, `attendance_status` per row, no schema change needed to support a 10-day course — it's just 10 rows instead of 1, which the existing shape already allows once the constraint above lands. **No app-code UI for entering per-day attendance exists today** (the traced `attendance/**` module always operates on exactly one attendance row per `(schedule_id, participant_id)` pair with no date picker) — that's a real feature build, not a schema gap, and is out of scope for "minimum additive migration"; flagged in §R as a follow-on product decision (do multi-day courses need this on day one, or can single-session-per-schedule ship first with the schema already correctly future-proofed?).

---

## I. Assessment model

Business requirement: theory + practical + overall result + competency/assessment status + trainer notes + assessment date; must work for score-free awareness programmes too; don't fabricate results.

Live `assessments` today: `id, schedule_id (nullable → course_schedules), participant_id (not null), assessment_type, score, max_score (default 100), result (not null, default 'pending', merged CHECK), assessed_at, remarks, created_at/updated_at`.

Proposed shape — **nullable-additive, no second table**, per instruction:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `schedule_id` | uuid → `course_schedules(id)` | **change to not null** | every consumer query filters on it; safe on 0 rows |
| `assessment_type` | text | yes (unchanged) | already free text, already fine |
| `theory_score` | numeric(5,2) | yes — **new** | left null for programmes with no theory component |
| `practical_score` | numeric(5,2) | yes — **new** | left null for programmes with no practical component |
| `overall_score` | numeric(5,2) generated | — **new**, formula below | **only computed when at least one input score exists** — see below |
| `result` | text | no, default `'pending'` | **narrow the CHECK to `pending/pass/fail` only** — split out competency (next row) |
| `competency_status` | text | yes — **new** | `pending_review/competent/not_yet_competent`; **nullable, not defaulted** — awareness programmes that don't assess competency simply never set this |
| `remarks` | text | yes (unchanged, already live) | this **is** "trainer notes" — no new column needed, app code should just start writing to it |
| `assessed_at` | date | yes (unchanged) | this **is** "assessment date" already — no new column needed |
| `locked`/`locked_at`/`locked_by` | boolean/timestamptz/uuid | new, default `false`/null/null | matches app code's lock workflow |
| `assessor_id` | uuid → `profiles(id)` | yes — new | who recorded it |
| `deleted_at` | timestamptz | yes — new | soft-delete, matches convention |
| `assessment_id` | text unique | new | business code, same pattern as elsewhere |
| `score`, `max_score` (legacy) | *unchanged* | — | kept, unused by new flow, no app code reads them today — low cost to leave, flagged for a future retirement decision, not this one |

**Awareness-programme support**: a row can exist with `assessment_type` set (or even entirely null), `theory_score`/`practical_score`/`overall_score` all null, `competency_status` null, and only `result` (`pass`/`fail`, or left at default `pending` until the trainer marks attendance-based completion) populated — or, for programmes with genuinely no pass/fail concept at all, **no assessment row is created for that schedule in the first place** (assessment stays optional per-schedule, not forced). This matches "do not fabricate results" directly: nothing here defaults a score or a competency value to anything meaningful — everything score-related is nullable with no synthetic default.

**`overall_score` formula — flagged as unresolved, do not guess**: recommend
```sql
overall_score numeric(5,2) generated always as (
  case
    when theory_score is not null and practical_score is not null then round((theory_score + practical_score) / 2, 2)
    when theory_score is not null then theory_score
    when practical_score is not null then practical_score
    else null
  end
) stored
```
as a reasonable default (simple average when both exist, pass through the one that exists otherwise, null if neither) — but this is a genuine business-rules question (should practical be weighted higher for a hands-on competency course? is there a minimum-theory-score-to-pass-regardless-of-practical rule?) that this audit cannot answer from code, since no app code was found computing this value anywhere (it's always treated as already-computed). **Confirm this formula, or supply the real one, before writing the DDL.**

---

## J. Certificate eligibility model (schema contract only — not building the view yet)

Conceptual chain, per the instruction:
```
schedule_participants row exists for (schedule_id, participant_id)
  ↓
Required attendance satisfied
  — e.g. no session for that schedule has attendance_status in ('absent') past a configurable threshold,
    or "all sessions present/late/excused" — exact threshold rule is a business decision, not inferable from code
  ↓
Required assessment satisfied, WHEN the programme requires one
  — i.e. this check is conditional: if no assessment row exists for this schedule at all (an awareness
    programme, per §I), this step is skipped entirely rather than failing; if an assessment row exists,
    it must have result = 'pass' (and competency_status = 'competent' when that programme tracks competency)
  ↓
Certificate eligible
```

Fields the future `v_certificate_eligibility`-equivalent will need to expose (matching what `certificates/actions.ts` and `certificates/generate/[scheduleId]/page.tsx` already read, per the prior trace): `schedule_id, participant_id, course_id (via course_schedules.course_id), holder_name (via participants.full_name), attendance_status (aggregated across sessions, not a single row — a real design question, see §R), result, competency_status, eligible (boolean)`.

**`certificates.schedule_id` needs its first-ever live FK** (confirmed in the prior audit — it exists as a column but has zero FK constraint today): `add constraint certificates_schedule_id_fkey foreign key (schedule_id) references public.course_schedules(id) on delete set null`.

Not building the view itself in this phase, per instruction — this section exists so §O's proposed columns don't foreclose it later, and every field the eventual view needs is already covered by §B/§C/§G/§I's additions.

---

## K. Capacity/seats_taken decision

**Recommendation: `capacity` stays stored config; `seats_taken` becomes trigger-maintained from `schedule_participants`, not app-code-updated.**

A pure query-time-derived value (no stored column, always `count(*)` from `schedule_participants where registration_status <> 'cancelled'`) was considered, since it has zero drift risk by construction — but it would require rewriting every place that currently reads `seats_taken`/`registered_participants` as a plain selected column (list, detail, export, certificate-generate picker, dashboard) into a subquery or view join, which is a much larger app-code footprint than the task's "minimum additive" framing wants.

The middle ground that actually satisfies "avoid maintaining a counter that can drift": a **trigger on `schedule_participants` (insert/update of `registration_status`/delete)** that recomputes `course_schedules.seats_taken` as `count(*) from schedule_participants where schedule_id = X and registration_status <> 'cancelled'`. This is not "the app maintains a counter that can drift" (the actual failure mode being warned against — two code paths independently incrementing/decrementing a number) — it's "the database is the single source of truth, recomputed deterministically from the real rows, on every relevant write." No application code ever increments/decrements it; `seats_taken` is effectively read-only from the app's perspective, same as `seats_remaining` (generated column, §B) which depends on it.
```sql
create or replace function app.sync_schedule_seats() returns trigger as $$
begin
  update public.course_schedules
  set seats_taken = (
    select count(*) from public.schedule_participants
    where schedule_id = coalesce(new.schedule_id, old.schedule_id) and registration_status <> 'cancelled'
  )
  where id = coalesce(new.schedule_id, old.schedule_id);
  return null;
end;
$$ language plpgsql;
-- attach as an AFTER INSERT OR UPDATE OR DELETE trigger on schedule_participants
```
(Naming deliberately matches the already-designed, never-applied `0013` migration's own `app.sync_schedule_seats()` — same idea, just now driven by the live `schedule_participants` table instead of the never-built one.) The existing `course_schedules_check` (`seats_taken >= 0 and seats_taken <= capacity`) stays as a correctness backstop.

---

## L. Schedule statuses

Inventory (from the prior audit, re-confirmed here):

| Source | Values |
|---|---|
| Live `schedule_status` enum | `open, full, in_progress, completed, cancelled` (5) |
| `schedules/**` app UI (`ScheduleForm`, list filter, `scheduleSchema`) | `draft, open, full, completed, cancelled, archived` (6) |
| Attendance/Assessment/Certificate/Reports modules | never filter/branch on schedule status values directly (they filter on `attendance_status`/`result`/`competency_status` instead) — no additional values to reconcile from these modules |

**Proposed canonical set** (adopting the business-suggested simple lifecycle, with `full` demoted from a stored status to a computed UI indicator — see rationale):
```
draft, scheduled, ongoing, completed, cancelled
```
- `draft` — being planned, not yet published/bookable (matches `is_published` already live on `course_schedules` — `draft` could literally just mean `is_published = false`, worth considering collapsing these two concepts into one, flagged as a secondary question in §R rather than decided here).
- `scheduled` — published, open for enrollment (replaces live `open`).
- `ongoing` — training is currently in progress (replaces live `in_progress`).
- `completed` — training finished (unchanged concept).
- `cancelled` — terminal, training will not run (unchanged concept).
- **`full` is removed as a status value.** Recommend it become a UI-computed badge (`seats_taken >= capacity`) shown alongside `status = 'scheduled'`, rather than a fifth lifecycle stage that a trigger has to flip back and forth as enrollments change — this avoids coupling the enrollment-count trigger (§K) to also owning status transitions, keeping each trigger single-purpose.

**Transitions** (app-enforced, not DB CHECK-enforced in this phase, per instruction not to apply CHECK constraints yet):
```
draft → scheduled → ongoing → completed
scheduled → cancelled
ongoing → cancelled   (rare but real — a training aborted mid-course)
completed, cancelled  → terminal, no further transitions
```

---

## M. Registration statuses

Adopting the business-suggested set exactly, since nothing in the traced app code demands more:
```
registered, confirmed, cancelled, completed
```
- `registered` — default on enrollment (§C's column default).
- `confirmed` — payment/attendance confirmed ahead of the session (optional workflow step — if the business doesn't use this distinction, `registered`→`completed` directly is fine; including it costs nothing since it's just a string value, not a new column).
- `cancelled` — the enrollment was withdrawn (this is what §C's partial unique index excludes from the "active" set, and what `removeParticipant` should set instead of hard-deleting, per §C).
- `completed` — the participant finished this schedule (distinct from *attendance* or *assessment* outcomes — a participant can be `completed` in registration terms while having failed the assessment; those are separate concepts, as instructed).

**Explicitly not conflated**: `registration_status` (enrollment lifecycle) ≠ `attendance_status` (per-session presence, §G) ≠ `assessments.result`/`competency_status` (pass/fail and skill outcome, §I). Three separate columns on three separate tables, exactly as instructed.

---

## N. RLS design

Confirmed live in the `app` schema this session: `is_editor()`, `is_admin()`, `is_super_admin()`, `has_min_role()`, `is_active()`, plus `audit_trigger()`, `log_event()`, `stamp_actor()`, `set_updated_at()` — all the helpers CLAUDE.md §6/§8 says must be used. **Do not repeat the live `course_schedules_staff_all`/`attendance_staff_all`/`assessments_staff_all` pattern** (currently blanket `ALL` to any `authenticated` user, no role check at all — a known, pre-existing gap, not something to extend).

Mirroring the app-layer guards already described in CLAUDE.md §8 (`requireAttendance(write?)`, `requireAssessment(write?)` separate view vs. manage rights, Trainer role admitted to the shell but scoped per-module):

```sql
-- course_schedules: schedule CRUD is an editor+ action; any active staff (incl. Trainer) can read
create policy course_schedules_read  on public.course_schedules for select to authenticated using (app.is_active());
create policy course_schedules_write on public.course_schedules for insert, update, delete to authenticated
  using (app.is_editor()) with check (app.is_editor());

-- schedule_participants: same split — assigning participants is an editor+ action; staff can read the roster
create policy schedule_participants_read  on public.schedule_participants for select to authenticated using (app.is_active());
create policy schedule_participants_write on public.schedule_participants for insert, update, delete to authenticated
  using (app.is_editor()) with check (app.is_editor());

-- attendance: Trainers record attendance for schedules they're delivering — write needs only "active staff",
-- not editor+, matching requireAttendance(write?)'s existing looser bar for this specific module
create policy attendance_read  on public.attendance for select to authenticated using (app.is_active());
create policy attendance_write on public.attendance for insert, update, delete to authenticated
  using (app.is_active()) with check (app.is_active());

-- assessments: same reasoning as attendance — trainers record scores; locking/approval is still an
-- app-layer concern (the `locked` column + requireAssessment(write?) guard), not a separate RLS tier here
create policy assessments_read  on public.assessments for select to authenticated using (app.is_active());
create policy assessments_write on public.assessments for insert, update, delete to authenticated
  using (app.is_active()) with check (app.is_active());
```

`app.is_active()`'s exact signature wasn't re-inspected this session (confirmed only that it exists) — verify its definition matches "any active staff member regardless of role" before using it as written above; if it instead checks a specific role floor, swap for `app.has_min_role('trainer')` to get the same effect explicitly. **Not executing any of this yet**, per instruction — this is the proposed shape for the eventual migration.

---

## O. Required DB additions (consolidated)

1. `course_schedules`: add `schedule_id` (text, unique, business code), `training_mode` (text), `start_time`/`end_time` (time), `seats_remaining` (generated, depends on `capacity`/`seats_taken`); extend `schedule_status` enum to the §L set (`add value` for `scheduled`/`ongoing`/`draft`, retire `full`/`in_progress`/`open` from active use — enum values can't be dropped without a rebuild, so old values simply go unused, not removed).
2. **New table** `schedule_participants` per §C, with the partial unique index from §C.
3. `attendance`: add `attendance_status` (text, default `'absent'`), `check_in_time`/`check_out_time` (timestamptz), `deleted_at`, `attendance_id` (business code); convert `present` to a generated column (§G); replace the `unique(participant_id, session_date)` constraint with `unique(schedule_id, participant_id, session_date)` (§H).
4. `assessments`: `schedule_id` → not null; add `theory_score`, `practical_score`, `overall_score` (generated, formula pending confirmation), `competency_status`, `locked`/`locked_at`/`locked_by`, `assessor_id`, `deleted_at`, `assessment_id`; narrow the `result` CHECK to `pending/pass/fail`.
5. `certificates`: add the missing `certificates_schedule_id_fkey → course_schedules(id) on delete set null`.
6. Trigger: `app.sync_schedule_seats()` on `schedule_participants` (§K), reusing the existing naming convention from the never-applied `0013` migration.
7. Indexes: `schedule_participants(participant_id)` (beyond the composite unique, since it doesn't efficiently serve participant-first lookups), `attendance(schedule_id)`, `attendance(participant_id)`, `assessments(schedule_id)`, `assessments(participant_id)`, `course_schedules(status) where deleted_at is null`, `course_schedules(trainer_id)` deferred with §F.
8. RLS per §N, replacing the blanket policies on `course_schedules`/`attendance`/`assessments` (whether to also fix `courses`/`participants`'s same blanket-policy gap in the same pass is a scope decision for you — they weren't asked about here, flagged in §R).
9. Audit trigger (`app.audit_trigger()`, confirmed live) attached to `schedule_participants` as a new staff-mutable table, per CLAUDE.md §11 rule 7.
10. No `training_schedules`, no `trainers` table — explicitly excluded per instruction.

---

## P. File-by-file application migration map

| # | File | Change type | Detail |
|---|---|---|---|
| 1 | `app/admin/(protected)/schedules/page.tsx` | QUERY RENAME + FIELD MAPPING | `training_schedules` → `course_schedules`; `trainer/max_participants/registered_participants/remarks` → `trainer_name/capacity/seats_taken/notes`; `course_name` → join `courses(course_name)` |
| 2 | `schedules/[id]/page.tsx` | QUERY RENAME + SCHEMA ADDITION REQUIRED | schedule header same as above; participant roster query becomes `schedule_participants.select("id, enrolled_at, registration_status, participants(...)").eq("schedule_id", id)` — needs §C to exist first |
| 3 | `schedules/[id]/edit/page.tsx` | QUERY RENAME + FIELD MAPPING | same header mapping; trainer dropdown becomes disabled/removed per §F deferral (was loading from a nonexistent `trainers` table anyway) |
| 4 | `schedules/new/page.tsx` (implied, not separately traced) | QUERY RENAME + FIELD MAPPING | same as create path in `actions.ts` |
| 5 | `schedules/calendar/page.tsx` | QUERY RENAME + FIELD MAPPING | same header mapping, adds `start_time` once §O.1 lands |
| 6 | `schedules/export/route.ts` | QUERY RENAME + FIELD MAPPING | column list swap; `entity_type` audit-log string `"training_schedules"` → `"course_schedules"` |
| 7 | `schedules/ScheduleForm.tsx` | FIELD MAPPING | input `name` attributes renamed to match live columns; status `<select>` options updated to §L's set; `training_mode` free-text input now has a real column to write to |
| 8 | `schedules/AssignParticipants.tsx` | SCHEMA ADDITION REQUIRED | posts to a rewritten `assignParticipants` action targeting `schedule_participants` |
| 9 | `schedules/actions.ts` — `createSchedule`/`updateSchedule` | FIELD MAPPING | payload keys renamed per §B |
| 10 | `schedules/actions.ts` — `trainerConflict()` | BUSINESS LOGIC CHANGE | see §F — either dropped or weakened to string-match on `trainer_name`; needs an explicit call, not silent |
| 11 | `schedules/actions.ts` — `duplicateSchedule` | FIELD MAPPING | same column renames |
| 12 | `schedules/actions.ts` — `archiveSchedule`/`softDeleteSchedule`/`restoreSchedule` | FIELD MAPPING + BUSINESS LOGIC CHANGE | `status: "archived"` needs a new value decision since §L drops `archived` from the proposed set — recommend soft-delete (`deleted_at`) already covers "archived" semantics; question whether a distinct `status='archived'` is still needed at all, flagged in §R |
| 13 | `schedules/actions.ts` — `assignParticipants`/`removeParticipant` | SCHEMA ADDITION REQUIRED + BUSINESS LOGIC CHANGE | targets `schedule_participants`; `removeParticipant` becomes an update to `registration_status='cancelled'` instead of a hard delete (§C) |
| 14 | `schedules/options.ts` | FIELD MAPPING + DEFERRED | course dropdown unchanged; trainer dropdown deferred per §F (returns empty/disabled until Trainers exists) |
| 15 | `lib/validation/schemas.ts` — `scheduleSchema` | FIELD MAPPING | field names/enum values updated to match §B/§L; add a new `scheduleParticipantSchema` (doesn't exist today) for the enrollment write path |
| 16 | `attendance/page.tsx`, `[scheduleId]/page.tsx`, `[scheduleId]/export/route.ts` | QUERY RENAME + SCHEMA ADDITION REQUIRED | `training_schedules` → `course_schedules`; attendance queries gain `attendance_status`/`check_in_time`/`check_out_time` once §O.3 lands; participant embed now goes through `schedule_participants` rather than a direct `attendance.participant_id → participants` embed if the roster (not just recorded attendance) needs to be shown for participants with no attendance row yet |
| 17 | `attendance/actions.ts` | FIELD MAPPING + BUSINESS LOGIC CHANGE | status literal set narrowed to §G's 4 values; `markAllPresent` etc. unchanged in shape, just narrower enum |
| 18 | `attendance/[scheduleId]/import/importActions.ts` | SCHEMA ADDITION REQUIRED | already has a code comment acknowledging it's working around missing live columns — once §O.3 lands, the cast-workaround can be removed |
| 19 | `assessment/page.tsx`, `[scheduleId]/page.tsx`, `[scheduleId]/export/route.ts` | QUERY RENAME + SCHEMA ADDITION REQUIRED | same pattern as attendance; needs §O.4 columns |
| 20 | `assessment/actions.ts` | FIELD MAPPING + BUSINESS LOGIC CHANGE | `result`/`competency_status` split matches live split once §O.4 lands (currently the app already treats them as separate, so this is actually a live-schema catch-up, minimal app-code change); score fields become genuinely optional in the UI (currently `z.union([z.literal(""), ...])` already supports empty — no change needed there, just confirm the empty→null path still works against nullable `theory_score`/`practical_score`) |
| 21 | `certificates/actions.ts` — `generateCertificate`/`bulkGenerate` | BUSINESS LOGIC CHANGE | rewritten against §J's conceptual chain instead of `v_certificate_eligibility` (view doesn't exist yet — this becomes inline query logic in the interim, or blocked until the view is built, a sequencing choice for §Q) |
| 22 | `certificates/generate/page.tsx`, `[scheduleId]/page.tsx` | QUERY RENAME + FIELD MAPPING | `training_schedules` → `course_schedules` header queries |
| 23 | `certData.ts` | **DEFERRED** | already deliberately targets the live/legacy `certificates` shape and explicitly avoids embedding schedule data — no change needed, matches this plan's "don't touch what already works" principle |
| 24 | `reports/page.tsx`, `reports/export/route.ts` | QUERY RENAME + DEFERRED | head-counts rename trivially now; the 6 reporting views (`v_schedules_per_month` etc.) are **DEFERRED** — not built in this phase per instruction, and `v_trainer_workload` specifically stays deferred until Trainers exists (§F) |
| 25 | `companies/[id]/page.tsx` | QUERY RENAME + BUSINESS LOGIC CHANGE | `schedule_participants.select("training_schedules(...)")` embed renamed to `course_schedules(...)`; the adjacent `participants.select("...schedule_id")` read is replaced with a `schedule_participants` join (§E point 3) |
| 26 | `trainers/[id]/page.tsx` | **DEFERRED** | entire page out of scope until Trainers exists (§F) — no change in this phase |
| 27 | `participants/[id]/page.tsx` | QUERY RENAME | `schedule_participants(...training_schedules(...))` nested embed renamed to `...course_schedules(...)` — this page already correctly uses `schedule_participants` as the outer table, just needs the inner embed name fixed |
| 28 | Dashboard (`app/admin/(protected)/dashboard/page.tsx`) | **DEFERRED** — not traced this session; confirmed only that it filters `certificates.status = 'valid'` (§ from prior audit), no direct schedule dependency found in either research pass. **Flag for a quick grep before implementation** to confirm it has no `training_schedules` reference this document missed. |
| 29 | Search (`app/admin/(protected)/search/page.tsx`) | **DEFERRED** — not traced this session or the prior one. **Flag for a quick grep before implementation** — the task explicitly lists it as an area to cover but neither research pass this session read this file; do not assume it's clean without checking. |

---

## Q. Exact implementation sequence

1. Confirm the two remaining open questions this document couldn't resolve from code (§R) — smaller and more bounded than the prior phase's list, but still real blockers for exact DDL: the attendance-status value set (4 vs. 6, medical_leave folded or not), the `overall_score` formula, the `trainerConflict()` fate, and whether `status='archived'` is still needed.
2. `course_schedules` additive migration (§O.1).
3. `schedule_participants` new table + partial unique index + `app.sync_schedule_seats()` trigger (§O.2, §C, §K) + audit trigger (§O.9).
4. `attendance` additive migration, including the constraint replacement (§O.3, §H).
5. `assessments` additive migration (§O.4).
6. `certificates.schedule_id` FK (§O.5).
7. RLS migration replacing the blanket policies on `course_schedules`/`attendance`/`assessments`/new `schedule_participants` (§N) — one migration, matches CLAUDE.md §11 rule 6 ("one logical change"), separate from the column-adding migrations above.
8. Indexes (§O.7) — can ride along with each table's own migration rather than being a separate step, since CLAUDE.md §13 requires the covering index in the *same* migration as the FK/filter column that needs it.
9. App-code compatibility pass, file-by-file per §P — items 1–15 (Schedules module) first, since everything else reads through it; then 16–20 (Attendance/Assessment) in parallel; then 21–23 (Certificates); then 24–27 (Reports/Companies/Trainers/Participants), with 26 staying deferred and 28–29 grep-verified before being marked either "no change" or added to this map.
10. `lib/supabase/database.types.ts` regeneration after each schema-changing migration (not just once at the end), per CLAUDE.md §11 rule 8.
11. Regression pass in the order the task specifies: Attendance → Assessment → Certificate generation → Reports.
12. `v_certificate_eligibility`-equivalent and the 6 reporting views — separate, later work, explicitly not part of this migration per instruction.

---

## R. Risks / remaining questions

1. **`trainerConflict()` fate** (§F, §P#10) — drop the double-booking check, or keep a weaker exact-string-match version against `trainer_name`? Small but real product-behavior decision.
2. **Attendance status set**: exactly 4 values (`present/absent/late/excused`) as the business requirement states, or does `medical_leave` need to stay distinct from `excused` for compliance/reporting reasons? Assumed folded in §G — confirm.
3. **`overall_score` formula** (§I) — simple average assumed; confirm or supply the real weighting rule before DDL.
4. **`status='archived'`** (§P#12) — with `deleted_at` already covering soft-delete/archival, is a separate `archived` lifecycle status still meaningful for `course_schedules`, or was it only ever needed because the numbered-track design didn't have `deleted_at` doing that job? Recommend dropping it from §L's set unless there's a use case this audit is missing.
5. **`draft` vs. `is_published`** (§L) — `course_schedules.is_published` (boolean, already live) may already fully cover what a `draft` status would mean. Worth collapsing into one concept rather than shipping both, but not decided here.
6. **Attendance aggregation for eligibility** (§J) — "required attendance satisfied" needs a concrete rule (100% present? some threshold? per-session or overall?) once multi-day attendance (§H) is real; a single-session model made this trivial, multi-day does not.
7. **Dashboard and Search** (§P#28–29) — genuinely unaudited this session; do not implement against them without first grepping for `training_schedules`/`course_schedules` references, since this document cannot certify they're clean.
8. **`courses`/`participants`'s own blanket RLS policies** (§O.8) — same "any authenticated user, no role check" gap as `course_schedules`/`attendance`/`assessments`, but out of this task's stated scope; flagging so it isn't mistaken for "already handled" once §N's policies ship.
9. **Existing 126 `participants` rows' `status` values** — not queried this session; before any future narrowing of `participants.status`'s CHECK constraint (not part of this migration, but adjacent), confirm what values are actually in use.

None of these block starting the migration sequence in §Q — items 1–5 are narrow, single-answer questions that can be resolved in the same conversation as DDL drafting; items 6–9 are scoped to later steps in §Q (view-building, RLS-hardening-beyond-schedules) and don't block the additive column/table work itself.

---

## Final verdict

**READY FOR MINIMAL ADDITIVE SCHEDULES MIGRATION**

The architecture is fully decided: `course_schedules` canonical, `schedule_participants` new, `attendance`/`assessments` extended additively, `certificates.schedule_id` gets its first FK, no `training_schedules`, no `trainers` table. The 5 items in §R are narrow confirmations (mostly single-value decisions), not open-ended business-model questions like the prior phase's — they can be resolved inline while drafting the actual DDL rather than requiring a separate business round-trip first. Recommend resolving §R items 1–5 explicitly (a quick confirm-or-correct pass) immediately before writing migration SQL, and grep-verifying §P items 28–29 before touching Dashboard/Search.
