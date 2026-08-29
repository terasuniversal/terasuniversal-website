# TERAS Universal — Shared Agent Instructions

This file is the root entry point for AI agents working in the TERAS Universal website and CRM repository. Read it before starting work, then read `.ai/CURRENT_TASK.md` and `.ai/PROJECT_STATUS.md` for the current task and project state.

## Source of truth

- Product and repository context: `CLAUDE.md`, `AI_DEVELOPMENT_GUIDE.md`, and the relevant documents under `docs/`.
- UI: the TERAS Design System already present in the repository. Reuse `components/admin/ui/index.tsx`, the `ta-*` admin class conventions, and the separation between `app/globals.css` and `app/admin/admin.css`. Do not introduce a competing visual system without an explicit decision recorded in `.ai/DECISIONS.md`.
- Database: the verified live schema and the database safety rules in `CLAUDE.md`, `.ai/DATABASE_SAFETY.md`, and the current audit documents. Migration files alone are not proof of production state.
- Shared task state: `.ai/CURRENT_TASK.md`, `.ai/PROJECT_STATUS.md`, `.ai/DECISIONS.md`, and `.ai/ROADMAP.md`.

## Agent roles

- Codex is the primary implementation agent for the active task and performs the final technical review of its own work when no separate reviewer is available.
- Claude Code is the reviewer for architecture, security, database, auth/RLS, certificate, and cross-module concerns. Claude may implement complex work when explicitly assigned.
- DeepSeek is limited to low-risk, routine, narrowly scoped work such as copy, CSS, small UI polish, and mechanical CRUD changes. It must escalate if scope, architecture, security, database, auth, or production impact appears.
- A human remains the approval authority. No agent may merge, push, deploy, apply a production migration, or otherwise release to production without explicit approval in the conversation.

## TERAS Auto-Agent Governance Policy (Approved)

### Repository boundaries

- Development worktree: `D:\Projects\terasuniversal-website-clean`
- Recovery evidence: `D:\Projects\terasuniversal-website`
- Recovery evidence is permanently read-only unless explicitly approved by a human.
- Do not touch the recovery worktree during normal development work.

### Risk levels and permitted actions

#### LOW RISK

Examples include:

- small UI fixes
- responsive fixes
- simple CRUD
- boilerplate
- documentation
- small validation fixes
- read-only audits

Allowed:

- inspect
- edit approved files
- run relevant validation
- delegate focused work

Stop before commit.

#### MEDIUM RISK

Examples include:

- multi-file features
- moderate refactors
- Sales/Marketing workflow changes
- shared component changes

Allowed:

- inspect
- edit approved files
- test
- focused delegation

Stop before commit and request review.

#### HIGH / CRITICAL

Examples include:

- migrations
- Supabase schema, RLS, policies, or functions
- auth
- RBAC/permissions
- security-sensitive changes
- production configuration
- destructive Git operations
- broad architecture changes
- certificate trust or verification logic

Default: read-only only. Implementation requires explicit human approval.

### Human approval gates

Human approval is always required before:

- commit
- push
- merge or rebase
- deploy
- migration apply
- production or staging database mutation
- reset
- clean
- risky stash
- significant deletion
- production configuration changes

### Delegation

- The parent Hermes agent owns final review.
- Maximum two concurrent workers.
- Maximum delegation depth is one; workers cannot spawn grandchildren.
- Every worker must receive the exact objective, allowed paths, blocked paths, risk level, prohibited actions, and output contract.
- Do not delegate trivial one-file edits unnecessarily.
- A worker must stop on scope expansion.
- Existing role descriptions above do not authorize routing that is disabled by the model policy below.

Worker output must include:

- `COMPLETE`, `BLOCKED`, or `ESCALATE`
- task ID
- inspected files
- changed files
- validation run
- validation results
- risks
- unresolved issues
- recommended next action

### Model policy

- Parent model: `gpt-5.6-luna` via OpenAI Codex.
- Delegated workers inherit the parent model/provider for now.
- Claude and DeepSeek routing remain disabled until later approval.

### Required verification

Before implementation is reported complete:

- run `git status`
- run `git diff`
- run `git diff --check`
- confirm approved files only were changed
- run relevant lint, typecheck, tests, and build validation
- report environment failures honestly
- confirm no commit, push, merge, deploy, or migration occurred

## Required workflow

1. Read `.ai/CURRENT_TASK.md` and `.ai/PROJECT_STATUS.md` before editing.
2. Inspect the relevant existing implementation and preserve local conventions. Do not overwrite important historical state; append or supersede it with a dated decision when necessary.
3. Keep changes within the task scope. Record assumptions, conflicts, and unresolved questions in `.ai/PROJECT_STATUS.md` or `.ai/DECISIONS.md`.
4. Treat every database change as forward-only. Never use destructive production resets, `DROP`, `TRUNCATE`, or destructive data changes without explicit confirmation and the database safety workflow.
5. After implementation, run `git status` and `git diff`. Run `npm run lint`, `npm run typecheck`, and `npm run build` when the repository scripts and changed files make them relevant.
6. Update `.ai/PROJECT_STATUS.md` after the task with the result, validation, changed files, conflicts, and next action. Do not mark production approval unless the human explicitly granted it.

## Change boundaries

- Do not commit, push, merge, deploy, or apply migrations as part of normal implementation.
- Do not expose secrets, tokens, or PII in source, logs, reports, or task state.
- For Supabase work, verify the live schema before adding queries or migrations; use the existing auth/RBAC, validation, RLS, audit, and error-handling patterns in `CLAUDE.md`.
- Prefer additive, reversible changes and soft-delete conventions for application data.

## Handoff format

When handing work to another agent, include the task ID, scope, changed files, validation results, known risks, and the exact review question in `.ai/` state. The next agent must read the state rather than relying on copied terminal output.
