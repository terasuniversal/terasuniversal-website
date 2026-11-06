# DECISIONS

Durable decisions for the TERAS Universal shared agent workflow.

## 2026-08-28 — Shared agent operating model

- Codex is the primary implementation agent for the active task.
- Claude Code is the architecture/security/database/auth/RLS/certificate/cross-module reviewer and may implement complex work when explicitly assigned.
- DeepSeek is restricted to low-risk, routine, narrowly scoped work and must escalate on scope or risk expansion.
- Human approval is required before merge, push, deploy, or production migration application.

## 2026-08-28 — UI source of truth

- Existing TERAS Design System conventions remain canonical: `components/admin/ui/index.tsx`, `ta-*` admin classes, `app/admin/admin.css`, and `app/globals.css` for public styling.
- New UI work must reuse these conventions and must not create a parallel design system without a recorded decision.

## 2026-08-28 — Database safety

- Database changes are forward-only and additive by default.
- Destructive production reset, `DROP`, `TRUNCATE`, or destructive data changes are prohibited without explicit human confirmation and the database safety workflow.

## 2026-11-06 — Online registration is paid-only
- A session is registrable online only when its confirmed fee is greater than 0. Fee 0 and NULL are enquiry-only; there is no free-registration workflow. Enforcement is server-side in `get_public_registration_schedule` and `create_public_registration`, with the public form and Admin validation mirroring it.
- Staff CRM enrolment is a separate path and is not constrained by the online fee.

## 2026-11-05 - Premium public design kit (A3 Executive)

- The public site's premium design language is Concept A3 Executive with the Refined hero mosaic on the homepage.
- It lives in `components/premium/` as scoped CSS Modules on the existing site tokens (`--navy`, `--navy-deep`, `--gold`, `--ink`, `--muted`, `--soft`, `--line`); `globals.css` is not rewritten. Inner pages migrate to the same kit template by template; do not add a second public design system.
- One header action: "Request a Proposal". WhatsApp stays in the top bar, footer and contact block.

## 2026-11-05 - Premium A3 design direction approved site-wide

- Owner approved A3 Executive + Refined Mosaic as the design standard for the whole public website after physical iPhone QA (9 of 10 passed; the hero mosaic on a phone failed and is being corrected). Logo size accepted.
- The rollout order is training and course pages, then About/Services/Corporate Training, Contact/Request Proposal, Industries, and the utility pages, all on the existing `components/premium` kit. Nothing migrates until the corrected hero and shared baseline are accepted. Production release is on hold.

## 2026-11-05 - Premium A3 baseline accepted on iPhone

- Owner accepted A3 Executive + Refined Mosaic + Hero Variant B after physical iPhone QA of Preview `3b26524` (hero 5 of 5 PASS). Design and local development are approved; PR, merge, deployment and database changes are not.
- `3b26524` is the visual reference for the homepage. The inner-page templates extend `components/premium` minimally (statement hero, section heading, course cards, facts, CTA band, recognition block, empty state) and do not repeat the two hero photographs on unrelated pages.

## 2026-11-06 - Session price and availability presentation
- Session fees are shown only from the authoritative schedule record as `RM x,xxx per participant`; null or zero is an enquiry state, never a free session. Registration is offered only when the server flag `registration_available` is true. Full sessions offer an enquiry ("Ask about the next date"), with no waiting-list workflow.

## 2026-11-06 - Register state follows the registration and payment contract
- A public session shows Register only when the server flag `registration_available` is true, the status is not full, the fee is a positive amount and a seat remains. A zero fee is an enquiry state, because the payment provider cannot bill RM 0. The registration page, payment and database logic are unchanged.

## 2026-11-06 - Fee wording for zero or NULL public session fees
- Owner decision: a public session whose fee is zero or NULL reads "Fee to be confirmed" on every surface (homepage Upcoming training, course pages, calendar). It supersedes the earlier "Fee confirmed on enquiry" wording; the single source is `FEE_ENQUIRY_TEXT` in `lib/session-display.ts`.
- Unchanged Production rule: fee > 0 allows paid online registration; zero and NULL are enquiry-only and never reach `/registration/<id>` as a registrable session. There is no free-registration workflow.
## 2026-11-06 - Training design accepted as the site-wide standard
- Owner accepted the Training/Course templates (Preview `83ab57a`, iPhone 7 of 7). The inner-page kit in `components/premium` is the standard for the remaining public pages; Company and Services are the second template group. Design and local development only.

## 2026-11-06 - Public enquiry email on the scaffolding service page
- The scaffolding service page uses the website training enquiry channel (`training@`), consistent with the forms, header, footer and structured data. `admin@` stays in administrative references. A role-based public contact policy is pending owner approval.

## 2026-11-06 - Seven A3 pages accepted on the S2D Preview
- Owner confirmed that all seven A3 pages inspected on the S2D Preview (`dpl_3HKuFeideHtWEZ5mEsowTx47SBoT`, commit `7308cf2`) passed visual review. This is visual acceptance only: it is not approval for Production, it does not clear any business claim, and it allows no live form submission or database change.

## 2026-11-06 - Template 3 (Contact, Request Proposal) design decisions
- J1: the seven-step Request Proposal wizard is replaced by one sectioned, mobile-first page. J2: every currently required field stays required, including training objectives; the server contract is not weakened.
- J3: only verified channels and claims are shown. Email, phone and address come from `data/companyProfile.js`; the existing WhatsApp link stays. No response-time, operating-hours, coverage or capability claims, and no follow-up promises while the notification email is best effort.
- J4: `companyProfile.contact.address` is the reference. The footer, the structured data on the homepage and `HomeContact` still use a different address string; reconciling them is a separate owner decision.
- J8: the automatic Google Maps iframe is replaced by a link the visitor opens themselves.
- Not done on purpose (S3B-2, needs database and endpoint changes with their own approval): storing enquiry or proposal consent, a privacy notice page, IP or global rate limiting, CAPTCHA, a Zod schema for the proposal route, tighter origin check, removing raw IPs from error logs.
