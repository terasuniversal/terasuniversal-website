# Batch 11 — Performance (Module 36)

## What I checked
I audited the codebase for common Next.js performance issues: raw `<img>`
tags bypassing Next.js image optimization, unused/oversized image files
sitting in the deployment, and excessive `priority` image loading. Two real,
verifiable issues found — both fixed safely with zero visual risk.

## Issue 1 — Admin login page bypassed image optimization
`app/admin/login/page.tsx` used a plain `<img>` tag for the logo instead of
`next/image`, meaning it skipped Next.js's automatic format conversion
(AVIF/WebP), resizing and lazy-loading that every other page on the site
already benefits from.

**Fix:** Replaced with the same `next/image` `<Image>` component pattern
used everywhere else on the site (same logo file, same dimensions).
Low-traffic page (admin only), but a real and correct fix.

## Issue 2 — 13MB of unused image files sitting in the deployment
I found 6 large original PNG files in `public/images/` (2–2.4MB each,
~12.8MB total) that are **not referenced anywhere** in the codebase — the
optimized `.webp` versions of the exact same images (180KB each) are what's
actually used throughout the site. I confirmed this by searching every
`.js`/`.tsx`/`.css`/`.json` file in the repo for each filename — zero
matches. There's also an unused `teras-universal-logo.jpg` (36KB) — the
active logo everywhere is `teras-universal-logo.png`.

These leftover files don't slow down page loads for visitors (nothing
requests them), but they do bloat your Git repository and Vercel deployment
size unnecessarily, which slows down every future `git clone`, `npm
install`/build, and deploy.

**Fix:** Delete these 7 unused files (see PowerShell commands below — this
batch has no new/changed files to copy, just deletions plus the one code
fix).

## One recommendation (not changed — needs your input)
Your main logo (`public/teras-universal-logo.png`, used sitewide) is
1144×806px and 708KB, but it's only ever displayed at roughly 210–220px
wide. Next.js's image optimizer already resizes and compresses it on the
fly for visitors, so this isn't hurting anyone's page load today — but if
you ever export a fresh logo from your design source, exporting at around
480×340px (2x for retina, plenty of headroom) instead of the current full
resolution would shrink the source file significantly and speed up builds.
I didn't touch the logo file itself since it's your primary brand asset and
I have no way to visually verify a recompressed version looks right before
you see it — just flagging it as a future easy win.

## Files changed (1) + deletions (7)

### `app/admin/login/page.tsx`
Swapped the raw `<img>` for `next/image`'s `<Image>` component.

### Files to delete (unused, verified no references)
- `public/images/temp-ai-training-yard.png`
- `public/images/temp-ai-scaffolding-practical.png`
- `public/images/temp-ai-competency-assessment.png`
- `public/images/temp-ai-technical-equipment.png`
- `public/images/temp-ai-ppe-equipment.png`
- `public/images/temp-ai-industrial-safety-briefing.png`
- `public/teras-universal-logo.jpg`

## What to check after applying
- `/admin/login` — logo should still display correctly, same size and
  position as before
- Confirm the 7 files are gone from `public/` after the PowerShell script
  runs, and that `npm run build` still passes (it will — nothing references
  them)
- Spot-check a few public pages (homepage, training, gallery) to confirm all
  images still load normally — they use the `.webp` versions, which are
  untouched
