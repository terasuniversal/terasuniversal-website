# CEO Dashboard Plan — TERAS UNIVERSAL

A plan for an executive-level dashboard: which metrics, which charts, and how to lay them out. Every metric below is mapped to an actual field in this repository's designed schema (`DATABASE_AUDIT.md`) so this plan is buildable, not aspirational — and every gap (data the CEO would want that the schema doesn't currently capture) is called out explicitly rather than glossed over. Documentation only; no code or files beyond this plan were created.

## Before this can be built

This dashboard should read from the **designed** operations schema (`training_schedules`, `participants`, `certificates`, `companies`, `trainers`, `attendance`, `assessments`, and the pre-built `v_*` reporting views), not the live legacy schema — the live schema has none of `companies`, `trainers`, or the reporting views at all. Per `MASTER_TODO.md`, this dashboard is realistically sequenced **after C1 (schema consolidation) and H1 (operations modules rebuilt)** — building it against today's live database would mean building it twice. Treat this document as the target state to build toward, and revisit the specific view/column names here once C1's direction is finalized (adopt-live vs. migrate-forward — see `DATABASE_AUDIT.md` §10) in case field names shift.

The one metric category with **no schema support at all, in either schema lineage**: **revenue**. `courses.fee` and `training_schedules`/`course_schedules` may carry a `fee` field, but there is no invoicing, payment, or transaction table anywhere in this codebase. Revenue on this dashboard must be an *estimate* (fee × enrolled participants), clearly labeled as such, unless a billing/invoicing module is scoped and built first — this is called out again in the Revenue section below rather than presented as tracked, real data.

---

## 1. Audience and purpose

Built for the CEO/founder and senior management — a weekly/monthly read, not an operational tool (that's what the existing Dashboard, Reports, and per-module list pages are for). Optimized for **"is the business healthy and growing"** at a glance, with drill-down available but not required. Should answer, in under 30 seconds of looking at it:

- Are we training more people than last month? Is revenue trending up?
- Are certificates being issued reliably (operational health), and are participants passing (quality)?
- Which companies and courses are driving the business? Which trainers are carrying the load?
- Is anything broken or falling behind (overdue certificates, low attendance, expiring certs coming due)?

## 2. KPIs (top-of-page summary strip)

The single most important design decision: **6–8 number tiles, no more**, each with a trend indicator (↑/↓ vs. prior period) — this is the "glance" layer everything else supports.

| KPI | Formula / source | Trend comparison |
|---|---|---|
| **Active participants (YTD)** | `count(participants) where deleted_at is null` | vs. same point last year |
| **Certificates issued (this month)** | `count(certificates) where status='issued' and issue_date in current month` | vs. last month (`v_certificates_per_month`) |
| **Estimated revenue (this month)** | `sum(training_schedules.fee × registered_participants)` for schedules starting this month — *estimated, not billed, see §6* | vs. last month |
| **Training sessions this month** | `count(training_schedules) where start_date in current month` | vs. last month (`v_schedules_per_month`) |
| **Overall pass rate** | `pass / (pass + fail)` from `v_assessment_passfail` | vs. prior month |
| **Attendance rate** | `present / total` from `v_attendance_breakdown` or `v_attendance_trend` | vs. prior month |
| **Active corporate clients** | `count(companies) where status='active'` | vs. last quarter |
| **Active trainers** | `count(trainers) where status='active'` | — (headcount, not usually trended) |

Each tile: big number, small trend arrow + percentage, one-line label. No charts embedded in this row — that's what the sections below are for.

## 3. Business metrics (executive overview section)

- **Revenue trend** (line chart, 12-month) — see §6, clearly labeled "Estimated" in the chart title/legend, not just a footnote.
- **Training sessions per month** (bar chart, 12-month) — direct from `v_schedules_per_month`.
- **New vs. returning corporate clients** (stacked bar, monthly) — requires distinguishing a company's first-ever schedule/participant from a repeat one; derivable from `companies.created_at` vs. `participants`/schedule-assignment dates, but not a pre-built view — flag as a **new query**, not existing.
- **Top courses by revenue (estimated)** (horizontal bar or ranked list, top 5) — `v_top_courses` gives session/participant counts already; revenue needs the same estimation caveat as above.
- **Top companies by participant volume** (horizontal bar, top 10) — direct from `v_top_companies`.

## 4. Training metrics

- **Sessions by status** (donut/pie: open / full / in progress / completed / cancelled) — direct from `training_schedules.status`, grouped.
- **Sessions per month** (bar, 12-month trend) — `v_schedules_per_month`.
- **Capacity utilization** (gauge or horizontal bar per active session, or an average-utilization single stat: `avg(registered_participants / max_participants)` across open/in-progress sessions) — new query, `training_schedules` has the raw columns (`registered_participants`, `max_participants`, generated `seats_remaining`).
- **Course popularity** (ranked list, top 10 by session count and by participant count) — `v_top_courses`.
- **Delivery mode split** (donut: public / in-house / onsite / online / hybrid) — from `courses.delivery_modes` joined through sessions, or `training_schedules.training_mode` if that's the field carrying it at schedule level — new query.

## 5. Certificates

- **Certificates issued per month** (bar, 12-month) — `v_certificates_per_month`.
- **Status breakdown** (donut: draft / pending / issued / revoked / expired / archived) — `certificates.status` grouped.
- **Certificates expiring in the next 90 days** (a list/table widget, not a chart — this is an operational alert the CEO cares about at a glance: "how many clients need to be told to renew soon") — `where expiry_date between now() and now() + interval '90 days' and status = 'issued'`.
- **Verification activity** (small stat + sparkline: verifications per week from `certificate_verifications`) — signals whether employers/regulators are actually checking certificates, a decent proxy for how seriously the credential is being treated in the market.

## 6. Revenue metrics *(estimated — flagged explicitly, see "Before this can be built")*

- **Monthly revenue trend** (line, 12-month, estimated) — `sum(fee × registered_participants)` per month of session start date. Label every axis/tooltip "Estimated" — don't let this metric look more authoritative than it is.
- **Revenue by course category** (stacked bar or treemap) — same estimation, grouped by `courses.category`.
- **Revenue by company** (ranked list, top 10) — same estimation, grouped by `participants.company_id → companies`.
- **Recommendation, not just a caveat**: if revenue reporting matters to leadership (it almost certainly does, given it's explicitly requested here), this dashboard is the forcing function to scope a minimal invoicing/payment-tracking table (`invoices`: schedule_id, company_id, amount, status, paid_at) rather than perpetually estimating. Flag this as a `MASTER_TODO.md`-worthy follow-up, not something to solve inside this dashboard.

## 7. Participants

- **Registrations per month** (bar, 12-month) — `v_participants_per_month`.
- **Status breakdown** (donut: registered / confirmed / attended / no_show / cancelled) — `participants.status` grouped.
- **Participants by company** (top 10, horizontal bar) — same query family as `v_top_companies`, participant-count side.
- **Repeat participant rate** (single stat: % of participants with more than one schedule assignment via `schedule_participants`) — new query, signals training-programme stickiness.

## 8. Companies

- **Active vs. inactive vs. prospect** (donut) — `companies.status` grouped.
- **Top companies by participant volume** (§3/§7, shared widget — don't duplicate the same ranked list twice on one dashboard; pick one placement, likely under Companies since that's the more natural home).
- **New companies onboarded per month** (bar, 12-month) — `companies.created_at` grouped by month.
- **Industry breakdown** (donut or bar) — `companies.industry` grouped — useful for the CEO to see market concentration (e.g. over-reliance on Oil & Gas vs. a diversified base).

## 9. Trainers

- **Workload (sessions per trainer)** (horizontal bar, all active trainers) — `v_trainer_workload`.
- **Utilization vs. headcount** (single stat: sessions this month / active trainer count) — signals whether the trainer bench is stretched or under-utilized.
- **Trainer status** (donut: active / inactive / retired / on_leave) — `trainers.status` grouped.

## 10. Attendance

- **Attendance rate trend** (line, monthly) — `v_attendance_trend`.
- **Status breakdown** (donut: present / absent / late / medical_leave / excused / pending) — `v_attendance_breakdown`.
- **Sessions with attendance below a threshold** (alert list, e.g. <70%) — an operational-quality signal worth surfacing to leadership, not just staff — new query filtering `v_attendance_trend`-style aggregation per session rather than per month.

## 11. Monthly growth

This is less a separate data section and more a **presentation lens applied across the sections above** — every "per month" chart already listed (`v_participants_per_month`, `v_schedules_per_month`, `v_certificates_per_month`, revenue, attendance rate) should share:
- A consistent 12-month trailing window as the default range, with a control to extend it.
- A consistent month-over-month **and** year-over-year comparison (both matter to a CEO: MoM shows momentum, YoY controls for seasonality — training businesses are often seasonal around school/corporate budget calendars).
- One combined "Growth Summary" widget near the top of the page (below the KPI strip, above the detailed sections): a small multi-line sparkline set showing participants / sessions / certificates / revenue all normalized to the same month-over-month % change, so the CEO can see at a glance whether growth is broad-based or concentrated in one metric.

---

## 12. Suggested dashboard layout

A 4-tier, top-to-bottom layout, widest/most-important information first, drill-down further down:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 1 — KPI STRIP (§2)                                                  │
│  [Participants] [Certificates] [Est. Revenue] [Sessions]                  │
│  [Pass Rate]    [Attendance]   [Active Cos.]  [Active Trainers]           │
│  8 tiles, single row on desktop, 2×4 on tablet, 1×8 stacked on mobile      │
├──────────────────────────────────────────────────────────────────────────┤
│  TIER 2 — GROWTH SUMMARY (§11)                                            │
│  One wide card: 4 small sparklines (participants/sessions/certs/revenue), │
│  normalized % change, MoM + YoY toggle                                    │
├──────────────────────────────────────────────────────────────────────────┤
│  TIER 3 — TREND CHARTS (2-column grid, each a full chart not a sparkline) │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐         │
│  │ Revenue trend (line, 12mo)  │ │ Sessions per month (bar)    │         │
│  ├─────────────────────────────┤ ├─────────────────────────────┤         │
│  │ Certificates issued (bar)   │ │ Attendance rate (line)      │         │
│  ├─────────────────────────────┤ ├─────────────────────────────┤         │
│  │ Participant registrations   │ │ Pass/fail breakdown (donut) │         │
│  └─────────────────────────────┘ └─────────────────────────────┘         │
├──────────────────────────────────────────────────────────────────────────┤
│  TIER 4 — RANKINGS & BREAKDOWNS (3-column grid, compact ranked lists)     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                 │
│  │ Top Companies  │  │ Top Courses   │  │ Trainer        │                │
│  │ (by volume)    │  │ (by sessions) │  │ Workload       │                │
│  ├───────────────┤  ├───────────────┤  ├───────────────┤                 │
│  │ Industry mix   │  │ Delivery mode │  │ Company status │                │
│  │ (donut)        │  │ split (donut) │  │ (donut)        │                │
│  └───────────────┘  └───────────────┘  └───────────────┘                 │
├──────────────────────────────────────────────────────────────────────────┤
│  TIER 5 — OPERATIONAL ALERTS (list widgets, not charts — action items)   │
│  • Certificates expiring in 90 days (count + table, link to Certificates) │
│  • Sessions with attendance below 70% (count + table)                    │
│  • (Optional) Overdue/at-risk items surfaced from Automation Centre       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Design notes:**
- **Tier 1 and 2 are the only things a time-pressed CEO needs to see.** Everything below is for the monthly deep-dive, not the daily glance — this ordering matters more than any individual chart choice.
- **Every chart needs a consistent date-range control** (default: trailing 12 months) applied globally, not per-widget — a dashboard where each chart has its own independent date picker is unusable for comparison.
- **Estimated figures (revenue) get a visually distinct treatment** — e.g. a dashed line style, a small "Est." badge on the tile/chart title — so leadership never mistakes an estimate for a tracked, audited number.
- **Color and chart-type consistency**: reuse this app's existing admin visual language (the `ta-` design tokens already established in `components/admin/ui/index.tsx` and `admin.css`) rather than introducing a new visual system just for this one page — this keeps the executive dashboard feeling like part of the same product, not a bolted-on BI tool.
- **Mobile**: Tiers collapse to single-column, Tier 1 tiles go 2-per-row, all charts remain full-width and horizontally scrollable if needed rather than shrunk illegibly.
- Follow this codebase's existing admin patterns when this is actually built: a Server Component page under `app/admin/(protected)/`, reading from the `v_*` views (or new equivalents) via the RLS-bound server client, gated at minimum `editor` role (arguably `admin`+ given the sensitivity of revenue/company data — worth an explicit decision when scoping the build, not assumed).

## 13. Build sequencing note

This is a planning document, not a build ticket — see `MASTER_TODO.md` for how this fits into the overall backlog. Recommended sub-sequence once C1/H1 land: (1) KPI strip + existing `v_*`-view-backed charts first, since those views already exist in the designed schema and need no new query work; (2) the "new query" items called out throughout this doc (utilization, repeat-participant rate, industry mix, attendance-below-threshold alert) second, since each is a small bespoke aggregation; (3) revenue estimation last, with an explicit leadership conversation about whether to build real invoicing instead of estimating indefinitely.
