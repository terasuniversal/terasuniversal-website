# Batch 20 — Breadcrumb on Certificate Verification Result

This was the last item from the additional-suggestions list: every other
dynamic detail page (course pages, industry pages, insights articles)
already had a breadcrumb; the certificate verification result page
(`/verify/[certificateNo]`) was the one page missing it.

## What this adds
A breadcrumb — `Home / Verify Certificate / [Certificate Number]` — at the
top of the verification result, using the same `.course-breadcrumb` style
already used elsewhere on the site, so it looks consistent.

It's also added to the existing print stylesheet's hidden-elements list, so
when someone prints or saves a verified certificate as PDF (via the
existing Print button), the breadcrumb doesn't clutter the printed output —
consistent with how the header, footer and WhatsApp button are already
hidden from print on this page.

## Files changed (2)
- `app/verify/[certificateNo]/page.js` — added the breadcrumb
- `app/globals.css` — added `.course-breadcrumb` to the existing
  `@media print` rule for `.verify-page`

## What to check after applying
- Visit any valid certificate verification URL (e.g.
  `/verify/<a real certificate number>`) — a small breadcrumb should appear
  above "CERTIFICATE VERIFIED"
- Use the existing Print button on that page — the breadcrumb should not
  appear in the print/PDF output, same as the header and footer
