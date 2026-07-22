# Batch 3 — Corporate Solutions / Industry Landing Pages (Module 23)

## Source
Sector names, and every named client shown on an industry page, are taken
directly from the official "TERAS UNIVERSAL Corporate Profile 2026" PDF —
Section "Sectors Served" and Section "Valued Clients". Nothing was invented.

## What this adds
A dedicated landing page for each of the 8 industries TERAS UNIVERSAL already
listed on the homepage (`/industries/oil-gas`, `/industries/construction`,
`/industries/petrochemical`, `/industries/power-utilities`,
`/industries/manufacturing`, `/industries/marine-offshore`,
`/industries/heavy-industry`, `/industries/government-glc`), plus an overview
hub at `/industries`. Each page shows: a short sector-focused introduction,
the training programmes most relevant to that sector (linking to real,
already-published `/training/...` pages), and — only for the 3 sectors that
have a verified named client list in the Corporate Profile (Oil & Gas,
Construction, Manufacturing, plus Government & GLC) — a "Trusted across
[sector]" strip listing those real client names. Sectors without a verified
client list (Petrochemical, Power & Utilities, Marine & Offshore, Heavy
Industry) simply don't show that section — no placeholder or invented names.

This is a standard B2B lead-generation pattern (dedicated industry pages so a
prospect searching "scaffolding training oil and gas Malaysia" lands on
something specific to them, not a generic homepage) and directly supports
credibility and lead-gen without adding anything unverified.

## Files changed (6)

### `data/industries.js` (new)
Single source of truth for all 8 industries: name, one-line summary, longer
"sector focus" paragraph, which training programmes are relevant (referencing
real slugs already in `data/courseCatalog.js`), and verified client names
(empty array where none are verified — the page hides that section
automatically).

### `app/industries/page.js` (new)
Hub page listing all 8 industries as clickable cards linking to their
dedicated page.

### `app/industries/[slug]/page.js` (new)
The individual industry landing page template — same structural pattern as
the existing `/training/[slug]` course page template, so it fits the site's
existing conventions (breadcrumb, hero, content sections, final CTA, same
header/footer).

### `app/page.js` (homepage — small, targeted change)
The homepage already had an "Industries We Serve" section with 8 cards
(`#industries`), but they were plain text, not links. Two changes:
1. The hardcoded `industries` array (8 strings) is replaced with an import
   from the new `data/industries.js`, so there's one source of truth instead
   of two lists that could drift out of sync.
2. Each card is now an `<a>` linking to its `/industries/[slug]` page instead
   of a static `<article>`. Visual appearance is preserved exactly (same
   gradient card, same hover-lift), just now clickable.
Nothing else on the homepage was touched.

### `components/MegaNav.js` (small, targeted change)
The "Industries" nav dropdown already existed but every link pointed to the
same homepage anchor (`/#industries`). Updated so "Oil & Gas", "Construction",
"Manufacturing" and "Government & GLC" now link to their real dedicated
pages, and added an "All Industries" link to the new `/industries` hub.
Labels are unchanged — only the destination URLs improved.

### `app/globals.css`
Styling for the new hub grid, industry landing page hero/sections, and the
homepage's now-clickable industry cards — appended to the end of the file.
Nothing existing was changed or removed.

## What to check after applying
- `/industries` — hub page renders all 8 industry cards
- `/industries/oil-gas`, `/industries/construction`, `/industries/manufacturing` —
  should each show a "Trusted across..." client strip with real company names
- `/industries/petrochemical` (or power-utilities / marine-offshore /
  heavy-industry) — should NOT show a clients section (no verified names for
  these yet) — confirm it doesn't look broken/empty, just omits that block
- Homepage `#industries` section — cards should still look the same but now
  be clickable
- Top navigation "Industries" dropdown — links should go to the new pages
