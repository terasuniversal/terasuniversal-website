# CURRENT_TASK

> This file is regenerated from `.ai/task-state.json` by `tools/agent-router.ps1` - never hand-edit one without the other going stale.

Task ID: TERAS-20260813-200548
Created At: 2026-08-13 20:05:48
Category: Attendance / UI / Print
Risk: LOW
Description: Fix mobile alignment and spacing on the existing attendance print page only. The existing implementation is in app/admin/(protected)/attendance/[scheduleId]/print/page.tsx and app/admin/(protected)/attendance/[scheduleId]/print/PrintButton.tsx. Modify only these existing files if necessary. Do not create new HTML pages or replacement print implementations. Preserve attendance data loading, attendance business rules, participant signatures, trainer signature, session grouping, and print behavior. UI/layout/responsive changes only.

State: BLOCKED
Human Decision: PENDING
Repair Cycles Used: 0 / 1

Implementer: Claude Code
Implementer Model: CLAUDE_FAST
Original Implementer: DeepSeek
Current Implementer: Claude Code
Fallback Implementer: Claude Code
Fallback Model: CLAUDE_FAST
Fallback Type: STALE_AGENT_RESULT
Fallback Reason: STALE_AGENT_RESULT - the existing DeepSeek report no longer reflects the current attempt (Task ID or source-context fingerprint mismatch - see Test-DeepSeekReportStale). Its findings are preserved below for reference but its Escalation Required/Reason are NOT treated as current.

Reviewer: None
Reviewer Model: None

Reason for Model Selection:
Explicit attendance-module signal takes precedence over generic visual keyword matching - routed as an Attendance UI change, not Certificate / Visual. DeepSeek is the preferred owner for routine UI/print work.

## Approved Scope

Scope Source: EXPLICIT_TASK_PATHS

Allowed Files:
- app/admin/(protected)/attendance/[scheduleId]/print/page.tsx
- app/admin/(protected)/attendance/[scheduleId]/print/PrintButton.tsx

Blocked Files:
- (fill in before implementation begins)

Scope Check: FAIL

## Changed Files

Pre-existing changes (excluded from this task):
- .gitignore
- app/admin/(protected)/participants/import/ImportClient.tsx
- app/admin/(protected)/participants/import/importActions.ts
- app/admin/admin.css
- components/admin/ProfessionalScaffoldCertificateDocument.tsx
- lib/admin-nav.ts
- lib/auth/rbac.ts
- lib/professional-scaffold-certificate-html.ts
- lib/validation/schemas.ts
- public/downloads/TERAS-UNIVERSAL-Company-Profile.pdf
- .ai/
- COURSE_DATA_CLEANUP_PLAN.md
- POST_PUSH_PRODUCTION_VERIFY.md
- PRODUCTION_SMOKE_TEST.md
- app/admin/(protected)/sales/
- ceo-dashboard-audit/
- components/admin/sales/
- docs/reference/
- lib/sales/
- public/certificates/template-a/teras-symbol-v1.png
- supabase/migrations/20260812120000_standard_scaffold_certificate_template.sql
- supabase/seed.sql
- tools/

Task-generated changes:
- app/globals.css
- supabase/.temp/

## QA

Git Diff Check   : SKIPPED - Not run yet.
TypeScript       : SKIPPED - Not run yet.
Targeted Tests   : SKIPPED - Not run yet.
Production Build : SKIPPED - Not run yet.

## Independent Review

Review Verdict: NOT_REQUIRED

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

Database Task: NO
Database State: DB_NOT_REQUIRED
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

Human Approval: NOT REQUIRED

## Required Verification

- [ ] Inspect relevant code
- [ ] Implement change within Approved Scope only
- [ ] Targeted verification (manual check of the specific behavior changed)
- [ ] npx tsc --noEmit
- [ ] Targeted tests, if any exist for this area
- [ ] git diff --check
- [ ] npm run build (final step only, once)
