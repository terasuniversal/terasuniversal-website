# Batch 8 — Training Facilities & Participant Support (Module 29)

## Note on Module 28 (Corporate Timeline)
Module 28 — Corporate Timeline — was already completed in Batch 1 ("Our
Journey" section on the About page, showing the Director's verified career
milestones from 1991 to founding TERAS UNIVERSAL in 2012). Nothing further
was needed there, so this batch moves on to Module 29.

## What this adds
The official Corporate Profile lists a "Training Facilities & Participant
Support" section that was never published anywhere on the site — including
real value-adds that a corporate client evaluating in-house or multi-day
training would want to know about: **hostel accommodation for participants
travelling from outside**, and **daily meals and refreshments provided
during the programme**. These are genuine differentiators that were simply
missing from the site.

Added a new section to the About page listing all 6 verified items:
Modern Training Classroom, Practical Training Yard, Comfortable
Accommodation, Meals & Refreshments, Personal Protective Equipment, and
Participant Support — each with the exact description from the Corporate
Profile.

I deliberately did **not** touch the existing "Training Facilities" section
on the homepage (photo cards for Classroom, Yard, Scaffold Area, PPE,
Technical Equipment, Assessment Area) — that section already works well and
covers a different angle (visual environment). This batch adds the
complementary text-based "what's included" list to the About page instead
of overloading the homepage section or forcing unrelated stock photos onto
facilities like "Accommodation" or "Meals" that don't have real photos yet.

## Files changed (3)

### `data/companyProfile.js`
Added `trainingFacilities` — 6 verified items with title + description,
sourced directly from the Corporate Profile.

### `app/about/page.js`
Added one new section, "Training Facilities & Participant Support", placed
right after "Our Journey" (timeline) and before "Why Choose TERAS
UNIVERSAL". Nothing else on the page changed.

### `app/globals.css`
Styling for the new 3-column card grid (2 columns on tablet, 1 on mobile) —
appended to the end of the file.

## What to check after applying
- `/about` — scroll to "Training Facilities & Participant Support" (between
  "Our Journey" and "Why Choose TERAS UNIVERSAL") — should show 6 cards
- Confirm the homepage's existing "Training Facilities" section (with
  photos) is unchanged
