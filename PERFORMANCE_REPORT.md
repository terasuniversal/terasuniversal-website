# Performance Review — TERAS UNIVERSAL

Review of rendering performance, Server/Client Component boundaries, database queries, duplicate fetches, image optimization, caching, bundle size, dynamic imports, and React/Next.js/Supabase-specific performance. Method: static review of every data-loading and rendering path in `app/`, `lib/`, `components/`, cross-checked against the **live** connected Supabase project (`iagzkrzeuawaxvacqprk`) for real index coverage and the Supabase performance advisor — not just what the migration files declare. Cross-referenced against `DATABASE_AUDIT.md`, `BUG_REPORT.md`, and `SECURITY_REPORT.md` (same session) where findings overlap. Documentation only — no files were modified.

Severity key: **High** = measurably slow or wasteful on every relevant request today. **Medium** = fine at current data volume, will degrade as data grows, or is a real-but-bounded waste. **Low** = cosmetic/best-practice/opportunity.

---

## 1. Server Components vs. Client Components

Every list/detail page under `app/admin/(protected)/**` is a Server Component that fetches its own data directly (no client-side data fetching, no waterfall through a loading skeleton then a fetch). `"use client"` is used narrowly, on 47 of ~133 `.tsx`/`.js` files under `app/` and `components/` (~35%) — consistently for genuinely interactive widgets (`ImageUpload`, `AssignParticipants`, `AttendanceTable`, `SettingsForm`, `Topbar`'s sign-out/search) rather than wrapping entire pages. No unnecessary `"use client"` boundaries found, and no Server Component was found trying to use browser-only APIs. This is a correctly-applied Server/Client split — no changes recommended here.

## 2. Rendering performance / React performance

No missing `key` props, controlled/uncontrolled input mismatches, or obviously-avoidable re-render patterns were found in the admin form components (`ScheduleForm.tsx`, `ParticipantForm.tsx`, `CompanyForm.tsx`, `TrainerForm.tsx`). None of the client components reviewed do expensive synchronous work in render (no unmemoized heavy computation, no large inline object/array literals recreated every render that would matter — most client components here are simple forms/toggles, not data grids that would benefit from `useMemo`/`React.memo`). React 19 is in use (`package.json`), which removes most of the historical reasons to hand-roll memoization for this class of component. No action needed here.

## 3. Database queries — missing indexes (live-verified)

Direct query against the connected project's `pg_constraint`/`pg_index` (not the migration files — the actual database), cross-confirmed by the Supabase performance advisor (`unindexed_foreign_keys`), found **30+ foreign keys with no covering index**. The ones that matter in practice — i.e. columns the app actually filters/joins on, not just `created_by`/`updated_by` audit trails:

- `attendance.schedule_id → course_schedules(id)` (`ON DELETE CASCADE`) — attendance is looked up by schedule constantly.
- `assessments.schedule_id`, `assessments.participant_id` — same pattern; both are hot join/filter columns for assessment and certificate-eligibility flows.
- `media.folder_id`, `downloads.media_id`, `gallery_images.media_id` / `category_id`, `news_posts.category_id` / `author_id`, `faqs.category_id` — every taxonomy/media join in the CMS content modules.
- The remaining ~15 are `created_by`/`updated_by → profiles(id)` on nearly every table — lower priority, rarely filtered on, but still flagged.

Not causing a slow query *today* (only `courses`, at 125 rows, has meaningful live data), but every FK-based lookup on these columns currently forces a sequential scan, and this will bite the moment `attendance`/`assessments`/`participants` accumulate real rows. *(High — structural, not urgent yet, but should land before production volume.)*

## 4. Database queries — N+1 and unbounded fetches

- **N+1 in bulk certificate generation** (`app/admin/(protected)/certificates/actions.ts`, `bulkGenerate`): calls `generateCertificate()` once per eligible participant in a sequential loop; each call independently re-runs the role guard, an eligibility select, an existing-certificate select, an insert, and a follow-up update — ~5 round-trips per participant, unbatched. A 50-participant schedule is ~250 sequential Supabase calls for one click. *(Medium — restated from `BUG_REPORT.md` §11.)*
- **Unbounded duplicate-check fetch on every CSV import preview** (`app/admin/(protected)/participants/import/importActions.ts:46`): `supabase.from("participants").select("ic_passport_no").is("deleted_at", null).limit(100000)` loads every non-deleted participant's IC number into memory to build a JS `Set`, on every `analyzeImport` call — and `commitImport` calls `analyzeImport` again to re-validate (correct for safety, doubles this cost). Free today at low row counts; becomes a full-column scan on every import action at scale. Should be a targeted `WHERE ic_passport_no = ANY($batch_ics)` query instead. *(High)*
- **Certificates API route has no pagination**: `app/api/admin/certificates/route.js:42` (`GET`) does `select("*").order(...)` with no `.range()`/`.limit()` — harmless at 0 live rows, unbounded once this table has real data. *(Medium)*

## 5. Duplicate fetches

**Trainer profile page's "parallel" queries are accidentally serialized, and one duplicates a fetch already made** (`app/admin/(protected)/trainers/[id]/page.tsx:28-31`):
```js
const [{ data: schedules }, { count: upcomingCount }, { count: certsCount }] = await Promise.all([
  supabase.from("training_schedules").select("id, schedule_id, course_name, start_date, end_date, status").eq("trainer_id", id)...limit(20),
  supabase.from("training_schedules").select("*", { count: "exact", head: true }).eq("trainer_id", id)...,
  supabase.from("certificates").select("*", { count: "exact", head: true }).is("deleted_at", null)
    .in("schedule_id", (await supabase.from("training_schedules").select("id").eq("trainer_id", id)).data?.map((s: any) => s.id) ?? [...]),
]);
```
Two stacked problems in the third array element:
- **It duplicates the first query** — both element 1 and the nested fetch inside element 3 pull `training_schedules` filtered by the same `trainer_id`; element 1 already has every schedule `id` this trainer has (just with more columns and a 20-row cap).
- **It breaks the parallelism `Promise.all` is there for.** JavaScript evaluates array elements left-to-right *before* `Promise.all` is called. Because the third element contains a nested `await`, constructing the array itself blocks on that inner fetch completing — so elements 1 and 2 don't get their `.then()` invoked (the point at which supabase-js actually fires the HTTP request) until after the nested query resolves. What reads as "3 queries in parallel" is actually **1 query, then 3 more after it** — 4 round-trips where 2 would do. *(High — concrete, easy fix: reuse `schedules` for the `in()` filter and hoist the nested `await` out of the array literal.)*

**Protected-layout badge counts run on every single admin navigation**: `app/admin/(protected)/layout.tsx:18-29` runs 2 `head:true` count queries (pending certificates, active participants) on every request to any page under `(protected)`, since nothing here is cached and the whole admin area is `force-dynamic` by design. Individually cheap, but it's 2 extra round-trips stacked on every admin page view. *(Low)*

## 6. Caching

The public site's caching is centralized and correctly TTL'd: `lib/public-content.ts` wraps all six public data-loading helpers in `unstable_cache` with a 60-second `revalidate` and per-entity `tags`, exactly as `CLAUDE.md` documents. All 48 pages under `app/admin/(protected)/**` are `export const dynamic = "force-dynamic"` — correct for an operational admin CMS where staff need to see their own writes immediately, not a defect.

Two caveats:
- **Caching correctness is only as good as the query underneath it.** `getUpcomingSchedules()` is wrapped in the same `unstable_cache` pattern but queries a table (`schedules`) that doesn't exist in either live schema track (`DATABASE_AUDIT.md` §9) — today this cache is faithfully caching an empty result for 60 seconds, and will remain true after a schema fix unless the query itself is also corrected. *(Medium)*
- **No `revalidateTag` call sites were confirmed paired with every mutation that should invalidate the public cache.** `CLAUDE.md` documents the intended pattern; given most admin mutations don't currently reach the database at all (schema mismatch, see `DATABASE_AUDIT.md`), this wasn't independently exercised end-to-end. Worth re-checking once the schema is consolidated that every course/news/gallery/faq/downloads/company-profile mutation actually fires `revalidateTag` for its tag, rather than relying on the 60s TTL to eventually catch up. *(Low)*

## 7. Bundle size

**`pdfjs-dist` and `tesseract.js` — two large libraries — are pulled in by a module that is never imported anywhere in the app.** `lib/bulkCertificates.js` imports `pdfjs-dist/build/pdf.mjs` and `tesseract.js`'s `createWorker` (an OCR engine shipping multi-megabyte WASM/worker assets), and contains browser-only code (`document.createElement("canvas")`), so it's clearly meant to run client-side. A repo-wide search for imports of this module or its exports (`bulkCertificates`, `parseCertificateText`, `extractPdfText`, `ocrPdf`) found **zero references** anywhere under `app/` or `components/`. As it stands, unused code isn't bundled, so this costs nothing at runtime today — but it's dead weight in `package.json`/install size, and a trap for whoever eventually wires it up expecting it to be lightweight (it isn't). *(Medium — also flagged as dead code in `BUG_REPORT.md`.)*

No `@next/bundle-analyzer` (or equivalent) is configured in `package.json`/`next.config.mjs`. Worth adding given the app already has one large, easy-to-miss dependency situation (above) that an analyzer would have caught immediately. *(Low)*

## 8. Dynamic imports

**Zero uses of `next/dynamic` (or bare dynamic `import()`) found anywhere in `app/` or `components/`.** Every component is statically imported. This is not a defect by itself — most of the admin UI is small, server-rendered, and doesn't need code-splitting — but it means the two heaviest client-side surfaces in the codebase have no opportunity taken to isolate their cost:
- `components/admin/CertificateDocument.tsx` and `app/admin/cert-pdf/[id]/page.tsx` (certificate rendering/print flow) — not currently large, but this is exactly the kind of print/PDF-adjacent, not-every-page-needs-it component `next/dynamic(..., { ssr: false })` exists for, especially if certificate template rendering grows to need a canvas/PDF library client-side.
- If `lib/bulkCertificates.js` (§7) is ever wired up, it should be loaded via `next/dynamic` with `ssr: false`, not a static import — `tesseract.js`/`pdfjs-dist` have no business being in a page's initial JS payload regardless of which page ends up using them.

*(Low today, becomes Medium the moment either of the above is built out.)*

## 9. Image optimization

**`next/image` is configured with no `remotePatterns`, so it cannot be used for any Supabase Storage or externally-hosted image — forcing raw `<img>` everywhere media is actually displayed.** `next.config.mjs`'s `images` config only sets `formats: ["image/avif", "image/webp"]`; no `domains`/`remotePatterns`. `next/image` refuses to optimize any image whose host isn't explicitly allow-listed. This is very likely *why* 8 files fall back to plain `<img>`: `components/admin/Sidebar.tsx`, `components/admin/ImageUpload.tsx`, `components/admin/CertificateDocument.tsx`, `app/admin/(protected)/media/page.tsx`, `app/admin/login/page.tsx`, `app/admin/reset-password/page.tsx`, `app/admin/(protected)/trainers/[id]/page.tsx`, `app/verify/VerificationResult.tsx`. The public site (25 files) consistently uses `next/image` — but only because its images are local static assets under `/public`, not Storage-hosted. Once Storage is actually provisioned (`SECURITY_REPORT.md` §8 confirms it isn't live yet) and admin-uploaded images start rendering at any volume, none of them will get automatic resizing/format-conversion/lazy-loading. *(Medium — add a `remotePatterns` entry for the Supabase project's storage host.)*

`ImageUpload.tsx` uploads originals with no client-side resize/compression — up to the full 5 MB limit, stored and later served at that resolution regardless of where it's displayed. Compounds with the above: even once `next/image` is wired up for Storage URLs, it can only pick an appropriately-sized *output*; the *stored* original is still whatever the uploader's camera produced. *(Low)*

## 10. Supabase performance

- §3/§4 above (missing indexes, N+1, unbounded selects) are the Supabase-specific findings; restated here for completeness under this heading rather than duplicated in full.
- **Dashboard fires 8 independent round-trips on every load** (`app/admin/(protected)/dashboard/page.tsx:17-35`), correctly parallelized via a genuine `Promise.all` (no blocking issue, contrast with §5) but still 8 separate network calls to Supabase per view, on a `force-dynamic` page with no caching. Each is individually cheap (`head:true` counts or `limit(6)` selects). Not wrong, but a candidate for consolidation into 1-2 Postgres views/RPCs — the numbered migration lineage's `v_*` reporting views (`DATABASE_AUDIT.md`) were designed for exactly this; none are live yet. *(Low)*
- All Supabase clients in this codebase go through the anon-key server/browser clients (`RLS`-bound) except the unused `createSupabaseServiceClient()` (`SECURITY_REPORT.md` §16) — no performance concern from service-role bypass patterns since that path isn't exercised anywhere.

## 11. Next.js performance (general)

- Security headers (`next.config.mjs`) apply to every route via a single `source: "/(.*)"` matcher — negligible overhead, not a performance concern, but worth knowing it's evaluated on every request including static assets under `/public` unless Next's static-file serving bypasses the headers function (it does, for truly static files served by the CDN layer on Vercel; this only matters for anything actually routed through the Next.js server).
- No `next/font` usage was checked in depth as part of this pass; if custom fonts are loaded via `<link>`/CSS `@import` rather than `next/font`, that's a common source of layout shift and un-optimized font loading worth a follow-up look — out of scope for this review's evidence base.
- Metadata/`generateMetadata` usage on public pages (course pages, insights, FAQ) is present and correctly scoped per-page — no findings here.

---

## Summary

Two items are concrete, fixable-today code changes with a clear before/after: **§4's unbounded IC-dedup fetch** and **§5's accidentally-serialized `Promise.all` on the trainer page** (which also happens to duplicate a query). **§3 (missing indexes)** and **§9 (`next/image` remote patterns)** are the two structural gaps worth planning for before this system carries real production volume or Storage goes live, respectively. Everything else — §1, §2, §6, §11 — is either already good practice worth confirming stays that way, or low-priority cleanup (§7, §8, §10's dashboard consolidation).
