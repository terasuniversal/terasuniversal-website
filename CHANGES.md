# Batch 13 — Security (Module 38)

## What I checked
Reviewed the codebase for common web security gaps: security response
headers, environment variable handling, admin authentication gating, cookie
handling, and every API route's abuse protection.

**Already solid (no changes needed):**
- `next.config.js` already sets HSTS, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy, Permissions-Policy and a Content-Security-Policy on every
  route
- `.env` / `.env.local` are correctly gitignored; `.env.example` only lists
  variable names, no real secrets
- `/admin/**` routes are gated by `middleware.ts` via Supabase session checks
  — unauthenticated visitors are redirected to login
- Supabase auth cookies are handled through `@supabase/ssr`'s standard
  pattern (secure cookie flags are Supabase's own defaults, not something
  this codebase overrides)
- Request Proposal and Newsletter API routes already have per-IP rate
  limiting and honeypot/timing anti-spam

**One real gap found and fixed:** the admin password reset endpoint
(`/api/admin/reset-password`) is intentionally public — a locked-out admin
can't be logged in to reset their own password — but unlike every other
public-facing endpoint in this codebase, it had **no rate limiting at all**.
Anyone could hit it repeatedly to flood an admin's inbox with reset emails.

## What this adds

### `app/api/admin/reset-password/route.js`
Added the same per-IP throttling pattern already used in
`request-proposal`/`newsletter` (max 1 request per IP per 60 seconds). No
behaviour change for legitimate use — an admin resetting their own password
will never hit this limit in normal use.

### `public/.well-known/security.txt` (new)
Added a standard `security.txt` file (RFC 9116) at
`/.well-known/security.txt` — this tells security researchers how to
responsibly report a vulnerability they find (contact email/phone), which
is considered basic security hygiene for any business website and costs
nothing to add.

## Two recommendations (not changed — outside what I can safely verify)
- **Dependency audit**: I can't run `npm audit` from my side (no registry
  access). Worth running `npm audit` yourself occasionally to catch any
  known-vulnerable package versions.
- **Certificate verification page** (`/verify/[certificateNo]`) has no rate
  limiting on certificate number lookups — someone could try many numbers
  in sequence. It's already excluded from search engine indexing
  (`robots: noindex`), which limits casual discovery, but if you ever notice
  unusual traffic patterns there, rate limiting that route would be a
  sensible follow-up (I didn't want to add throttling to a page real
  visitors use to verify legitimate certificates without being able to test
  it doesn't cause false lockouts).

## Files changed (1) + 1 new file

### `app/api/admin/reset-password/route.js`
Added per-IP rate limiting (60-second window).

### `public/.well-known/security.txt` (new)
Standard responsible-disclosure contact file.

## What to check after applying
- `/admin/login` → "Forgot password" flow should still work normally on
  first attempt
- Submitting the reset form twice within 60 seconds should show "Sila
  tunggu seminit sebelum cuba lagi." instead of sending a second email
- Visit `https://www.terasuniversal.com.my/.well-known/security.txt` after
  deploying — should display the contact info as plain text
