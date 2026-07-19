# TERAS UNIVERSAL Website — Developer Documentation

This document is for developers and content maintainers working on the TERAS
UNIVERSAL SDN. BHD. website. It covers project structure, components,
environment variables, deployment and day-to-day content management.

For a feature/module changelog, see `README.md`. This file focuses on "how do
I do X" rather than "what was built when".

## Tech stack

- **Next.js 15** (App Router), **React 19**
- Plain CSS in `app/globals.css` (no CSS-in-JS, no Tailwind, no CSS modules)
- No TypeScript, no ESLint — `npm run lint` runs `scripts/lint.mjs`, a syntax-only
  check (`node --check` on every `.js` file). It does **not** catch JSX errors
  reliably (JSX often parses as a syntactically-valid-but-meaningless comparison
  expression). Always run `npm run build` to validate real changes — the
  Next.js/SWC compiler is the actual correctness check in this project.
- **Resend** for transactional email, a **Google Apps Script Web App** as a
  lightweight CRM (Google Sheets), both used server-side only via API routes.

## Project structure

```
app/                    Next.js App Router pages (one folder per route)
  api/                  Server-only API routes (Resend + Google Sheets, etc.)
  <route>/page.js        Route content
  <route>/layout.js       Route-specific metadata (title/description/OG), where present
  globals.css            All site styling (single file, organised by dated section comments)
  layout.js               Root layout: fonts, global metadata, JSON-LD, <StickyCta>, <Analytics>
  sitemap.js, robots.js   Generated from data/*.js where possible — see "Adding a page" below
components/             Reusable React components (shared across routes)
data/                   Plain JS content arrays/objects — the site's "content layer"
lib/                    Small server/client helpers (e.g. Supabase client factory)
public/                 Static assets: images, logo, downloadable PDFs
scripts/lint.mjs        Syntax-check script used by `npm run lint`
```

### Why content lives in `data/*.js`, not hardcoded in JSX

Nearly every list on the site (courses, FAQ, industries, insights, gallery
images, resources) is a plain exported array in `data/`. Pages `import` and
`.map()` over these. **When adding content, edit the relevant `data/*.js`
file — do not hand-add a new `<article>` block into a page.** This keeps
pages and their styling stable while content changes.

### The "verified-only" content pattern — important

Several `data/*.js` files are **intentionally empty** with a doc-comment
explaining what must be true before an entry is added:

| File | Empty until... |
|---|---|
| `data/certificates.js` | A certificate's participant, dates, course and number are confirmed |
| `data/successStories.js` | A client has approved a testimonial/case study for publication |
| `data/team.js` | A staff member has approved their photo, bio and LinkedIn link for public use |
| `data/partners.js` | A partner organisation has approved its logo being shown |
| `data/awards.js` | An award's issuer, year and title are verified |
| `data/timeline.js` | A milestone (e.g. incorporation date) is verified |
| `data/metrics.js` | A statistic can be substantiated if a client asks |
| `data/media.js` | A news/announcement/event/press item is confirmed |
| `data/careers.js` | A vacancy or internship is formally approved for posting |

**Do not hardcode a number, testimonial, logo, award or headcount directly
into a page.** If it isn't in one of these files yet, it isn't verified. The
corresponding component (`TeamGrid`, `PartnersGrid`, `AwardsList`,
`CorporateTimeline`, `MetricsBlock`, `MediaCentre`, etc.) automatically
hides itself or shows a neutral "not yet published" state when its data
array is empty — you do not need to add any conditional logic on the page
that renders it. Just populate the array and the section activates.

See also `data/companyProfile.js`'s `pendingClaims` array — a documented
backlog of marketing claims ("14+ years", "10,000+ workers trained", etc.)
that must **not** be rendered anywhere until verified. It exists as a
reminder list, not as data to consume.

## Components reference (selected)

| Component | Used on | Notes |
|---|---|---|
| `SiteHeader` / `SiteFooter` | Most routes | Shared header/footer. Prefer these over hand-rolling `<header>`/`<footer>` markup in a new page. |
| `MegaNav` / `MobileNav` | Inside `SiteHeader`, or directly | Single source of truth for nav links — edit `components/MegaNav.js`'s `groups` array (and mirror in `MobileNav.js`) to add a nav destination. |
| `TrainingComparison` | `/training/compare` | Reads `data/courseCatalog.js`. Only shows fields present in that file — never fabricate a course's duration/objectives here. |
| `TeamGrid`, `PartnersGrid`, `AwardsList`, `CorporateTimeline`, `MetricsBlock` | `/about` | See "verified-only" pattern above. |
| `ResourceCentre`, `InsightsCentre`, `MediaCentre`, `FaqCentre` | `/resources`, `/insights`, `/media`, `/faq` | Client components with search + category/type filter (+ pagination on `MediaCentre`). |
| `ContextualCta` | Various | `<ContextualCta variant="proposal" | "advisor" | "whatsapp" | "download-profile" | "register" />` — a standard end-of-page lead-gen banner. Prefer this over writing a new bespoke CTA block. |
| `NewsletterSignup` | Homepage, `/insights`, `/media` | Posts to `/api/newsletter`. |
| `CareersApplicationForm` | `/careers` | Posts to `/api/careers-application`. |
| `ProposalWizard` | `/request-proposal` | The live proposal form (multi-step). `ProposalForm` (single-page) was removed as unused dead code. |

## Environment variables

See `.env.example` for the full list with comments. Summary:

| Variable | Required for | Notes |
|---|---|---|
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | `/api/request-proposal`, `/api/newsletter`, `/api/careers-application` | Server-only. Without these, the forms return a 503 rather than silently failing. |
| `GOOGLE_SHEETS_WEB_APP_URL` | `/api/request-proposal` | Server-only. Must be HTTPS. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_GTM_ID` | Analytics | Optional; GA4 only loads in production when set. |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_VERIFICATION` | SEO | Optional webmaster verification meta tags. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | *(not currently used anywhere)* | `lib/supabase.js` is dormant scaffolding — safe to ignore or wire up when a Supabase-backed feature is actually built. |

All new API routes (`newsletter`, `careers-application`) follow the same
security pattern as `request-proposal`: honeypot field, minimum-time-to-submit
check, request-origin check, per-IP in-memory rate limit (60s), server-side
length caps + HTML-escaping before interpolating into email HTML. If you add
another form/API route, copy this pattern rather than inventing a new one.

Note: the in-memory rate limiter (`Map` at module scope) resets on every
serverless cold start and is not shared across instances — it's a basic
abuse deterrent, not a hard guarantee. If real abuse becomes a problem,
that's the place to add a durable store (e.g. Upstash Redis).

## Deployment

The site deploys to Vercel. `next.config.mjs` sets strict security headers
(HSTS, CSP, X-Frame-Options, Permissions-Policy, etc.) on every route. If you
introduce a new external script, stylesheet, font, iframe or fetch target in
the **browser** (not server-side fetches like Resend/Sheets, which aren't
subject to CSP), you must add its domain to the relevant CSP directive in
`next.config.mjs` or it will be silently blocked in production.

## Content management how-tos

### Add a new training course

1. Add an entry to `courseCatalog` in `data/courseCatalog.js`. Use the
   `STANDARD_DELIVERY_MODE` / `STANDARD_ASSESSMENT` / `STANDARD_COMPLETION`
   constants unless you have course-specific, verified text.
2. If the course needs a fully bespoke page (like `scaffolding-competency`),
   build a static route under `app/training/<slug>/page.js` and set
   `detailPage: "/training/<slug>"` on its catalog entry — this excludes it
   from `app/training/[slug]/generateStaticParams()` so the two routes don't
   collide at build time. Otherwise, omit `detailPage` and the generic
   `app/training/[slug]/page.js` template handles it automatically.
3. Add the course to the relevant industry's `recommendedTraining` array in
   `data/industries.js` if applicable.
4. Add a sitemap entry — `app/sitemap.js` derives course URLs from
   `courseCatalog` automatically, so no manual edit is needed there.

### Add a gallery image

1. Add the optimised image file to `public/images/`.
2. Add a `["Title", "/images/your-file.webp"]` tuple to
   `data/trainingGallery.js`.

### Replace or add a download (brochure, form, guide)

1. Upload the file to `public/downloads/`.
2. Add an entry to `resources` in `data/resources.js` with the correct
   `category` (existing categories: Company Information, Training, Forms,
   Certification, Guides, Corporate Solutions — or introduce a new one, e.g.
   "Brochures" or "Safety Guides", and it will appear in the filter
   automatically once at least one resource uses it).

### Update the company profile / contact details

Edit `data/companyProfile.js`. Note the `pendingClaims` array — move an item
out of it (and into the relevant page copy) only once it is verified and
approved for publication.

### Update the homepage

`app/page.js` is a single large page composed of many `<section>` blocks.
Most sections pull from a small local array at the top of the file (e.g.
`pillars`, `programmes`, `facilities`) — edit those arrays rather than the
JSX below. Section-specific styling lives in `app/globals.css` under a
matching `/* ===== ... ===== */` comment (search for the section's class
name, e.g. `.facilities-grid`, if there's no exact header match).

### Add a new top-level page

1. Create `app/<route>/page.js` (and `layout.js` for metadata, following the
   pattern in `app/careers/layout.js`).
2. Use `<SiteHeader />` / `<SiteFooter />` rather than hand-rolling
   header/footer markup.
3. Add the route to `components/MegaNav.js` (desktop) and
   `components/MobileNav.js` (mobile) if it should appear in navigation.
4. Add it to the `staticRoutes` array in `app/sitemap.js`.

## Known gaps / intentionally deferred (see README "Remaining Recommendations")

- `SiteSearch` and search-adjacent tools index the site's own `data/*.js`
  files directly rather than a full-text/CMS index — sufficient for the
  current content volume, but will need revisiting if content grows
  significantly.
- `TrainingCalendar` uses a small hardcoded demo schedule, not a live booking
  backend.
- The newsletter signup notifies the internal team by email (via Resend) on
  each signup; it is not yet a fully automated double-opt-in mailing list
  (that requires a mailing-list provider or database, which isn't configured
  in this project).
