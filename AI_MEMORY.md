# AI_MEMORY.md — Load Before Every Development Session

Condensed project memory for TERAS UNIVERSAL. Full detail lives in `CLAUDE.md` (enforceable rules), `AI_DEVELOPMENT_GUIDE.md` (patterns/tutorial), `DATABASE_AUDIT.md`/`BUG_REPORT.md`/`SECURITY_REPORT.md`/`PERFORMANCE_REPORT.md` (evidence), `MASTER_ARCHITECTURE.md` (full system view), `MASTER_TODO.md`/`PRODUCT_ROADMAP.md`/`DEVELOPMENT_BACKLOG.md` (what's left). This file is the fast-load summary — if it conflicts with a fuller doc, the fuller doc wins, and re-verify live state if meaningful time has passed since this was last updated.

## Architecture

Next.js 15 App Router, one deployment, two halves: **public site** (`app/*.js`, `components/*.js`, `data/*.js` — plain JS, not being redesigned) and **admin CMS** (`app/admin`, `app/api/admin`, `lib/`, `components/admin` — TypeScript, Supabase-backed). Bridge: `lib/public-content.ts` (cached reads for the public site). `middleware.ts` covers `/admin/:path*` ONLY — `/api/**` has zero middleware protection, every route guards itself.

## Business rules

- Soft-delete everywhere (`deleted_at`/`status`), never hard-delete.
- Contact Enquiries, Proposal Requests, Website Settings: tables exist, **no admin UI by design** (`DELIVERABLE.md` scope lock) — don't build UI for these without an explicit scope change.
- Role hierarchy: `super_admin > admin > editor > trainer > client > participant` — lower array index = more privileged.

## Database — THE critical fact

**Two independently-designed schemas exist. Only ONE is live.** The numbered migrations (`0001`–`0021`) were never applied. The live schema is the older legacy + compatibility-migration lineage. Most admin CRUD code was written against the never-applied schema. **Before writing or trusting any query, verify the table exists live** (Supabase MCP `list_tables`/`execute_sql`) — don't infer from a migration filename. Live: 21 tables, `courses` has 125 real rows, everything else is empty. **Do not assume this file's snapshot is still current** — re-check if it's been a while.

Working (schema-correct today): Courses, News/Gallery/FAQ/Downloads/Company *data layer* (list pages are still `<ScaffoldPage>` stubs though — see below), `/api/admin/certificates`.
Broken (queries non-existent tables/columns): Schedules, Trainers, Companies, Participants, Attendance, Assessment, Certificates admin UI, Automation, Reports, Audit, Users, Dashboard, public `/verify` (calls a missing RPC — the one customer-facing feature that's completely broken), public "upcoming schedules."

## Authentication

Live path: `app/admin/login/actions.ts` → `signInWithPassword()` → check `profiles.is_active` → cookie session via `@supabase/ssr`. Do NOT build on `app/api/admin/login/route.js` — orphaned, checks a different table (`admin_users`), returns raw tokens in JSON, no rate limit. Sign-out: client-side `supabase.auth.signOut()`. `middleware.ts` uses `getUser()` never cached `getSession()` — don't add code between client construction and that call.

## RBAC

`lib/auth/rbac.ts` (`ROLE_ORDER`, `hasMinRole()`, `MODULE_ACCESS`) + `lib/auth/session.ts` (`requireRole()`, `requireStaff()`, feature guards). **RLS is the real enforcement boundary, not these guards.** Known live gap: `courses`/`participants`/`certificates` RLS checks `admin_users` membership (binary, no roles), completely disconnected from `profiles.role`/`is_active` — deactivating a user doesn't revoke their DB access to these 3 tables. Never introduce a second authorization mechanism for any table — always `profiles.role` via `app.is_editor()`/`app.is_admin()`/`app.has_min_role()`.

## Coding standards

- No premature abstraction; no dead code left "for later" (`lib/bulkCertificates.js` + `pdfjs-dist`/`tesseract.js` are the live example of this mistake — fully built, imported nowhere).
- TypeScript: **never** `as any` a Supabase client/query. `database.types.ts` is a hand-written partial stub (4 tables typed, rest `any`) — this is why `typecheck` passes on code that fails at runtime.
- Server Actions: guard → validate (Zod) → mutate → check `{ error }` → revalidate. Never skip the guard, never discard `error`.
- Never build a `.or()`/`.ilike()` filter from raw user input — sanitize with `.replace(/[%_,()]/g, " ")` first.
- Never put `await` inside a `Promise.all([...])` array literal — it silently serializes (live bug in `trainers/[id]/page.tsx`).

## Naming conventions

DB: `snake_case`. TS/JS vars/functions: `camelCase`; components: `PascalCase`. Server Actions: `createX`/`updateX`/`archiveX`/`bulkX`. Guards: `require<Thing>()`; capability checks: `can<Verb><Thing>()`. Admin CSS: `ta-` prefix. Designed ID format (once live): `PREFIX-000001` (`TU-` participants, `TR-` trainers, `CO-` companies, `CERT-` certificates).

## Folder responsibilities

```
app/admin/(protected)/<module>/  page.tsx (list) · new/[id]/page.tsx (form) · actions.ts (Server Actions)
app/api/**                        route handlers — NOT covered by middleware, self-guarded
lib/auth/                         rbac.ts, session.ts
lib/supabase/                     server.ts (RLS client), client.ts (browser), database.types.ts (STALE)
lib/validation/schemas.ts         one Zod schema per entity
components/admin/ui/index.tsx     shared primitives — use these, don't hand-roll
work/                             scratch dir; contains a committed duplicate old-app snapshot — don't trust or import from it
```

## Common pitfalls (all are live, real bugs — don't repeat the pattern)

1. Trusting a migration file over the live DB.
2. `as any` on a Supabase client/query.
3. Discarding `{ error }` from a Supabase call (→ `/verify` reports every real certificate as invalid).
4. `await` inside a `Promise.all([...])` array.
5. Unsanitized `.or()` filter interpolation (13 live instances).
6. Building an insert payload with `String(x ?? "")` instead of a Zod schema (certificates).
7. Building a second implementation instead of checking if one already exists (3 different "schedule" tables exist from this).
8. Resetting a timestamp on every save instead of only on the real state transition (`published_at`).
9. Trusting client-side validation as a security boundary (file upload type/size, schedule capacity).

## Current bugs (see `BUG_REPORT.md` for full detail — 36 items)

Critical: schema mismatch (root cause of most), public cert verification broken, Participants/Certificates CRUD broken, admin_users/profiles auth split. High: Storage not provisioned, orphaned login route, filter-injection (13 sites), duplicate-cert race condition, serialized `Promise.all` bug, timezone-wrong attendance times.

## Future plans

`PRODUCT_ROADMAP.md`: V1.0 (fix the schema + core CRUD) → V1.1 (quick wins/hardening) → V1.5 (rebuild remaining operations modules) → V2.0 (CEO dashboard, reporting, email/PDF/QR automation) → V3.0 (revenue/invoicing module — **no billing table exists today**, client/participant self-service portals, i18n, public API). Full task breakdown: `DEVELOPMENT_BACKLOG.md`.

## Development priorities, right now

1. Fix `/verify` (few hours, zero dependencies, ship immediately).
2. Decide schema direction (adopt-live vs. migrate-forward) — blocks nearly everything else.
3. Execute the consolidation on a Supabase branch first — `courses` has 125 real rows, never touch prod directly.
4. Then: Participants/Certificates CRUD, Storage provisioning, auth unification — in that coordinated batch.
5. Only after that: rebuild the remaining 9 operations modules, then the V2.0/V3.0 layers.

**Never start V1.5+ work against the current live schema** — it will need to be rebuilt again once the schema decision lands.
