# Trainer Management — Deliverable

Full-CRUD trainer/assessor/instructor module added to the existing TERAS
UNIVERSAL Admin CMS, integrated with Training Schedule, Assessment and the
Certificate Engine. Public website, Resend, routing and deployment config
unchanged.

> **Permissions:** Super Admin & Admin manage; **Editor read-only**. Enforced
> by RLS **and** `requireRole()` in every action.

---

## 1. Database Migration — `0018_trainer_management.sql`

Validated on PostgreSQL 16 (full set 0001–0018 applies clean).

## 2. SQL Schema — `trainers` (extended from 0003)

| Column | Notes |
|---|---|
| id (uuid PK) | |
| trainer_id | **auto** `TR-000001` (sequence + trigger) |
| full_name | required |
| ic_passport_no | **unique** among live rows (case-insensitive) |
| staff_no | **unique** among live rows |
| email, phone | |
| position, department | |
| employment_type | Full-time / Part-time / Contract / Freelance / Associate |
| specialisation | |
| qualifications, competencies | jsonb string arrays |
| trainer_photo, signature_image | image URLs (Supabase Storage) |
| status | **Active / Inactive / Retired / On Leave** |
| joining_date | |
| created/updated/deleted, audit | soft delete |

Plus **`training_schedules.trainer_id`** → `trainers(id)` (new FK) so schedules,
assessments and certificates all resolve to a real trainer.

**Indexes:** unique trainer_id; partial-unique IC + staff_no; status,
department; GIN search. **Verified:** auto `TR-000001`, duplicate-IC rejected,
editor read-only, schedule↔trainer link, status enum — all proven live.

## 3. RLS Policies

```
trainers
  trainers_public_read   SELECT using status='active' and not deleted   -- public site
  trainers_staff_read    SELECT using app.is_editor()
  trainers_admin_insert  INSERT with check app.is_admin()
  trainers_admin_update  UPDATE using/check app.is_admin()              -- edit + soft delete + restore
  trainers_admin_delete  DELETE using app.is_admin()
```
RLS enabled and forced.

## 3b. API Routes

| Route | Method | Purpose |
|---|---|---|
| `/admin/trainers/export` | GET | `?format=csv\|excel` (list) or `?format=profile&id=…` (printable **Trainer Profile PDF** placeholder). Auth re-checked, list export audited. |

Mutations (create/update/soft-delete/restore) are `requireRole('admin')`
server actions.

## 4. Pages Created

| Route | Access | Purpose |
|---|---|---|
| `/admin/trainers` | editor+ | List — search, status/employment filter, export, deleted view |
| `/admin/trainers/new` | admin+ | Add |
| `/admin/trainers/[id]` | editor+ | **Profile** — personal, employment, competencies, qualifications, assigned courses, training history, certificates issued, **workload** stats, signature |
| `/admin/trainers/[id]/edit` | admin+ | Edit |

## 5. Components Created

- `TrainerForm.tsx` — grouped form (personal / employment / competencies /
  photo + signature) with inline validation.
- `ImageUpload.tsx` — uploads photo/signature to the Supabase `media` bucket and
  writes the public URL (URL field fallback if Storage isn't configured).
- Server actions: `trainers/actions.ts`.
- Reuses existing `Card`, `Badge`, `StatCard`, `PageHead`, `EmptyState`,
  `Pagination`, `Field` and the admin layout (one new "Trainers" nav item).

## 6. Integration Summary

- **Training Schedule** — the schedule form now has a **trainer selector**
  (`training_schedules.trainer_id`) that also fills the trainer name.
  **Scheduling-conflict prevention**: creating/editing a schedule rejects
  overlapping date ranges for the same trainer (verified with live queries).
- **Certificate Engine** — `loadCertificateRender` resolves the schedule's
  trainer and, if present, uses the trainer's **signature_image** and name on
  the certificate automatically.
- **Assessment / Reporting** — the trainer profile surfaces assigned courses,
  training history, certificates issued and upcoming-session workload
  (foundation for reporting).

## 7. Files Modified / Added

**Added**
```
supabase/migrations/0018_trainer_management.sql
components/admin/ImageUpload.tsx
app/admin/(protected)/trainers/{page,actions,TrainerForm}.tsx
app/admin/(protected)/trainers/new/page.tsx
app/admin/(protected)/trainers/[id]/page.tsx
app/admin/(protected)/trainers/[id]/edit/page.tsx
app/admin/(protected)/trainers/export/route.ts
```
**Modified**
```
lib/admin-nav.ts        (Trainers nav item)
lib/auth/rbac.ts        (MODULE_ACCESS.trainers)
lib/validation/schemas.ts   (trainerSchema; scheduleSchema + trainer_id)
app/admin/(protected)/schedules/options.ts     (loadTrainerOptions)
app/admin/(protected)/schedules/ScheduleForm.tsx (trainer selector)
app/admin/(protected)/schedules/actions.ts       (trainer_id + conflict check)
app/admin/(protected)/schedules/new|/[id]/edit/page.tsx (pass trainers)
app/admin/(protected)/certificates/certData.ts   (trainer signature on cert)
```
No public-site, Resend or deployment config touched.

## 8. Build Result

⚠️ **This sandbox firewalls the npm registry (`registry.npmjs.org` → 403)**, so
`npm install` / `npm run build` can't run here. Note: `ImageUpload` uses the
Supabase Storage JS API (already a project dependency) — it can't be exercised
in the sandbox but requires no new package. Verification performed:

- ✅ **SQL** applied to PostgreSQL 16 — 0 errors; auto ID, unique IC/staff,
  editor-read-only RLS, schedule link and conflict-overlap logic all proven
  with live queries.
- ✅ **TypeScript** — all 96 `.ts/.tsx` files parse with 0 syntax errors.
- ✅ **Imports** — 263/264 resolve; the 1 remaining is the intentional
  `../globals.css` reference to your existing public stylesheet.

**Run to complete the required build:**
```bash
npm install
npm run lint
npm run build
```
The repo's Vercel connection runs the real `next build` on push to `main`.
