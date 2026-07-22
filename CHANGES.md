# Batch 15 — Developer Documentation (Module 40)

This is the last of the 20 modules from your original brief (21–40).

## What I found
`README.md` already existed, but it read as a running changelog — a log of
every past update phase ("Phase 1", "Phase 2 premium upgrade", "Safari
iPhone patch", etc.) with setup notes scattered inside each section. Useful
as history, but there was no single place a new developer (or a future
AI session) could read to quickly understand the project structure,
required environment variables, or what's been added recently.

## What this adds
A new "Developer Guide" section added to the **top** of `README.md`,
covering:
- Getting started (`npm install`, `.env.local`, `npm run dev`)
- All available scripts (`build`, `start`, `lint`, `typecheck`)
- Project structure (`app/`, `components/`, `data/`, `lib/`, `scripts/`,
  `supabase/`)
- A consolidated table of **every** environment variable used anywhere in
  the codebase (I verified this by searching all `process.env.*` references
  across the project) — including the new `RESEND_AUDIENCE_ID` from Batch 7
- A summary of the 3 key integrations (Request Proposal/Contact, Newsletter,
  Certificate Verification) and how they connect
- An explicit explanation of the `as any`/`as never` TypeScript casting
  pattern used throughout the admin CMS — so a future developer doesn't
  "clean up" those casts and accidentally break the build again, the way it
  broke before this engagement started
- A short recap of everything added during Modules 21–39

**Nothing below this new section was touched** — the entire existing
changelog (Phase 1 through Certificate Verification Database) is preserved
exactly as it was, per your instruction to never remove existing content. A
one-line note at the top explains that everything from "Phase 1 Website"
onward is the historical record.

## Files changed (1)

### `README.md`
Added the new "Developer Guide" section between the title and the existing
"Phase 1 Website" section. No existing line was edited, removed or
reordered.

## What to check after applying
- Open `README.md` — the new "Developer Guide" section should appear near
  the top, and everything that was there before should still be there,
  unchanged, below it
- Nothing to build or test here — it's documentation only, `npm run build`
  is unaffected
