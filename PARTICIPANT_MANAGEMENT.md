# Participant Management — Deliverable

Internal-admin CRUD module added to the existing TERAS UNIVERSAL Admin CMS.
The public website, Resend, and existing routing/deployment config are
unchanged. Built on the existing stack (Next.js 15 · TypeScript · Supabase ·
existing admin layout).

> **Permissions:** Super Admin & Admin = full write (create/edit/delete/
> restore/import). **Editor = read-only** (view, search, export). Enforced by
> both RLS and `requireRole()` in every server action.

---

## 1. Database Schema — `participants`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| participant_id | text unique | **auto-generated** `TU-000001…` (sequence + trigger) |
| full_name | text | required |
| ic_passport_no | text | **unique among live rows**, case-insensitive |
| nationality | text | default `Malaysian` |
| company | text | required |
| position | text | |
| phone | text | required |
| email | citext | |
| gender | text | Male / Female |
| date_of_birth | date | |
| address | text | |
| emergency_contact_name | text | |
| emergency_contact_phone | text | |
| registration_date | date | default `current_date` |
| status | participant_status | registered / confirmed / attended / no_show / cancelled |
| schedule_id | uuid FK → schedules | future-ready course link |
| created_at / updated_at | timestamptz | `updated_at` auto-maintained by trigger |
| deleted_at | timestamptz | **soft delete** (null = live) |
| created_by / updated_by | uuid FK → profiles | audit stamp |

**Indexes:** unique `participant_id`; partial-unique `lower(ic_passport_no)`
where `deleted_at is null`; `company`, `status`, `created_at`; GIN full-text
(`participant_id, full_name, company, ic, email`).

## 2. SQL Migration

`supabase/migrations/0012_participants_management.sql` — additive migration
on top of the existing participants table:
- adds all expanded columns; migrates legacy `ic_passport` → `ic_passport_no`
- `participant_id_seq` + `app.gen_participant_id()` trigger (auto, race-safe)
- unique/partial-unique indexes + GIN search index
- `alter type audit_action add value 'import'`
- RLS rewrite (see §3)

**Verified** against PostgreSQL 16: migration applies clean; auto-ID yields
`TU-000001…`; duplicate IC (case-insensitive) is rejected; editor insert is
blocked by RLS while admin insert succeeds; `import` audit action + `log_event`
write correctly.

## 3. RLS Policies (on `public.participants`)

```
participants_read           SELECT  using (app.is_editor())        -- all staff read
participants_admin_insert   INSERT  with check (app.is_admin())    -- admin writes
participants_admin_update   UPDATE  using/check (app.is_admin())   -- edit + soft delete + restore
participants_super_delete   DELETE  using (app.is_super_admin())   -- hard delete (rare)
```
Soft delete and restore are `UPDATE`s (of `deleted_at`), so they fall under the
admin-update policy. RLS is **enabled and forced**.

## 4. API Routes

| Route | Method | Purpose |
|---|---|---|
| `/admin/participants/export` | GET | `?format=csv\|excel` + filters (`q,status,company,deleted`). CSV has UTF-8 BOM; Excel is a dependency-free `.xls` HTML table. Re-checks auth, audits the export. |

Import uses **server actions** (`analyzeImport`, `commitImport`) rather than a
REST route, so parsed rows are validated and de-duplicated server-side without
exposing an endpoint. Mutations (create/update/delete/restore/bulk) are also
server actions, all `requireRole('admin')`-guarded.

## 5. Pages Created

| Route | Access | Purpose |
|---|---|---|
| `/admin/participants` | editor+ | **List** — search, status/company filter, sort, pagination, bulk select, CSV/Excel export, deleted view |
| `/admin/participants/new` | admin+ | **Add** — validated form, friendly errors, duplicate-IC guard |
| `/admin/participants/[id]` | editor+ | **View** — personal / employment / contact + training/certificate/attendance/assessment placeholders |
| `/admin/participants/[id]/edit` | admin+ | **Edit** — auto `updated_at` |
| `/admin/participants/import` | admin+ | **Import** — CSV upload, preview, dedup, summary |

## 6. Components Created

- `ParticipantTable.tsx` — client table with row/all selection, bulk export
  (browser-side CSV of the selection), bulk delete/restore.
- `ParticipantForm.tsx` — shared add/edit form (grouped sections, inline errors).
- `ImportClient.tsx` — file picker, pure-JS CSV parser, live preview + summary,
  template download.
- Server actions: `actions.ts` (CRUD + bulk), `importActions.ts` (analyze/commit).
- Reuses existing `Card`, `Badge`, `PageHead`, `EmptyState`, `Pagination`,
  `Field`, and the admin `Sidebar`/`Topbar` layout (navigation unchanged).

## 7. Import Template Mapping

Template headers (download in the Import screen) → DB columns:

| CSV column | DB column | Required |
|---|---|---|
| Full Name | full_name | ✅ |
| IC / Passport | ic_passport_no | ✅ |
| Company | company | ✅ |
| Phone | phone | ✅ |
| Email | email | |
| Nationality | nationality | |
| Position | position | |
| Gender | gender (M*→Male, F*→Female) | |
| Date of Birth | date_of_birth (`YYYY-MM-DD` or `DD/MM/YYYY`) | |
| Address | address | |
| Emergency Contact | emergency_contact_name | |
| Emergency Phone | emergency_contact_phone | |

Import rules: preview before commit; **duplicate detection by IC/Passport**
(against DB and within the file); invalid rows skipped with a reason;
participant IDs generated automatically; a summary (total / ok / duplicate /
invalid) is shown, and the commit re-validates server-side (never trusts the
client). *Note: `.xlsx` binary import needs SheetJS (`xlsx`) — the parser is
structured so adding it is a one-function swap; CSV works with zero deps. The
sandbox's npm registry is firewalled, so SheetJS wasn't added here.*

## 8. Export Functionality

- **CSV** — UTF-8 BOM, all fields, honours current list filters.
- **Excel** — `.xls` (Excel-openable HTML table), dependency-free, honours filters.
- **Bulk export** — "Export selected" builds a CSV of the checked rows in-browser.
- Every export writes an audit entry (`action='export'`).

## 9. Files Modified / Added

**Added**
```
supabase/migrations/0012_participants_management.sql
app/admin/(protected)/participants/ParticipantTable.tsx
app/admin/(protected)/participants/import/page.tsx
app/admin/(protected)/participants/import/ImportClient.tsx
app/admin/(protected)/participants/import/importActions.ts
app/admin/(protected)/participants/export/route.ts
app/admin/(protected)/participants/[id]/edit/page.tsx
```
**Rewritten to full spec**
```
app/admin/(protected)/participants/page.tsx        (list)
app/admin/(protected)/participants/[id]/page.tsx   (now View, was Edit)
app/admin/(protected)/participants/new/page.tsx    (Add)
app/admin/(protected)/participants/actions.ts      (admin-only CRUD + bulk + restore)
app/admin/(protected)/participants/ParticipantForm.tsx
lib/validation/schemas.ts                          (participantSchema + import schema)
```
Navigation (`lib/admin-nav.ts`) already contains **Participants** — unchanged.
No public-site, Resend, or deployment files touched.

## 10. Build Result

⚠️ **This sandbox firewalls the npm registry (`registry.npmjs.org` → 403
Forbidden)**, so `npm install` / `npm run build` cannot execute here (Next
cannot be fetched). Verification performed instead:

- ✅ **SQL migration** applied to real PostgreSQL 16 — 0 errors; RLS, auto-ID,
  unique-IC, and import audit all proven with live queries.
- ✅ **TypeScript** — all 63 `.ts/.tsx` files parse with 0 syntax errors
  (compiler `transpileModule`).
- ✅ **Imports** — 156/157 relative imports resolve; the 1 remaining is the
  intentional `../globals.css` reference to your existing public stylesheet
  (present in the repo).

**Run on your machine / CI to complete the required build:**
```bash
npm install            # deps already in package.json + package.additions.json
npm run lint
npm run build
```
Because the repo is connected to Vercel with auto-deploy, pushing to `main`
runs the real `next build` on Vercel. If `npm run build` surfaces any
environment-specific type gap, regenerate Supabase types first:
`npx supabase gen types typescript … > lib/supabase/database.types.ts`.
