# Security Audit — TERAS UNIVERSAL Admin CMS

Full audit of authentication, authorization, RBAC, middleware, Server Actions, API routes, Supabase RLS, storage buckets, environment variables, secrets, file uploads, XSS, CSRF, injection risks, security headers, and session management. Method: static review of every file in these areas, cross-checked against **live** inspection of the connected Supabase project (`iagzkrzeuawaxvacqprk`) — live RLS policies, role privileges, storage buckets, and the Supabase security advisor — via direct MCP queries, not assumptions from migration files. Cross-referenced against `DATABASE_AUDIT.md` and `BUG_REPORT.md` (same repo, same session) where findings overlap. Documentation only — no source files were modified.

Severity key: **Critical** = exploitable now, or a live authorization boundary that doesn't do what the code/docs claim. **High** = a real gap that's one config change or one new code path away from exploitable. **Medium** = defense-in-depth gap or inconsistency, not independently exploitable today. **Low** = best-practice deviation flagged by tooling, cosmetic.

---

## 1. Authentication

**Live path** (`app/admin/login/actions.ts`): `supabase.auth.signInWithPassword()`, then explicitly checks `profiles.is_active` and signs the user back out if deactivated, stamps `last_login_at`, writes an audit event. Correct pattern, no issues found. **No rate limiting of its own** — relies entirely on Supabase Auth's default throttling, inconsistent with the explicit per-IP throttle pattern used elsewhere in this codebase (`reset-password`, `request-proposal`, `newsletter`). *(Medium)*

**Orphaned path** (`app/api/admin/login/route.js`): a second, UI-unreferenced but live and reachable login endpoint. Signs in with the anon key, checks `admin_users` membership (not `profiles`), and — critically — **returns the raw Supabase session (`access_token`/`refresh_token`) in the JSON response body** rather than setting httpOnly cookies the way the real login flow does. Has **no rate limiting at all**. If this route is dead code it should be deleted; if it's an intentional fallback it needs the same session/cookie handling, rate limiting, and authorization source as the primary path. *(High)*

**Sign-out** (`components/admin/Topbar.tsx:31-36`): client-side `supabase.auth.signOut()` via the browser client, followed by `router.push` + `router.refresh()`. Correct pattern — the browser client clears the same cookies the server client reads, and `refresh()` forces server components to re-evaluate auth state.

**Password reset** (`app/api/admin/reset-password/route.js`): correctly avoids user enumeration (same generic success message regardless of whether the email exists), validates email format, and is intentionally public (documented rationale: a locked-out admin can't be logged in to reset their own password). Rate limiting present but ineffective in production — see §12.

**Leaked-password protection is disabled** in Supabase Auth (confirmed via live security advisor, `auth_leaked_password_protection`, WARN) — HaveIBeenPwned checking on password set/change is off. Free to enable. *(Low)*

## 2. Authorization

**Critical — the DB-level authorization boundary for `courses`/`participants`/`certificates` is a single binary flag, decoupled from the app's role system.** Live policy inspection (`pg_policies`) shows these three tables are gated *exclusively* by `EXISTS (SELECT 1 FROM admin_users a WHERE a.user_id = auth.uid())` on every SELECT/INSERT/UPDATE/DELETE policy — none reference `profiles.role` or `profiles.is_active` at all, even though the entire application-level RBAC layer (`lib/auth/rbac.ts`, `lib/auth/session.ts`) is built around exactly those two columns.

Consequences, confirmed live:
- **Deactivating a staff member** (`profiles.is_active = false`, the only "revoke access" action the Users module exposes) does nothing to `admin_users` membership. If they're in `admin_users`, they retain full DB-level read/write/delete on courses/participants/certificates indefinitely, regardless of what the app's `requireRole()`/`requireStaff()` guards show them.
- **Every `admin_users` member has unrestricted DELETE** on all three tables — no editor/admin/super_admin distinction exists at this layer, even though `lib/auth/rbac.ts` clearly intends certificate deletion to be admin-only.
- `admin_users` itself has **no INSERT/UPDATE/DELETE policy exposed via the API** — it can only be managed from the Supabase SQL editor or with the service-role key, so there's no in-app fix for the gap above.

Current blast radius is small — live data shows exactly 1 row in `admin_users` and 1 in `profiles`, in sync — but this is a structural gap, not an incidental one. It will surface the moment a second staff account is created through the Users module (which only touches `profiles`) without someone remembering to also touch `admin_users` via SQL. This is the same underlying schema-consolidation problem `DATABASE_AUDIT.md` §10 identifies; resolving that resolves this.

**Filter-injection via unsanitized search input** on 13 list/export endpoints — restated from `BUG_REPORT.md` §5 with the authorization framing: raw `?q=` values are interpolated directly into a PostgREST `.or()` filter string (e.g. `app/admin/(protected)/participants/page.tsx:52`), letting an authenticated `editor`+ user inject additional filter clauses (commas/parentheses are structural in `.or()` syntax) and alter which rows a query matches/excludes beyond what the UI exposes. Not privilege escalation — RLS still bounds the underlying table to what that role could see — but a real filter-logic bypass within that role's data. 3 endpoints (`search/page.tsx`, `media/page.tsx`, `audit/page.tsx`) already sanitize correctly via `.replace(/[%_,()]/g, " ")`; the other 13 don't. *(High)*

## 3. RBAC

`lib/auth/rbac.ts`'s role hierarchy logic (`ROLE_ORDER`, `hasMinRole()`, `rank()`) is internally sound — ordinal comparison, documented invariant ("lower index = more privileged"), consistent with the Postgres enum order. `MODULE_ACCESS` cleanly maps routes to minimum roles and is used both by the sidebar (to hide inaccessible modules) and by `requireRole()` (to actually enforce access) — no drift found between what's shown and what's enforced at the app layer.

The gap is not in this file — it's that the RBAC model this file implements **does not match the authorization model actually enforced by Postgres RLS** for the three most sensitive tables (§2). `lib/auth/rbac.ts` is a correct implementation of a role system that only partially governs the data it's meant to protect.

One inconsistency within the app layer itself: `app/admin/(protected)/layout.tsx` enforces only `requireStaff()` (any active role, including Trainer) at the shell level; every module's actual minimum role (`editor`, `admin`, or `super_admin` per `MODULE_ACCESS`) is enforced page-by-page, not centrally. Verified this is done consistently across all 18 `actions.ts` files with a "use server" directive — every exported action either calls a `require*` guard directly or delegates to an internal helper that does, with one exception: `automation/actions.ts`'s `getAutomationSettings()` has no guard of its own, safe today only because both current callers gate access first (see §4). *(Medium)*

## 4. Middleware

`middleware.ts`'s matcher is `["/admin/:path*"]` — this covers `/admin/**` pages only. It does **not** match `/api/admin/**`: Next.js matches on the literal path, and `/api/admin/login` doesn't start with `/admin`. This is a deliberate, documented choice ("so the public website is never touched"), but its actual scope is wider than the comment implies — **no route under `app/api/**` gets any middleware-level session check, admin or otherwise.** Every API route reviewed (`request-proposal`, `newsletter`, `admin/login`, `admin/certificates`, `admin/reset-password`) currently implements its own auth/rate-limit logic correctly for its purpose, but nothing structural stops a future `app/api/admin/<new-route>/route.js` from shipping with zero protection — unlike a new page under `app/admin/(protected)/`, which at minimum inherits `requireStaff()` from the shared layout even if the page itself forgets a guard. *(High)*

Within its actual scope, `middleware.ts`/`lib/supabase/middleware.ts` is implemented correctly: it calls `supabase.auth.getUser()` (which revalidates the token server-side) rather than trusting a cached `getSession()`, with an explicit comment warning future editors not to run code between client creation and `getUser()` — the standard Supabase SSR footgun, correctly avoided here.

## 5. Server Actions

Audited all 18 files with a `"use server"` directive. Consistent pattern: guard first (`requireRole`/`requireStaff`/`requireAttendance`/etc.), then validate, then mutate, then `revalidatePath`. One gap found:

- `automation/actions.ts:32` — `getAutomationSettings()` is an exported (hence directly-invocable) Server Action with no internal guard. Not exploitable today (both current callers check `requireRole("admin")` before calling it), but it's the one inconsistency across an otherwise clean pattern, and a future caller could expose it without realizing the guard lives in the caller, not the action. *(Medium)*
- `assessment/actions.ts`'s `unlockAssessments()` deliberately bypasses the shared `requireAssessment()` guard in favor of an inline `isSuperAdmin()` check — this is correct and intentional (unlock is a stricter permission than the rest of the module), not a bug.

No CSRF-relevant issue found — see §11.

## 6. API Routes

5 route handlers reviewed individually:

| Route | Auth | Rate limit | Notes |
|---|---|---|---|
| `POST /api/request-proposal` | none (public form) | in-memory per-IP (§12) | Good validation: length caps, honeypot field, fill-time heuristic, Origin check, HTML-escaped before email |
| `POST /api/newsletter` | none (public form) | in-memory per-IP (§12) | Same pattern, same quality |
| `POST /api/admin/login` | anon sign-in + `admin_users` check | **none** | Returns raw session tokens in JSON — §1 |
| `GET`/`POST /api/admin/certificates` | `profiles.role` ≥ editor | none | RLS-bound client (correct — not service-role); no Zod validation, only manual `String()` coercion (§ certificateSchema, cross-ref `BUG_REPORT.md` §2); `GET` has no pagination (unbounded `select("*")`, cross-ref `PERFORMANCE_REPORT.md` §4) |
| `POST /api/admin/reset-password` | none (intentionally public) | in-memory per-IP (§12) | Correctly avoids user enumeration |

## 7. Supabase RLS

Live-verified (not migration-file-assumed) via `pg_policies` and `pg_class.relrowsecurity`/`relforcerowsecurity`:

- **RLS is enabled on all 21 live tables.** `FORCE ROW LEVEL SECURITY` is set on **none** of them. Initially flagged as a defense-in-depth gap; **on further check this is low real-world impact**: `FORCE` only changes behavior for the table *owner* role when that role doesn't have `BYPASSRLS`, and live role inspection (`pg_roles`) confirms `postgres` and `service_role` both already have `rolbypassrls = true` (they bypass RLS regardless of `FORCE`), while `anon` and `authenticated` — the two roles the application actually uses — do **not** have `BYPASSRLS` and are therefore fully subject to RLS either way. Still worth setting `FORCE` for defense-in-depth and to match the numbered migration lineage's documented intent, but it is not currently a gap in what's actually enforced against untrusted traffic. *(Low, corrected down from an earlier draft of this review)*
- `profiles` has only `SELECT`/`UPDATE` policies (both self-or-admin-scoped) — no `INSERT`/`DELETE` policy. Row creation happens exclusively via the `SECURITY DEFINER` trigger `app.handle_new_user()` (correct, bypasses RLS by design); no `DELETE` path exists via the API at all (soft-delete via `is_active` is the real pattern). Both are almost certainly intentional but undocumented — worth a one-line comment in the migration so a future contributor doesn't read the missing policy as a bug. *(Medium)*
- Several public-content tables' read policies (`downloads_editor_read`, `faqs_editor_read`, `gallery_images_editor_read`, `news_posts_editor_read`, `media_editor_read`, `company_profile_editor_insert/update`, all `*_editor_all` taxonomy policies) are scoped to Postgres role `{public}` (anon + authenticated) rather than `to authenticated`, relying on `app.is_editor()` returning `false` for anon (`auth.uid()` is `NULL`) to filter anon out. Functionally safe today, but it means a `SECURITY DEFINER` function executes on every anonymous request to these tables rather than being short-circuited by the policy's role list — tighten to `to authenticated` so the intent is explicit in the policy itself. *(Medium)*
- `admin_users` has exactly one policy: self-read (`user_id = auth.uid()`). No write path via the API — see §2.
- The `Deny anonymous direct {certificate,participant,course} access` restrictive policies (`qual: false` for `anon`) are correctly in place — public/anon direct table reads are blocked; the only public data path for certificates is the `SECURITY DEFINER` RPC (§9 Injection Risks / §14).

## 8. Storage Buckets

Live query (`storage.buckets`, `pg_policies where schemaname='storage'`) returns **zero rows for both** — no buckets exist, and there are no storage RLS policies to review, because there's nothing to attach them to. `0008_storage_buckets.sql` (which would create the `media`/`downloads`/`private` buckets and their access policies) is part of the numbered migration lineage `DATABASE_AUDIT.md` confirmed was never applied live.

Practical effect: `components/admin/ImageUpload.tsx` and any other code calling `supabase.storage.from("media").upload(...)` fails outright against production today — a functional break, not currently exploitable (a nonexistent bucket is trivially fail-closed). Flagged here because **there is no storage security posture to audit right now**, and whoever provisions the bucket should do so deliberately — with `file_size_limit`/`allowed_mime_types` set at the bucket level and policies re-derived from whichever authorization model wins the §2 schema decision — rather than by copy-pasting `0008_storage_buckets.sql` as-is (it assumes `app.is_editor()`, i.e. the `profiles.role` model that doesn't actually govern the live `certificates`/`participants`/`courses` tables). *(High)*

## 9. File Uploads

`ImageUpload.tsx:28-29` checks file type (`file.type.startsWith("image/")`) and size (≤5MB) **client-side only**, then uploads directly from the browser to Storage using the anon key — there is no server action in between. Both checks are cosmetic from a security standpoint: anyone with valid staff credentials can call `supabase.storage.from("media").upload(path, arbitraryFile)` directly (devtools, a script) bypassing the component entirely, and nothing on the server/storage side would stop them. Moot only because the bucket doesn't exist yet (§8); becomes real the moment it's provisioned, unless the bucket is created with enforced `file_size_limit`/`allowed_mime_types` **and** the storage policies independently check `metadata->>'mimetype'`. Filenames are built with `crypto.randomUUID()` — no path-traversal risk from user input there. *(High, tied to §8)*

## 10. XSS

Checked every `dangerouslySetInnerHTML` call site in the repo (5 total): `app/layout.js:79`, `app/training/[slug]/page.js:47`, `app/insights/[slug]/page.js:7`, `app/faq/page.js:11` all inject `JSON.stringify()` of schema.org structured-data objects built from **static, hard-coded `data/*.js` content** (not user or database input) — safe. `app/admin/cert-pdf/[id]/page.tsx:34` injects a static, hard-coded print-trigger script string with no interpolated data — safe. **No instance found of database-sourced rich text (e.g. `news_posts.body`) being rendered via `dangerouslySetInnerHTML`** — everywhere CMS content is displayed, it's through normal JSX text interpolation, which React auto-escapes. No XSS sink found in the reviewed code.

## 11. CSRF

No evidence found of Next.js's built-in Server Action CSRF protection (Origin-header verification against the deployment's own host) being disabled — no `experimental.serverActions.allowedOrigins` override in `next.config.mjs`, so the framework default applies. The public API routes (`request-proposal`, `newsletter`) additionally do their own explicit `Origin` header check (`origin !== siteOrigin && !origin.endsWith(".vercel.app")`) as a second layer. `admin/login` and `admin/certificates` routes do not re-check `Origin` themselves, relying on Next.js's default handling for the framework-level request path — acceptable, but worth noting they have no independent check the way the public forms do.

## 12. Injection Risks

- **No raw SQL string concatenation found anywhere** — every data access goes through the Supabase JS client (`supabase.from(...)`) or a `.rpc()` call with parameterized arguments; PostgREST/postgrest-js parameterizes the underlying query in both cases.
- **PostgREST filter-string injection** via unsanitized `.or()` interpolation — see §2 (13 endpoints), the one real injection-adjacent finding in this codebase.
- **In-memory per-IP rate limiting is ineffective on serverless deployments.** `app/api/admin/reset-password/route.js:10-11`, `app/api/request-proposal/route.js:11`, `app/api/newsletter/route.js:6` each use a module-level `Map<string, number>` to throttle repeat requests. On Vercel (or any multi-instance/serverless Next.js deployment) each invocation may land on a different, cold-started function instance with its own empty `Map` — there is no shared state across instances, so this throttle is inconsistent and easily bypassed by retrying, while reading as "rate-limited" in the code. For abuse-sensitive endpoints (email-sending, password reset), back this with a shared store (Redis/Upstash/a Supabase table) or a platform-level limiter. Also note `getClientIp()` trusts `x-forwarded-for` as a fallback if `x-vercel-forwarded-for` is absent — spoofable outside Vercel's edge. *(High)*

## 13. Security Headers

`next.config.mjs` sets, on every route (`source: "/(.*)"`, so this covers public and admin alike): `Strict-Transport-Security` (1yr, includeSubDomains), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geolocation denied), and a `Content-Security-Policy`.

**The CSP allows `'unsafe-inline'` and `'unsafe-eval'` in `script-src`** (`script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com`). Together these remove most of what CSP actually protects against: any successfully injected inline `<script>` or `eval()`'d string executes exactly as if there were no CSP `script-src` restriction at all. Almost certainly present to accommodate Google Tag Manager, which commonly needs both — but it means this header should not be read anywhere in this codebase as "XSS is mitigated by CSP." If GTM is the reason, a nonce- or hash-based `script-src` is the standard fix; at minimum, scope the relaxed policy away from `/admin/**` if GTM doesn't need to run there. `style-src` also allows `'unsafe-inline'`, a much smaller and more common/acceptable risk (inline styles can't execute script). *(High)*

No `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` set — low priority for a site with no cross-origin postMessage/SharedArrayBuffer usage found.

## 14. Session Management

Sessions are managed entirely by `@supabase/ssr`'s cookie-based flow (`lib/supabase/server.ts`, `client.ts`, `middleware.ts`) — no custom cookie `maxAge`/`sameSite`/`secure` overrides were found anywhere in the codebase, meaning session cookie lifetime and flags are whatever `@supabase/ssr` defaults to. That's a reasonable default to inherit rather than a flaw, but it wasn't independently verified against this project's specific security requirements (e.g. desired absolute session lifetime for an admin CMS) — worth an explicit decision rather than an inherited default if that matters for this deployment.

`middleware.ts` correctly revalidates the session on every request via `getUser()` (not a cached `getSession()`), with an explicit code comment warning against introducing any code between client construction and that call — the standard Supabase SSR correctness requirement, followed correctly here. Sign-out (§1) correctly clears client-side session state and forces a server re-render.

One session-adjacent gap already covered in §1/§4: the orphaned `/api/admin/login` route hands back raw bearer tokens in a JSON body instead of using this cookie-based session mechanism — a second, weaker session-establishment path that bypasses the httpOnly-cookie model the rest of the app relies on.

---

## 15. Environment Variables

- `.gitignore` excludes `.env*`; `git ls-files` confirms only `.env.example` is tracked. `.env.local`, `.env.admin.example`, `.env.cms.example` exist on disk but are **not** committed.
- `NEXT_PUBLIC_` prefix is used correctly and only for values meant to be public (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, analytics IDs). No secret was found prefixed with `NEXT_PUBLIC_`.
- `.env.example` and `.env.admin.example` both carry explicit inline warnings ("Never expose ... to the browser", "SERVER ONLY. Never prefix with NEXT_PUBLIC") next to the sensitive vars — good practice, keeps the warning next to the place someone would actually make the mistake.

## 16. Secrets

- **`SUPABASE_SERVICE_ROLE_KEY`** — the most powerful credential in this project — is read in exactly one place (`lib/supabase/server.ts`'s `createSupabaseServiceClient()`), and a repo-wide search found **zero call sites** of that function anywhere in application code. The key is defined but currently unused, which is the safest possible state for it to be in (smallest attack surface) — though it also means the "trusted server code that must act without a user session" use case its own doc comment describes doesn't actually exist anywhere in this codebase yet. If a future feature needs it, keep the call site count as close to zero as possible and never let it reach a client component.
- `RESEND_API_KEY`, `GOOGLE_SHEETS_WEB_APP_URL` — both read only in the two public-facing API routes that need them, both server-only, both fail closed with a clear 503 if missing rather than silently proceeding.
- No hardcoded API keys, tokens, or credentials found in source (searched for common patterns; the only key-shaped strings in the repo are env var *names*, not values).

---

## Recommendations, in priority order

1. **Resolve §2 before adding a second staff account.** Highest real-world impact, shortest fuse — invisible today only because there's exactly one user in the system. Either sync `admin_users` to `profiles.is_active`/role automatically, or migrate `courses`/`participants`/`certificates` RLS onto the `profiles.role` model already used everywhere else (the same decision `DATABASE_AUDIT.md` §10 already calls for).
2. **Decide the fate of `/api/admin/login`** (§1/§4): delete if unused, or bring it to parity (cookie session, rate limiting, `profiles`-based check) with the real login path.
3. **Replace in-memory rate limiting with a shared store** (§12) before relying on it for anything abuse-sensitive.
4. **Provision Storage deliberately** (§8/§9): bucket-level size/MIME limits, policies re-derived from whichever model wins #1, not a copy-paste of the unapplied migration.
5. **Tighten the CSP** (§13) — nonce/hash-based `script-src` instead of `unsafe-inline`/`unsafe-eval`, or at least scope the relaxation away from `/admin/**`.
6. Everything else here (§3, §5, §7's `FORCE RLS`/policy-role scoping, §16) is either already safe or a small, well-isolated fix.
