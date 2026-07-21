# TERAS UNIVERSAL — Admin CMS

A secure, role-based admin dashboard that powers the existing TERAS UNIVERSAL
website dynamically. Built to **extend** the current site — the public frontend
is not redesigned or rebuilt. The admin lives under `/admin` in the same
Next.js app and shares the same Vercel deployment.

**Stack:** Next.js 15 (App Router) · React 19 · Supabase (Postgres + Auth +
Storage + RLS) · Resend (unchanged) · Vercel. Admin code is TypeScript; your
existing `.js` public pages are untouched.

**Scope (locked):** Dashboard · Course Management · Training Schedule ·
Participant Management · Attendance & Assessment · Certificate Management ·
Public Certificate Verification · Website Content (News, Gallery, FAQ,
Downloads, Company Profile, Media) · Draft/Published/Archived workflow ·
Preview before publishing · Audit Log · User & Role Management.
**Explicitly excluded:** Contact Enquiries, Proposal Requests, Website Settings.

Everything the admin changes is read by the public site through
`lib/public-content.ts`, so approved changes appear automatically.

---

## 1. Database Schema

25 base tables + 2 (attendance, assessments) = **27 tables**, all with UUID
keys, `created_at`/`updated_at`, soft-delete (`deleted_at`), and audit columns.
Every table has **Row Level Security enabled and forced**. The schema was
applied and tested against a live PostgreSQL 16 instance (all migrations + seed
run clean; RLS enforcement verified across anon/editor/admin/super_admin).

### Auth & RBAC
| Table | Purpose |
|---|---|
| `profiles` | 1:1 mirror of `auth.users` — role, status, name, last login |
| `user_permissions` | Per-user permission overrides on top of role defaults |

Roles (most→least privileged): `super_admin`, `admin`, `editor`, and
future-ready `trainer`, `client`, `participant`. Helper functions in the `app`
schema (`is_editor()`, `is_admin()`, `is_super_admin()`, `has_permission()`)
back every RLS policy.

### Training Operations
| Table | Purpose |
|---|---|
| `courses` | Programmes: title, slug, overview, objectives, modules, FAQ, SEO, status |
| `trainers`, `venues` | Lookups for scheduling |
| `schedules` | Sessions: dates, times, capacity, `seats_available` (generated), status |
| `participants` | People registered to a schedule |
| `attendance` | Per-participant, per-session presence |
| `assessments` | Results: score, competent / not-yet-competent / pass / fail |
| `certificates` | Issued certificates + non-guessable `verification_code` |

### Website Content
| Table | Purpose |
|---|---|
| `news_posts`, `news_categories` | News with draft/publish/schedule workflow |
| `gallery_images`, `gallery_categories` | Gallery with alt text, featured, sort |
| `faqs`, `faq_categories` | FAQ CRUD |
| `downloads` | Company profile, brochures, forms, calendars |
| `company_profile` | Singleton: vision, mission, about, services, contact, map, socials |
| `media`, `media_folders` | Single media library (all uploads) |
| `site_settings` | Namespaced key/value (present but not surfaced in UI per scope) |

### System
| Table | Purpose |
|---|---|
| `audit_logs` | Append-only trail — login, create, update, delete, publish, export |
| `enquiries`, `proposal_requests` (+ notes) | Present in schema but **no admin UI** (excluded scope); safe to drop if unwanted |

Full definitions: `supabase/migrations/`. Entity relationships in §5.

---

## 2. Folder Structure

```
├── middleware.ts                      # protects /admin, refreshes session
├── tsconfig.json                      # add if not present
├── package.additions.json             # deps to merge into package.json
├── .env.admin.example                 # Supabase env vars to add
│
├── supabase/
│   ├── migrations/0001…0011_*.sql     # schema, RLS, functions, storage, grants
│   └── seed.sql                       # migrates current site content into DB
│
├── lib/
│   ├── supabase/{server,client,middleware,database.types}.ts
│   ├── auth/{rbac,session}.ts         # role helpers + requireRole() guard
│   ├── validation/schemas.ts          # Zod schemas (defence in depth)
│   ├── admin-nav.ts                   # navigation config (role-aware)
│   └── public-content.ts              # PUBLIC site reads CMS data through here
│
├── components/admin/
│   ├── Sidebar.tsx  Topbar.tsx  NavScrim.tsx  ScaffoldPage.tsx
│   └── ui/index.tsx                   # StatCard, Card, Badge, DataTable bits, Field, Pagination…
│
└── app/
    ├── verify/page.tsx                # PUBLIC certificate verification (no auth)
    ├── admin/
    │   ├── layout.tsx                 # .teras-admin scope + admin.css
    │   ├── admin.css                  # self-contained admin styling (brand colours)
    │   ├── login/{page.tsx,actions.ts}
    │   ├── no-access/page.tsx
    │   └── (protected)/               # everything here requires ≥ editor
    │       ├── layout.tsx             # sidebar + topbar shell
    │       ├── dashboard/page.tsx
    │       ├── courses/…              # FULL reference module (list/new/edit/preview/actions)
    │       ├── schedules|participants|attendance|certificates/…
    │       ├── news|gallery|faq|downloads|company|media/…
    │       ├── search/page.tsx
    │       ├── audit/page.tsx         (admin)
    │       └── users/page.tsx         (super_admin)
```

---

## 3. Components Created

**Shell:** `Sidebar` (role-filtered nav + badges), `Topbar` (global search,
user menu, sign-out), `NavScrim` (mobile), `AdminRootLayout`, `ProtectedLayout`.

**UI primitives** (`components/admin/ui`): `StatCard`, `Card`, `Badge`
(status-coloured), `PageHead`, `EmptyState`, `Pagination`, `Field`.

**Module components:** `CourseForm` (shared create/edit with inline Zod
errors), `ScaffoldPage` (for modules whose data layer is done and UI follows
the Courses pattern).

**Libraries:** Supabase server/browser/middleware clients, `rbac` helpers,
`requireRole()` guard, Zod schemas, `admin-nav`, `public-content` adapters.

---

## 4. Pages Created

| Route | Access | Status |
|---|---|---|
| `/admin/login` | public | ✅ complete |
| `/admin/dashboard` | editor | ✅ complete (widgets: courses, participants, certs, upcoming, assessments, quick actions) |
| `/admin/courses` `/new` `/[id]` `/[id]/preview` | editor | ✅ complete — **full CRUD + preview** (reference module) |
| `/admin/attendance` | editor | ✅ complete — mark attendance + record assessment per schedule |
| `/admin/search` | editor | ✅ complete (global search RPC) |
| `/admin/audit` | admin | ✅ complete (read-only) |
| `/verify` | **public** | ✅ complete — certificate verification |
| `/admin/schedules` `/participants` `/certificates` | editor | ◑ scaffold — data layer done, UI follows Courses pattern |
| `/admin/news` `/gallery` `/faq` `/downloads` `/company` `/media` | editor | ◑ scaffold — data layer done, UI follows Courses pattern |
| `/admin/users` | super_admin | ◑ scaffold |

"Scaffold" = database, RLS, audit, seed and navigation are complete and
tested; the CRUD screen replicates the fully-built Courses module (three
files: `page.tsx`, `[id]/page.tsx`+`new/page.tsx`, `actions.ts`). See §8.

---

## 5. SQL Migration Files

Apply in order (Supabase SQL editor, or `supabase db push`):

| File | Contents |
|---|---|
| `0001_extensions_and_enums.sql` | pgcrypto/citext/pg_trgm, `app` schema, all enums |
| `0002_core_auth_rbac.sql` | `profiles`, `user_permissions`, role helpers, new-user trigger |
| `0003_content_modules.sql` | courses, schedules, trainers, venues, downloads, news, gallery, faq, testimonials, company, settings |
| `0004_crm_and_media.sql` | media library, participants, certificates (+ enquiries/proposals) |
| `0005_audit_log.sql` | `audit_logs` + `log_event()` |
| `0006_functions_triggers.sql` | updated_at, actor-stamp, generic audit trigger, slugify, global search |
| `0007_rls_policies.sql` | RLS enable/force + all policies (public read published / staff write / admin delete) |
| `0008_storage_buckets.sql` | media / downloads / private buckets + storage policies |
| `0009_grants.sql` | anon/authenticated privilege grants (RLS filters rows) |
| `0010_public_rpc.sql` | public wrappers for `log_event` + `global_search` |
| `0011_attendance_assessment_verification.sql` | attendance, assessments, `verify_certificate()` |
| `seed.sql` | migrates current site content (courses, gallery, company, categories) + super-admin bootstrap |

**Verification performed:** all 11 migrations + seed applied to PostgreSQL 16
with zero errors; RLS proven (anon sees only published; editor cannot delete;
admin can; super_admin has all permissions; public cert verification returns
safe fields only; audit triggers auto-log writes).

Key relationships: `schedules.course_id → courses` · `participants.schedule_id
→ schedules` · `attendance/assessments.participant_id → participants` ·
`certificates.course_id → courses` · every content table
`created_by/updated_by → profiles`.

---

## 6. Admin Navigation Structure

```
Overview
  └ Dashboard
Training Operations
  ├ Courses
  ├ Training Schedule
  ├ Participants
  ├ Attendance & Assessment
  └ Certificates
Website Content
  ├ News
  ├ Gallery
  ├ FAQ
  ├ Downloads
  ├ Company Profile
  └ Media Library
Administration
  ├ Audit Log            (admin+)
  └ Users & Roles        (super_admin)
```

The sidebar renders only items the signed-in role may access (mirrors RLS).
Role → module access is defined in `lib/auth/rbac.ts` (`MODULE_ACCESS`).

---

## 7. Production Checklist

**Supabase**
- [ ] Create a Supabase project; copy URL + anon + service-role keys.
- [ ] Run migrations `0001`→`0011` in order, then `seed.sql`.
- [ ] Create the first user (Auth → Add user), then run the elevation
      statement at the bottom of `seed.sql` to make them `super_admin`.
- [ ] Confirm the three storage buckets exist (`media`, `downloads`, `private`).
- [ ] Spot-check RLS: from an anon context, published courses are visible and
      drafts are not.

**App / Vercel**
- [ ] `npm install @supabase/supabase-js @supabase/ssr zod` and dev types
      (see `package.additions.json`).
- [ ] Add env vars from `.env.admin.example` to Vercel (mark
      `SUPABASE_SERVICE_ROLE_KEY` as sensitive; never `NEXT_PUBLIC_`).
- [ ] Copy `lib/`, `components/admin/`, `app/admin/`, `app/verify/`,
      `middleware.ts` into the repo. Merge `package.additions.json` and
      `tsconfig.json`.
- [ ] Deploy. Visit `/admin/login`, sign in, confirm the dashboard loads.
- [ ] Point the public site at CMS data incrementally via
      `lib/public-content.ts` (start with courses; see §8).

**Security**
- [ ] Service-role key is server-only and never imported into a client component.
- [ ] Enable Supabase Auth password policy / rate limiting; consider MFA for
      super admins.
- [ ] `/admin` and `/verify` behave over HTTPS on the production domain.
- [ ] Audit log is admin-only and append-only (no update/delete policies).

**Quality**
- [ ] `npx supabase gen types typescript … > lib/supabase/database.types.ts`
      to replace the hand-written subset with the full generated types.
- [ ] `next build` passes; Lighthouse/keyboard pass on `/admin` and `/verify`.

---

## 8. Remaining Tasks

The foundation, database, security model, and the **Courses** module are
production-ready and tested. To finish the remaining modules, replicate the
Courses pattern — each is ~3 small files against a table that already exists:

1. **List** (`page.tsx`) — copy `courses/page.tsx`, swap the table name,
   columns and filters.
2. **Form** (`new/page.tsx` + `[id]/page.tsx` + a `*Form.tsx`) — copy
   `CourseForm.tsx`, change the fields; add a Zod schema in
   `lib/validation/schemas.ts` (patterns already there for schedules).
3. **Actions** (`actions.ts`) — copy `courses/actions.ts` (create / update /
   soft-delete, all `requireRole`-guarded and Zod-validated).

Module-by-module notes:
- **Training Schedule** — `scheduleSchema` already written; add
  duplicate-schedule (clone row) and cancel (set status) actions.
- **Participants** — CRUD + register-against-schedule; feeds Attendance.
- **Certificates** — issue (insert → `verification_code` auto-generated),
  revoke/expire (status), and a "print/PDF" view; link the QR to
  `/verify?code=…`.
- **News / Gallery / FAQ / Downloads / Company / Media** — standard CRUD; wire
  uploads to Supabase Storage via the `media` table.
- **Users & Roles** — invite (Supabase Auth admin API via a service-role route
  handler), set role, deactivate, per-user permission overrides.

Then connect the **public site** to the CMS (no redesign — data source swap
only), e.g. in `app/page.js` replace the hard-coded programmes array with
`getPublishedCourses()` from `lib/public-content.ts`. Repeat for gallery, FAQ,
schedules and company profile. Call `revalidateTag('courses')` in the relevant
action (or rely on the 60s cache) so approved edits appear automatically.

**Not in scope** (do not build): Contact Enquiries, Proposal Requests, Website
Settings. Their tables can be dropped from `0004` if you prefer a leaner schema.
