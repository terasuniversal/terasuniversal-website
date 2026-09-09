import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { evaluateDecisionFreshness } from "./hermes-decision.mjs";

const APPROVAL_STATES = new Set(["PENDING", "APPROVED", "REJECTED", "REVOKED", "EXPIRED", "INVALIDATED"]);
const unique = (values) => [...new Set(values.filter(Boolean))];
const bounded = (value, max = 500) => String(value ?? "").slice(0, max);

function reasonToAction(codes = [], { approvalRequired = false, reviewStatus = null, repairRequired = false } = {}) {
  if (codes.includes("APPROVAL_MISSING") || (approvalRequired && !codes.includes("APPROVAL_REQUIRED"))) return "APPROVE";
  if (codes.includes("STALE_DECISION") || codes.includes("STALE_CONTEXT") || codes.includes("HEAD_DRIFT") || codes.includes("BRANCH_MISMATCH") || codes.includes("STATUS_FINGERPRINT_DRIFT") || codes.includes("STALE_PROJECT_CONTEXT")) return "REFRESH_CONTEXT";
  if (codes.includes("DEPENDENCY_INCOMPLETE")) return "RESOLVE_DEPENDENCY";
  if (codes.includes("WRITE_CONFLICT")) return "RESOLVE_CONFLICT";
  if (reviewStatus === "FAILED" || reviewStatus === "CHANGES_REQUIRED") return "REVIEW_FINDINGS";
  if (repairRequired) return "APPROVE_REPAIR";
  if (codes.length) return "MANUAL_INTERVENTION";
  return "NONE";
}

export function normalizeApprovalRecord({ task = null, decision = null, intent = null, projectContext = null, now = new Date(), existing = null } = {}) {
  const required = Boolean(decision?.ApprovalRequired || task?.HumanApprovalRequired === "REQUIRED");
  if (!required && !existing) return null;
  const approved = task?.HumanDecision === "APPROVED" || decision?.ApprovalState === "APPROVED";
  const rejected = task?.HumanDecision === "REJECTED";
  const revoked = task?.HumanDecision === "REVOKED";
  const decisionFreshness = decision && intent && projectContext ? evaluateDecisionFreshness(decision, { taskId: task?.TaskId ?? decision.TaskId, intent, projectContext, approvalState: decision.ApprovalState }) : { valid: true };
  let state = existing?.ApprovalState ?? (rejected ? "REJECTED" : revoked ? "REVOKED" : approved ? "APPROVED" : "PENDING");
  let invalidationReason = existing?.InvalidationReason ?? null;
  if (state === "APPROVED" && decision) {
    if (Date.parse(decision.ExpiresAt ?? "") <= now.getTime()) { state = "EXPIRED"; invalidationReason = "Decision expiry elapsed."; }
    else if (decisionFreshness.valid === false && decisionFreshness.code !== "LEASE_NOT_ELIGIBLE") { state = "INVALIDATED"; invalidationReason = decisionFreshness.reason; }
  }
  if (!APPROVAL_STATES.has(state)) state = "PENDING";
  return {
    ApprovalId: existing?.ApprovalId ?? `approval-${randomUUID()}`,
    TaskId: task?.TaskId ?? decision?.TaskId ?? existing?.TaskId ?? null,
    DecisionId: decision?.DecisionId ?? existing?.DecisionId ?? null,
    ApproverType: existing?.ApproverType ?? (required ? "HUMAN" : "POLICY"),
    ApprovalState: state,
    ApprovedRisk: existing?.ApprovedRisk ?? decision?.Risk ?? task?.Risk ?? null,
    ApprovedWorkspace: existing?.ApprovedWorkspace ?? decision?.Workspace ?? task?.WorkspaceBoundary?.CanonicalWorkspace ?? null,
    ApprovedBranch: existing?.ApprovedBranch ?? decision?.Branch ?? null,
    ApprovedHead: existing?.ApprovedHead ?? decision?.ObservedHeadSha ?? null,
    ApprovedStatusFingerprint: existing?.ApprovedStatusFingerprint ?? decision?.StatusFingerprint ?? null,
    ApprovedScope: existing?.ApprovedScope ?? decision?.AllowedPaths ?? [],
    ApprovedImplementer: existing?.ApprovedImplementer ?? (decision ? { provider: decision.ImplementerProvider, model: decision.ImplementerModel } : null),
    ApprovedReviewer: existing?.ApprovedReviewer ?? (decision ? { provider: decision.ReviewerProvider, model: decision.ReviewerModel } : null),
    InputFingerprint: existing?.InputFingerprint ?? decision?.InputFingerprint ?? null,
    CreatedAt: existing?.CreatedAt ?? decision?.CreatedAt ?? now.toISOString(),
    ExpiresAt: existing?.ExpiresAt ?? decision?.ExpiresAt ?? null,
    RevokedAt: existing?.RevokedAt ?? (state === "REVOKED" ? now.toISOString() : null),
    InvalidatedAt: existing?.InvalidatedAt ?? (state === "INVALIDATED" ? now.toISOString() : null),
    InvalidationReason: invalidationReason,
  };
}

export function approvalValidity(approval, { now = new Date() } = {}) {
  if (!approval) return { valid: true, status: "NOT_REQUIRED", reasonCodes: [] };
  if (approval.ApprovalState === "APPROVED" && Date.parse(approval.ExpiresAt ?? "") > now.getTime()) return { valid: true, status: "APPROVED", reasonCodes: [] };
  const code = approval.ApprovalState === "EXPIRED" ? "STALE_DECISION" : approval.ApprovalState === "INVALIDATED" ? "STALE_CONTEXT" : "APPROVAL_MISSING";
  return { valid: false, status: approval.ApprovalState, reasonCodes: [code] };
}

function event({ taskId, type, timestamp, actor = "Hermes", provider = null, model = null, attempt = null, decisionId = null, approvalId = null, executionId = null, summary = null, reasonCodes = [] }) {
  return { EventId: `event-${randomUUID()}`, TaskId: taskId, Type: type, Timestamp: timestamp, Actor: actor, Provider: provider, Model: model, Attempt: attempt, DecisionId: decisionId, ApprovalId: approvalId, ExecutionId: executionId, Summary: bounded(summary), ReasonCodes: unique(reasonCodes) };
}

export function buildAuditTimeline({ task = null, decisionHistory = [], approval = null, executionEvents = [], queueEvents = [], now = new Date() } = {}) {
  const events = [];
  const taskId = task?.TaskId ?? approval?.TaskId ?? decisionHistory[0]?.TaskId ?? null;
  if (task?.CreatedAt) events.push(event({ taskId, type: "TASK_CREATED", timestamp: task.CreatedAt, summary: "Task record created." }));
  for (const transition of task?.TransitionHistory ?? []) {
    if (transition?.timestamp && transition?.to) events.push(event({ taskId, type: transition.to === "ROUTED" ? "TASK_ROUTED" : transition.to === "BLOCKED" ? "TASK_BLOCKED" : transition.to === "COMPLETED" ? "TASK_COMPLETED" : "TASK_STATE_CHANGED", timestamp: transition.timestamp, summary: bounded(transition.reason), reasonCodes: transition.reason ? [transition.reason] : [] }));
  }
  for (const decision of decisionHistory) events.push(event({ taskId, type: decision.Decision === "ALLOW" ? "DECISION_ALLOWED" : "DECISION_BLOCKED", timestamp: decision.CreatedAt, actor: "Hermes", decisionId: decision.DecisionId, summary: decision.DecisionReason, reasonCodes: decision.DecisionReasonCodes }));
  if (approval?.CreatedAt) events.push(event({ taskId, type: "APPROVAL_REQUESTED", timestamp: approval.CreatedAt, actor: approval.ApproverType, approvalId: approval.ApprovalId, decisionId: approval.DecisionId, summary: "Approval record created." }));
  if (approval?.ApprovalState === "APPROVED") events.push(event({ taskId, type: "APPROVAL_GRANTED", timestamp: approval.CreatedAt, actor: approval.ApproverType, approvalId: approval.ApprovalId, decisionId: approval.DecisionId, summary: "Approval granted for the bound decision." }));
  if (approval?.ApprovalState === "REJECTED") events.push(event({ taskId, type: "APPROVAL_REJECTED", timestamp: approval.CreatedAt, actor: approval.ApproverType, approvalId: approval.ApprovalId, summary: "Approval rejected." }));
  for (const raw of executionEvents) {
    const map = { ACQUIRED: "LEASE_ACQUIRED", HEARTBEAT: "HEARTBEAT", FINALIZED: raw.status === "COMPLETED" ? "EXECUTION_COMPLETED" : raw.status === "INTERRUPTED" ? "EXECUTION_INTERRUPTED" : raw.status === "FAILED" ? "EXECUTION_FAILED" : "EXECUTION_FINALIZED", RECONCILED_INTERRUPTED: "EXECUTION_INTERRUPTED" };
    if (raw.timestamp && map[raw.event]) events.push(event({ taskId, type: map[raw.event], timestamp: raw.timestamp, actor: raw.agent ?? "Hermes", provider: raw.provider, model: raw.model, attempt: raw.attempt, executionId: raw.executionId, summary: raw.details ?? raw.status }));
  }
  const queueMap = {
    TASK_ENQUEUED: "TASK_ENQUEUED", TASK_READY: "TASK_READY", TASK_WAITING_APPROVAL: "TASK_WAITING_APPROVAL",
    TASK_WAITING_DEPENDENCY: "TASK_WAITING_DEPENDENCY", TASK_WAITING_CONFLICT: "TASK_WAITING_CONFLICT",
    DISPATCH_CLAIMED: "DISPATCH_CLAIMED", EXECUTION_DISPATCHED: "EXECUTION_DISPATCHED", TASK_CANCELLED: "TASK_CANCELLED",
  };
  for (const raw of queueEvents) {
    if (raw?.Timestamp && queueMap[raw.Type]) events.push(event({ taskId: raw.TaskId ?? taskId, type: queueMap[raw.Type], timestamp: raw.Timestamp, actor: raw.Actor ?? "Hermes Scheduler", provider: raw.Provider, model: raw.Model, attempt: raw.Attempt, decisionId: raw.DecisionId, approvalId: raw.ApprovalId, executionId: raw.ExecutionId, summary: raw.Summary, reasonCodes: raw.ReasonCodes }));
  }
  if (task?.ClaudeReviewStartedAt) events.push(event({ taskId, type: "REVIEW_REQUESTED", timestamp: task.ClaudeReviewStartedAt, actor: task.Reviewer ?? "Reviewer", provider: task.ReviewerProvider, model: task.ReviewerModel, summary: "Reviewer activity started." }));
  if (task?.ClaudeReviewCompletedAt) events.push(event({ taskId, type: "REVIEW_COMPLETED", timestamp: task.ClaudeReviewCompletedAt, actor: task.Reviewer ?? "Reviewer", summary: bounded(task.ClaudeReviewStatus) }));
  for (const handoff of task?.HandoffHistory ?? []) {
    if (handoff?.handoffType === "REPAIR" && handoff.timestamp) events.push(event({ taskId, type: "REPAIR_STARTED", timestamp: handoff.timestamp, actor: handoff.toAgent ?? "Codex", attempt: task.RepairCyclesUsed ?? null, summary: "Bounded repair handoff recorded." }));
  }
  const sorted = events.filter((item) => item.Timestamp).sort((a, b) => String(a.Timestamp).localeCompare(String(b.Timestamp)) || a.Type.localeCompare(b.Type));
  return { Events: sorted, DataQuality: sorted.length === 0 && task ? "LEGACY_INCOMPLETE" : "DURABLE", UnknownHistoricalEvents: sorted.length === 0 && task ? ["TASK_LIFECYCLE_EVENTS"] : [] };
}

export function buildOperatorSummary({ task = null, intent = null, projectContext = null, decision = null, approval = null, executionLease = null, timeline = null, now = new Date() } = {}) {
  const approvalStatus = approvalValidity(approval, { now });
  const decisionExpired = Boolean(decision && Date.parse(decision.ExpiresAt ?? "") <= now.getTime());
  const decisionStatus = decision ? (decisionExpired ? "STALE_DECISION" : decision.Decision) : "NONE";
  const decisionCodes = unique([...(decision?.DecisionReasonCodes ?? []), ...(decisionExpired ? ["STALE_DECISION"] : [])]);
  const reviewStatus = task?.ClaudeReviewStatus ?? "NOT_STARTED";
  const repairUsed = Number(task?.RepairCyclesUsed ?? 0);
  const repairLimit = 2;
  const reviewBlocked = ["FAILED", "CHANGES_REQUIRED"].includes(reviewStatus);
  const blockers = unique([...(task?.BlockingIssues ?? []), ...decisionCodes.filter((code) => !["APPROVAL_REQUIRED"].includes(code))]);
  const requiredHumanAction = reasonToAction(decisionCodes, { approvalRequired: Boolean(decision?.ApprovalRequired), reviewStatus, repairRequired: task?.State === "REPAIR_REQUIRED" });
  const leaseEligible = Boolean(decision?.LeaseEligible && decisionStatus === "ALLOW" && approvalStatus.valid);
  const ready = leaseEligible && blockers.length === 0 && !reviewBlocked && !["COMPLETED", "FAILED", "CANCELLED", "BLOCKED", "REPAIR_REQUIRED"].includes(task?.State);
  return {
    TaskId: task?.TaskId ?? intent?.TaskId ?? null, Title: intent?.Title ?? task?.Description ?? null, IntentSummary: bounded(intent?.RequestedOutcome ?? task?.Description), Domain: intent?.Domain ?? "UNKNOWN", OperationType: intent?.OperationType ?? "UNKNOWN", Risk: intent?.Risk ?? task?.Risk ?? null, RiskReasonCodes: intent?.RiskReasons ?? [],
    Workspace: projectContext?.ActiveWorkspace ?? intent?.SuggestedWorkspace ?? null, WorkspaceRole: projectContext?.WorkspaceRole ?? intent?.WorkspaceRole ?? "UNKNOWN", Branch: projectContext?.Branch ?? null, ExpectedHead: decision?.ExpectedHeadSha ?? intent?.ExpectedHeadSha ?? null, ObservedHead: projectContext?.HeadSha ?? null, WorkspaceStatus: projectContext?.WorkingTreeState ?? "UNKNOWN",
    AllowedScope: intent?.AllowedPathFamilies ?? decision?.AllowedPaths ?? [], ProtectedScope: intent?.ProtectedPathFamilies ?? decision?.ProtectedPaths ?? [], Dependencies: intent?.Dependencies ?? [], Conflicts: intent?.Conflicts ?? [], DecompositionStatus: intent?.DecompositionRequired ? "REQUIRED" : "NOT_REQUIRED",
    Implementer: { provider: intent?.ImplementerProvider ?? decision?.ImplementerProvider ?? null, model: intent?.ImplementerModel ?? decision?.ImplementerModel ?? null }, Reviewer: { provider: intent?.ReviewerProvider ?? decision?.ReviewerProvider ?? null, model: intent?.ReviewerModel ?? decision?.ReviewerModel ?? null }, ApprovalRequired: Boolean(decision?.ApprovalRequired || intent?.RequiresHumanApproval), ApprovalStatus: approvalStatus.status, ApprovalValid: approvalStatus.valid, ApprovalBoundFingerprint: approval?.InputFingerprint ?? null,
    DecisionStatus: decisionStatus, DecisionReasonCodes: decisionCodes, DecisionCreatedAt: decision?.CreatedAt ?? null, DecisionExpiresAt: decision?.ExpiresAt ?? null, DecisionStale: Boolean(decision && decisionStatus !== "ALLOW"), ExecutionStatus: task?.ExecutionStatus ?? "NOT_STARTED", ExecutionAttempt: Number(task?.ExecutionAttempt ?? 0), ExecutionLeaseStatus: executionLease?.status ?? "NONE", LastHeartbeat: executionLease?.heartbeatAt ?? task?.ExecutionHeartbeatAt ?? null,
    ReviewStatus: reviewStatus, ReviewSummary: { FindingCount: Array.isArray(task?.ClaudeReviewFindings) ? task.ClaudeReviewFindings.length : 0, FindingSeverities: unique((task?.ClaudeReviewFindings ?? []).map((finding) => typeof finding === "object" ? finding.severity ?? "UNKNOWN" : "UNKNOWN")), ReviewDecision: task?.ReviewVerdict ?? task?.ClaudeReviewStatus ?? "UNKNOWN", OutstandingFindings: task?.BlockingIssues ?? [] }, RepairAttempts: repairUsed, RepairLimit: repairLimit, RepairAttemptsRemaining: Math.max(0, repairLimit - repairUsed), Blockers: blockers, RequiredHumanAction: ready ? "NONE" : requiredHumanAction, ApprovalBound: approvalStatus.valid && approval?.ApprovalState === "APPROVED", LeaseEligible: leaseEligible, ReadyForExecution: ready, AuditEventCount: timeline?.Events?.length ?? 0, LastUpdatedAt: now.toISOString(),
  };
}

export function controlledActionAuditResponse({ action, taskId, result, summary, decision = null } = {}) {
  return { TaskId: taskId ?? summary?.TaskId ?? null, Action: action, Result: result ?? null, DecisionStatus: summary?.DecisionStatus ?? decision?.Decision ?? "UNKNOWN", ApprovalStatus: summary?.ApprovalStatus ?? "UNKNOWN", ReasonCodes: summary?.DecisionReasonCodes ?? [], RequiredHumanAction: summary?.RequiredHumanAction ?? "MANUAL_INTERVENTION", ExecutionStatus: summary?.ExecutionStatus ?? "UNKNOWN" };
}

export async function persistApprovalRecord(root, approval) {
  const key = String(approval?.TaskId ?? "planned").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  const directory = join(root, ".ai", "hermes-approvals");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${key}.json`);
  const history = join(directory, `${key}.jsonl`);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(approval, null, 2), "utf8");
  await rename(temp, path);
  await writeFile(history, `${JSON.stringify(approval)}\n`, { encoding: "utf8", flag: "a" });
  return path;
}

async function readJson(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; } }
async function readJsonLines(path) { try { return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } }

export async function readAuditInputs(root, taskId) {
  if (!taskId) return { decisionHistory: [], approval: null, executionEvents: [] };
  const key = String(taskId).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  return {
    decisionHistory: await readJsonLines(join(root, ".ai", "hermes-decisions", `${key}.jsonl`)),
    approval: await readJson(join(root, ".ai", "hermes-approvals", `${key}.json`)),
    executionEvents: await readJsonLines(join(root, ".ai", "hermes-execution", `${key}.journal.jsonl`)),
    queueEvents: await readJsonLines(join(root, ".ai", "hermes-queue", "events.jsonl")),
  };
}
