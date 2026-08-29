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

### WORKSPACE SCOPE ENFORCEMENT

Default allowed workspace:
`D:\Projects\terasuniversal-website-clean`

Agents and delegated workers must not inspect, search, enumerate, read, or modify
other TERAS repositories, worktrees, recovery folders, sibling project folders,
or `D:\Projects` recursively unless explicitly authorized by the human.

Blocked by default:

- `D:\Projects\terasuniversal-website`
- `D:\Projects\_recovery`
- `D:\Projects\_worktrees`
- `D:\Projects\_03-other-projects`
- `D:\Projects\supabase`

For normal TERAS tasks:

- all discovery must remain inside the clean worktree
- workers must receive this same workspace restriction
- if information outside the allowed workspace appears necessary, stop and request approval
- never use another worktree as an alternate source of truth unless explicitly authorized

STRICT RULES:

- Do not modify application code.
- Do not modify migrations.
- Do not modify `.ai` generated state.
- Do not touch the recovery worktree.
- Do not commit.
- Do not push.
- Do not merge.
- Do not deploy.

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

- Parent Hermes model: `gpt-5.6-luna` via OpenAI Codex.
- Selective worker/specialist routing must not change the parent default model.
- Every worker or specialist report must state the actual model and provider used.
- No model fallback may happen silently; report any fallback and the reason.

#### LOW RISK — routine/simple

- Preferred worker: `deepseek-v4-flash` via DeepSeek.
- Examples: copy changes, documentation, simple UI consistency, mechanical CRUD,
  small CSS/responsive fixes, and basic read-only audits.
- If DeepSeek is unavailable or fails, the parent may reassess whether
  `gpt-5.6-luna` is appropriate; any change must be reported explicitly.
- Stop before commit.

#### LOW RISK — stronger coding/reasoning required

- Parent/worker: `gpt-5.6-luna` via OpenAI Codex.
- Stop before commit.

#### MEDIUM RISK

- Primary: `gpt-5.6-luna` via OpenAI Codex.
- A focused delegated Luna review may be used.
- Stop before commit and request human review.

#### HIGH RISK

- Preferred specialist: `claude-sonnet-5` via Anthropic / Claude Code.
- Default behavior remains read-only.
- Claude performs specialist review; the parent Luna agent reviews Claude's
  output.
- Implementation requires explicit human approval.

#### CRITICAL

- Claude Sonnet 5 specialist review is required where applicable.
- Read-only by default.
- Human approval is required before implementation.
- Separate approval remains required before commit, push, merge, deploy,
  migration apply, or production/staging changes.

#### Routing safety and boundaries

- Stay inside the canonical workspace:
  `D:\Projects\terasuniversal-website-clean`.
- Recovery evidence remains read-only:
  `D:\Projects\terasuniversal-website`.
- Preserve all approval gates, workspace enforcement, delegation limits, and
  repository rules above.

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
