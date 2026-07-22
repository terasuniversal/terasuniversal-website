# Batch 12 — Accessibility (Module 37)

## What I checked
Reviewed the codebase against common WCAG requirements: `lang` attribute
(already correctly set to "en"), form labels (already using proper `sr-only`
labels + `htmlFor` on search/newsletter forms), icon-only button labelling
(mobile menu toggle, sticky WhatsApp/Call/Email buttons already have
`aria-label`s), and keyboard navigation (the mega menu already uses native
`<details>`/`<summary>`, which is keyboard-accessible by default).

One real, sitewide gap found: there was **no "Skip to main content" link**
anywhere on the site. This is a WCAG 2.4.1 (Bypass Blocks) requirement —
keyboard and screen-reader users currently have to tab through the entire
header and navigation menu on every single page before reaching the actual
content. This affects every page on the site equally.

## What this adds
A standard "Skip to main content" link, added once in the root layout so it
applies to every page automatically:
- Hidden off-screen until it receives keyboard focus (standard accessible
  pattern — invisible to sighted mouse users, but the very first thing a
  keyboard or screen-reader user encounters)
- When focused (Tab key) and activated, jumps straight past the header/nav
  to the page's main content
- Styled to match the site's navy/white brand colours when it does appear

## Files changed (2)

### `app/layout.js`
Added the skip link as the first element inside `<body>`, and wrapped
`{children}` in a `<div id="main-content">` so the link has somewhere to
jump to. This is the only structural change — nothing else in the layout
(Analytics, StickyCta, schema markup, fonts) was touched. The wrapper div
has no styling of its own, so it has zero visual effect on any page.

### `app/globals.css`
Styling for the skip link (off-screen by default, slides into view on
keyboard focus) — appended to the end of the file.

## What to check after applying
- On any page, click into the address bar and press Tab once — a "Skip to
  main content" button should appear at the top-left of the screen
- Press Enter — focus should jump past the header/navigation
- Confirm no page's layout visually shifted (the wrapper div is unstyled, so
  it shouldn't affect anything)
- Mouse-only visitors should see no visible change at all
