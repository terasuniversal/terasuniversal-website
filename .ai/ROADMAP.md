# ROADMAP

Shared roadmap for the TERAS Universal website/CRM and its agent workflow.

## Now

- Keep `.ai/CURRENT_TASK.md`, `.ai/PROJECT_STATUS.md`, `.ai/DECISIONS.md`, and `.ai/ROADMAP.md` current after each meaningful task.
- Preserve the existing public/admin UI boundary and extend the TERAS Design System through existing primitives.
- Keep implementation, review, and production approval as separate responsibilities.

## Next

- Run authenticated browser checks for Marketing Dashboard, Campaigns, Contacts, and the contact-to-Sales handoff using an approved test session; do not enter credentials into the browser without user direction.
- Complete staging newsletter end-to-end validation after `RESEND_AUDIENCE_ID` and the server-only Supabase service key are configured.
- Reconcile the existing generated router state with the current human-approved work item through the repository's task workflow; do not hand-edit generated task records.

## Later

- Improve automated handoff/report tooling while preserving human gates for commit, merge, deploy, and production migration application.
- Consolidate duplicate historical audit/state documents only through an explicit cleanup task; do not remove them opportunistically.

## Completed checkpoints

- Live Supabase schema, RLS, grants, and read-only advisors were re-verified for the Marketing tables on 2026-08-28.
- Local unauthenticated browser smoke check for `/admin/marketing` was completed on 2026-08-28.
