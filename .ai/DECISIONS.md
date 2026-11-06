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
