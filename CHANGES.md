# Batch 9 — Strategic Partners (Module 31)

## Note on Module 30 (Corporate Team)
Module 30 — Corporate Team — was already completed in Batch 1. The Corporate
Profile only names 2 approved personnel: the Director (Mohd Latifi Amir Bin
Abu Bakar) and the Manager (Nor Zalikha binti Mohd Latifi Amir), both already
shown in the "Our Leadership" section on the About page with their verified
bios and credentials. There's no other named team member in the official
documents, so nothing further can be added there without fabricating people
who aren't documented — this module stays as-is.

## What this adds
The Corporate Profile lists 2 organisations under "Other Valued Partners"
(distinct from the industry client lists already used on `/industries/[slug]`
in Batch 3): **Universiti Kuala Lumpur (UniKL)** and **Lembaga Kemajuan
Wilayah Kedah (KEDA)**. These weren't shown anywhere on the site. Added a
"Strategic Partners" section to the About page with both, plus a line
pointing to the `/industries` page for the full client list by sector.

Only these 2 are shown as "partners" — I did not relabel any of the 32
industry clients as "partners" since the source document itself
distinguishes between the two categories.

## Files changed (3)

### `data/companyProfile.js`
Added `partners` — the 2 verified organisations with a short description
each.

### `app/about/page.js`
Added one new section, "Strategic Partners", placed after "Industries We
Support" and before "Corporate Commitment". Nothing else on the page
changed.

### `app/globals.css`
Styling for the new 2-column partner card grid — appended to the end of the
file.

## What to check after applying
- `/about` — scroll to "Strategic Partners" (near the bottom, after
  "Industries We Support") — should show 2 cards: UniKL and KEDA
- The "View industries we serve" link below the cards should go to
  `/industries`
