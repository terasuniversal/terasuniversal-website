# Batch 2 — Training Comparison tool (Module 22)

## Source
Every duration, objective, target audience, delivery mode, assessment method
and completion requirement below is taken directly from the official
"TERAS UNIVERSAL Training Course Catalogue 2026" PDF you provided. Nothing
was estimated, guessed, or carried over from a generic template.

## Important scope note — read this first
Module 22 originally asked to compare: Working at Height, Scaffolding,
Confined Space, Forklift, Rigging, Fire Watch. After reading both official
2026 documents in full:

- **Scaffolding** has full verified spec sheets for 6 distinct levels —
  Basic / Intermediate / Advanced Scaffolder, and Scaffolding Inspector
  Basic / Intermediate / Advanced. These are now in the comparison tool.
- **Working at Height** and **Confined Space Safety** exist in the
  catalogue, but only as a short description — no verified duration,
  objectives or assessment method. They're already on the site as separate
  course pages with a "duration to be confirmed" placeholder (that
  discipline was already in place before I touched anything), so they are
  correctly excluded from the comparison tool until that data is verified.
- **Forklift** and **Fire Watch** — neither appears anywhere in the 2026
  Corporate Profile or Course Catalogue. TERAS UNIVERSAL does not
  currently have a verifiable Forklift or Fire Watch programme, so I did
  not create pages or comparison entries for them. If these are genuinely
  offered, send the course details and I'll add them properly next round.

So the comparison tool currently compares the 6 verified Scaffolding
programmes — the only courses with complete, confirmed data across every
field the tool displays.

## Files changed (4)

### `data/courseCatalog.js`
Added the 6 verified Scaffolding courses as full entries (new fields:
`deliveryMode`, `assessment`, `completion`, `entryRequirements`,
`objectives`, in addition to the existing `duration`/`audience`/`modules`
fields the site's course detail template already uses — so each of these 6
new courses also gets its own working page automatically at
`/training/<slug>`, e.g. `/training/basic-scaffolder-level-1`).

Also added `comparableCourses()` — a small helper that returns only courses
with a verified `assessment` field, so the comparison tool automatically
picks up new courses in future without any code changes, and just as
automatically excludes anything not yet verified.

The 5 pre-existing placeholder courses (Working at Height, Confined Space
Safety, Safety Passport, Lifting Awareness) are untouched.

### `components/TrainingComparison.js` (new)
Reusable client component. Lets a visitor pick up to 3 programmes and see
them side by side: Duration, Delivery Mode, Assessment, Completion, Target
Audience, Objectives. Each column links to that course's full page. If a
field isn't verified for a given course, it shows "Available on request"
instead of a blank or a guess — this was a deliberate design choice so the
component is safe to reuse later for other course categories even before
their data is fully verified.

### `app/training/page.js`
One import added, one line added (`<TrainingComparison
courses={comparableCourses()} />`) placed right after the existing Training
Finder section. Nothing else on this page was changed — the programme grid,
filters, delivery options and process sections are all untouched.

### `app/globals.css`
Styling for the new comparison table and picker chips, appended to the end
of the file in a clearly marked block. Reuses the same navy/gold card
system as the rest of the site (rounded corners, soft shadows, gold accent)
— no new colours or design language introduced.

## What to check after applying
- `/training` — scroll to "Compare Programmes" section, try selecting
  different combinations of the 6 scaffolding levels, check mobile width
- `/training/basic-scaffolder-level-1` (and the other 5 new slugs) — each
  should render as a full course page using the existing course template
- Confirm nothing else on `/training` changed
