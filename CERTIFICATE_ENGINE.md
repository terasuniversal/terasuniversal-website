# Certificate Management & Certificate Engine — Deliverable

Template-based, reusable certificate engine added to the existing TERAS
UNIVERSAL Admin CMS. Public website, Resend, routing and deployment config
unchanged. Built on the existing stack and admin layout.

> **Permissions:** view = all staff (incl. **Trainer view-only**); generate /
> revoke / reissue / duplicate / templates = **Admin+** (Editor cannot
> generate). Enforced by RLS **and** `requireCertificate()` in every action.
>
> **Generation gate:** a certificate is created only when the participant is
> **Present**, assessment **result = Pass**, and **competency = Competent**
> (enforced via the `v_certificate_eligibility` view).

---

## 1. Database Migration — `0016_certificate_engine.sql`

Validated on PostgreSQL 16 (full set 0001–0016 applies clean).

## 2. SQL Schema

**`certificate_templates`** (reusable designs)

| Column | Notes |
|---|---|
| id, name, description | |
| orientation | landscape / portrait |
| paper_size | A4 |
| config jsonb | logo, background, colours, signature, body_text, show_qr, custom_fields |
| is_active, is_default | active / inactive; single default enforced by the app |
| audit + soft-delete columns | |

**`certificates`** (extended from 0004/0011)

| Column | Notes |
|---|---|
| id (uuid PK), certificate_id (uuid, external) | |
| certificate_number | **auto** `CERT-2026-000001` (year + sequence) |
| participant_id, schedule_id → **training_schedules**, course_id | schedule FK repointed |
| template_id → certificate_templates | |
| holder_name | snapshot |
| status | draft / issued / revoked / expired / archived |
| issue_date, expiry_date | (renamed from issued_at/expires_at) |
| verification_token (auto, unique), verification_url | QR target |
| pdf_path, qr_code_path | reserved for stored artefacts |
| issued_by → profiles, remarks | |
| verification_code (legacy, retained) | |
| created/updated/deleted, timestamps | soft delete |

**View `v_certificate_eligibility`** — joins schedule_participants + attendance
+ assessments, exposing `eligible = (present AND pass AND competent)`.

**Renames handled** (fresh-DB safe): `certificate_no→certificate_number`,
`issued_at→issue_date`, `expires_at→expiry_date`. The legacy
`verify_certificate(code)` function was redefined to the new columns (aliased
back to old return names) so the existing `/verify?code=` page keeps working.

## 3. RLS Policies

```
certificates
  certificates_view          SELECT using (is_editor() OR trainer)   -- all staff view
  certificates_admin_insert  INSERT with check is_admin()            -- generate = admin+
  certificates_admin_update  UPDATE using is_admin()                 -- revoke/reissue/edit
  certificates_admin_delete  DELETE using is_admin()
certificate_templates
  cert_templates_view        SELECT using (is_editor() OR trainer)
  cert_templates_admin_write ALL   using is_admin()
v_certificate_eligibility    granted SELECT to authenticated (RLS of base tables applies)
```
Public: `verify_certificate_by_token(token)` and `verify_certificate(code)` are
`SECURITY DEFINER`, granted to `anon` — return only safe fields for
issued/expired/revoked certificates.

**Verified:** eligibility view correct; admin generate → `CERT-2026-000001` +
32-char token; anon token verification returns the certificate; **Trainer
view-only** (generate blocked by RLS); both verify functions work post-rename.

## 4. API Routes

| Route | Method | Purpose |
|---|---|---|
| `/admin/certificates/export` | GET | `?format=csv\|excel\|register` — Certificate Register (register = printable PDF placeholder). |
| `/admin/cert-pdf/[id]` | GET (page) | A4 certificate render, auto-print → **Save as PDF**. Outside the admin shell, still auth-gated. |
| `/verify/[token]` | GET (page) | **Public** QR verification target. |
| `/verify?code=` | GET (page) | Legacy public verification (still works). |

## 5. Pages Created

| Route | Access | Purpose |
|---|---|---|
| `/admin/certificates` | staff | List — stats, search, status filter, export |
| `/admin/certificates/generate` | admin+ | Schedule picker for generation |
| `/admin/certificates/generate/[scheduleId]` | admin+ | Eligible participants + **Generate** / **Generate all eligible** |
| `/admin/certificates/[id]` | staff | Detail — live preview, Download PDF, Revoke, Reissue, Duplicate, Email (placeholder), edit meta |
| `/admin/certificates/templates` (+ new / [id]) | admin+ | Template CRUD, duplicate, activate/deactivate, **live preview** |
| `/admin/cert-pdf/[id]` | staff | A4 print/PDF |
| `/verify/[token]` | public | Verification |

## 6. Components Created

- `CertificateDocument.tsx` — **template-driven** certificate renderer (logo,
  background, borders, colours, signature, QR, cert number, name, IC, course,
  date, venue, trainer, issue date, custom fields; portrait/landscape A4).
- `TemplateForm.tsx` — template editor with **live preview**.
- Server actions: certificate engine (`actions.ts`) + templates
  (`templates/actions.ts`).
- `certData.ts` — shared render-data loader.

## 7. Certificate Template System

Reusable `certificate_templates` with JSONB `config`; a default seeded
("TERAS Standard (Landscape)"). Templates are Active/Inactive, Duplicatable,
and have a live Preview in the editor. A single default is enforced. The
renderer consumes the template config so one component serves all templates.

## 8. Certificate Engine

`generateCertificate(schedule, participant)` checks `v_certificate_eligibility`
(present + pass + competent), skips if already certified, snapshots
holder/course, sets status `issued`, and stamps the verification URL from the
request origin. `bulkGenerate(schedule)` iterates all eligible participants.
Also: `revoke`, `reissue`, `duplicate` (new number+token), `updateMeta`,
`softDelete` — all audited and Admin-gated.

## 9. Files Modified / Added

**Added**
```
supabase/migrations/0016_certificate_engine.sql
components/admin/CertificateDocument.tsx
app/admin/cert-pdf/[id]/page.tsx
app/verify/[token]/page.tsx
app/admin/(protected)/certificates/certData.ts
app/admin/(protected)/certificates/generate/page.tsx
app/admin/(protected)/certificates/generate/[scheduleId]/page.tsx
app/admin/(protected)/certificates/export/route.ts
app/admin/(protected)/certificates/templates/{page,new/page,[id]/page,TemplateForm,actions}
```
**Rewritten for the engine**
```
app/admin/(protected)/certificates/page.tsx       (list + stats + export)
app/admin/(protected)/certificates/[id]/page.tsx  (preview/PDF/revoke/reissue/…)
app/admin/(protected)/certificates/actions.ts     (engine)
```
**Modified**
```
lib/admin-nav.ts        (Certificates → trainer-visible; + Certificate Templates)
lib/auth/rbac.ts        (canView/canManageCertificate + MODULE_ACCESS)
lib/auth/session.ts     (requireCertificate guard)
lib/validation/schemas.ts   (certificate field names → new columns)
app/admin/(protected)/dashboard/page.tsx   (cert stats → draft)
app/admin/(protected)/layout.tsx           (badge → draft)
```
**Removed** (superseded): old manual `CertificateForm.tsx`, `loaders.ts`, `new/`.
No public-site, Resend or deployment config touched.

## 10. Build Result

⚠️ **This sandbox firewalls the npm registry (`registry.npmjs.org` → 403)**, so
`npm install` / `npm run build` can't run here. Also note: **true binary-PDF
generation needs a library** (puppeteer / @react-pdf / pdfkit) which likewise
can't be installed/tested here — so PDF is delivered via the print-to-PDF A4
page (production-quality, dependency-free), with the data/template layers
structured so a server-side PDF renderer drops in later without UI changes.
QR codes use an image endpoint (as elsewhere in the codebase).

Verification performed:
- ✅ **SQL** applied to PostgreSQL 16 — 0 errors; templates, eligibility view,
  auto number/token, token + code verification, and Trainer-view-only RLS all
  proven with live queries.
- ✅ **TypeScript** — all 87 `.ts/.tsx` files parse with 0 syntax errors.
- ✅ **Imports** — 232/233 resolve; the 1 remaining is the intentional
  `../globals.css` reference to your existing public stylesheet.

**Run to complete the required build:**
```bash
npm install
npm run lint
npm run build
```
The repo's Vercel connection runs the real `next build` on push to `main`.
