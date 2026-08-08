# Admin CRM verification audit

Date: 24 July 2026

## Scope

The verified user story is: authorised staff sign in at `/admin/login`, navigate to an admin module, read or update Supabase data under RLS, and see the saved state reflected in the CRM.

## Evidence collected

- Production build completed successfully for all 65 routes.
- Vercel Preview deployed successfully.
- Read-only authenticated checks confirmed: 104 courses, 104 participants, 87 certificates and one staff profile are accessible to the supplied admin role.
- Certificate records are linked to participants (87 links found).
- The Participants page query was corrected from the absent `registered_at` column to `created_at`; the corrected query returns 100 records on its first page.
- Dashboard certificate queries were corrected because the production `certificates` table does not have `deleted_at`.

## Verified working

| Area | Status | Evidence |
| --- | --- | --- |
| Authentication and protected routes | Verified | Preview request logs show login and protected route requests; server-side `requireRole` is used in protected layouts/actions. |
| Admin navigation and root redirect | Verified | `/admin` redirects to Dashboard; sidebar routes are present. |
| Courses | Verified | Live table query works; create/edit server actions are built. |
| Participants | Verified after repair | Live query returns records after `created_at` correction. |
| Certificates | Verified for existing data | 87 certificate records, all linked to participants. |
| Schedules | Available, empty data set | Table query works; no sessions currently exist. |
| Attendance and assessments | Available, empty data set | Read queries work; server actions are present. |
| Company Profile | Available | Singleton form and server action compile. |
| Audit and Users & Roles | Available | Protected list pages compile; roles are enforced server-side. |

## Critical gaps

The following production tables are absent from the Supabase Data API schema cache:

- `news_posts`
- `gallery_images`
- `faqs`
- `downloads`
- `media`

Their related CRM pages cannot currently read or save real data. The repository contains additive migrations for these modules, but the connected production database has not received them or has not exposed them through the Data API.

## Required remediation

1. Apply the existing content-module migrations to the intended Supabase project in a controlled Preview/staging database first.
2. Verify table exposure, grants and RLS policies for authenticated editor/admin roles.
3. Seed one non-production record per content type and run the create/edit/read flow.
4. Only then enable News, Gallery, FAQ, Downloads and Media as full CRUD modules in production.

## Safety note

No database migration or test record was written during this audit. Applying migrations is a persistent production-data change and should be approved and run against the correct Supabase project deliberately.
