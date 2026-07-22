# Batch 14 — Technical Quality (Module 39)

## What I found

**1. `npm run lint` never checked the /admin CMS's TypeScript files at all.**
The existing lint script only walks `.js` files and runs `node --check`
(syntax validation) on them. It silently skips every `.ts`/`.tsx` file —
which is exactly where the entire "Supabase queries typed as `never`" bug
class lived at the start of this engagement, only ever caught when
`next build` failed on Vercel. `typescript` is already a devDependency and
this repo already has a working `tsconfig.json` (`strict: true`), so a real
type-check costs nothing new to install.

**2. Footer markup is duplicated across 13 page files**, in 4 slightly
different variants. This is a real maintainability finding (e.g. updating
the phone number or address means editing up to 13 files by hand, and it's
easy to miss one), but extracting it into a shared `<Footer />` component
means touching all 13 files in the same batch — safe in principle since I'd
just be moving identical markup, but for something visible on literally
every page, I'd rather flag it and tackle it as its own reviewable batch
than fold it into this one silently. Let me know if you'd like that as the
next batch.

## What this adds
A **new, separate, opt-in** script: `npm run typecheck`. It does **not**
change `npm run lint`, `npm run build`, or `npm run dev` in any way — those
all behave exactly as before. Running `npm run typecheck` runs the
TypeScript compiler's own check (`tsc --noEmit`) across the whole project
using the existing `tsconfig.json`.

Since this would be the very first time a full type-check has run across
this codebase, it's possible it surfaces some pre-existing warnings on
first run — that's expected and fine, it doesn't mean anything is broken.
`next build` already succeeds and continues to be the real gate before
deploying; this new script is an extra, optional early-warning tool you can
run locally before pushing, at your own pace.

## Files changed (2) + 1 new file

### `scripts/typecheck.mjs` (new)
Runs `tsc --noEmit` and reports pass/fail clearly.

### `package.json`
Added one new line: `"typecheck": "node scripts/typecheck.mjs"` under
`scripts`. Nothing else in this file changed — same dependencies, same
existing scripts, same versions.

### `scripts/lint.mjs`
No functional change — re-delivered as-is for completeness (it was
untouched; only included so the ZIP is self-contained).

## What to check after applying
- `npm run lint` — should behave exactly as before (unchanged)
- `npm run build` — should behave exactly as before (unchanged)
- `npm run typecheck` — new command; run it and see what it reports. If it
  shows errors, that's useful information, not a regression — share them
  with me and I'll help triage which are worth fixing.
