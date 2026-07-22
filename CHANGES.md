# Batch 4 — Success Metrics (Module 24)

## Source & approach
Per the verified content review, TERAS UNIVERSAL's official documents contain
**no** stated numeric statistics like "years of combined experience",
"trainees trained" or "satisfaction rate" — so none of those are used here.

Instead, every number in this new "Track Record" section is **computed**
directly from data already verified in previous batches:
- **Years in Operation** — current year minus 2012 (the verified
  incorporation year from `data/companyProfile.js`). Self-updating; no need
  to edit it next year.
- **Organisations Served** — a live count of the unique named clients in
  `data/industries.js` (currently 32 real, named organisations from the
  Corporate Profile's Valued Clients list).
- **Industries Supported** — count of the 8 sectors in `data/industries.js`.
- **Regulatory Accreditations** — count of the 5 verified accreditations in
  `data/companyProfile.js` (JKKP, HRD Corp, CIDB, MOF, SSM).
- **Verified Scaffolding Programmes** — count of the 6 courses in
  `data/courseCatalog.js` that have a full, verified spec sheet.

Because these are computed from the source files rather than typed as fixed
numbers, if you ever update the client list, accreditations, or course
catalogue, this section updates itself automatically — no risk of the
homepage showing stale or inconsistent figures.

## Files changed (3)

### `lib/successMetrics.js` (new)
Small helper, `getSuccessMetrics()`, that computes the 5 metrics above from
existing verified data files. Fully commented to explain why trainee counts
and similar unverified figures are deliberately excluded.

### `app/page.js`
Added one new section, "Track Record", placed between the existing "Training
Gallery" and "Accreditation & Recognition" sections. Nothing else on the
homepage was changed.

### `app/globals.css`
Styling for the new metrics grid (5 cards, responsive down to 2 columns on
mobile) — appended to the end of the file.

## What to check after applying
- Homepage — scroll to the new "Track Record" section (between Gallery and
  Accreditation & Recognition) — should show 5 cards: Years in Operation,
  Organisations Served, Industries Supported, Regulatory Accreditations,
  Verified Scaffolding Programmes
- Confirm the numbers look reasonable (currently: ~14 years, 32
  organisations, 8 industries, 5 accreditations, 6 programmes)
- Check mobile width — cards should reflow to 2 per row
