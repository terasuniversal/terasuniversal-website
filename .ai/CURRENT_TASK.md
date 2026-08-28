# CURRENT_TASK

> This file is regenerated from `.ai/task-state.json` by `tools/agent-router.ps1` - never hand-edit one without the other going stale.

Task ID: TERAS-20260828-152855
Created At: 2026-08-28 15:28:55
Category: Database / Supabase
Risk: HIGH
Description: Final Marketing CRM migration safety review. The implementation is already present. Do not modify application code. Review this exact approved file only: supabase/migrations/20260828103000_marketing_campaigns_attribution_v2.sql. It is a new additive migration for the existing marketing_campaigns table and sales_lead_attributions. Preserve Sales -> Leads ownership. HIGH-RISK / EDIT_ONLY_NO_APPLY. Do not apply migration, commit, push, merge, deploy, or modify unrelated files.

State: BLOCKED
Human Decision: PENDING
Repair Cycles Used: 0 / 1

Implementer: Claude Code
Implementer Model: CLAUDE_DEEP

Reviewer: Codex
Reviewer Model: CODEX_REVIEW

Reason for Model Selection:
Touches migrations, RLS/policies, database functions/RPCs, schema, constraints, indexes, or auth - a DeepSeek-blocked area (AGENTS.md); Claude DEEP + mandatory Codex review.

## Approved Scope

Scope Source: EXPLICIT_TASK_PATHS

Allowed Files:
- supabase/migrations/20260828103000_marketing_campaigns_attribution_v2.sql

Blocked Files:
- (fill in before implementation begins)

Scope Check: PASS

## Changed Files

Pre-existing changes (excluded from this task):
- app/admin/(protected)/sales/leads/[id]/page.tsx
- app/admin/(protected)/sales/leads/actions.ts
- lib/sales/crm.ts
- lib/supabase/database.types.ts
- lib/validation/schemas.ts
- .ai/CLAUDE_HANDOFF.md
- .ai/CODEX_IMPLEMENTATION_HANDOFF.md
- .ai/CODEX_REPAIR_HANDOFF.md
- .ai/DATABASE_HANDOFF.md
- .ai/DATABASE_REPORT.md
- .ai/FINAL_REPORT.md
- .ai/validation/
- app/admin/(protected)/marketing/
- lib/marketing/
- tools/agent-router.ps1
- tools/approval-runner.ps1
- tools/db-runner.ps1
- tools/deepseek-runner.ps1
- tools/pr-runner.ps1
- tools/preview-runner.ps1
- tools/push-runner.ps1
- tools/qa-runner.ps1
- tools/release-runner.ps1
- tools/review-runner.ps1
- tools/validate-runner.ps1
- work/repair-loop-real-test.json

Task-generated changes:
- supabase/migrations/20260828103000_marketing_campaigns_attribution_v2.sql

## QA

Git Diff Check   : PASS - No whitespace/conflict-marker issues.
TypeScript       : SKIPPED - No .ts/.tsx files changed.
Targeted Tests   : SKIPPED - No test script configured in package.json for this area.
Production Build : FAIL -    Creating an optimized production build ... |  ✓ Compiled successfully in 9.7s |    Linting and checking validity of types ... |    Collecting page data ... |    Generating static pages (0/82) ... | Error occurred prerendering page "/". Read more: https://nextjs.org/docs/messages/prerender-error | Error: Supabase environment variables are not configured. |     at f (D:\Projects\terasuniversal-website-clean-repair-loop\.next\server\app\page.js:1:449) |     at j.tags (D:\Projects\terasuniversal-website-clean-repair-loop\.next\server\app\page.js:1:1761) |     at <unknown> (D:\Projects\terasuniversal-website-clean-repair-loop\.next\server\chunks\6780.js:1:10336) |     at async B (D:\Projects\terasuniversal-website-clean-repair-loop\.next\server\app\page.js:2:21293) { |   digest: '3338936453' | } | Export encountered an error on /page: /, exiting the build. |  ⨯ Next.js build worker exited with code: 1 and signal: null

## Independent Review

Review Verdict: PASS_WITH_NOTES

## Push / Preview (Phase 4)

Branch: (not yet pushed)
Push Target: (none)
Preview Status: NOT_STARTED
Preview URL: (none)
Preview Verification: NOT_STARTED
Preview Approved: NO
Production Deployment Allowed: NO

## PR / Release (Phase 5)

PR: (not prepared)
Migration Detected: NO
Environment Change Detected: NO
Release Eligibility: NOT_STARTED
Release Approved: NO
Merge Status: NOT_STARTED
Production Deployment: NOT_STARTED
Production Verification: NOT_STARTED

## Database Safety (Phase 7)

Database Task: YES
Database State: DB_PREPARING
Database Risk: (not yet classified)
Migration File: (none)
Static Validation: NOT_RUN
Codex Database Review: NOT_REQUIRED
Migration Approved: NO
Migration Apply Approved: NO
Migration Apply Status: NOT_STARTED

## Permissions

Scope Lock: ON
Full Repo Audit: OFF

Database Changes Allowed: NO
Migration Allowed: NO
Commit Allowed: NO
Push Allowed: NO
Deploy Allowed: NO

Human Approval: REQUIRED

## Required Verification

- [ ] Inspect relevant code
- [ ] Implement change within Approved Scope only
- [ ] Targeted verification (manual check of the specific behavior changed)
- [ ] npx tsc --noEmit
- [ ] Targeted tests, if any exist for this area
- [ ] git diff --check
- [ ] npm run build (final step only, once)
- [ ] Codex independent review (REQUIRED for HIGH risk)
- [ ] Human approval before commit/push/deploy/migration
