# Assessment Management — Deliverable

Full-CRUD assessment module added to the existing TERAS UNIVERSAL Admin CMS.
Public website, Resend, routing and deployment config unchanged. Built on the
existing stack and admin layout.

> **Permissions:** Super Admin, Admin & Trainer manage; **Editor read-only**.
> Locked assessments are editable only by **Super Admin** (unlock). Enforced by
> RLS **and** `requireAssessment()` in every server action.

---

## 1. Database Migration — `0015_assessment_management.sql`

Replaces the basic assessments table (0011) with the full spec model
(validated on PostgreSQL 16).

**`assessments`**

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| assessment_id | text unique | **auto** `ASMT-000001` |
| schedule_id | uuid FK → training_schedules | cascade |
| participant_id | uuid FK → participants | cascade |
| assessment_type | enum | theory / practical / combined |
| theory_score | numeric(5,2) | 0–100 |
| practical_score | numeric(5,2) | 0–100 |
| overall_score | numeric(5,2) | **generated** — avg when both, else whichever present |
| result | enum | pending / pass / fail |
| competency_status | enum | pending_review / competent / not_yet_competent |
| assessment_date | date | |
| assessor_id | uuid FK → profiles | |
| remarks | text | |
| locked, locked_at, locked_by | bool / ts / uuid | lock workflow |
| created_at, updated_at, deleted_at | timestamptz | soft delete |
| **unique (schedule_id, participant_id)** | | one row per participant per schedule |

**Triggers/logic:** auto `assessment_id`; **auto-create** an assessment row when
a participant's attendance row is created (assign → attendance → assessment
chain); `overall_score` generated; `updated_at` + audit triggers.

**Verified:** assign → attendance → assessment auto-created (`ASMT-000001`,
combined, pending); entering theory 80 + practical 90 auto-computed
`overall_score = 85.00`; locking blocks trainer edits; **Super Admin unlock**
works; editor read-only.

## 2. RLS Policies

```
assessments_view            SELECT using can_view_assessment()      -- editor+ or trainer
assessments_manage_insert   INSERT with check can_manage_assessment()   -- admin or trainer
assessments_manage_update   UPDATE using (can_manage_assessment() AND locked=false)
                                   with check can_manage_assessment()    -- can't edit locked rows
assessments_super_update    UPDATE using is_super_admin()            -- edit any incl. unlock
assessments_admin_delete    DELETE using is_admin()
```
Locking a row is a normal update (old row still unlocked → allowed). Once
locked, only Super Admin's policy matches, which is how **unlock** is
restricted. RLS **enabled and forced**.

## 3. API Routes

| Route | Method | Purpose |
|---|---|---|
| `/admin/assessment/[scheduleId]/export` | GET | `?format=csv\|excel\|report`. CSV (BOM), Excel (`.xls`), **report** = printable HTML (the PDF placeholder — print/save as PDF, includes assessor signature line). Auth re-checked, export audited. |

Mutations (update / bulk result / lock / unlock) are `requireAssessment`-guarded
server actions; unlock additionally checks Super Admin.

## 4. Pages Created

| Route | Access | Purpose |
|---|---|---|
| `/admin/assessment` | editor+/trainer | **List** — schedules with competency/pending summary, search/filter |
| `/admin/assessment/[scheduleId]` | editor+/trainer | **Assessment page** — schedule view, summary tiles, inline marks table, bulk result, lock/unlock, export, integration placeholders |

## 5. Components Created

- `AssessmentTable.tsx` — client inline editor (type, theory, practical,
  live overall, result, competency, remarks per row), **bulk set result**,
  **lock / unlock** (unlock shown only to Super Admin), search; locked rows
  render read-only.
- Server actions: `actions.ts` (update / bulkUpdateResult / lockAssessments /
  unlockAssessments).
- Reuses existing `Card`, `Badge`, `StatCard`, `PageHead`, `EmptyState`,
  `Pagination` and the admin layout (navigation gets one new "Assessment" item).

**Integration placeholders** (per spec): Certificate Generator, Participant
History, Training History, Reporting Dashboard — cards on the assessment page.

## 6. Files Modified / Added

**Added**
```
supabase/migrations/0015_assessment_management.sql
app/admin/(protected)/assessment/page.tsx
app/admin/(protected)/assessment/actions.ts
app/admin/(protected)/assessment/AssessmentTable.tsx
app/admin/(protected)/assessment/[scheduleId]/page.tsx
app/admin/(protected)/assessment/[scheduleId]/export/route.ts
```
**Modified**
```
lib/admin-nav.ts        (new "Assessment" nav item, trainer-visible)
lib/auth/rbac.ts        (canView/canManageAssessment + MODULE_ACCESS.assessment)
lib/auth/session.ts     (requireAssessment guard)
app/admin/(protected)/dashboard/page.tsx   (Recent Assessments → new columns)
app/admin/admin.css     (badge colours: fail/pending_review/not_yet_competent/…)
```
No public-site, Resend or deployment files touched.

## 7. Build Result

⚠️ **This sandbox firewalls the npm registry (`registry.npmjs.org` → 403)**, so
`npm install` / `npm run build` can't run here. Verification performed instead:

- ✅ **SQL migration** applied to PostgreSQL 16 — 0 errors; auto-create chain,
  generated overall_score, lock-blocks-trainer, super-admin-unlock, and
  editor-read-only all proven with live queries.
- ✅ **TypeScript** — all 78 `.ts/.tsx` files parse with 0 syntax errors.
- ✅ **Imports** — 204/205 relative imports resolve; the 1 remaining is the
  intentional `../globals.css` reference to your existing public stylesheet.

**Run to complete the required build (your machine or CI):**
```bash
npm install
npm run lint
npm run build
```
The repo's Vercel connection runs the real `next build` on push to `main`.
If a Supabase type gap surfaces:
`npx supabase gen types typescript … > lib/supabase/database.types.ts`.
