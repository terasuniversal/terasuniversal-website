# Batch 18 — Course Schema.org + Missing Footer Fix

## What this adds

### 1. Course structured data (`app/training/[slug]/page.js`)
Every individual course page (e.g. `/training/working-at-height`,
`/training/basic-scaffolder-level-1`) now includes `Course` JSON-LD
structured data — this is what allows Google to potentially show richer
search results for course pages (provider name, course title, etc).

Only real, verified fields are used: course title, summary, and the
TERAS UNIVERSAL organisation as provider. Where a course's duration is
in an unambiguous "N Days" format (verified from the Training Course
Catalogue 2026), it's also converted to the ISO 8601 format Google
requires (e.g. "10 Days" → "P10D"). For courses whose duration is listed
as "to be confirmed based on scope", nothing is added for duration —
we never guess at or invent a number.

### 2. Missing footer on course detail pages (found while working on this)
While adding the schema, I found that `app/training/[slug]/page.js` — the
page every individual course link on the site points to — had **no footer
at all**. It wasn't part of the 13-file footer inconsistency fixed in
Batch 16 because it didn't have a footer to be inconsistent; it simply had
none. A visitor reading a course page and scrolling down would hit a dead
end with no contact details, no site links, nothing.

This is now fixed: `<Footer />` (the same shared component from Batch 16)
has been added to the end of this page, matching every other page on the
site.

## Files changed (1)

### `app/training/[slug]/page.js`
- Added `Course` JSON-LD schema
- Added `<Footer />` before the closing `</main>`

## What to check after applying
- Visit any course page (e.g. `/training/working-at-height`) — the footer
  should now appear at the bottom, matching the rest of the site
- View page source on a course page and confirm a
  `<script type="application/ld+json">` block with `"@type": "Course"`
  is present
- Optional: paste a course URL into Google's Rich Results Test
  (search.google.com/test/rich-results) to confirm it's recognised
