# PROJECT.md — Multi-AI Engineering Orchestrator

## What this is

A task-routing and handoff layer for coordinating multiple AI engineering agents on the TERAS UNIVERSAL codebase. It decides *which* agent should implement or review a given task, records the agreed scope and safety constraints for that task in a single file, and defines the report formats each agent hands off to the next.

**This is infrastructure, not application code.** Nothing under `.ai/` or `tools/` is imported by, or affects the runtime behavior of, the public website or the admin CMS. See `ARCHITECTURE.md` for the isolation boundary.

## Why it exists

This repository already has a strong single-agent discipline documented in the root `CLAUDE.md` (schema verification rules, RBAC/RLS rules, the Server Action shape, etc.). That discipline does not by itself answer a different question: when more than one AI agent (or a human) touches the same codebase across a session, who does what, in what order, under what constraints, and who reviews before anything ships. `.ai/` answers that question. It does not replace `CLAUDE.md` — every agent routed through this orchestrator is still bound by every rule in `CLAUDE.md` for any code it writes.

## The five participants

| Participant | Role |
|---|---|
| ChatGPT | Project Lead — planning, architecture, business rules, task decomposition, prompt generation, final review |
| Claude Code | Main Implementer — large features, Next.js, Supabase, Server Actions, cross-module changes, certificate engine |
| DeepSeek | Fast/Lightweight Implementer — CSS, UI polish, small components, ordinary CRUD |
| Codex | Independent Reviewer — security-sensitive changes, RLS/auth, database changes, certificate issuance/verification, production audits |
| Human | Final approval authority — the only participant who can authorize commit, push, deploy, migration apply, or a database write |

Full responsibilities and boundaries: `AGENTS.md`. Routing logic: `ROUTING_RULES.md`.

## Phase 1 scope

Phase 1 builds the routing and handoff scaffolding only:

- `.ai/*.md` — the documents in this directory (this file plus `ARCHITECTURE.md`, `BUSINESS_RULES.md`, `AGENTS.md`, `ROUTING_RULES.md`, `CURRENT_TASK.md`, `HANDOFF.md`, `IMPLEMENTATION_REPORT.md`, `REVIEW_REPORT.md`, `FINAL_REPORT.md`)
- `tools/teras-agent.ps1` — a PowerShell menu that classifies a task (category, risk, implementer, reviewer) and writes `.ai/CURRENT_TASK.md`

Phase 1 explicitly does **not**:

- call any proprietary AI API automatically (no scripted invocation of ChatGPT/Claude/DeepSeek/Codex APIs)
- commit, push, deploy, apply a migration, or write to the database, ever, under any menu option
- modify certificate behavior, verification behavior, the Supabase schema, environment variables, or production data
- change anything under `app/`, `components/`, `lib/`, `data/`, or `supabase/` — those directories are the CMS/website and are out of scope for this phase

See `BUSINESS_RULES.md` for the enforced safety defaults.

## Relationship to existing repo documents

`CLAUDE.md` remains the engineering guide for all application code. `DELIVERABLE.md`, `DATABASE_AUDIT.md`, `BUG_REPORT.md`, `SECURITY_REPORT.md`, `PERFORMANCE_REPORT.md`, and the module docs (`CERTIFICATE_ENGINE.md`, etc.) remain the source of truth for what's live and what's designed-but-unapplied. `.ai/` documents do not restate or override any of that — they reference it. If a task routed through `.ai/CURRENT_TASK.md` touches the database, the implementer still owes `CLAUDE.md` §11 rule 1 (verify live state before writing a migration), not a `.ai/`-specific shortcut.
