# TERAS UNIVERSAL — Phase 1 Website

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

## Contact form behaviour

The form works without any paid service or API key. On submission it opens the
visitor's default email application with the enquiry already addressed to:

training@terasuniversal.com.my

A future upgrade can submit directly in the background using Formspree, Resend
or another email API.


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
```

GA4 does not load during development or when the measurement ID is blank. Page views are sent on App Router path changes. The analytics component also honours `window.__TERAS_ANALYTICS_CONSENT__ = false` and can listen to a future consent implementation without changing page layouts.

## Request Proposal email delivery

The `/request-proposal` form sends submissions through the server-only route
`/api/request-proposal`. It uses Resend to send an internal notification to
`training@terasuniversal.com.my` and a confirmation email to the requester.

The route validates and sanitises fields server-side, uses a honeypot and
minimum completion time for basic spam protection, applies a lightweight
per-IP rate limit, and redirects to `/request-proposal/success` only after
both emails are accepted by Resend. No database is used.

### Required Vercel environment variables

In Vercel Project Settings → Environment Variables, add these for Production
(and Preview if needed):

```env
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=TERAS UNIVERSAL <noreply@terasuniversal.com.my>
```

The sending domain must be verified in Resend. Keep `RESEND_API_KEY` server-only:
do not prefix it with `NEXT_PUBLIC_` and do not commit it to Git.
