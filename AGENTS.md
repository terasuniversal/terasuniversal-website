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
- DeepSeek routing is disabled for now. Do not invoke DeepSeek or use it as an automatic fallback.
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

### LOW / MEDIUM IMPLEMENTATION COMPLETION WORKFLOW

After every LOW or MEDIUM implementation:

1. Automatically run the relevant validation for the approved scope.
2. Automatically perform a final read-only review of the implementation.
3. If the review fails, fix only within the approved scope and re-run the
   relevant validation and final read-only review.
4. If the review passes, send one concise Telegram report containing:
   - task completed
   - risk level
   - model/provider used
   - files changed
   - validation result
   - review result
   - risks
5. If a commit is appropriate, stop and ask exactly:
   `APPROVAL REQUIRED: COMMIT`

The requester must not need to ask separately for a final review. This
workflow does not authorize commit, push, merge, deploy, migration apply, or
database mutation; all existing approval gates remain mandatory.

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

### SELECTIVE WORKER PATH SAFETY

For every delegated or selective worker:

- Resolve all allowed paths against `D:\Projects\terasuniversal-website-clean`.
- When an exact file path is supplied, read that exact path directly.
- Do not search `D:\Projects`.
- Do not enumerate sibling repositories.
- Do not inspect alternate worktrees.
- If a target file cannot be found, return `BLOCKED`, report the unresolved
  path, and do not broaden the search scope automatically.
- Parent Hermes must decide the next action.
- Parenthesized route segments such as `app/admin/(protected)/` are literal
  path segments and must be handled as such.
- Prefer normalized absolute paths using:
  `D:/Projects/terasuniversal-website-clean/...`.
- Never use another repository, worktree, recovery folder, or sibling project
  as a fallback.

#### Worker success/failure semantics

- `ROUTING PASS` means the correct model/provider was used, the correct scope
  was respected, and no prohibited action occurred.
- Findings discovered during a review do not make routing fail. Report
  `FINDINGS FOUND` or `NO FINDINGS` separately.
- `ROUTING FAIL` is reserved for a wrong model/provider, scope violation,
  prohibited action, silent fallback, or inability to execute the requested
  worker.

### Model policy

- Parent Hermes model: `gpt-5.6-luna` via OpenAI Codex.
- Selective worker/specialist routing must not change the parent default model.
- Every worker or specialist report must state the actual model and provider used.
- No model fallback may happen silently; report any fallback and the reason.

#### LOW RISK — routine/simple

- Use `gpt-5.6-luna` via OpenAI Codex.
- The worker may inspect, implement the approved scope, validate, and report.
- Stop before commit.
- DeepSeek routing is disabled for now.
- Automatic fallback to DeepSeek is prohibited.

#### LOW RISK — stronger coding/reasoning required

- Use `gpt-5.6-luna` via OpenAI Codex.
- The worker may inspect, implement the approved scope, validate, and report.
- Stop before commit.

#### MEDIUM RISK

- Use `gpt-5.6-luna` via OpenAI Codex.
- A focused delegated Luna reviewer may be used when useful.
- The worker may inspect, implement the approved scope, validate, and report.
- Stop before commit and request human review.

#### HIGH RISK

- Use `claude-sonnet-5` via Claude Code / Anthropic as the specialist.
- Default behavior is read-only review.
- Parent `gpt-5.6-luna` must review Claude's findings.
- Implementation requires explicit human approval.

#### CRITICAL

- Use `claude-sonnet-5` via Claude Code / Anthropic as the specialist where applicable.
- Read-only by default.
- Parent `gpt-5.6-luna` must review Claude's findings.
- Human approval is required before implementation.
- Separate approval remains required before commit, push, merge, deploy,
  migration apply, or production/staging changes.

#### Routing safety and boundaries

- The approved worker setup currently consists only of Codex and Claude.
- DeepSeek routing and any automatic fallback to DeepSeek are disabled.
- Claude specialist invocation must not change the parent default model.
- Every delegated or specialist report must state the actual model and provider.
- No silent model fallback is permitted.
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
