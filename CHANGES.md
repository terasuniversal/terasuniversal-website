# Batch 21 — Navigation Consistency (Legacy Nav → MegaNav)

## What I found
While re-checking the site after Batches 16-20, I found 6 pages still using
an old, hardcoded navigation bar (`<nav className="desktop-nav">` — a flat
list of links) instead of `MegaNav`, the dropdown navigation component every
other page has used since Batch 16 (which includes the "current page"
gold-highlight feature).

Pages affected:
- `/training/scaffolding-competency`
- `/request-proposal`
- `/request-proposal/success`
- `/verify`
- `/verify/[certificateNo]` (the certificate verification result page)
- `/gallery`

This mattered because:
- These pages had no dropdown submenus (missing direct links to things like
  "Oil & Gas", "Scaffolding Competency", "Resources Centre" that MegaNav
  provides)
- They didn't get the "current page" highlight added in Batch 16
- Some linked "Industries" and "FAQ" to anchors on the homepage
  (`/#industries`, `/#faq`) instead of the dedicated `/industries` and `/faq`
  pages that exist elsewhere in the site
- It was one more source of the "not consistent" feeling in the original
  feedback — different pages had visibly different navigation bars

## What this fixes
All 6 pages now use the exact same `<MegaNav />` component as every other
page on the site. Nothing else on these pages was touched — same content,
same footer, same layout below the header.

Note: `/request-proposal/success` intentionally keeps its simpler one-line
footer (just copyright + email) — that's a deliberate, different design for
a confirmation page, not part of this fix.

## Files changed (6)
- `app/training/scaffolding-competency/page.js`
- `app/request-proposal/page.js`
- `app/request-proposal/success/page.js`
- `app/verify/page.js`
- `app/verify/[certificateNo]/page.js`
- `app/gallery/page.js`

## What to check after applying
- Visit each of the 6 pages above — the header navigation should now show
  the same dropdown menu style (Services / Training / Industries /
  Resources / Company) as the rest of the site, not a flat link list
- On `/verify` or `/gallery`, confirm the relevant dropdown group
  highlights gold, same as other pages
- `npm run lint` / `npm run build` — should pass cleanly
