# Batch 17 — Sitewide 404 Page

## What I found
Only `/verify/[certificateNo]` had a custom "not found" experience. Every
other broken link, mistyped URL, or removed page on the rest of the site
would have fallen through to a generic, unbranded error screen — a poor
first impression for a visitor who followed a bad link (from search
results, an old bookmark, a typo, etc).

## What this adds
A single new file, `app/not-found.js`, which Next.js automatically shows
for any unmatched route across the entire site (this is a built-in Next.js
App Router convention — no routing config needed).

The page keeps the full site header, navigation and footer so a lost
visitor never leaves the TERAS UNIVERSAL look-and-feel, then offers 5 clear
next steps instead of a dead end: Homepage, Training Programmes, Industries,
Search, and Contact Us. It's marked `noindex` so Google doesn't try to rank
the 404 page itself.

## Files changed (2)

### `app/not-found.js` (new)
The sitewide 404 page described above.

### `app/globals.css`
Added one new, additive block: `.notfound-section` and related styles.
Nothing existing was changed or removed.

## What to check after applying
- Visit any non-existent URL on the site (e.g.
  `https://www.terasuniversal.com.my/this-page-does-not-exist`) — it should
  show the new branded 404 page with header, nav, footer and the 5 quick
  links, instead of a generic error
- `npm run lint` / `npm run build` — both should pass unaffected
