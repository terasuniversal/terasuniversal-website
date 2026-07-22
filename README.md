# TERAS UNIVERSAL SDN. BHD. — Website

Production site: [www.terasuniversal.com.my](https://www.terasuniversal.com.my)
Stack: Next.js (App Router) · React · Supabase (admin CMS) · Resend (email) ·
Google Sheets (CRM lead forwarding) · Vercel (hosting)

> Everything below "## Developer Guide" onward, down to "## Phase 1 Website",
> is a running historical changelog of every update made to this site,
> oldest section last. It has been kept as-is — nothing here was removed —
> so it remains a useful record of what changed and why. This section at the
> top is a consolidated reference for anyone (developer, freelancer, or
> future Claude/AI session) picking up this codebase for the first time.

## Developer Guide (Module 40)

### Getting started

```bash
npm install
cp .env.example .env.local   # fill in the values you have — see below
npm run dev                  # http://localhost:3000
```

```bash
npm run build      # production build (this is the real gate — must pass before every deploy)
npm run start       # run the production build locally
npm run lint         # syntax check across all .js files
npm run typecheck   # TypeScript type-check (tsc --noEmit) — optional, added in Module 39
```

### Project structure

- `app/` — Next.js App Router. Public marketing/informational pages are
  `.js` (e.g. `app/training/page.js`); the admin CMS under `app/admin/` is
  `.tsx`/`.ts` (TypeScript, Supabase-backed).
- `app/api/` — server-only route handlers: `request-proposal`, `newsletter`,
  and `admin/*` (login, reset-password, certificates).
- `components/` — shared React components used across pages (`MegaNav`,
  `MobileNav`, `TrainingComparison`, `NewsletterSignup`, `LeadGenCta`, etc.).
- `data/` — plain JS data modules that back most public content
  (`companyProfile.js`, `courseCatalog.js`, `industries.js`, `faq.js`, etc.).
  These are the easiest place to update text/content without touching page
  markup.
- `lib/` — shared server logic: `lib/supabase/` (server/browser/middleware
  Supabase clients — see the `<Database>` generic note below), `lib/auth/`
  (admin session/role checks), `lib/certificates.js` (certificate lookup),
  `lib/successMetrics.js` (Module 24's computed trust metrics).
- `public/` — static assets. `public/images/` holds the AI-generated
  placeholder photography (`temp-ai-*`) used across the site until real
  photography is supplied.
- `scripts/` — `lint.mjs` (syntax check) and `typecheck.mjs` (TypeScript
  check, Module 39).
- `supabase/` — SQL schema/migrations for the certificate verification
  system.

### Environment variables

Copy `.env.example` to `.env.local` for local dev, and set the same values
in Vercel → Project Settings → Environment Variables for Production
(and Preview if you use preview deployments).

| Variable | Required for | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | Request Proposal, Contact, Newsletter | Server-only. Never prefix with `NEXT_PUBLIC_`. |
| `RESEND_FROM_EMAIL` | Request Proposal, Contact, Newsletter | Sending domain must be verified in Resend. |
| `RESEND_AUDIENCE_ID` | Newsletter (Module 27) | Create an Audience in the Resend dashboard first — see Batch 7 notes if you have them, or just create one under Resend → Audiences and paste its ID here. |
| `GOOGLE_SHEETS_WEB_APP_URL` | Request Proposal CRM forwarding | Apps Script Web App URL; must return `{"success":true}`. Server-only. |
| `NEXT_PUBLIC_SUPABASE_URL` | Admin CMS, Certificate Verification | Public — safe to expose to the browser. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Admin CMS, Certificate Verification | Public anon/publishable key — safe to expose. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin CMS server actions | Server-only. Full database access — never expose to the browser or commit it. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Analytics | Optional; GA4 doesn't load if blank. |
| `NEXT_PUBLIC_GTM_ID` | Analytics | Optional. |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | SEO | Optional webmaster verification meta tag. |
| `NEXT_PUBLIC_BING_VERIFICATION` | SEO | Optional webmaster verification meta tag. |

### Key integrations at a glance

- **Request Proposal / Contact** (`app/api/request-proposal/route.js`):
  validates + sanitises input server-side, sends via Resend (internal
  notification + requester confirmation), then forwards the lead to Google
  Sheets via an Apps Script Web App. Rate-limited per IP, honeypot + timing
  anti-spam. Both Resend and Sheets must succeed for the request to count as
  successful.
- **Newsletter** (`app/api/newsletter/route.js`, Module 27): adds an email
  to a Resend Audience. Same anti-spam pattern as above. Requires
  `RESEND_AUDIENCE_ID` to be configured — returns a clear "not configured"
  error otherwise rather than failing silently.
- **Admin CMS** (`app/admin/`): Supabase-backed, gated by `middleware.ts` +
  `lib/auth/session.ts`. Every `supabase.from("table")` call in `.ts`/`.tsx`
  files is cast `as any`/`as never` where needed — see the note below, this
  is required, not a code smell.
- **Certificate Verification** (`/verify`, `/admin/certificates`): public
  lookup by certificate/IC number, backed by Supabase with RLS. See the
  "Certificate Verification Database" section further down this file for
  the one-time Supabase setup steps.

### A TypeScript quirk you'll hit if you touch Supabase calls

`lib/supabase/server.ts` and `lib/supabase/middleware.ts` create the
Supabase client with a `<Database>` generic (`createServerClient<Database>(...)`).
Without it, every table reference resolves to `never`, and — unlike most
other types — TypeScript does **not** allow assigning `any` to a
`never`-typed parameter. That's why you'll see patterns like
`(supabase.from("courses") as any).insert(...)` and
`supabase.rpc("name" as never, {...} as never)` throughout the admin code —
this isn't a workaround to "fix" by removing the cast; removing it will
break the build. If you add a **new** table/RPC call, follow the same
pattern.

### What's been added since the original build (Modules 21–39)

This site has gone through a large content/feature pass covering: Training
Comparison tool, Corporate Solutions industry pages (`/industries`), a
verified Success Metrics section, a rebuilt Resources Centre, lead-gen CTAs
on FAQ/Calendar/Insights/Search, Newsletter signup, verified Training
Facilities & Participant Support content, Strategic Partners, an expanded
Corporate FAQ, a performance cleanup (13MB of unused images removed), a
sitewide skip-to-content accessibility link, rate limiting on the admin
password reset endpoint, a `security.txt`, and this developer guide. Every
piece of company/course/client content added during this pass was checked
against the official TERAS UNIVERSAL Corporate Profile 2026 and Training
Course Catalogue 2026 documents — nothing was published that isn't stated
in one of those two sources.

---

## Phase 1 Website

This update includes:

- New official logo and blue/gold corporate branding
- Favicon and Apple touch icon
- Professional SEO metadata
- Open Graph and social sharing images
- robots.txt and sitemap.xml
- Google Maps location embed
- Responsive contact enquiry form
- Floating WhatsApp button
- Professional footer with office address
- Loading screen and responsive/mobile optimisation
- Next.js image optimisation

## Upload to GitHub

Upload the CONTENTS of this folder to the root of the existing
`terasuniversal-website` repository.

Required root structure:

- app/
- components/
- public/
- package.json
- next.config.mjs
- README.md

Commit message:
`Complete Phase 1 website improvements`

Vercel will automatically deploy the update.

## Current website modules

The site includes corporate pages, training finder, course detail pages,
request proposal workflow, Google Sheets CRM forwarding, Resend email delivery,
training calendar, resources, FAQ centre, insights, gallery, stories, search,
analytics hooks and certificate verification.


## Mobile responsiveness fix

This version includes:
- explicit mobile viewport settings
- horizontal overflow prevention
- stacked hero layout below 590px
- automatic logo resizing
- single-column mobile cards and forms
- narrower mobile container spacing
- responsive Google Maps and footer


## Phase 2 premium upgrade

This update adds:
- larger corporate header logo
- mobile hamburger navigation
- premium hero visual without repeating the logo
- expanded training programme section
- corporate value section
- four-step delivery approach
- premium corporate CTA
- refined WhatsApp button placement
- improved desktop and mobile layouts

No unverified client logos, testimonials or numerical claims have been included.


## Safari iPhone and desktop optimisation patch

This patch:
- removes the decorative premium hero visual on phones
- prevents Safari from reserving a large invisible hero area
- reduces mobile hero bottom spacing
- balances desktop and laptop hero proportions
- enlarges the desktop header logo
- tidies the three floating desktop cards


## Desktop right-column alignment fix

This patch:
- removes overlapping absolute-positioned cards on desktop
- places the three cards in a clean row at the bottom
- keeps the text and badges within the visual panel
- improves laptop and desktop spacing

## Analytics and webmaster verification

The site includes an optional production-only GA4 integration and environment-driven verification metadata. Copy `.env.example` to `.env.local` for local configuration, or add these values to the production deployment environment:

```env
NEXT_PUBLIC_GA_MEASUREMENT_ID=
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=
NEXT_PUBLIC_BING_VERIFICATION=
NEXT_PUBLIC_GTM_ID=
```

GA4 does not load during development or when the measurement ID is blank. Page views are sent on App Router path changes. The analytics component also honours `window.__TERAS_ANALYTICS_CONSENT__ = false` and can listen to a future consent implementation without changing page layouts.

## Request Proposal email delivery

The `/request-proposal` form sends submissions through the server-only route
`/api/request-proposal`. It uses Resend to send an internal notification to
`training@terasuniversal.com.my` and a confirmation email to the requester.

The route validates and sanitises fields server-side, uses a honeypot and
minimum completion time for basic spam protection, applies a lightweight
per-IP rate limit, and redirects to `/request-proposal/success` only after
both emails are accepted by Resend and the Google Sheets CRM confirms a
successful write. No private API credentials are exposed to the browser.

### Required Vercel environment variables

In Vercel Project Settings → Environment Variables, add these for Production
(and Preview if needed):

```env
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=TERAS UNIVERSAL <noreply@terasuniversal.com.my>
```

The sending domain must be verified in Resend. Keep `RESEND_API_KEY` server-only:
do not prefix it with `NEXT_PUBLIC_` and do not commit it to Git.

## Google Sheets CRM delivery

Successful proposal submissions are also forwarded server-side to the Google Apps
Script Web App that writes to the `Training Leads` sheet. The route maps the form
fields to the Apps Script schema, sets `status` to `New`, and sends an ISO timestamp
in `submitted`. The request is considered successful only when both Resend and
Google Sheets return success. If the emails are sent but the CRM write fails, the
API returns an error so the failure can be investigated rather than being hidden.

Add this server-only Vercel environment variable for Production (and Preview if
needed):

```env
GOOGLE_SHEETS_WEB_APP_URL=https://script.google.com/macros/s/your-deployment-id/exec
```

The Apps Script endpoint should be deployed as a Web App, accept unauthenticated
JSON POST requests as configured for the project, and return a JSON response with
`{"success":true}` after appending the lead. Do not expose this URL through a
`NEXT_PUBLIC_` variable, and do not commit private credentials or API keys.

## Certificate Verification Database

The certificate workflow is available at `/verify` and `/admin/certificates`.

1. Run `supabase/certificates.sql` in the Supabase SQL Editor.
2. Create an Email/Password admin in Supabase Auth.
3. Insert the admin user UUID into `admin_users` using the SQL comment at the bottom of the schema file.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` and Vercel.

The public page can search by certificate number or IC/passport number. Public access is restricted by RLS to records marked for public verification; admin CRUD requires membership in `admin_users`. Certificate files are stored as URLs so they can point to Supabase Storage or an approved document location.
