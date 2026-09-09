import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeTaskIntent } from "./hermes-task-intent.mjs";
import { createFinalDecision, persistDecisionRecord, readDecisionRecord } from "./hermes-decision.mjs";
import { buildAuditTimeline, buildOperatorSummary, controlledActionAuditResponse, normalizeApprovalRecord, persistApprovalRecord, validatePersistedApprovalBinding } from "./hermes-audit.mjs";
import { HERMES_WORKSPACE } from "./hermes-project-config.mjs";

const context = (overrides = {}) => ({ ProjectId: "teras-universal-website", ActiveWorkspace: HERMES_WORKSPACE, WorkspaceRole: "ISOLATED_HERMES", Branch: "isolate/hermes-source", HeadSha: "head-1", StatusFingerprint: "status-1", Blockers: [], ...overrides });
const task = (overrides = {}) => ({ TaskId: "H5-TASK", Description: "Update Hermes routing", Risk: "MEDIUM", State: "ROUTED", HumanApprovalRequired: "NOT_REQUIRED", HumanDecision: "PENDING", RepairCyclesUsed: 0, ClaudeReviewStatus: "NOT_STARTED", ...overrides });

test("pending and approved approvals produce clear operator actions", () => {
  const intent = analyzeTaskIntent({ taskId: "H5-TASK", description: "Harden Hermes process supervision" });
  const waitingDecision = createFinalDecision({ taskId: "H5-TASK", intent, projectContext: context(), approvalState: "MISSING" });
  const pending = normalizeApprovalRecord({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED" }), intent, projectContext: context(), decision: waitingDecision });
  const pendingView = buildOperatorSummary({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED" }), intent, projectContext: context(), decision: waitingDecision, approval: pending });
  assert.equal(pending.ApprovalState, "PENDING");
  assert.equal(pendingView.RequiredHumanAction, "APPROVE");
  const approvedDecision = createFinalDecision({ taskId: "H5-TASK", intent, projectContext: context(), approvalState: "APPROVED" });
  const approved = normalizeApprovalRecord({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: "APPROVED" }), intent, projectContext: context(), decision: approvedDecision });
  const approvedView = buildOperatorSummary({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: "APPROVED" }), intent, projectContext: context(), decision: approvedDecision, approval: approved });
  assert.equal(approved.ApprovalState, "APPROVED");
  assert.equal(approvedView.ApprovalValid, true);
});

test("rejected, revoked, expired, and changed-context approvals cannot execute", () => {
  const intent = analyzeTaskIntent({ taskId: "H5-TASK", description: "Harden Hermes process supervision" });
  const decision = createFinalDecision({ taskId: "H5-TASK", intent, projectContext: context(), approvalState: "APPROVED" });
  for (const humanDecision of ["REJECTED", "REVOKED"]) {
    const approval = normalizeApprovalRecord({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: humanDecision }), intent, projectContext: context(), decision });
    assert.equal(approval.ApprovalState, humanDecision);
    assert.equal(buildOperatorSummary({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: humanDecision }), intent, projectContext: context(), decision, approval }).ApprovalValid, false);
  }
  const expiredDecision = createFinalDecision({ taskId: "H5-TASK", intent, projectContext: context(), approvalState: "APPROVED", now: new Date("2020-01-01T00:00:00Z"), ttlMs: 1000 });
  const expired = normalizeApprovalRecord({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: "APPROVED" }), intent, projectContext: context(), decision: expiredDecision, now: new Date("2020-01-01T00:01:00Z") });
  assert.equal(expired.ApprovalState, "EXPIRED");
  const changed = normalizeApprovalRecord({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: "APPROVED" }), intent: { ...intent, Risk: "CRITICAL" }, projectContext: context(), decision, existing: normalizeApprovalRecord({ task: task({ Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: "APPROVED" }), intent, projectContext: context(), decision }) });
  assert.equal(changed.ApprovalState, "INVALIDATED");
});

test("H-1 persisted approval binding blocks every material context drift", () => {
  const intent = { TaskId: "H1-APPROVAL", Domain: "HERMES_RELIABILITY", OperationType: "SOURCE_EDIT", Risk: "HIGH", RequiresHumanApproval: true, AllowedPathFamilies: ["tools/**"], ProtectedPathFamilies: ["app/**"], Dependencies: [], Conflicts: [], ImplementerProvider: "Anthropic", ImplementerModel: "Claude Sonnet 5", ReviewerProvider: "OpenAI Codex", ReviewerModel: "GPT-5.6 Luna", ValidationRequirements: ["targeted tests"] };
  const approvedDecision = createFinalDecision({ taskId: "H1-APPROVAL", intent, projectContext: context(), approvalState: "APPROVED", now: new Date("2026-01-01T00:00:00Z"), ttlMs: 60_000 });
  const approval = normalizeApprovalRecord({ task: task({ TaskId: "H1-APPROVAL", Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: "APPROVED" }), intent, projectContext: context(), decision: approvedDecision, now: new Date("2026-01-01T00:00:00Z") });
  assert.equal(validatePersistedApprovalBinding(approval, approvedDecision, { now: new Date("2026-01-01T00:00:30Z") }).valid, true);
  assert.equal(validatePersistedApprovalBinding(null, approvedDecision).code, "APPROVAL_MISSING");
  for (const [label, changed] of [
    ["description", { ...intent, RequestedOutcome: "different" }],
    ["operation", { ...intent, OperationType: "DATABASE_CHANGE" }],
    ["risk", { ...intent, Risk: "CRITICAL" }],
    ["scope", { ...intent, AllowedPathFamilies: ["tools/other/**"] }],
    ["model", { ...intent, ImplementerModel: "GPT-5.6 Luna", ImplementerProvider: "OpenAI Codex" }],
  ]) {
    const changedDecision = createFinalDecision({ taskId: "H1-APPROVAL", intent: changed, projectContext: context(), approvalState: "APPROVED", now: new Date("2026-01-01T00:00:00Z"), ttlMs: 60_000 });
    assert.equal(validatePersistedApprovalBinding(approval, changedDecision).valid, false, label);
  }
  for (const [label, changedContext] of [
    ["workspace", context({ ActiveWorkspace: "D:\\Projects\\other" })],
    ["branch", context({ Branch: "other" })],
    ["head", context({ HeadSha: "head-2" })],
    ["status", context({ StatusFingerprint: "status-2" })],
  ]) {
    const changedDecision = createFinalDecision({ taskId: "H1-APPROVAL", intent, projectContext: changedContext, approvalState: "APPROVED", now: new Date("2026-01-01T00:00:00Z"), ttlMs: 60_000 });
    assert.equal(validatePersistedApprovalBinding(approval, changedDecision).valid, false, label);
  }
  for (const state of ["EXPIRED", "REVOKED", "REJECTED", "PENDING"]) {
    assert.equal(validatePersistedApprovalBinding({ ...approval, ApprovalState: state }, approvedDecision).valid, false, state);
  }
});

test("operator summary exposes bounded execution, review, repair, and human-action state", () => {
  const intent = analyzeTaskIntent({ taskId: "H5-TASK", description: "Update Hermes routing" });
  const decision = createFinalDecision({ taskId: "H5-TASK", intent, projectContext: context() });
  const summary = buildOperatorSummary({ task: task({ ExecutionStatus: "COMPLETED", ExecutionAttempt: 1, ClaudeReviewStatus: "FAILED", ClaudeReviewFindings: ["finding"], RepairCyclesUsed: 2 }), intent, projectContext: context(), decision, executionLease: { status: "COMPLETED", heartbeatAt: "2026-01-01T00:00:00Z" } });
  assert.equal(summary.ExecutionStatus, "COMPLETED");
  assert.equal(summary.ExecutionLeaseStatus, "COMPLETED");
  assert.equal(summary.RepairAttempts, 2);
  assert.equal(summary.RepairAttemptsRemaining, 0);
  assert.equal(summary.RequiredHumanAction, "REVIEW_FINDINGS");
  assert.equal(summary.ReviewSummary.FindingCount, 1);
  const staleDecision = { ...decision, Decision: "ALLOW", ExpiresAt: "2020-01-01T00:00:00Z" };
  assert.equal(buildOperatorSummary({ task: task(), intent, projectContext: context(), decision: staleDecision }).RequiredHumanAction, "REFRESH_CONTEXT");
});

test("dependency, conflict, and review blockers map to explicit operator actions", () => {
  const intent = analyzeTaskIntent({ taskId: "H5-TASK", description: "Update Hermes routing" });
  for (const [code, action] of [["DEPENDENCY_INCOMPLETE", "RESOLVE_DEPENDENCY"], ["WRITE_CONFLICT", "RESOLVE_CONFLICT"]]) {
    const decision = { Decision: "WAITING_DEPENDENCY", DecisionReasonCodes: [code], ApprovalRequired: false, LeaseEligible: false, CreatedAt: "2026-01-01T00:00:00Z", ExpiresAt: "2099-01-01T00:00:00Z", AllowedPaths: [], ProtectedPaths: [] };
    assert.equal(buildOperatorSummary({ task: task(), intent, projectContext: context(), decision }).RequiredHumanAction, action);
  }
  const review = buildOperatorSummary({ task: task({ ClaudeReviewStatus: "FAILED" }), intent, projectContext: context(), decision: null });
  assert.equal(review.RequiredHumanAction, "REVIEW_FINDINGS");
});

test("timeline is bounded, ordered, and does not fabricate legacy events", () => {
  const timeline = buildAuditTimeline({ task: task({ CreatedAt: "2026-01-01T00:00:00Z", TransitionHistory: [{ timestamp: "2026-01-01T00:01:00Z", to: "ROUTED", reason: "routed" }], ClaudeReviewStartedAt: "2026-01-01T00:03:00Z", ClaudeReviewCompletedAt: "2026-01-01T00:04:00Z" }), decisionHistory: [{ TaskId: "H5-TASK", Decision: "ALLOW", CreatedAt: "2026-01-01T00:02:00Z", DecisionId: "d1", DecisionReasonCodes: [] }], approval: { TaskId: "H5-TASK", ApprovalId: "a1", ApprovalState: "APPROVED", CreatedAt: "2026-01-01T00:01:30Z", DecisionId: "d1", ApproverType: "HUMAN" }, executionEvents: [{ taskId: "H5-TASK", event: "FINALIZED", status: "COMPLETED", timestamp: "2026-01-01T00:05:00Z", executionId: "e1" }] });
  assert.equal(timeline.DataQuality, "DURABLE");
  assert.equal(timeline.Events[0].Type, "TASK_CREATED");
  assert.equal(timeline.Events.at(-1).Type, "EXECUTION_COMPLETED");
  const legacy = buildAuditTimeline({ task: task({ CreatedAt: null }) });
  assert.equal(legacy.DataQuality, "LEGACY_INCOMPLETE");
  assert.deepEqual(legacy.UnknownHistoricalEvents, ["TASK_LIFECYCLE_EVENTS"]);
});

test("decision and approval history survives restart without duplicate idempotent records", async () => {
  const root = await mkdtemp(join(tmpdir(), "hermes-h5-audit-"));
  try {
    const intent = analyzeTaskIntent({ taskId: "history", description: "Update Hermes routing" });
    const decision = createFinalDecision({ taskId: "history", intent, projectContext: context() });
    await persistDecisionRecord(root, decision);
    const approval = normalizeApprovalRecord({ task: task({ TaskId: "history", Risk: "HIGH", HumanApprovalRequired: "REQUIRED", HumanDecision: "APPROVED" }), intent, projectContext: context(), decision });
    await persistApprovalRecord(root, approval);
    const loaded = await readDecisionRecord(root, "history");
    assert.equal(loaded.InputFingerprint, decision.InputFingerprint);
    assert.equal(JSON.parse(await readFile(join(root, ".ai", "hermes-approvals", "history.json"))).ApprovalState, "APPROVED");
    assert.equal(JSON.stringify(loaded).includes("command"), false);
    assert.equal(JSON.stringify(loaded).includes("secret"), false);
    assert.equal(JSON.stringify(loaded).includes("prompt"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("controlled action response has consistent bounded fields", () => {
  const response = controlledActionAuditResponse({ action: "hermes_start_task", taskId: "H5-TASK", result: "BLOCKED", summary: { TaskId: "H5-TASK", DecisionStatus: "WAITING_APPROVAL", ApprovalStatus: "PENDING", DecisionReasonCodes: ["APPROVAL_MISSING"], RequiredHumanAction: "APPROVE", ExecutionStatus: "NOT_STARTED" } });
  assert.deepEqual(Object.keys(response), ["TaskId", "Action", "Result", "DecisionStatus", "ApprovalStatus", "ReasonCodes", "RequiredHumanAction", "ExecutionStatus"]);
  assert.equal(response.RequiredHumanAction, "APPROVE");
});
