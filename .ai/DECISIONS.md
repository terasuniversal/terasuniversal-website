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
