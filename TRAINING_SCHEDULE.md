# Training Schedule Management — Deliverable

Full-CRUD scheduling module added to the existing TERAS UNIVERSAL Admin CMS.
Public website, Resend, routing and deployment config unchanged. Built on the
existing stack and admin layout (navigation not redesigned — the existing
"Training Schedule" item now points at this module).

> **Permissions:** Super Admin & Admin = full write (create/edit/duplicate/
> archive/delete/assign/remove). **Editor = read-only** (view/search/export).
> Enforced by RLS **and** `requireRole()` in every server action.

---

## 1. Database Migration — `0013_training_schedules.sql`

Two new tables (validated on real PostgreSQL 16):

**`training_schedules`** — one session per row.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| schedule_id | text unique | **auto** `TS-000001…` (sequence + trigger) |
| course_id | uuid FK → courses | nullable |
| course_name | text | snapshot (survives course rename/delete) |
| trainer, venue, training_mode | text | mode = Public/In-house/Onsite/Online/Hybrid |
| start_date, end_date | date | `end_date >= start_date` check |
| start_time, end_time | time | |
| max_participants | int | |
| registered_participants | int | **auto-maintained** by trigger |
| seats_remaining | int | **generated** `max - registered` (≥0) |
| status | training_status | draft / open / full / completed / cancelled / archived |
| remarks | text | |
| created_at, updated_at, deleted_at | timestamptz | soft delete |
| created_by, updated_by | uuid FK → profiles | audit stamp |

**`schedule_participants`** — assignment (many-to-many).

| Column | Notes |
|---|---|
| schedule_id FK → training_schedules (cascade) | |
| participant_id FK → participants (cascade) | |
| **unique (schedule_id, participant_id)** | prevents duplicate registration |
| assigned_at, assigned_by | |

**Triggers/logic:** auto `schedule_id`; `app.sync_schedule_seats()` recalculates
`registered_participants` on every assign/remove and auto-flips `open ⇄ full`
(never overrides draft/completed/cancelled/archived); `updated_at`, actor-stamp
and audit triggers.

**Indexes:** unique `schedule_id`; `status`, `start_date`, `course_id`,
`trainer`; GIN full-text (`schedule_id, course_name, trainer, venue`); junction
indexes on both FKs.

**Verified:** migration applies clean on PG16; `TS-000001` auto-generated;
assigning 2 to a max-2 session set `registered=2, seats_remaining=0,
status=full`; duplicate registration rejected by the unique constraint; editor
insert blocked by RLS while admin insert succeeds.

## 2. RLS Policies

```
training_schedules
  ts_public_read    SELECT using status in (open,full,completed) and not deleted   -- public "upcoming"
  ts_staff_read     SELECT using app.is_editor()
  ts_admin_insert   INSERT with check app.is_admin()
  ts_admin_update   UPDATE using/check app.is_admin()      -- edit + archive + soft delete + restore
  ts_super_delete   DELETE using app.is_super_admin()

schedule_participants
  sp_staff_read     SELECT using app.is_editor()
  sp_admin_insert   INSERT with check app.is_admin()       -- assign
  sp_admin_delete   DELETE using app.is_admin()            -- remove
```
Both tables: RLS **enabled and forced**.

## 3. API Routes

| Route | Method | Purpose |
|---|---|---|
| `/admin/schedules/export` | GET | `?format=csv\|excel\|print` + filters (`q,status,course,trainer,month,year`). CSV (UTF-8 BOM), Excel (dependency-free `.xls`), Print (auto-print HTML). Re-checks auth, audits export. |

Mutations (create/update/duplicate/archive/delete/restore/assign/remove) are
`requireRole('admin')`-guarded **server actions**, not open REST endpoints.

## 4. Pages Created

| Route | Access | Purpose |
|---|---|---|
| `/admin/schedules` | editor+ | **List** — search, filter (status/course/trainer/month/year), sort, pagination, export CSV/Excel/Print, duplicate/archive inline |
| `/admin/schedules/new` | admin+ | **Create** |
| `/admin/schedules/[id]` | editor+ | **Details** — info, assigned participants (remove), assign panel, seats, Attendance/Assessment/Certificate placeholders |
| `/admin/schedules/[id]/edit` | admin+ | **Edit** (auto `updated_at`) |
| `/admin/schedules/calendar` | editor+ | **Calendar** — Month grid, Week view, List view + prev/next navigation |

## 5. Components Created

- `ScheduleForm.tsx` — create/edit form (course picker auto-fills name; mode,
  dates, times, capacity, status, remarks; inline validation).
- `AssignParticipants.tsx` — client search + multi-select + **bulk assign**,
  live remaining-seats guard (blocks over-capacity selection).
- `calendar/page.tsx` — dependency-free month/week/list renderer.
- Server actions: `actions.ts` (CRUD + duplicate/archive/restore + assign/remove).
- Reuses existing `Card`, `Badge`, `PageHead`, `EmptyState`, `Pagination`,
  `Field` and the admin `Sidebar`/`Topbar` layout (navigation unchanged).

## 6. Files Modified / Added

**Added**
```
supabase/migrations/0013_training_schedules.sql
app/admin/(protected)/schedules/AssignParticipants.tsx
app/admin/(protected)/schedules/calendar/page.tsx
app/admin/(protected)/schedules/export/route.ts
app/admin/(protected)/schedules/[id]/edit/page.tsx
```
**Rewritten for the new `training_schedules` model**
```
app/admin/(protected)/schedules/page.tsx        (list)
app/admin/(protected)/schedules/[id]/page.tsx   (details + assignment)
app/admin/(protected)/schedules/new/page.tsx
app/admin/(protected)/schedules/actions.ts
app/admin/(protected)/schedules/ScheduleForm.tsx
app/admin/(protected)/schedules/options.ts
lib/validation/schemas.ts                        (scheduleSchema)
app/admin/(protected)/dashboard/page.tsx         (Upcoming widget → training_schedules)
app/admin/admin.css                              (badge colours for full/completed)
```

**Reconciliation note (not blocking):** three legacy spots still read the older
`schedules` table — the participant form's optional schedule dropdown
(`participants/loadSchedules.ts`), the placeholder attendance page, and the
public adapter (`lib/public-content.ts`). The canonical assignment now lives in
`schedule_participants`. Repoint those to `training_schedules` when the
Attendance/public modules are finalised; nothing breaks meanwhile because the
old table still exists.

Placeholders prepared (per spec): **Attendance, Assessment, Certificate
Generation** appear as cards on the schedule details page.

## 7. Build Result

⚠️ **This sandbox firewalls the npm registry (`registry.npmjs.org` → 403)**, so
`npm install` / `npm run build` cannot run here (Next can't be fetched).
Verification performed instead:

- ✅ **SQL migration** applied to PostgreSQL 16 — 0 errors; auto-ID, seat-sync,
  auto full/open, duplicate-prevention and editor-read-only RLS all proven with
  live queries.
- ✅ **TypeScript** — all 67 `.ts/.tsx` files parse with 0 syntax errors.
- ✅ **Imports** — 170/171 relative imports resolve; the 1 remaining is the
  intentional `../globals.css` reference to your existing public stylesheet.

**Run to complete the required build (your machine or CI):**
```bash
npm install
npm run lint
npm run build
```
Because the repo is connected to Vercel with auto-deploy, pushing to `main` runs
the real `next build`. If a Supabase type gap surfaces, regenerate first:
`npx supabase gen types typescript … > lib/supabase/database.types.ts`.
