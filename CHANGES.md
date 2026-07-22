# Batch 19 — Fix 5 Pages With No Header, Navigation or Footer

## What I found
Confirmed and fixed the issue flagged after Batch 18: `/faq`, `/search`,
`/calendar`, `/insights` and `/stories` had **no site header, no main
navigation, and no footer at all**. Each page rendered as an isolated block
of content with no logo, no way to reach the rest of the site except the
browser's back button, and no footer contact details at the bottom.

This wasn't part of the earlier 13-file footer inconsistency (Batch 16)
because those 13 files had a footer, just 4 slightly different versions of
one. These 5 pages had none to begin with — a more fundamental gap, and
very likely the single biggest contributor to the site feeling
"tidak tersusun" (disorganised), since landing on any of these 5 pages felt
like leaving the TERAS UNIVERSAL site entirely.

## What this fixes
All 5 pages now have the exact same header, navigation (`MegaNav` /
`MobileNav`) and footer (`Footer`, the shared component from Batch 16) as
every other page on the site. Nothing about the actual page content (FAQ
list, search tool, calendar, insights articles, testimonials) was changed —
only the missing header/footer wrapper was added around it.

One small supporting CSS change: the content area on these pages
(`.utility-container`) previously had very large top padding (up to 130px)
to compensate for having no header above it. Now that a real header sits
above it, that padding would look like an oversized empty gap, so it's
been reduced specifically for pages where a header immediately precedes it
— this does **not** affect the two "not found" fallback states
(`/industries/[slug]` and `/training/[slug]` when the URL doesn't match a
real course/industry), which still intentionally have no header and keep
their original spacing.

## Files changed (6)
- `app/faq/page.js` — added header/nav + footer
- `app/search/page.js` — added header/nav + footer
- `app/calendar/page.js` — added header/nav + footer
- `app/insights/page.js` — added header/nav + footer
- `app/stories/page.js` — added header/nav + footer
- `app/globals.css` — added one scoped rule reducing top padding only when
  a header now precedes `.utility-container`

## What to check after applying
- Visit `/faq`, `/search`, `/calendar`, `/insights`, `/stories` — each
  should now show the full TERAS UNIVERSAL header with the logo and
  dropdown navigation at the top, and the standard footer at the bottom
- Confirm spacing between the header and the page heading looks natural
  (not a large empty gap, not cramped)
- Confirm the mega-nav "current page" highlight (Batch 16) correctly shows
  which section you're in on these pages too (e.g. Resources highlighted
  on `/faq` and `/search`)
- `npm run lint` / `npm run build` — should pass cleanly
