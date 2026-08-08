# CLAUDE.md

This file is the permanent engineering guide for this repository. It governs how code is written here — by a human or by Claude Code — and takes precedence over generic defaults. Every rule below exists because of something concretely true about this codebase (verified against the live, connected Supabase project as of 2026-08-06), not because it's generically good practice. Where a rule cites a report, that report has the full evidence; this file has the rule.

Companion documents, all produced by full-repo audits this session and kept up to date going forward:
- `DATABASE_AUDIT.md` — which schema is actually live vs. designed-but-never-applied, table-by-table.
- `BUG_REPORT.md` — functional defects, root causes, fixes.
- `SECURITY_REPORT.md` — auth/authz/RLS/storage/headers findings.
- `PERFORMANCE_REPORT.md` — query, caching, bundle, rendering findings.

**Read `DATABASE_AUDIT.md` before touching anything in `supabase/` or writing a query against a table you haven't personally verified live.** This is not optional — see §11.

---

## 1. Project overview

A Next.js 15 (App Router) site for TERAS UNIVERSAL, a Malaysian industrial training/certification company. It has two halves that share one deployment:

- **Public website** (`app/*.js`, `components/*.js`, `data/*.js`) — plain JavaScript, mostly static/hard-coded content. Not being redesigned.
- **Admin CMS** (`app/admin`, `app/api/admin`, `lib/`, `components/admin`) — TypeScript, backed by Supabase (Postgres + Auth + Storage + RLS). This is where active development happens.

The two are bridged by `lib/public-content.ts`: public pages are meant to read CMS data through cached helpers there (`getPublishedCourses()`, `getGallery()`, etc.) instead of the hard-coded arrays in `data/`. Not every public page has been migrated yet — check whether a given page still imports from `data/` before assuming it's CMS-backed.

**Critical context you must internalize before writing code**: this repository contains two independently-designed database schemas — a clean-room spec (`supabase/migrations/0001`–`0021`) and a set of additive compatibility migrations layered on a real pre-existing production database (`supabase/migrations/2026*`, plus loose root `.sql` files). Only the second is actually deployed. Most of the admin CRUD code was written against the first. Full detail in `DATABASE_AUDIT.md`; the operating rule is in §11.

`DELIVERABLE.md` has the original architecture spec (schema, module list, navigation, rollout checklist) — read it as *design intent*, not as a description of what's live. Module-specific docs (`CERTIFICATE_ENGINE.md`, `PARTICIPANT_MANAGEMENT.md`, `TRAINER_MANAGEMENT.md`, `TRAINING_SCHEDULE.md`, `REPORTING_ANALYTICS.md`, `COMPANY_MANAGEMENT.md`, `AUTOMATION_CENTRE.md`, `PUBLIC_VERIFICATION.md`) go deeper on individual modules, same caveat. `docs/uat/` has operator-facing manuals; `docs/release/` has release notes and the go-live checklist.

## 2. Folder architecture

```
app/
  admin/
    (protected)/<module>/     # page.tsx (list), new/page.tsx + [id]/page.tsx (create/edit), actions.ts (server actions)
    login/, no-access/, reset-password/   # outside the (protected) route group, no auth required
  api/
    admin/                    # API route handlers — NOT covered by middleware.ts, see §7
    request-proposal/, newsletter/   # public form endpoints
  verify/                     # public certificate verification, no auth
  <public pages>.js           # public site, plain JS
components/
  admin/                      # admin-only components; shared primitives in components/admin/ui/index.tsx
  <public components>.js
lib/
  auth/                       # rbac.ts, session.ts — see §7/§8
  supabase/                   # server.ts, client.ts, middleware.ts, database.types.ts
  validation/                 # schemas.ts — Zod, one schema per entity, see §10
  public-content.ts           # cached public-facing data helpers, see §5 caching rules
data/                         # legacy hard-coded content, being phased out in favor of lib/public-content.ts
supabase/
  migrations/                 # see §11 — do not assume these are all applied
  seed.sql, cms-seed.sql, certificates.sql, role_policies.sql   # loose root scripts, also see §11
docs/
  uat/                        # operator manuals per module
  release/                    # release notes, go-live checklist
work/                         # scratch/investigation directory — DO NOT add production code here (see §2a)
```

**2a.** `work/` currently contains a full committed duplicate snapshot of an earlier version of the admin app (`work/teras-admin-cms/teras-admin-cms/`, 59 files) plus ad hoc one-off scripts. Do not import from `work/` in application code, and do not add new one-off scripts there without naming them clearly as throwaway (`check-*.cjs` is the existing convention) — this directory is duplicate/dead weight already flagged in `BUG_REPORT.md`; don't grow it further without a plan to clean it up.

- Public pages are `.js`, admin pages are `.ts`/`.tsx`. Don't mix conventions when adding files to either side.
- `app/admin/layout.tsx` scopes admin styling under a `.teras-admin` class with its own `admin.css`, kept separate from `app/globals.css`.

## 3. Coding standards

- No premature abstraction. Three similar inline blocks are better than a shared helper built for a fourth case that doesn't exist yet. This codebase already has an example of the failure mode to avoid: two competing "sanitize a search string" implementations exist (§ below) instead of one shared helper — don't add a third; extract the existing pattern into `lib/` the next time you touch a file that needs it.
- No dead code left "just in case." `lib/bulkCertificates.js` (imports `pdfjs-dist` + `tesseract.js`, never called from anywhere) and two orphaned components (`components/PrintButton.js`, `components/ProposalForm.js`) are exactly this failure mode, flagged in `BUG_REPORT.md`. If you write something and its only caller gets removed or was never added, delete it in the same change — don't leave it for a future cleanup pass.
- Match the file's existing style before introducing a new one. This codebase has areas of dense one-line-per-function style (`gallery/actions.ts`) and areas of conventionally-formatted multi-line style (`news/actions.ts`) — follow whichever the file you're editing already uses; don't reformat unrelated code as a side effect of a small change.
- Comments explain *why*, never *what*. The existing code is good at this (e.g. `lib/auth/rbac.ts`'s comment on why smaller ordinal = more privileged) — keep it that way.

## 4. TypeScript standards

- **Never cast a Supabase client or query result to `any`.** `lib/supabase/server.ts` currently does `return client as any;` and the vast majority of admin queries do `(supabase.from("x") as any).select(...)` — this is not a style choice, it's the reason `npm run typecheck` passes cleanly on code that fails at runtime against tables/columns that don't exist. Every new query you write must be typed against a real `Database` type, not cast around it. If the current `lib/supabase/database.types.ts` doesn't have the table you need, that's a signal to fix the types file (§11), not to add another `as any`.
- `lib/supabase/database.types.ts` is currently a **hand-written, partial** file — its own header says so. It covers `profiles`, `courses`, `enquiries`, `proposal_requests` and falls back to `any` for every other table. Do not add a new table to the app without also adding it here (or, correctly, regenerating the whole file per §11 once the live schema is settled).
- `strict` mode expectations: don't silence a type error with `@ts-ignore`/`@ts-expect-error` without a comment explaining what's actually wrong and why it can't be fixed properly right now.
- Prefer `interface` for object shapes that represent DB rows (matches the existing `database.types.ts` convention); `type` for unions/utility types.
- Zod-inferred types (`z.infer<typeof xSchema>`) are the source of truth for validated input shapes — don't hand-write a parallel interface that can drift from the schema.

## 5. Next.js 15 best practices

- Server Components by default. Only add `"use client"` when the component genuinely needs browser state, effects, or event handlers — this codebase does this correctly today (~35% client components, all genuinely interactive; verified in `PERFORMANCE_REPORT.md` §1) and should stay that way.
- **Never put an `await` inside an array literal passed to `Promise.all([...])`.** JavaScript evaluates array elements left-to-right before `Promise.all` is even called, so a nested `await` in one element blocks construction of the whole array — silently serializing what looks like parallel code. This exact bug exists today in `app/admin/(protected)/trainers/[id]/page.tsx` (`PERFORMANCE_REPORT.md` §5). If you need a value from one query to build another, `await` it as its own statement *before* the `Promise.all` array, not inside it.
- `export const dynamic = "force-dynamic"` is the correct, deliberate default for every page under `app/admin/(protected)/**` — staff must see their own writes immediately. Don't add caching to an admin page without a specific reason and a short TTL.
- Public pages that read CMS data go through `lib/public-content.ts`'s `unstable_cache`-wrapped helpers (60s revalidate, tagged). When you add a new admin mutation that feeds a public page, call `revalidateTag(...)` with the matching tag in that Server Action so the change is visible immediately rather than waiting out the TTL.
- `next/image` requires `remotePatterns` in `next.config.mjs` for any non-local image host — currently unconfigured, which is why Supabase Storage URLs fall back to raw `<img>` throughout the admin area (`PERFORMANCE_REPORT.md` §9). Add the Storage host to `remotePatterns` before building new Storage-backed image UI, rather than adding another raw `<img>`.
- Route Handlers under `app/api/**` are **not** covered by `middleware.ts` (matcher is `/admin/:path*` only — see §7). Every new API route must implement its own auth check; there is no fallback net the way `(protected)` pages get from the shared layout.

## 6. Supabase best practices

- **Before writing a query against any table, verify it exists in the live database** — don't infer this from a migration filename. Use the Supabase MCP tools (`list_tables`, `execute_sql`) against the connected project, or check `DATABASE_AUDIT.md`'s live table list, which is current as of 2026-08-06 and should be re-verified (not assumed still accurate) for any work done meaningfully later. The single largest source of defects in this codebase today is code written against a schema that was designed but never applied — don't add to that pile.
- Use `createSupabaseServerClient()` (RLS-bound, cookie-based session) in Server Components and Server Actions. Use `createSupabaseBrowserClient()` in Client Components. **Never** import `createSupabaseServiceClient()` (service-role, bypasses RLS) into anything that runs in or is reachable from the browser. It currently has zero call sites anywhere in the app — keep that number as close to zero as possible; if you do need it, the call site must be server-only code with no user-controlled routing to it.
- RLS is the actual enforcement boundary, not the app-layer `requireRole()`/`requireStaff()` guards — those are a UI-side mirror only. A new mutation needs a matching RLS policy, not just a route guard. Corollary: don't invent a second, independent authorization check inside Postgres for a table that's supposed to be governed by `profiles.role` — this codebase already has exactly that mistake live (`certificates`/`participants`/`courses` are gated by `admin_users` membership, completely independent of `profiles.role`/`is_active` — `SECURITY_REPORT.md` §2). Any new table's RLS policies must check `profiles.role`/`is_active` via the existing `app.is_editor()`/`app.is_admin()`/`app.has_min_role()` helpers, full stop.
- Always check `{ data, error }` — never destructure only `data` and silently drop `error`. (The live `/verify` pages currently do exactly this when calling a since-removed RPC, and the result is a "not found" response for every valid certificate with no error surfaced anywhere — see `BUG_REPORT.md`.)
- Don't build a `.or()`/`.ilike()` filter string by directly interpolating unsanitized user input — `,`, `(`, `)` are structural characters in PostgREST filter syntax. Sanitize with `.replace(/[%_,()]/g, " ")` (the pattern already used correctly in `search/page.tsx`, `media/page.tsx`, `audit/page.tsx`) before interpolating, every time, everywhere.
- Sequential per-row Supabase calls in a loop (bulk generate, bulk import) don't scale — batch into set-based queries (`WHERE id = ANY($1)`, multi-row `insert([...])`) instead of N individual round-trips.

## 7. Authentication architecture

- **Sole live login path**: `app/admin/login/actions.ts` → `supabase.auth.signInWithPassword()` → checks `profiles.is_active` → stamps `last_login_at` → audit log → redirect (trainers to `/admin/attendance`, everyone else to `/admin/dashboard`). This is the only authentication path new work should build on or assume is active.
- `app/api/admin/login/route.js` is a second, UI-unreferenced login endpoint that checks `admin_users` membership instead of `profiles`, and returns raw session tokens in a JSON body rather than setting cookies. Do not build on this route or treat it as equivalent to the real login path — it needs an explicit decision (delete or fix) before anyone relies on it, per `SECURITY_REPORT.md` §1.
- Sign-out is client-side: `supabase.auth.signOut()` via the browser client, then `router.push("/admin/login")` + `router.refresh()`. Follow this pattern for any new sign-out-adjacent UI.
- `middleware.ts` (matcher: `/admin/:path*` only) refreshes the session and redirects unauthenticated users to `/admin/login`. It calls `supabase.auth.getUser()`, never a cached `getSession()`, and there is a comment warning not to run any code between client construction and that call — preserve this invariant if you ever touch `lib/supabase/middleware.ts`.
- Password reset (`app/api/admin/reset-password/route.js`) is intentionally public and correctly avoids user enumeration (same generic response whether or not the email exists) — keep it that way if you touch this route.
- Rate limiting on `login`, `reset-password`, `request-proposal`, `newsletter` uses an in-memory `Map`, which does not work correctly on serverless/multi-instance deployments (each invocation may hit a cold instance with an empty map). Do not copy this pattern for a new rate-limited endpoint — use a shared store.

## 8. RBAC architecture

Role hierarchy, most→least privileged: `super_admin > admin > editor > trainer > client > participant` (`lib/auth/rbac.ts`'s `ROLE_ORDER`; **lower index = more privileged** — always use `hasMinRole()`/`rank()`, never compare role strings directly or assume alphabetical/insertion order means anything).

- `lib/auth/rbac.ts` — role ordering, per-feature capability helpers (`canViewAttendance`, `canManageCertificate`, etc.), and `MODULE_ACCESS` (route → minimum role), which the sidebar filters against. When adding a new module, add its entry to `MODULE_ACCESS` in the same change that adds the route — the sidebar and the route guard must never disagree about who can see a link versus who can actually use it.
- `lib/auth/session.ts` — server-side guards to call at the top of a page or Server Action: `requireRole(min)`, `requireStaff()` (admits Trainer into the shell), plus feature-specific guards (`requireAttendance(write?)`, `requireAssessment(write?)`, `requireCertificate(manage?)`) that separate view vs. manage rights.
- **Every Server Action must call one of these guards as its first meaningful statement**, or delegate to an internal helper that does. This is true today for every audited action except one read-only helper (`automation/actions.ts`'s `getAutomationSettings()`, currently safe only because its callers happen to guard first) — don't add a second exception. If a function is exported from a `"use server"` file, it is a directly-invocable endpoint regardless of how "internal" it feels.
- **The RBAC model in `lib/auth/rbac.ts` must be the single authorization model for this app — do not let a table's RLS policies enforce a different one.** See §6's RLS rule; this is the same rule from the app-code side.
- `app/admin/(protected)/layout.tsx` enforces only `requireStaff()` (any active role including Trainer) at the shell level — per-module minimum role is each page's own responsibility via `requireRole(MODULE_ACCESS[module])`. Don't assume the layout protects a module beyond "some kind of active staff member is logged in."

## 9. Server Actions pattern

Every mutating Server Action in this codebase follows (and every new one must follow) this shape:

```ts
"use server";
import { requireRole } from "../../../../lib/auth/session";
import { xSchema, fieldErrors } from "../../../../lib/validation/schemas";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateX(id: string, prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole("editor");        // 1. guard — always first
  const parsed = xSchema.safeParse(readForm(formData)); // 2. validate — always before touching the DB
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createSupabaseServerClient();  // 3. RLS-bound client, not service-role
  const { error } = await supabase.from("x").update(parsed.data).eq("id", id);
  if (error) return { message: error.message };          // 4. always check error, never discard it
  revalidatePath("/admin/x");                             // 5. revalidate, redirect if it's a create/update flow
  redirect("/admin/x");
}
```

- Guard → validate → mutate → check error → revalidate/redirect. Don't reorder these; validating before checking auth wastes work on requests that should be rejected outright, and mutating before validating is how invalid data reaches the database.
- Read-only "get" functions exported from a `"use server"` file are still directly-invocable — see §8's rule on guards.
- Never build an insert/update payload with unbounded `String(x ?? "")` coercion and no Zod schema behind it — see §10. `app/admin/(protected)/certificates/actions.ts` currently does exactly this (`BUG_REPORT.md`/`SECURITY_REPORT.md`); don't repeat it in new code.
- Never trust client-supplied validation results on a "commit" step that follows a "preview" step (e.g. bulk import) — re-run the same validation server-side on commit, as `participants/import/importActions.ts` correctly does.

## 10. Zod validation pattern

`lib/validation/schemas.ts` holds one Zod schema per entity (`courseSchema`, `newsSchema`, `scheduleSchema`, ...) and is meant to be — per that file's own header comment — the single source of truth for input validation in Server Actions.

- **Every mutating Server Action must `.safeParse()` its input through a schema from this file before writing to the database.** `certificateSchema` already exists in this file and is currently imported nowhere — that's a bug (`BUG_REPORT.md` §2), not a precedent. Adding a new mutation without a corresponding schema-and-parse step repeats it.
- String fields must chain `.trim()` before `.min(1)` — several fields in the current schema (`modules[].title`, `faq[].q`/`.a`) skip `.trim()`, letting whitespace-only input pass validation and render as a blank line on the public site (`BUG_REPORT.md` §10). Don't repeat this in a new schema; every free-text field gets `.trim()` first.
- Use `fieldErrors(parsed.error)` (the existing helper) to map Zod issues to a `Record<fieldName, message>` for form state — don't hand-roll a different error-shaping function per module.
- Enum fields (`status`, role-like fields) should use `z.enum([...])`, not `z.string()` with a manual `.includes()` check elsewhere — keep the valid-values list in exactly one place.

## 11. Database migration rules

This is the single most important section in this file, because getting it wrong is what produced the current state documented in `DATABASE_AUDIT.md`: two independently-designed schemas, one of them entirely unapplied, with most application code written against the wrong one.

1. **Before writing a migration, check what's actually live.** Use the Supabase MCP tools (`list_migrations`, `list_tables`) against the connected project. Do not infer live state from `supabase/migrations/` filenames or contents alone — this repository's own history proves that inference wrong.
2. **There is exactly one live schema track.** It is the legacy + compatibility lineage (`DATABASE_AUDIT.md` §1), not the numbered `0001`–`0021` files. Do not write new migrations that assume the numbered lineage's tables (`training_schedules`, `trainers`, `companies`, `certificate_templates`, etc.) exist until the schema-consolidation decision in `DATABASE_AUDIT.md` §10 has actually been made and executed.
3. **Never create a second implementation of a table/feature that already exists under a different name** because the "real" one is inconvenient or you're not sure it's live. This codebase has three different "schedule" tables (`schedules`, `course_schedules`, `training_schedules`) as a direct result of exactly this pattern. If you think a table is missing, verify it's actually missing (rule 1) before creating a new one.
4. **All DDL must be idempotent and guarded**: `create table if not exists`, `add column if not exists`, `do $$ if not exists (...) then ... end if; end $$;` for types/enums. The compatibility-lineage migrations already do this correctly and consistently; new migrations must match that standard, not the numbered lineage's un-guarded `create table` statements.
5. **Never `DROP TABLE`/`DROP COLUMN` without an explicit backup step and sign-off**, even inside a guarded migration. `courses` alone currently holds 125 rows of real production content — there is no "it's probably fine" here.
6. **One migration, one logical change.** Don't bundle an unrelated RLS policy change into a migration that's nominally about adding a column — makes both harder to review and impossible to safely roll back independently.
7. **New tables require, in the same change**: the migration, RLS policies (checking `profiles.role`/`is_active` via the `app.*` helpers — see §6/§8), an audit trigger if the table is staff-mutable (see `app.audit_trigger()`'s existing attachment pattern), a Zod schema (§10), and — if staff-facing — an entry in `MODULE_ACCESS` (§8).
8. **Regenerate `lib/supabase/database.types.ts` after any schema change** that's actually confirmed live (`npx supabase gen types typescript --project-id <id> > lib/supabase/database.types.ts`), and remove any `as any` cast that regeneration makes unnecessary (§4).
9. Scope is locked per `DELIVERABLE.md`: Contact Enquiries, Proposal Requests, and Website Settings are explicitly **out of scope** for admin UI even though their tables exist in the schema. Don't build admin UI for these without an explicit scope change.

## 12. Security requirements

Full detail and live evidence in `SECURITY_REPORT.md`. The rules that must hold for any new code:

- **Authorization**: RLS policies for any table check `profiles.role`/`is_active`, never a second, independent membership table. (§6/§8/§11 rule 7.)
- **Secrets**: `SUPABASE_SERVICE_ROLE_KEY` never reaches a client component, never gets prefixed `NEXT_PUBLIC_`, and its call-site count should stay at zero unless there's a specific, reviewed, server-only need. No secret value is ever committed — `.env*` stays gitignored; only `.env.example`/`.env.*.example` are tracked, with placeholder values.
- **Rate limiting**: any new abuse-sensitive public endpoint (email-sending, auth, password reset) needs a shared-store rate limiter, not an in-memory `Map` (§7's note — serverless instances don't share memory).
- **File uploads**: client-side type/size checks are UX only, not security — they must be backed by bucket-level `file_size_limit`/`allowed_mime_types` and storage RLS policies that independently check `metadata->>'mimetype'` once Storage is provisioned (it is not live today — `SECURITY_REPORT.md` §8).
- **Session tokens never go in a JSON response body.** Use the cookie-based `@supabase/ssr` flow exclusively — see the orphaned `/api/admin/login` counter-example in §7, don't repeat that pattern.
- **CSP**: `next.config.mjs`'s `script-src` currently allows `'unsafe-inline' 'unsafe-eval'`, which defeats most of what CSP protects against. Don't add a new inline `<script>` or `eval`-requiring dependency as a way to "make it work" — either it needs a nonce/hash, or it doesn't belong in `script-src` at all. Tightening this is tracked in `SECURITY_REPORT.md` §13; don't make it looser.
- **Injection**: never interpolate raw user input into a `.or()`/`.ilike()` filter string (§6); never build raw SQL by string concatenation (no instance of this exists today — keep it that way); always check `{ error }` from every Supabase call (§6).
- **XSS**: `dangerouslySetInnerHTML` is only acceptable for `JSON.stringify()` of structured data built from static/internal sources (the existing schema.org JSON-LD usage). Never pass database-sourced rich text (news body, course overview, etc.) through it — render as plain JSX text, which React auto-escapes.

## 13. Performance requirements

Full detail in `PERFORMANCE_REPORT.md`. Rules for new code:

- Any new column used in a `WHERE`/`JOIN`/`.eq()`/`.in()` filter that's a foreign key needs a covering index in the same migration that adds the FK — don't rely on the FK constraint itself to provide one (Postgres doesn't auto-index FK columns).
- No `Promise.all([...])` array element may contain a nested `await` (§5's rule — it silently serializes the whole array).
- No unbounded `select()` / `.limit(100000)`-as-a-substitute-for-pagination pattern for anything that scales with user data — real pagination (`.range()`) or a targeted `WHERE ... = ANY($batch)` query instead.
- No sequential per-row loop of Supabase calls for a bulk operation — batch into set-based queries.
- Any Storage-hosted image needs `next/image` with the host added to `remotePatterns`, not a raw `<img>` fallback (once Storage is live — see §11/§12).
- A new heavy client-only dependency (OCR, PDF rendering, canvas-heavy libraries) must be loaded via `next/dynamic(..., { ssr: false })`, not a static import, and must actually be called from somewhere — don't add a dependency "for later" the way `pdfjs-dist`/`tesseract.js` currently sit unused in `lib/bulkCertificates.js`.

## 14. UI/UX standards

- Admin CRUD modules follow the same 3–4 file shape under `app/admin/(protected)/<module>/`: `page.tsx` (list view, table + filters), `new/page.tsx` + `[id]/page.tsx` (create/edit, usually sharing a `<Module>Form.tsx` component), `actions.ts` (server actions). **Courses is the reference implementation** — look at `app/admin/(protected)/courses/*` first when building or extending a module.
- Shared UI primitives (`PageHead`, `Card`, `Badge`, `EmptyState`, `Pagination`, `StatCard`, table bits) live in `components/admin/ui/index.tsx` — use them, don't hand-roll a new card/badge/table style per module. Shell chrome (`Sidebar`, `Topbar`, `NavScrim`) lives directly under `components/admin/`.
- Modules not yet fully built out use `components/admin/ScaffoldPage.tsx` as a placeholder — replace it wholesale when building the module out, don't patch around it.
- Soft-delete is the norm: rows carry `deleted_at`/`status` rather than being hard-deleted; queries filter with `.is("deleted_at", null)`. Follow this for any new table, not hard deletes.
- Admin styling is scoped under `.teras-admin` with its own `admin.css`; the public site uses `app/globals.css`. Never let admin styles leak into public pages or vice versa.
- Form state pattern: `useActionState`-compatible `FormState` type (`{ errors?: Record<string,string>; message?: string }`) returned from Server Actions, rendered via the shared form field components — match this rather than inventing a new form-state shape per module.

## 15. Error handling standards

- Every Supabase call result must have its `error` checked — never destructure only `{ data }`. An unchecked error is not "no error," it's a silently swallowed failure (see the `/verify` RPC example in §6 — this exact mistake makes every certificate verification attempt on the live site return "not found" with no error surfaced anywhere).
- Server Actions return typed `FormState` objects with a `message`/`errors` field on failure — never throw an unhandled error back to the client from a form submission path; the user needs an actionable message, not a stack trace.
- API routes (`app/api/**/route.js`) catch and return a structured `NextResponse.json({ error }, { status })` — never let an unexpected error crash the handler and return a bare 500 with no body.
- User-facing error messages must not leak internal details (table names, constraint names, stack traces). `error.message` from Supabase is sometimes safe to surface (e.g. a unique-constraint violation the user caused) and sometimes isn't (an RLS denial, a missing-table error) — prefer a generic message unless you've confirmed the underlying error is meant to be user-readable.
- Public-facing lookups (certificate verification, password reset) must never reveal whether a record exists via differing error messages/timing — this codebase already does this correctly for password reset; match that standard for any new public lookup.

## 16. Logging standards

- Privileged mutations are recorded via the audit trigger (`app.audit_trigger()`, attached per-table in the migration that creates the table) or, for non-table events (login, export, bulk import), via `supabase.rpc("log_event", {...})`. Use one of these two mechanisms for anything that should show up in the Audit module — don't build a third logging path.
- Server-side errors that aren't user-facing failures (a background job failure, an unexpected exception in a route handler) go through `console.error(message, { ...context })` — never `console.log` for errors, and never log a raw secret, full request body, or full Supabase error object that might contain sensitive row data.
- Never log a password, session token, service-role key, or PII (IC/passport number, full address) even at debug level, even temporarily during development — grep the diff for these before committing if you added any logging.

## 17. Git commit conventions

Observed and required style, `type: short imperative summary` (lowercase type, colon, space, then a concise present-tense description):

- `feat:` — new capability or module.
- `fix:` — bug fix.
- `style:` — visual/formatting change with no behavior change.
- `release:` — version bump / release marker.
- Body (optional, blank line after summary): explain *why*, not what — the diff already shows what changed.
- One logical change per commit. Don't bundle a schema migration, a UI change, and a dependency bump into one commit.
- Never use `git commit --amend`, `--no-verify`, or force-push on shared branches without explicit user instruction.

## 18. Code review checklist

Before considering a change done, confirm:

- [ ] Every table/column referenced actually exists in the **live** database (§11 rule 1) — not just in a migration file.
- [ ] Every new Server Action guards first, validates via Zod, checks `error`, revalidates (§9).
- [ ] Every new RLS policy checks `profiles.role`/`is_active` via the `app.*` helpers, not a parallel authorization table (§6/§8).
- [ ] No `as any` cast introduced on a Supabase client or query result without a tracked reason (§4).
- [ ] No raw user input interpolated into a `.or()`/`.ilike()` filter string (§6/§12).
- [ ] No `await` inside a `Promise.all([...])` array literal (§9/§13).
- [ ] No secret, token, or PII in a log line, error message, or committed file (§15/§16).
- [ ] `npm run typecheck` passes for any `.ts`/`.tsx` change; `npm run build` succeeds.
- [ ] New/changed public-facing pages tested for the actual golden path in a browser, not just "the build succeeded" (per this repo's own stated verification standard).
- [ ] Any new dependency is actually imported and used somewhere, and any heavy client-only one is loaded via `next/dynamic` (§13).

## 19. Pull request checklist

- [ ] Title matches the commit convention (§17): `type: summary`.
- [ ] Description states *why*, links the relevant module doc (`CERTIFICATE_ENGINE.md`, etc.) if one exists for the area touched.
- [ ] If the change touches `supabase/`: confirms it was checked against the live schema (§11) and states whether it was actually applied to the connected project or is pending.
- [ ] If the change touches auth/RLS/RBAC: explicitly states which role(s) can now do what, and confirms the app-layer guard and the RLS policy agree.
- [ ] If the change adds a new table: confirms all of §11 rule 7's checklist (RLS, audit trigger, Zod schema, `MODULE_ACCESS` entry) is present in the same PR, not deferred.
- [ ] Test plan section lists what was manually verified (which page, which role, which action) — "build passed" is not a test plan for a UI or data-flow change.
- [ ] No `.env*` file, credential, or generated build artifact (`.next/`, `tsconfig.tsbuildinfo`) included in the diff.

## 20. AI coding rules

These bind Claude Code (and any other AI agent) working in this repository, in addition to everything above:

1. **Never assume a migration file describes the live database.** This is the single most expensive mistake possible in this repo — it produced the current two-schema situation. Verify with the Supabase MCP tools before writing or claiming anything about schema state. If MCP access isn't available in a given session, say so explicitly rather than presenting migration-file contents as confirmed live state.
2. **Never generate code that violates any rule in this file.** If a request conflicts with a rule here (e.g. "just cast it to `any` to make the build pass," "skip the Zod schema for now"), say so and propose the compliant alternative rather than silently complying.
3. **Never introduce a second implementation of something that already exists** (a second schedule table, a second login path, a second sanitization helper) without first confirming the existing one is genuinely insufficient — and if it is, fix or replace it rather than adding a parallel one.
4. **When a task is "produce a report/audit document," ground every claim in something actually checked** (a grep result, a live query result, a file read) — never state that a table exists, a function is called, or a query is correct without having verified it in that session. Prior audit reports in this repo (`DATABASE_AUDIT.md`, `BUG_REPORT.md`, `SECURITY_REPORT.md`, `PERFORMANCE_REPORT.md`) were built this way; match that standard when updating them.
5. **When asked to update one of the audit reports, re-verify rather than regenerate from scratch** — check whether the underlying code/schema actually changed since the report was last written before rewriting a finding, and note explicitly when something was re-checked and found still accurate versus genuinely changed.
6. **Documentation-only requests do not touch application code**, full stop — if a task says "documentation only" or "do not modify source code," the only files touched are the requested `.md` output(s).
7. **Destructive database operations (`DROP`, `TRUNCATE`, data-modifying `UPDATE`/`DELETE` against the live project) require explicit user confirmation in the conversation, every time** — `courses` alone holds 125 rows of real content today; there is no context in which "probably fine" is an acceptable bar here.
8. **Prefer fixing the root cause over the symptom.** If a page is broken because it queries a non-existent table, the fix is deciding which schema is canonical and aligning the code (or the schema) to match — not adding a `try/catch` that swallows the resulting error and shows an empty state.
