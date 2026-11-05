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
