# ARCHITECTURE.md — Orchestrator Architecture

## Isolation boundary

```
terasuniversal-website/
├── .ai/                  <- orchestrator state & docs (THIS layer)
│   ├── PROJECT.md
│   ├── ARCHITECTURE.md
│   ├── BUSINESS_RULES.md
│   ├── AGENTS.md
│   ├── ROUTING_RULES.md
│   ├── CURRENT_TASK.md      <- overwritten per task by tools/teras-agent.ps1
│   ├── HANDOFF.md
│   ├── IMPLEMENTATION_REPORT.md
│   ├── REVIEW_REPORT.md
│   └── FINAL_REPORT.md
│
├── tools/
│   └── teras-agent.ps1   <- the only executable in the orchestrator layer
│
└── (everything else)     <- the CMS/website (APPLICATION layer, untouched by this phase)
```

The orchestrator layer has exactly one edge crossing into the application layer: **read-only** `git status`/`git diff` calls (used by the launcher's "Review Current Changes" option to summarize what's already changed in the working tree — it never stages, commits, or modifies anything). Nothing under `.ai/` or `tools/` is imported by `app/`, `components/`, or `lib/`, and nothing in `app/`, `components/`, or `lib/` reads `.ai/` at runtime. The orchestrator has no effect on what ships.

## Why a single `CURRENT_TASK.md` instead of a task queue/database

Phase 1 is one human operator running one task at a time through the launcher. A single overwritten file is sufficient, inspectable with a text editor, diffable in git if the human chooses to commit it, and requires no additional runtime (no database, no service, no daemon). This matches `BUSINESS_RULES.md`'s "prefer native tooling, no unnecessary dependencies" constraint. A multi-task queue is an explicit non-goal until a later phase demonstrates the single-task flow is insufficient — see `ROUTING_RULES.md`'s note on Phase 2+.

## Data flow for one task

```
Human describes task
        |
        v
tools/teras-agent.ps1 (menu selection + description)
        |
        | classifies: category, risk, implementer, reviewer
        | (rules in ROUTING_RULES.md, encoded in the script)
        v
.ai/CURRENT_TASK.md written
        |
        | human copies CURRENT_TASK.md + relevant context into
        | the chosen implementer's session (ChatGPT/Claude/DeepSeek)
        v
Implementer works, produces a diff
        |
        v
Implementer (or human) fills in .ai/IMPLEMENTATION_REPORT.md
        |
        | if Risk = HIGH -> handoff to Codex via .ai/HANDOFF.md
        |   (Codex receives ONLY: CURRENT_TASK.md, changed files,
        |    git diff, IMPLEMENTATION_REPORT.md — never a full repo scan
        |    unless explicitly requested, per AGENTS.md)
        v
Reviewer fills in .ai/REVIEW_REPORT.md
        |
        v
.ai/FINAL_REPORT.md assembled (implementation + typecheck + tests +
build + diff-check + review status, all summarized)
        |
        v
Human reviews FINAL_REPORT.md and explicitly approves
        |
        v
Human — not any agent, not the script — runs the actual
git add / commit / push / deploy / migration apply, if approved
```

Every arrow in this diagram is a manual handoff in Phase 1: a human moves content between agent sessions and between `.ai/` files. `teras-agent.ps1` automates only the first step (classification + writing `CURRENT_TASK.md`) and the read-only diff summary. No step in this flow calls a proprietary AI API programmatically — see `BUSINESS_RULES.md`.

## Why PowerShell, no new dependencies

The user's shell is PowerShell on Windows; the repo already ships `npm`/`npx`/`git` tooling. A single `.ps1` script using only built-in cmdlets (`Get-Date`, `Read-Host`, `Set-Content`, `Get-Content`, `git` via the existing PATH) needs no package install, no lockfile change, and no risk of breaking the Next.js build. This matches the "prefer native PowerShell and existing project tooling" instruction and `BUSINESS_RULES.md`'s dependency constraint.

## Extension points for later phases (not built now)

- Direct API calls to ChatGPT/Claude/DeepSeek/Codex from the launcher, gated behind explicit per-provider opt-in and a real secrets story (none of `SUPABASE_SERVICE_ROLE_KEY`'s mistakes repeated — see `CLAUDE.md` §12).
- A task history log (`.ai/history/<task-id>.md`) instead of a single overwritten `CURRENT_TASK.md`, if running more than one task concurrently becomes necessary.
- Automatic invocation of `npx tsc --noEmit` / `npm run build` from the launcher as a scripted verification step (Phase 1 documents the sequence in `BUSINESS_RULES.md`'s QA strategy but does not wire it up, to avoid the launcher silently running a full build on every menu interaction).
