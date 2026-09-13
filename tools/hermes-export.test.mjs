import test from "node:test";
import assert from "node:assert/strict";
import { buildOperatorEvidence, createAuditExport, planRetention, serializeAuditExport } from "./hermes-export.mjs";

const projectContext = {
  ProjectId: "teras-universal-website", ActiveWorkspace: "D:\\Projects\\_worktrees\\teras-hermes-source", Branch: "isolate/hermes-source", ProtectedPaths: ["app/**", "supabase/**"],
};
const intent = { TaskId: "task-low", Title: "Bounded Hermes tooling", RequestedOutcome: "Improve Hermes audit evidence", Domain: "HERMES_TOOLING", OperationType: "SOURCE_EDIT", Risk: "LOW", AllowedPathFamilies: ["tools/hermes-*.mjs"], ProtectedPathFamilies: ["app/**", "supabase/**"] };
const task = { TaskId: "task-low", Description: "Bounded Hermes tooling", State: "COMPLETED", ExecutionStatus: "COMPLETED", ExecutionId: "exec-1", ExecutionAttempt: 1, ImplementerProvider: "OpenAI Codex", ImplementerModel: "GPT-5.6 Luna", Reviewer: "Claude", RepairCyclesUsed: 0, ValidationSummary: "Targeted tests passed" };

test("completed task produces bounded deterministic evidence and digest", () => {
  const input = { task, intent, projectContext, decisionHistory: [{ DecisionId: "decision-1", Decision: "ALLOW", DecisionReasonCodes: [], CreatedAt: "2026-09-09T10:00:00Z", ExpiresAt: "2026-09-09T11:00:00Z", LeaseEligible: true, ImplementerProvider: "OpenAI Codex", ImplementerModel: "GPT-5.6 Luna" }], queueItem: { QueueItemId: "queue-1", TaskId: "task-low", QueueState: "COMPLETED", Priority: "P2", Dependencies: [], Conflicts: [] }, executionEvents: [{ ExecutionId: "exec-1", Attempt: 1, Provider: "OpenAI Codex", Model: "GPT-5.6 Luna", Status: "COMPLETED", StartedAt: "2026-09-09T10:01:00Z", CompletedAt: "2026-09-09T10:02:00Z", LeaseState: "COMPLETED" }], timeline: { DataQuality: "DURABLE", Events: [] }, operatorSummary: { Blockers: [], RequiredHumanAction: "NONE" } };
  const first = createAuditExport({ ...input, now: new Date("2026-09-09T12:00:00Z") });
  const second = createAuditExport({ ...input, now: new Date("2026-09-10T12:00:00Z") });
  assert.equal(first.FinalState, "COMPLETED");
  assert.equal(first.ExecutionHistory[0].Status, "COMPLETED");
  assert.equal(first.ExportDigest, second.ExportDigest);
  assert.equal(first.DataQuality, "DURABLE");
  assert.equal(buildOperatorEvidence(first).EvidenceStatus, "COMPLETED");
});

test("approval, interruption, failure, review, repair, and queue evidence remain bounded", () => {
  const exported = createAuditExport({ task: { ...task, State: "BLOCKED", ExecutionStatus: "INTERRUPTED", RepairCyclesUsed: 2, ClaudeReviewStatus: "CHANGES_REQUIRED", ClaudeReviewFindings: [{ severity: "HIGH", hiddenReasoning: "do not export" }], ReviewVerdict: "CHANGES_REQUIRED" }, intent: { ...intent, Risk: "HIGH" }, projectContext, approval: { ApprovalId: "approval-1", ApprovalState: "APPROVED", ApprovedRisk: "HIGH", ApprovedWorkspace: projectContext.ActiveWorkspace, ApprovedBranch: projectContext.Branch, ApprovedHead: "abc", InputFingerprint: "fp", CreatedAt: "2026-09-09T10:00:00Z" }, decisionHistory: [{ DecisionId: "decision-1", Decision: "ALLOW", CreatedAt: "2026-09-09T10:00:00Z", LeaseEligible: true }], queueItem: { QueueItemId: "queue-1", TaskId: "task-low", QueueState: "WAITING_CONFLICT", Priority: "P1", Dependencies: ["prereq"], Conflicts: ["other"], BlockReasonCodes: ["WRITE_CONFLICT"] }, queueEvents: [{ Type: "TASK_WAITING_CONFLICT", Timestamp: "2026-09-09T10:00:00Z", Summary: "Conflict detected", ReasonCodes: ["WRITE_CONFLICT"] }], executionEvents: [{ ExecutionId: "exec-2", Attempt: 1, Provider: "OpenAI Codex", Model: "GPT-5.6 Luna", Status: "INTERRUPTED", LeaseState: "INTERRUPTED" }], timeline: { DataQuality: "DURABLE", Events: [] }, operatorSummary: { Blockers: ["WRITE_CONFLICT"], RequiredHumanAction: "RESOLVE_CONFLICT" } });
  assert.equal(exported.ApprovalHistory[0].ApprovalState, "APPROVED");
  assert.equal(exported.ExecutionHistory[0].InterruptedFlag, true);
  assert.equal(exported.FinalState, "BLOCKED");
  assert.equal(exported.ReviewHistory[0].FindingCount, 1);
  assert.equal(exported.RepairHistory[0].RepairAttemptsRemaining, 0);
  assert.equal(exported.QueueHistory.Current.WaitingReason[0], "WRITE_CONFLICT");
  assert.equal(exported.QueueHistory.History[0].Type, "TASK_WAITING_CONFLICT");
});

test("legacy missing fields are explicit and no fictional success is created", () => {
  const exported = createAuditExport({ task: { TaskId: "legacy-1", State: "RUNNING" }, intent: { TaskId: "legacy-1", Domain: "UNKNOWN" }, projectContext, timeline: { DataQuality: "LEGACY_INCOMPLETE", Events: [] } });
  assert.equal(exported.DataQuality, "LEGACY_INCOMPLETE");
  assert.ok(exported.MissingFields.includes("HistoricalLifecycleEvents"));
  assert.equal(exported.FinalState, "RUNNING");
  assert.equal(exported.ExecutionHistory.length, 0);
  assert.equal(exported.ApprovalHistory.length, 0);
});

test("synthetic secrets, commands, and PII are redacted or excluded", () => {
  const exported = createAuditExport({ task: { ...task, Description: "OPENAI_API_KEY=sk-test user@example.com +60123456789 powershell.exe -Command secret" }, intent: { ...intent, RequestedOutcome: "Authorization: Bearer test-token; SUPABASE_SERVICE_ROLE_KEY=service-test; customer@example.com" }, projectContext, timeline: { DataQuality: "DURABLE", Events: [] } });
  const serialized = serializeAuditExport(exported);
  for (const forbidden of ["sk-test", "service-test", "test-token", "user@example.com", "customer@example.com", "+60123456789", "powershell.exe"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  for (const forbiddenField of ["prompt", "chainOfThought", "rawCommand", "commandLine", "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) assert.equal(serialized.includes(forbiddenField), false, forbiddenField);
});

test("retention planner is dry-run, reference-safe, and has no delete action", () => {
  const now = new Date("2026-09-09T00:00:00Z");
  const result = planRetention([
    { TaskId: "active", Active: true },
    { TaskId: "approval", OpenApproval: true },
    { TaskId: "review", OpenReview: true },
    { TaskId: "repair", OpenRepair: true },
    { TaskId: "dependency", State: "COMPLETED", CompletedAt: "2026-01-01T00:00:00Z" },
    { TaskId: "recent", State: "COMPLETED", CompletedAt: "2026-09-01T00:00:00Z" },
    { TaskId: "old", State: "COMPLETED", CompletedAt: "2026-01-01T00:00:00Z" },
    { TaskId: "legacy", LegacyIncomplete: true },
    { TaskId: "blocked", UnresolvedBlocker: true },
    { TaskId: "unknown", IntegrityUnknown: true },
  ], { now, references: { DependencyTaskIds: ["dependency"] } });
  const byId = new Map(result.map((item) => [item.ArtifactId, item]));
  assert.equal(byId.get("active").Action, "KEEP");
  assert.equal(byId.get("approval").Action, "KEEP");
  assert.equal(byId.get("review").Action, "KEEP");
  assert.equal(byId.get("repair").Action, "KEEP");
  assert.equal(byId.get("dependency").Action, "KEEP");
  assert.equal(byId.get("recent").Action, "KEEP");
  assert.equal(byId.get("old").Action, "ARCHIVE_ELIGIBLE");
  assert.equal(byId.get("legacy").Action, "REVIEW_REQUIRED");
  assert.equal(byId.get("blocked").Action, "KEEP");
  assert.equal(byId.get("unknown").Action, "REVIEW_REQUIRED");
  assert.equal(result.some((item) => item.Action === "DELETE"), false);
});

test("export generation does not mutate source records and evidence survives reconstruction", () => {
  const source = { task: { ...task }, intent: { ...intent }, projectContext, timeline: { DataQuality: "DURABLE", Events: [] } };
  const before = JSON.stringify(source);
  const exported = createAuditExport(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(buildOperatorEvidence(exported).TaskId, "task-low");
});

