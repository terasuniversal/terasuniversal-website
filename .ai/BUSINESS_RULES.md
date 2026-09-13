# BUSINESS_RULES.md — Safety Defaults

These are hard constraints for Phase 1. They are not configurable per task, per agent, or per menu option in `tools/teras-agent.ps1`. Any change to these defaults is a Phase 2+ decision requiring explicit human sign-off and a rewrite of this file — not a flag flip.

## Enforced defaults

```
AUTO_COMMIT             = false
AUTO_PUSH               = false
AUTO_DEPLOY             = false
AUTO_DATABASE_WRITE     = false
AUTO_MIGRATION_APPLY    = false

SCOPE_LOCK              = true
HUMAN_APPROVAL_REQUIRED = true
```

- **No agent, and no script in this repo, ever commits, pushes, deploys, applies a migration, or writes to the database automatically.** `tools/teras-agent.ps1` only writes files under `.ai/`; it never calls `git commit`, `git push`, `vercel deploy`, `supabase db push`, or any Supabase MCP mutating tool.
- **SCOPE_LOCK**: every task's `Allowed Files` / `Blocked Files` lists in `CURRENT_TASK.md` are binding. An implementer that finds it needs to touch a file outside the approved scope stops and asks — it does not silently expand scope.
- **HUMAN_APPROVAL_REQUIRED**: no task reaches commit/push/deploy/migration without a human reading `FINAL_REPORT.md` and explicitly approving. This is true for every risk level, not just HIGH — HIGH risk additionally requires a Codex review pass before the human approval step (see `ROUTING_RULES.md`).

## What "documentation only" means when a task says so

If a task's description or `CURRENT_TASK.md` scope says documentation-only, the only files touched are the requested `.md` output(s) — no source file under `app/`, `components/`, `lib/`, `data/`, or `supabase/` is modified, per the same rule already in the root `CLAUDE.md` §20.6.

## Dependency policy

Do not add a package, CLI tool, or external service to make the orchestrator work. `tools/teras-agent.ps1` uses only PowerShell built-ins and the `git` binary already required elsewhere in this repo's workflow. If a future phase genuinely needs a dependency (e.g. a real task queue, a scripted API client), that is a scoped, reviewed decision — not something added incidentally while building routing/handoff scaffolding.

## QA strategy (for implementers working a routed task)

Do not repeatedly run full builds while investigating or implementing. Recommended sequence, in order:

```
1. Inspect         — read the relevant files before changing anything
2. Implement        — make the change within Approved Scope
3. Targeted verification — manually exercise the specific behavior changed
4. npx tsc --noEmit  — typecheck
5. Targeted tests    — only the tests relevant to the change, if any exist
6. git diff --check  — whitespace/conflict-marker sanity check
7. npm run build     — ONCE, as final verification, not as an investigation loop
```

A full `npm run build` is the last step before writing `IMPLEMENTATION_REPORT.md`, not a tool for narrowing down where a bug is.

## Risk levels

Defined in full in `ROUTING_RULES.md`; model-tier consequences of each level are in `MODEL_ROUTING.md`. Summary:

- **LOW** — UI/CSS, small components, ordinary CRUD following an existing pattern. No required reviewer beyond the implementer's own verification. `Implementer Model: CLAUDE_FAST`.
- **MEDIUM** — new features, bug fixes, cross-module changes that don't touch auth/database/certificates. No mandatory Codex review, but still subject to `HUMAN_APPROVAL_REQUIRED`. `Implementer Model: CLAUDE_FAST`.
- **HIGH** — database schema, migrations, RLS, authentication, certificate issuance, certificate verification, production configuration, or anything destructive. Mandatory Codex review AND human approval before any commit/push/deploy/migration. `Implementer Model: CLAUDE_DEEP` when the escalation was keyword-driven (complex/database/certificate-trust surface); `CLAUDE_FAST or CLAUDE_DEEP` when HIGH is purely a category default with no specific complexity signal in the description.
- **CRITICAL** — a HIGH-risk task that also carries a destructive or production-scoped signal (production database changes, a destructive migration, a certificate trust/validity change in production, etc.). `Implementer Model: CLAUDE_DEEP` unconditionally. Mandatory Codex review AND human approval, same as HIGH — CRITICAL does not unlock any automation; `AUTO_DATABASE_WRITE`/`AUTO_MIGRATION_APPLY`/etc. stay `false` regardless of risk level.

## Absolute prohibitions for this phase

Restated from the task brief because they are business rules, not implementation detail:

- Do not modify certificate behavior.
- Do not modify verification behavior.
- Do not modify the Supabase schema.
- Do not create migrations.
- Do not change environment variables.
- Do not touch production data.
- Do not commit changes.
- Do not push changes.
- Do not deploy.

This phase is engineering orchestration infrastructure only.
