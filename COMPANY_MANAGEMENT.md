# Company / Client Management — Deliverable

Master database of corporate clients, integrated with Participants (and, via
them, Schedules, Attendance, Assessment and Certificates). Public website,
Resend, routing and deployment config unchanged.

> **Permissions:** Super Admin & Admin manage; **Editor read-only**. Enforced by
> RLS + `requireRole()`.

## 1. Database Migration — `0019_company_management.sql`
Validated on PostgreSQL 16.

## 2. SQL Schema — `companies`
Auto `company_id` (CO-000001), company_name, registration_no (**unique** among
live), industry, company_type, full address (address/postcode/city/state/
country), phone/email/website, PIC block (person_in_charge, pic_position,
pic_phone, pic_email), billing_address, **status** (Active/Inactive/Prospect/
Archived), remarks, audit + soft-delete columns. Indexes on status, industry,
state + GIN search. **`participants.company_id`** FK added to link participants.

**Verified live:** auto CO-000001, duplicate registration-no rejected, editor
read-only, participant↔company link.

## 3. API Routes
`/admin/companies/export` — `?format=csv|excel` (list) or `?format=profile&id=…`
(printable Company Profile Report / PDF placeholder). Auth re-checked, audited.
Mutations are `requireRole('admin')` server actions.

## 4. Pages Created
`/admin/companies` (list: search by name/reg/industry/PIC, filter status/
industry, export, deleted view) · `/new` · `/[id]` (**profile**: company
details, PIC info, participants (current/past), training schedules,
certificates) · `/[id]/edit`.

## 5. Components Created
`CompanyForm.tsx` (grouped: details / address / PIC), company actions. Reuses
`Card`, `Badge`, `StatCard`, `PageHead`, `EmptyState`, `Pagination`, `Field`.
One new "Companies" nav item.

## 6. Integration Summary
- **Participants** — participant form has a company selector
  (`participants.company_id`); the company profile lists its participants
  (current vs past by status).
- **Training Schedule / Attendance / Assessment / Certificate** — the company
  profile aggregates the schedules its participants attended and the
  certificates they earned (via `schedule_participants` + `certificates`).
- **Reporting** — `v_top_companies` powers the "Top Companies" chart.

## 7. Files Modified / Added
Added: `0019_company_management.sql`, `companies/{page,actions,CompanyForm}.tsx`,
`companies/new`, `companies/[id]/page.tsx`, `companies/[id]/edit`,
`companies/export/route.ts`. Modified: `admin-nav.ts`, `rbac.ts`,
`validation/schemas.ts` (companySchema + participant company_id),
`participants/{ParticipantForm,actions,loadSchedules}.tsx`,
`participants/new|/[id]/edit` (company options).

## 8. Build Result
⚠️ npm registry firewalled here (403) → `npm run build` runs on your Vercel push.
Verified: SQL on PostgreSQL 16 (0 errors; auto ID, unique reg, RLS, link),
TypeScript 106 files 0 syntax errors, 296/297 imports resolve (the 1 is the
intentional `../globals.css`). Run `npm install && npm run lint && npm run build`.
