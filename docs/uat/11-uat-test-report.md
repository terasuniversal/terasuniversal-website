# TERAS UNIVERSAL Admin CMS — UAT Test Report

## Evidence baseline

- Preview deployment is ready: `terasuniversal-website-40dhqtmg7-terasuniversal-my.vercel.app`.
- Build and TypeScript validation pass locally.
- Vercel runtime logs show successful requests to Dashboard, Courses, Participants, Schedules, Attendance, Assessment, Trainers, Companies, Reports, News and Certificate Templates after the route-conflict fix.
- Browser check: authenticated dashboard renders without console errors. Dashboard has no horizontal overflow at 390px, 768px, 1024px and 1440px.

## Passed by code/runtime review

- Protected admin routes, active-account checks and server-side role guards.
- Course, schedule, participant, company and trainer validation schemas.
- Participant duplicate IC/Passport handling; schedule participant upsert prevents duplicate registration.
- Trainer schedule conflict detection.
- Attendance states, bulk update and export; assessment update and export.
- Certificate eligibility gate, sequence trigger, QR token generation, revocation/reissue controls and public verification privacy surface.
- Audit/automation history hooks, responsive table wrappers and non-indexed admin metadata.

## Fixed during UAT

1. Resolved a production 500 caused by conflicting `/verify/[token]` and `/verify/[certificateNo]` routes.
2. Completed the existing password-reset path: request link, reset screen, generic account-safe response and correct redirect.
3. Added image upload MIME/5 MB checks and unpredictable storage object names.

## UAT still requiring authorised test data/accounts

- Real login failure, reset-email delivery, session expiry and every role matrix combination.
- Create/edit/import/revoke/restore actions against a disposable UAT dataset.
- Real Supabase RLS policy execution and provider backup/PITR recovery test.
- Mobile device QR scan (physical device) and visual checks of every individual form/table at the four breakpoints.

Do not run destructive scenarios against production data. Use separate UAT accounts and records, then record outcomes in this report.
