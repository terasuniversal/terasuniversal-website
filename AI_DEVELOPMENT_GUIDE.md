# AI Development Guide — TERAS UNIVERSAL

This document teaches an AI assistant (or a new human contributor) how to work on this repository: what it is, how it's structured, what patterns to follow, and what not to touch. It's a companion to `CLAUDE.md` (the permanent engineering guide with full checklists) — read this one first for orientation, then `CLAUDE.md` for the enforceable rule set. For live system state, `DATABASE_AUDIT.md` (schema), `BUG_REPORT.md` (known defects), `SECURITY_REPORT.md` (auth/RLS findings), and `PERFORMANCE_REPORT.md` (query/rendering findings) are the ground truth — all four were produced by direct inspection of the live codebase and the connected Supabase project, not assumptions.

---

## 1. Architecture

This is a Next.js 15 (App Router) application with **two halves sharing one deployment**:

```
Public website  →  app/*.js, components/*.js, data/*.js         (plain JavaScript, mostly static)
Admin CMS       →  app/admin, app/api/admin, lib/, components/admin  (TypeScript, Supabase-backed)
```

The public site is largely static/hard-coded and is *not* being redesigned — don't refactor it unless specifically asked. The admin CMS is where active development happens: it's a Postgres (via Supabase) backed content-management and operations system covering courses, training schedules, participants, attendance, assessments, certificates, trainers, companies, and CMS content (news/gallery/FAQ/downloads).

**The two halves are bridged by `lib/public-content.ts`** — public pages are meant to read CMS data through cached helpers there instead of the hard-coded arrays in `data/`. Not every public page has been migrated to this yet; check whether a page still imports from `data/` before assuming it reads from Supabase.

**The most important architectural fact about this repository, and the reason a large fraction of the admin CMS doesn't work today**: two independently-designed database schemas exist in this repo's migration history. Only one is actually applied to the live Supabase project. Most of the admin CRUD code was written against the *other* one. Read `DATABASE_AUDIT.md` before writing or trusting any code that touches a database table — see §4.

Two Supabase clients matter, and using the wrong one in the wrong place is a real risk:
- **RLS-bound client** (`lib/supabase/server.ts`'s `createSupabaseServerClient()`, `lib/supabase/client.ts`'s `createSupabaseBrowserClient()`) — runs as the logged-in user, subject to Row-Level Security. Use this everywhere.
- **Service-role client** (`createSupabaseServiceClient()`) — bypasses RLS entirely. It has zero call sites in the app today. Do not add one without a specific, reviewed, server-only reason, and never let it be reachable from a client component.

`middleware.ts` (matcher: `/admin/:path*` only) refreshes the Supabase session and redirects unauthenticated users away from `/admin/**`. It does **not** cover `/api/**` — every API route is responsible for its own auth check.

## 2. Folder responsibilities

```
app/
  admin/
    (protected)/<module>/    # page.tsx (list), new/page.tsx + [id]/page.tsx (create/edit), actions.ts (Server Actions)
    login/, no-access/, reset-password/   # outside the (protected) route group — no auth required
  api/
    admin/                   # route handlers — NOT covered by middleware.ts; each guards itself
    request-proposal/, newsletter/   # public form endpoints, no auth, own rate-limiting
  verify/                    # public certificate verification — no auth
  <public pages>.js          # public site
components/
  admin/                     # admin-only; shared primitives in components/admin/ui/index.tsx
  <public components>.js
lib/
  auth/                      # rbac.ts (role hierarchy + module access), session.ts (server guards)
  supabase/                  # server.ts, client.ts, middleware.ts, database.types.ts
  validation/                # schemas.ts — one Zod schema per entity
  public-content.ts          # cached helpers the public site reads CMS data through
data/                        # legacy hard-coded content, being phased out
supabase/
  migrations/                # SEE §4 — do not assume every file here is applied to the live project
  seed.sql, cms-seed.sql, certificates.sql, role_policies.sql   # loose root scripts, also see §4
docs/                        # uat/ operator manuals, release/ notes
work/                        # scratch directory — contains a committed duplicate of an old app snapshot;
                              # never import from here, never treat its contents as current
```

**Rule of thumb for where a new file goes**: if it's public-facing and content-driven, it's `.js` under `app/`/`components/`/`data/`. If it's admin/operations and touches Supabase, it's `.ts`/`.tsx` under `app/admin/`/`lib/`/`components/admin/`. Don't mix the two conventions within one feature.

## 3. Coding conventions

- **No premature abstraction.** Write the direct version first. This codebase already shows the cost of not doing this: the same 6-character search-sanitization expression (`.replace(/[%_,()]/g, " ")`) is copy-pasted in three files instead of extracted once, and it's *missing* from 13 other places that needed it — a shared helper would have made "did I remember this?" a one-line answer. Extract to `lib/` the *second* time you need something, not preemptively.
- **No dead code "for later."** `lib/bulkCertificates.js` imports two large libraries (`pdfjs-dist`, `tesseract.js`) and is never called from anywhere in the app. If you write a helper and its only caller disappears, delete the helper in the same change.
- **Match the file you're editing, not a house style you prefer.** This codebase has genuinely different formatting density in different areas (compare `gallery/actions.ts`'s single-line-per-function style to `news/actions.ts`'s more spread-out style) — follow whichever the file already does. Don't reformat unrelated lines as a side effect of a small fix; it makes the diff unreviewable.
- **Comments explain *why*, never *what*.** `lib/auth/rbac.ts` does this well (a comment explaining *why* a smaller ordinal means more privilege, not restating the code). Never write a comment that just restates the line below it.
- **No emojis in code or commit messages unless the existing UI already uses them** (a few admin pages use emoji as lightweight icons, e.g. `🔎`, `📄` — that's an established UI convention, not a general license to add them elsewhere).

## 4. Database conventions

**Before writing or trusting any query against a Supabase table, verify that table exists in the live, connected database.** Do not infer this from a migration filename. This repository's migration history contains a clean-room schema design (`supabase/migrations/0001`–`0021`) that was never applied to production, alongside a set of additive compatibility migrations (timestamp-named files, plus loose root `.sql` scripts) that *were* applied and describe the real live schema. `DATABASE_AUDIT.md` has the full live table/column inventory as of its last verification date — treat it as current only until you have reason to re-check (schema changes, time elapsed), and re-verify with the Supabase MCP tools (`list_tables`, `list_migrations`, `execute_sql`) rather than trusting a stale read of that file for anything consequential.

Consequences of getting this wrong, already live in this codebase: three different "schedule" tables exist (`schedules`, `course_schedules`, `training_schedules`) because each generation of work assumed the prior one didn't exist rather than checking.

Migration rules:
- **Idempotent, guarded DDL only**: `create table if not exists`, `add column if not exists`, `do $$ if not exists (...) then ... end if; end $$;` for types/enums. This is the standard the live/applied migrations already meet — match it.
- **Never `DROP TABLE`/`DROP COLUMN` without an explicit backup step and user sign-off.** The live `courses` table alone holds 125 rows of real content.
- **New tables need, together, in one change**: the migration; RLS policies that check `profiles.role`/`is_active` via the existing `app.is_editor()`/`app.is_admin()`/`app.has_min_role()` helpers (never a second, independent authorization mechanism — see §5); an audit trigger if staff-mutable; a Zod schema (§9); and a `MODULE_ACCESS` entry if staff-facing (§6).
- **Soft-delete is the norm**: rows carry `deleted_at`/`status`, queries filter with `.is("deleted_at", null)`. Don't hard-delete a row a new table's rows should instead be soft-deleted.
- Regenerate `lib/supabase/database.types.ts` (`npx supabase gen types typescript --project-id <id> > lib/supabase/database.types.ts`) after any schema change actually confirmed live — the current file is a **hand-written partial stub** covering only 4 tables, with everything else falling back to `any`. Don't add a table to the app without also either regenerating this file or, at minimum, hand-adding its type here.

## 5. Authentication rules

**The one live, UI-invoked login path** is `app/admin/login/actions.ts`: `supabase.auth.signInWithPassword()` → check `profiles.is_active` → stamp `last_login_at` → audit log → redirect. Build on this path; don't build on or extend `app/api/admin/login/route.js` (a second, unreferenced login endpoint that checks a different authorization table and returns raw session tokens in JSON instead of setting cookies — treat it as flagged-but-unresolved technical debt, not a pattern to follow).

- Sign-out is client-side: `supabase.auth.signOut()` via the browser client, then `router.push("/admin/login")` + `router.refresh()`.
- Sessions are cookie-based via `@supabase/ssr`. Never hand a session token back in a JSON response body — that's the one authentication pattern in this codebase that is explicitly wrong, not to be copied.
- `middleware.ts`/`lib/supabase/middleware.ts` calls `supabase.auth.getUser()` (which revalidates server-side), never a cached `getSession()`. There's a code comment protecting the requirement that nothing runs between client construction and that call — preserve it if you ever touch this file.
- Any new abuse-sensitive public endpoint (auth, password reset, anything that sends email) needs rate limiting backed by a shared store. The existing in-memory `Map`-based throttles (`login` has none at all; `reset-password`/`request-proposal`/`newsletter` have the flawed in-memory version) do not work correctly across serverless instances — don't copy that pattern for new code.

## 6. RBAC rules

Role hierarchy, most→least privileged: `super_admin > admin > editor > trainer > client > participant`. Defined in `lib/auth/rbac.ts` as `ROLE_ORDER` — **lower array index = more privileged.** Always compare roles with `hasMinRole(role, min)` / `rank(role)`; never compare role strings directly or assume any other ordering.

- `lib/auth/rbac.ts` — `MODULE_ACCESS` maps each admin route to its minimum role; the sidebar filters against it, and pages must independently enforce it via `requireRole()`. When adding a module, add its `MODULE_ACCESS` entry in the same change as the route — the sidebar and the actual guard must never disagree.
- `lib/auth/session.ts` — guards to call at the top of a page or Server Action: `requireRole(min)`, `requireStaff()` (admits Trainer into the shell but nothing module-specific), and feature guards that split view vs. manage rights (`requireAttendance(write?)`, `requireAssessment(write?)`, `requireCertificate(manage?)`).
- **Every Server Action must call a guard as its first meaningful statement**, or delegate to an internal helper that does. This repo has exactly one exception today (`automation/actions.ts`'s `getAutomationSettings()`, safe only because its current callers happen to guard first) — treat that as a known gap to fix opportunistically, not a pattern to extend.
- `app/admin/(protected)/layout.tsx` only enforces `requireStaff()` (any active role, including Trainer) at the shell level. Don't assume the layout protects a specific module beyond "some active staff member is logged in" — every page enforces its own minimum role.
- **The RBAC model here must be the single authorization model for any table you touch.** This repo has a live counter-example to avoid repeating: `certificates`/`participants`/`courses`' RLS policies check membership in a separate `admin_users` table, completely independent of `profiles.role`/`is_active` — meaning deactivating a user in the app doesn't revoke their actual database access. Never introduce a second authorization mechanism for a table that's supposed to be governed by `profiles.role`.

## 7. CRUD pattern

Every full CRUD module under `app/admin/(protected)/<module>/` follows the same shape. **Look at `app/admin/(protected)/courses/*` first** — it's the reference implementation:

```
<module>/
  page.tsx          # list view: table + filters, server component, fetches directly
  new/page.tsx       # create form, usually renders a shared <Module>Form.tsx
  [id]/page.tsx       # detail/edit view
  [id]/edit/page.tsx  # edit form (or combined with [id]/page.tsx, varies by module)
  actions.ts          # "use server" — create/update/soft-delete, each guarded + validated
```

List pages fetch with pagination (`.range()`) and filters built from `searchParams`, not client-side filtering of a full fetch. Soft-delete via an `archive*`/`softDelete*` action that sets `deleted_at`, not a hard `DELETE`. Shared UI primitives (`PageHead`, `Card`, `Badge`, `EmptyState`, `Pagination`, `StatCard`) live in `components/admin/ui/index.tsx` — use them rather than hand-rolling table/card markup per module.

## 8. Form pattern

Forms use React's `useActionState`-compatible pattern: a Server Action with signature `(prevState, formData) => Promise<FormState>`, where `FormState` is `{ errors?: Record<string,string>; message?: string }`. Concrete shape, copied from the actual codebase:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { fieldErrors, xSchema } from "../../../../lib/validation/schemas";

export type XFormState = { errors?: Record<string, string>; message?: string };

function readForm(formData: FormData) {
  return { title: String(formData.get("title") ?? ""), /* ... */ };
}

async function save(id: string | null, _prev: XFormState, formData: FormData): Promise<XFormState> {
  const profile = await requireRole("editor");           // 1. guard first
  const parsed = xSchema.safeParse(readForm(formData));    // 2. validate before touching the DB
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createSupabaseServerClient();
  const query = id ? supabase.from("x").update(parsed.data).eq("id", id) : supabase.from("x").insert(parsed.data);
  const { error } = await query;
  if (error) return { message: error.message };            // 3. never discard the error
  revalidatePath("/admin/x");
  redirect("/admin/x");
}

export async function createX(prev: XFormState, formData: FormData) { return save(null, prev, formData); }
export async function updateX(id: string, prev: XFormState, formData: FormData) { return save(id, prev, formData); }
```

Create and update usually share one internal `save()` function, called from two thin exported wrappers — follow this rather than duplicating the body. Image fields use `components/admin/ImageUpload.tsx`, which writes the uploaded URL into a hidden input so it submits with the rest of the form (note: client-side type/size checks in that component are UX only, not a security boundary — don't rely on them if you're ever asked to review upload security, see `SECURITY_REPORT.md` §9).

## 9. Validation pattern

`lib/validation/schemas.ts` holds one Zod schema per entity and is meant to be the single source of truth for input validation in every Server Action.

- **Every mutating Server Action must `.safeParse()` through a schema from this file before writing to the database.** This repo has a live counter-example not to repeat: `certificateSchema` already exists in this file and is imported nowhere — certificate generation writes unvalidated payloads as a result.
- Every free-text string field chains `.trim()` before `.min(1)` — a couple of fields in the current schema skip this and let whitespace-only input pass as "valid" (renders as a blank line on the public site). Match the majority pattern (`.trim().min(1, "message")`), not the exception.
- Use enums (`z.enum([...])`) for any field with a fixed valid-value set — don't validate a status field with a manual `.includes()` check elsewhere; keep the valid-values list in exactly one place.
- Map Zod errors to form state with the existing `fieldErrors(parsed.error)` helper — don't write a second error-shaping function.
- On any "preview then commit" flow (bulk CSV import is the existing example), **re-run validation server-side on commit** — never trust a client-supplied "this row is valid" flag from the preview step.

## 10. Error handling

- **Always destructure and check `{ data, error }` from every Supabase call — never destructure only `{ data }`.** This repo has a real, live example of what happens when this rule is broken: the public certificate-verification pages call an RPC and discard `error`, so when that RPC doesn't exist in production, the failure is indistinguishable from "certificate not found" — every verification attempt on the live site silently fails this way.
- Server Actions return a typed `FormState` (`{ errors?, message? }`) on failure — never let an unhandled exception propagate to the client from a form submission; the user needs an actionable message.
- API routes (`app/api/**/route.js`) wrap their body in `try/catch` and return `NextResponse.json({ error }, { status })` on failure — never let an unexpected error produce a bare 500 with no JSON body.
- Don't leak internal details (table/column/constraint names, stack traces) in a user-facing error message. `error.message` from Supabase is sometimes safe to surface verbatim (a unique-constraint violation the user caused) and sometimes isn't (an RLS denial, a missing-table error) — default to a generic message unless you've confirmed the specific error is meant to be user-readable.
- Public lookups (certificate verification, password reset) must never reveal via differing responses/timing whether a record exists — `reset-password` already does this correctly (identical response regardless); match that standard for any new public lookup.

## 11. Naming conventions

- **Tables/columns**: `snake_case`, matching Postgres convention (`full_name`, `deleted_at`, `created_by`).
- **TypeScript/JS variables, functions**: `camelCase`. React components: `PascalCase`. Files exporting a single component: `PascalCase.tsx` (`ScheduleForm.tsx`); files exporting utilities/actions: `camelCase.ts` (`actions.ts`, `session.ts`, `rbac.ts`).
- **Server Actions**: verb-first, matching the CRUD operation — `createX`, `updateX`, `archiveX`/`softDeleteX`, `restoreX`, `bulkX`. Don't invent a differently-shaped verb for a new module (e.g. `saveX`/`removeX`) when `createX`/`updateX`/`archiveX` is the established set.
- **Guards**: `require<Thing>()` for the auth/RBAC guards in `lib/auth/session.ts` (`requireRole`, `requireStaff`, `requireCertificate`), `can<Verb><Thing>()` for the boolean capability checks in `lib/auth/rbac.ts` (`canViewAttendance`, `canManageCertificate`).
- **CSS classes** (admin area): `ta-` prefix (`ta-btn`, `ta-card`, `ta-table`, `ta-search`) — see §12.
- **IDs generated by the app** (per the *designed*, not-fully-live schema, but the convention to follow if/when this is built out): `<PREFIX>-000001` — `TU-` participants, `TR-` trainers, `CO-` companies, `TS-`/`CERT-`/`ASMT-`/`ATT-` for schedules/certificates/assessments/attendance.

## 12. Styling conventions

- Admin styling is scoped under a `.teras-admin` class with its own `admin.css`, deliberately kept separate from `app/globals.css` (public site). Never let admin-specific styles leak into the public site's stylesheet or vice versa.
- Admin UI classes use a `ta-` prefix (`ta-btn`, `ta-btn-primary`, `ta-btn-outline`, `ta-btn-sm`, `ta-card`, `ta-table`, `ta-search`, `ta-field`, `ta-grid`, `ta-toolbar`) — reuse these rather than inventing new class names for a common element (button, card, table) that already has a `ta-` class.
- Shared UI primitives (`PageHead`, `Card`, `Badge`, `EmptyState`, `Pagination`, `StatCard`) in `components/admin/ui/index.tsx` are the building blocks for admin pages — compose from these before writing new bespoke markup.
- Public site pages use plain CSS classes matching each page's own naming (e.g. `course-catalog-page`, `catalog-course-hero`) — follow the pattern already established in the specific page/section you're editing, since the public site doesn't share the admin's `ta-` convention.
- `next/image` is used consistently across the public site — use it for any new public-facing image. It's currently *not* usable for Supabase Storage-hosted images (no `remotePatterns` configured in `next.config.mjs`), which is why admin components fall back to raw `<img>` for Storage URLs — that's a known, tracked gap (`PERFORMANCE_REPORT.md` §9), not a style choice to imitate for a *local/static* image.

## 13. Git workflow

- Commit style: `type: short imperative summary` — observed and required types are `feat:`, `fix:`, `style:`, `release:`. Lowercase type, colon, space, present-tense description. Body (if any) explains *why*, not *what* — the diff shows what changed.
- One logical change per commit — don't bundle a schema migration with an unrelated UI tweak.
- Never `git commit --amend`, force-push, or skip hooks (`--no-verify`) without explicit user instruction, even if a hook is inconvenient — fix the underlying issue instead.
- Before any destructive git operation (`reset --hard`, `checkout --`, discarding uncommitted work), check `git status` first and confirm nothing valuable would be lost.
- Only commit when explicitly asked — don't proactively commit as a side effect of finishing a task.

## 14. Common mistakes to avoid

These are not hypothetical — every one of them is a real, live defect in this codebase today, found during a full-repo audit this session. Don't add a new instance of any of them:

1. **Trusting a migration filename over the live database.** Two schemas exist in this repo's history; only one is applied. Verify live state before writing or claiming anything about a table.
2. **Casting a Supabase client or query to `as any`.** This is *why* `npm run typecheck` currently passes on code that fails at runtime — it hides the exact class of bug this repo is full of.
3. **Discarding `{ error }` from a Supabase call.** The live public certificate-verification flow does this and, as a result, silently reports every genuine certificate as invalid.
4. **Putting an `await` inside a `Promise.all([...])` array literal.** JS evaluates the array left-to-right before `Promise.all` runs, so a nested `await` serializes the whole thing while looking parallel. Live example: `trainers/[id]/page.tsx`.
5. **Interpolating raw user input into a `.or()`/`.ilike()` filter string.** `,`/`(`/`)` are structural characters in PostgREST filter syntax. Sanitize with `.replace(/[%_,()]/g, " ")` first, every time.
6. **Building an insert/update payload with ad hoc `String(x ?? "")` coercion instead of a Zod schema.** The certificate-generation flow does this; it has no validation as a result.
7. **Introducing a second implementation of something that already exists** instead of checking whether the existing one is actually broken/missing first — this repo has three different "schedule" tables from exactly this pattern.
8. **Resetting a timestamp field on every save instead of only on the relevant state transition.** `published_at` gets reset on every edit of an already-published course/news post, not just the draft→published transition.
9. **Relying on client-side validation as if it were a security boundary** — file-type/size checks, capacity limits, etc. must be re-checked server-side; the client-side version is UX only.
10. **Leaving unused, heavy dependencies wired into a module nothing imports** (`pdfjs-dist`/`tesseract.js` via `lib/bulkCertificates.js`) — delete unused code in the same change that orphans it, don't leave it "for later."

## 15. Things that must never be changed

- **The public/admin decoupling.** A change to `app/admin` should never require touching public `.js` pages, unless you're deliberately wiring a page to `lib/public-content.ts`.
- **The RLS-bound client as the default for all user-facing data access.** Never swap it for the service-role client to "make a query work" — if RLS is blocking a legitimate operation, fix the RLS policy, don't bypass it from application code.
- **The `profiles.role` hierarchy as the single authorization model.** Never add a table whose RLS checks a different mechanism (the existing `admin_users` exception is a known, tracked defect — not a precedent).
- **Soft-delete semantics** (`deleted_at`/`status`) for any table that already uses them — don't switch an existing module to hard deletes.
- **The out-of-scope modules locked by `DELIVERABLE.md`**: Contact Enquiries, Proposal Requests, and Website Settings have tables in the schema but are explicitly not to get admin UI. Don't build UI for these without an explicit scope change from the user.
- **Committed secrets policy**: `.env*` stays gitignored; only `.env.example`/`.env.*.example` (placeholder values only) are ever tracked. Never commit a real credential, even temporarily.
- **Destructive database operations against the live project** (`DROP`, `TRUNCATE`, bulk `UPDATE`/`DELETE`) — always require explicit user confirmation in the conversation. `courses` alone holds 125 rows of real production content today.
- **The audit trail mechanism** (`app.audit_trigger()` / `supabase.rpc("log_event", ...)`) — don't build a parallel logging path for privileged mutations that should show up in the Audit module.

## 16. Safe refactoring rules

- **Verify before you refactor "obviously dead" code.** Check for every plausible import path (direct import, dynamic `import()`, re-export, string-based table/RPC name) before deleting something that looks unused — and once confirmed, delete it fully (including now-unused dependencies in `package.json`), don't just comment it out.
- **Refactor one layer at a time.** Don't combine a schema change, a Server Action rewrite, and a UI redesign in one pass — each should be independently reviewable and revertible.
- **Never refactor a working area while investigating a broken one.** If you're fixing a bug in `certificates/actions.ts` and notice `trainers/actions.ts` has a similar-looking but unrelated issue, note it — don't fix it in the same change unless asked.
- **When consolidating duplicated logic** (e.g. the search-sanitization helper that's copy-pasted three times and missing from thirteen more places), extract to `lib/` and update *every* call site in the same change — a partial consolidation that leaves some call sites on the old pattern is worse than no consolidation, because it now looks intentional.
- **Preserve existing function signatures used by multiple callers** unless the refactor's whole point is changing that signature — check every call site first (`grep` for the function name) so you're not silently breaking a caller you didn't look at.
- **Any refactor that touches RLS, auth guards, or Zod schemas needs `npm run typecheck` to pass and a stated test plan** (which page, which role, which action was manually verified) before it's considered done — a passing build is not sufficient evidence for changes in this category.
- **Don't "fix" a schema mismatch by making the code more defensive (optional chaining, fallback values, swallowed errors) instead of resolving which schema is actually canonical.** That's exactly the pattern that let the current two-schema situation go unnoticed for as long as it did — a query returning nothing because a table doesn't exist should be loud, not quietly handled as "no results."
