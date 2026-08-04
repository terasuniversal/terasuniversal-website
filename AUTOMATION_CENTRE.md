# Operational Automation Centre — Deliverable

A central automation module for the TERAS UNIVERSAL Admin CMS: bulk operations,
configurable auto-numbering, a notification centre, an activity timeline, run
history and a template manager — all configurable by administrators. The public
website, Resend, routing and deployment config are **unchanged**; this continues
from the existing codebase (migration 0021, building on 0001–0020).

> **Permissions:** Super Admin & Admin only. Enforced by RLS (`app.is_admin()`)
> on every new table **and** by `requireRole("admin")` on every page/action,
> plus a route-level `isAdmin()` gate on the ZIP endpoint. Editors and Trainers
> cannot see the module (verified: editor reads return 0 rows, inserts blocked).

## 1. Database Changes — `0021_automation_centre.sql`
Validated on PostgreSQL 16 (all 21 migrations apply clean from scratch — 34
tables, 124 policies).

- **`automation_runs`** — append-only log of every automation execution
  (`run_type`, `status` [success/partial/failed/running], `summary`,
  `total/success/skipped/failed` counts, `params` + `result` JSONB, actor,
  timestamp). Doubles as **import history**, **run history** and the source for
  notifications. Actor is auto-stamped by a trigger. RLS: Admin+ read/insert;
  no update/delete (immutable).
- **`automation_templates`** — reusable templates of type `attendance`,
  `assessment`, `import`, `report` or `email` (`content` JSONB, `is_default`,
  `is_active`, soft-delete + audit). Unique name per type among live rows.
  Complements the existing `certificate_templates`. RLS: Admin+ full CRUD.
- **`app.automation_setting(key, default)`** — `SECURITY DEFINER` helper that
  reads one key from the `site_settings` row `key='automation'`. Because it is
  DEFINER it works inside the insert triggers regardless of the caller's grants.
- **System Settings seed** — inserts the `automation` settings object
  (`participant_prefix` `TU-`, `certificate_prefix` `CERT-`, `timezone`
  `Asia/Kuala_Lumpur`, `date_format` `DD/MM/YYYY`, `export_format` `csv`).
  Defaults preserve current behaviour, so **nothing changes until an admin edits
  it**.
- **Configurable auto-numbering** — `app.gen_participant_id()` and
  `app.gen_certificate_number()` rewritten to read their prefix from settings
  (falling back to `TU-` / `CERT-`). **Verified live:** default → `TU-000001`;
  after changing the setting → `EMP-000002`; certificate prefix → `TU-CERT-2026-000001`;
  under RLS as an admin → `RLS-000004`. Existing IDs are never renumbered.

## 2. API Routes
`/admin/certificates/download-zip` — **Bulk Certificate Download (ZIP)**.
`?scheduleId=<uuid>` zips every certificate for a schedule; `?ids=a,b,c` zips a
selection. Each certificate is rendered to a **self-contained, printable HTML
document** by `lib/certificate-html.ts` — a plain **HTML-string** renderer that
mirrors `CertificateDocument` (no `react-dom/server`, which the Next.js App
Router forbids in route handlers). Bundled with a `MANIFEST.txt` into one `.zip`.
Admin-only, Node runtime, capped at 500 per request (overflow noted in the
manifest). Output is HTML-escaped (XSS-safe). Every run is recorded in
`automation_runs` **and** the audit log.

The ZIP is produced by a **dependency-free** writer (`lib/zip.ts`) — the npm
registry is firewalled in this sandbox, so `jszip`/`archiver` cannot be added.
It implements the ZIP **STORE** method + **CRC-32** using only Node's `Buffer`.
**Verified in Node:** CRC-32 known-answer test passes (`0xCBF43926`), and the
output opens clean under `unzip -t` with UTF-8 filenames intact.

## 3. Automation Components (`/admin/automation`)
The Automation Centre hub shows: a snapshot (recent runs, certs awaiting
generation, upcoming-14-day sessions, template count); **Quick Actions** (bulk
import, bulk certificate generation, bulk ZIP download, template manager,
settings, email-queue placeholder); a **Notification Centre** that synthesises
alerts from live state (upcoming trainings, eligible-but-ungenerated
certificates, failed/partial runs, last import result); an **Activity Timeline**
from `audit_logs`; and a full **Automation Run History** table.

Existing flows now feed the centre: **bulk participant import** and **bulk
certificate generation** each record an `automation_run` on completion, so they
appear in run/import history automatically.

Automation areas coverage: (1) Bulk Import — existing importer, now with history;
(2) Bulk Certificate Generation — existing, now recorded; (3) **Bulk Certificate
Download (ZIP)** — new; (4) **Configurable Participant ID**; (5) **Configurable
Certificate Number**; (6) Automatic QR — via the existing certificate engine;
(7) **Email Queue** — placeholder (cert delivery / reminder / completion), UI
present, disabled; (8) **Notification Centre**; (9) **Activity Timeline**;
(10) **Template Manager**.

## 4. Settings Module (`/admin/automation/settings`)
Admin form (server action + Zod validation) editing the `automation` settings
object: **Participant ID prefix**, **Certificate prefix**, **Default timezone**,
**Default date format**, **Default export format**. Saves via
`site_settings` upsert and is audited. Prefix changes take effect for records
created afterwards (existing IDs untouched).

## 5. Template Manager (`/admin/automation/templates`)
List + create + edit + activate/deactivate + soft-delete for
`automation_templates` (import mapping, attendance, assessment, report, email),
with one-default-per-type enforcement. `content` accepts JSON (structured
config) or plain text. A link to the existing **Certificate Templates** keeps
all template types reachable from one place.

## 6. Files Modified / Added
**Added:** `supabase/migrations/0021_automation_centre.sql`, `lib/zip.ts`,
`lib/certificate-html.ts`,
`app/admin/(protected)/automation/{actions.ts, page.tsx}`,
`automation/settings/{page.tsx, SettingsForm.tsx}`,
`automation/templates/{page.tsx, TemplateForm.tsx, new/page.tsx, [id]/page.tsx}`,
`app/admin/(protected)/certificates/download-zip/route.ts`.
**Modified:** `lib/admin-nav.ts` (Automation Centre nav item, Admin+),
`lib/auth/rbac.ts` (`MODULE_ACCESS.automation`),
`app/admin/(protected)/participants/import/importActions.ts` (record run),
`app/admin/(protected)/certificates/actions.ts` (record bulk-generate run),
`app/admin/(protected)/certificates/generate/[scheduleId]/page.tsx` (ZIP button).

## 7. Build Result
⚠️ npm registry firewalled here (403) → `npm run build` runs on your Vercel push.
Verified in-sandbox: **SQL on PostgreSQL 16** — 21 migrations apply clean from
scratch (34 tables, 124 policies); configurable prefixes, `automation_runs`,
`automation_templates`, both enums, and RLS (admin allowed / editor blocked) all
confirmed with live queries. **ZIP writer** — CRC-32 known-answer + `unzip -t`
integrity pass. **TypeScript** — 116 TS/TSX files, 0 syntax errors; 327/328
relative imports resolve (the 1 is the intentional `../globals.css`). Run
`npm install && npm run lint && npm run build`.
