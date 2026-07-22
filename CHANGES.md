# Batch 7 — Newsletter (Module 27)

## Important — one new setup step required
This is the first batch that needs a **new environment variable** to fully
work: `RESEND_AUDIENCE_ID`. Everything else reuses your existing Resend
account (same `RESEND_API_KEY` already used for Request Proposal / Contact
emails) — no new vendor, no new service.

**Before this feature works, you need to:**
1. Log into your Resend dashboard (resend.com) → **Audiences** tab.
2. Create a new Audience (e.g. name it "Website Newsletter").
3. Copy its Audience ID.
4. In Vercel → your project → Settings → Environment Variables, add:
   `RESEND_AUDIENCE_ID` = *(the ID you copied)*
5. Redeploy (or it will pick up automatically on the next deploy).

**Until you do this**, the newsletter form will show a clear error
("Newsletter service is not configured...") instead of failing silently or
losing signups — same safe pattern already used elsewhere in this codebase
for missing configuration.

I could not test an actual subscription end-to-end myself (no access to your
Resend account or a way to run the site from my side), so please submit one
real test email after deploying and check it appears in your Resend Audience.

## What this adds
- A newsletter signup form (`components/NewsletterSignup.js`) — email field,
  required consent checkbox, honeypot + timing anti-spam (same pattern as
  the Request Proposal form), success/error states.
- A new API route (`app/api/newsletter/route.js`) that validates the
  submission and adds the email to your Resend Audience via
  `resend.contacts.create()`. Rate-limited per IP (30 seconds between
  attempts) to prevent abuse.
- A "Stay Informed" section on the **homepage** (between Contact and the
  footer) and a matching signup block on the **News & Insights** page
  (`/insights`) — the two pages where a newsletter signup makes the most
  sense.

Nothing about the existing Request Proposal workflow, Resend transactional
emails, or Google Sheets CRM was touched — this is a fully separate,
additive feature using the same Resend account.

## Files changed (5)

### `app/api/newsletter/route.js` (new)
The subscription endpoint, described above.

### `components/NewsletterSignup.js` (new)
The client-side form component.

### `app/page.js`
Added one new "Stay Informed" section between the Contact section and the
footer, plus the import for `NewsletterSignup`. Nothing else on the
homepage changed.

### `app/insights/page.js`
Added a newsletter block between the insights list and the lead-gen CTA
banner (from Batch 6), plus the import.

### `app/globals.css`
Styling for the form, consent checkbox and success/error states — appended
to the end of the file.

## What to check after applying
- Set up `RESEND_AUDIENCE_ID` in Vercel first (see above), otherwise the
  form will correctly show a "not configured" error — that's expected until
  you set it
- Homepage — scroll to "Stay Informed" section (just above the footer)
- `/insights` — scroll to the newsletter block
- Submit a real test email on either form and confirm it appears in your
  Resend dashboard → Audiences → (your audience)
- Try submitting an invalid email or without checking consent — should show
  a clear inline error, not a crash
