# Reporting & Analytics Dashboard — Deliverable

Real-time executive dashboard over live Supabase data — KPIs, charts, reports,
widgets and export. Public website, Resend, routing and deployment config
unchanged.

> **Permissions:** view = Editor+ (limited), full for Admin / Super Admin.
> Server-side filtering + head-count queries keep it fast.

## 1. Database Views — `0020_reporting_views.sql`
Nine `security_invoker` views (RLS-respecting, granted to authenticated),
validated on PostgreSQL 16:
`v_participants_per_month`, `v_schedules_per_month`, `v_certificates_per_month`,
`v_attendance_breakdown`, `v_attendance_trend` (monthly present-rate),
`v_assessment_passfail`, `v_top_companies`, `v_top_courses`,
`v_trainer_workload`. **Verified** returning correct aggregates with live data.

## 2. API Routes
`/admin/reports/export` — `?report=participants|companies|courses|schedules|
trainers|certificates&format=csv|excel`, and `?report=summary&format=print`
(printable executive summary → PDF via browser print). Every export is audited
(`log_event`).

## 3. Dashboard Pages
`/admin/reports` — executive dashboard:
- **KPI cards:** Total Participants, Companies, Courses, Training Schedules,
  Trainers, Certificates Issued, **Attendance Rate**, **Pass Rate**, Active
  (published) Courses, Upcoming Courses.
- **Widgets:** Upcoming Training, Recent Participants, Recent Certificates,
  Latest Companies, Latest Audit Logs.

## 4. Charts Implemented
Dependency-free **inline-SVG** chart components (`components/admin/Charts.tsx`):
`BarChart`, `LineChart`, `DonutChart` (no charting library → no new package).
Rendered on the dashboard:
- Participants per Month (bar) · Training Sessions per Month (bar)
- Certificates Issued monthly (line) · Attendance Trend % (line)
- Pass vs Fail (donut) · Attendance Breakdown (donut)
- Top Companies (bar) · Trainer Workload (bar) · Top Courses (bar)

## 5. Export Features
CSV, Excel (`.xls`), Print / PDF (executive summary), plus per-report CSV/Excel.
Global dashboard search is available via the existing top-bar search
(`global_search` RPC).

## 6. Files Modified / Added
Added: `0020_reporting_views.sql`, `components/admin/Charts.tsx`,
`app/admin/(protected)/reports/page.tsx`,
`app/admin/(protected)/reports/export/route.ts`.
Modified: `lib/admin-nav.ts` (Reports item), `lib/auth/rbac.ts`
(MODULE_ACCESS.reports).

## 7. Build Result
⚠️ npm registry firewalled here (403) → `npm run build` runs on your Vercel push.
Verified: SQL on PostgreSQL 16 (20 migrations apply clean; views return correct
data), TypeScript 106 files 0 syntax errors, 296/297 imports resolve (the 1 is
the intentional `../globals.css`). Run `npm install && npm run lint && npm run build`.

**Performance:** KPIs use `head:true` exact counts (no row transfer); charts use
pre-aggregated DB views; every list is paginated with server-side filtering.
