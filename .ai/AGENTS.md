# H0.1 active routing override

The active Hermes routing policy is authoritative here: LOW and MEDIUM route
to OpenAI Codex GPT-5.6 Luna; HIGH and CRITICAL route to Anthropic Claude
Sonnet 5; DeepSeek is disabled for active routing. Historical DeepSeek runner
code may remain only for explicit manual/compatibility use and must never be
selected by normal classification, configuration, health checks, or fallback.
Missing approved models fail closed with an explicit blocker. HIGH/CRITICAL
human approval and mandatory review requirements remain intact.

# AGENTS.md — Agent Responsibilities

## ChatGPT — Project Lead / Architecture / Final Review

Responsibilities:
- Project planning and task decomposition
- Architecture decisions
- Business rules and scope definition
- Prompt generation for the other agents
- Final review, alongside the human, before approval

**Not automatically invoked.** No script in this repo calls a ChatGPT API. The human copies context into a ChatGPT session manually when planning or architecture work is needed.

## Claude Code — Main Implementer

Use for:
- Large features
- Next.js (App Router, Server Components, Server Actions)
- Supabase (queries, RLS-aware code, schema-adjacent work)
- Database architecture questions
- Cross-module changes
- Complex debugging
- Certificate engine work

Claude Code is bound by every rule in the root `CLAUDE.md` in addition to whatever `CURRENT_TASK.md` specifies — the orchestrator adds routing and scope constraints on top, it does not relax anything `CLAUDE.md` already requires (schema verification before writing queries, guard→validate→mutate→check-error→revalidate for Server Actions, no `as any` on Supabase clients, etc.).

## DeepSeek — Fast / Lightweight Implementer

`tools/agent-router.ps1`'s classifier routes LOW/MEDIUM work to OpenAI Codex
GPT-5.6 Luna and HIGH/CRITICAL work to Anthropic Claude Sonnet 5. DeepSeek is
disabled for active routing; see `MODEL_ROUTING.md`.

Preferred owner for:
- CSS, spacing, responsive fixes, layout alignment, UI polish
- Small React/Next.js components
- Ordinary CRUD, search, filter, sorting, simple table updates
- Form field changes, labels, copy changes
- Boilerplate, repetitive code, small cleanup
- Simple bug fixes, targeted tests

Historical DeepSeek artifacts remain subject to the same repo conventions, but
are not active task routes and cannot be selected by configuration or fallback.

**DeepSeek must never be the sole implementer for** (these always route to Claude instead, structurally — the same keyword checks that force HIGH/CRITICAL risk are what keep DeepSeek out, not a separate rule that could drift out of sync):
- RLS, authentication, authorization
- Supabase migration design, database schema, database functions, critical RPC
- Certificate issuance, certificate verification, certificate validity, QR verification, certificate eligibility
- Security boundaries, production incident architecture, destructive database logic
- Major cross-module refactors

**Escalation**: DeepSeek can and should stop mid-task rather than push past its approved scope. If scope expands unexpectedly, more modules are involved than planned, database/security behavior is discovered, the root cause is unclear, an architecture change is required, or the fix would touch any blocked area above, DeepSeek sets `Escalation Required: YES` in `.ai/DEEPSEEK_IMPLEMENTATION_REPORT.md` (`ESCALATE_TO_CLAUDE`) instead of continuing. `teras-agent -Resume` then hands the task to Claude with full context via `.ai/CLAUDE_ESCALATION_HANDOFF.md` — Claude does not have to rediscover what DeepSeek already found. This runs Claude exactly once per escalation, never a repeated loop.

**Execution**: DeepSeek has no assumed local CLI. `tools/deepseek-runner.ps1` detects an existing, already-configured runner only (a `deepseek` command on PATH, or one named in a local, gitignored `.ai/AGENT_CONFIG.json` — see `AGENT_CONFIG.example.json`); it never installs anything and never reads or stores an API key. If no runner is detected, the task is still routed to DeepSeek logically, `.ai/DEEPSEEK_HANDOFF.md` is generated for manual execution, and the human fills in `.ai/DEEPSEEK_IMPLEMENTATION_REPORT.md` themselves before `-Resume` continues the pipeline.

**Codex usage**: routine DeepSeek tasks never call Codex — Reviewer is `None` by construction for every task DeepSeek is eligible for (the same blocked-area keyword checks that exclude DeepSeek are what make Codex mandatory, so the two conditions can't co-occur). Codex only re-enters if a DeepSeek task escalates to Claude *and* the escalation reason itself names a blocked area (see `MODEL_ROUTING.md`).

## Codex — Independent Reviewer / Critical Debugger

Use primarily for:
- Independent review of Claude Code's or DeepSeek's diff
- Difficult debugging that survived a first implementation pass
- Security-sensitive changes
- Database changes
- RLS / auth
- Certificate issuance
- Certificate verification
- Production audits

**Codex must not scan the full repository by default.** Codex should receive only:
- `.ai/CURRENT_TASK.md`
- the relevant changed files
- `git diff`
- `.ai/IMPLEMENTATION_REPORT.md`

A full-repository audit is a distinct, explicitly-requested mode (menu option 7, "Production Audit," in `tools/teras-agent.ps1`) — not the default review posture. Keeping Codex's context to the diff and its immediate surroundings is deliberate: it makes review fast and keeps Codex's judgment anchored to what actually changed rather than re-litigating the whole codebase on every task.

## Human — Final Approval Authority

The human is the only participant who can:
- Approve a `FINAL_REPORT.md` for commit
- Actually run `git commit`, `git push`, a deploy, or a migration apply
- Expand a task's scope beyond what `CURRENT_TASK.md` originally approved
- Override a risk classification the launcher suggested (the launcher suggests; the human decides)

No agent — including Claude Code, the implementer most capable of doing so — self-approves its own work for commit. See `BUSINESS_RULES.md`'s `HUMAN_APPROVAL_REQUIRED`.

## Handoff contract between agents

Every handoff between agents goes through a `.ai/*.md` file, never an ad hoc chat message that isn't captured anywhere:
- Implementer → Reviewer: `HANDOFF.md` (what to review, where, and why) + `IMPLEMENTATION_REPORT.md`
- Reviewer → Human: `REVIEW_REPORT.md`
- Assembly → Human: `FINAL_REPORT.md`

This keeps every task auditable after the fact without relying on chat history in a specific tool.
