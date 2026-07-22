# Batch 6 — Lead Generation (Module 26)

## What I found
I checked every content page for whether it gives a visitor a path back into
the enquiry funnel. Four pages had **zero** link to Request Proposal, Contact,
or WhatsApp anywhere on them: **FAQ Centre** (`/faq`), **Training Calendar**
(`/calendar`), **News & Insights** hub (`/insights`), and **Search**
(`/search`). A visitor could read an FAQ answer or browse the calendar and
then have nowhere obvious to go next except the browser back button — a real
lost-lead gap, especially for FAQ and Calendar which attract high-intent
visitors already close to a decision.

## What this adds
A small, reusable call-to-action banner (`components/LeadGenCta.js`) with a
headline, one line of supporting text, and two buttons: **Request
Proposal** and **WhatsApp Us**. It does **not** duplicate or modify the
existing Request Proposal form, the `/api/request-proposal` endpoint, Resend
email sending, or the Google Sheets CRM integration in any way — it's purely
a link into that already-working, already-protected workflow. I deliberately
did not touch `app/api/request-proposal/route.js` or the proposal form
itself, since those are explicitly protected systems.

The banner text is customised per page (e.g. FAQ says "Still have a
question?", Calendar says "Don't see a suitable date?") so it reads as
relevant to that page rather than a generic ad.

## Files changed (6)

### `components/LeadGenCta.js` (new)
The reusable banner component described above.

### `app/faq/page.js`, `app/calendar/page.js`, `app/insights/page.js`, `app/search/page.js`
One import line and one `<LeadGenCta ... />` line added to each, placed at
the end of the page content. Nothing else on any of these 4 pages was
changed — the FAQ accordion, calendar, insights list and search tool all
work exactly as before.

### `app/globals.css`
Styling for the new banner (navy/gold gradient card, matching the site's
existing visual language) — appended to the end of the file.

## What to check after applying
- `/faq`, `/calendar`, `/insights`, `/search` — each should now show a
  navy CTA banner at the bottom with "Request Proposal" and "WhatsApp Us"
  buttons
- Click "Request Proposal" from one of these pages — should go to the
  existing, unchanged `/request-proposal` form
- Confirm the FAQ accordion, calendar, insights list, and search results
  still work exactly as before (this batch only adds content, doesn't
  change any of that)
