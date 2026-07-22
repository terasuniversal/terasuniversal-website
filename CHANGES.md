# Batch 5 — Resource Centre (Module 25)

## What changed and why
The existing `/resources` page had a real gap: it had no header, navigation
menu or footer at all — just a bare list of 4 links floating on the page.
A visitor landing there (e.g. from a search engine) had no way to navigate
anywhere else on the site without hitting the back button. This directly
affects professional appearance, UX and lead-gen (a dead-end page loses
visitors).

This batch fixes that and turns it into an actual "Resource Centre" hub:
- Added the same header (logo + full navigation menu) and footer used
  everywhere else on the site.
- Reorganised resources into 3 clear categories: **Company Information**
  (Company Profile PDF, About page, Industries — including the new
  `/industries` hub from Batch 3), **Training Information** (Course
  Catalogue, Training Calendar, FAQ Centre, Certificate Verification), and
  **Corporate Engagement** (Request Proposal, Contact).
- Added a closing call-to-action strip (Request Proposal / WhatsApp), matching
  the pattern used on other pages.

Every link on this page goes to a route that already exists and already
works (`/about`, `/industries`, `/training`, `/calendar`, `/faq`, `/verify`,
`/request-proposal`, `/contact`, and the existing Company Profile PDF) — no
new pages, no new downloads, nothing invented. This is a pure reorganisation
and navigation fix.

## Files changed (2)

### `app/resources/page.js`
Rewritten from a bare 12-line page into a full page with header, categorised
resource sections, and footer — following the exact same structural pattern
already used on `/services`, `/about` and other pages in this codebase (same
`MegaNav`/`MobileNav` header, same footer markup). The original 4 resource
cards are preserved (Company Profile, Course Catalogue, Training Calendar,
Corporate Enquiry Form) — just regrouped, with 5 more added (About, Industries,
FAQ, Verify Certificate, Contact) that all point to pages that were already
live but not linked from here before.

### `app/globals.css`
Small styling additions for the new hero and grouped-section spacing —
appended to the end of the file. Reuses the site's existing `.resource-grid`
/ `.resource-card` / `.utility-lead` styles, so visually it matches what was
already there.

## What to check after applying
- `/resources` — should now show the full site header/nav at top and footer
  at bottom (previously missing entirely)
- 3 grouped sections should render: Company Information, Training
  Information, Corporate Engagement
- Click through a few links (About, Industries, FAQ, Verify Certificate) to
  confirm they go to the right existing pages
- Company Profile PDF download should still work exactly as before
