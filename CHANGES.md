# Batch 10 — Corporate FAQ (Module 35)

## Note on Modules 32–34
Per your decision, Awards (32), Media Centre/Press (33) and Careers (34) are
skipped for now since neither official document lists any awards, press
mentions or job openings. Nothing was built for these — they're left exactly
as they are until you have real content to share.

## What this adds
The existing FAQ Centre (`/faq`) had a "Corporate Training" category with
just 2 questions. Corporate/B2B decision-makers usually have more specific
questions before committing — about HRD Corp claims, government procurement
eligibility, accommodation logistics, minimum group sizes, lead time, and
invoicing. Added a new **"Corporate Engagement"** category with 6 more
questions answering exactly that, using **only** facts already verified
elsewhere in the codebase:
- HRD Corp claim assistance — verified in the Corporate Profile ("TERAS
  assists with application process" for claimable programmes)
- MOF registered supplier status — verified (Batch 1's Accreditations data)
- Hostel accommodation + meals — verified (Batch 8's Training Facilities)

For anything **not** stated in either official document — minimum
participant numbers, exact lead time, specific payment terms — the answers
deliberately stay general ("varies by programme," "can be discussed as part
of your proposal") rather than inventing a number or policy. This matches
the tone already used throughout the existing FAQ entries (e.g. "may be
discussed according to...").

## Files changed (1)

### `data/faq.js`
Added 6 new entries under a new "Corporate Engagement" category. The
existing 8 FAQ entries are untouched. The FAQ Centre page, its search/filter
behaviour, and the FAQPage schema markup all pick up the new entries
automatically — no other file needed to change.

## What to check after applying
- `/faq` — a new "Corporate Engagement" filter chip should appear alongside
  the existing category chips (Corporate Training, Programme Design,
  Certification, Enquiries, Participants, Delivery, Scheduling)
- Click it (or search "HRD Corp" / "accommodation" / "invoicing") to confirm
  the 6 new questions appear and expand correctly
