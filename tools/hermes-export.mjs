import { createHash } from "node:crypto";
import { MAX_AUTOMATIC_REPAIR_ATTEMPTS } from "./hermes-repair-policy.mjs";

export const EXPORT_VERSION = "H7.0";
export const RETENTION_ACTIONS = ["KEEP", "ARCHIVE_ELIGIBLE", "REVIEW_REQUIRED", "NEVER_DELETE_AUTOMATICALLY"];
export const DEFAULT_HISTORICAL_RETENTION_DAYS = 30;

function redact(value) {
  let textValue = String(value);
  if (/openai_api_key|supabase_service_role_key|toyyibpay|authorization\s*:\s*bearer|password\s*[:=]|service[_ -]?role/i.test(textValue)) textValue = "[REDACTED_SENSITIVE_VALUE]";
  if (/\b(powershell(?:\.exe)?|cmd(?:\.exe)?|bash|sh)\b|\bgit\s+(?:commit|push|merge|rebase)|supabase\s+(?:db|migration)|curl\s+.*(?:token|authorization)/i.test(textValue)) textValue = "[REDACTED_COMMAND]";
  textValue = textValue.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  textValue = textValue.replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[REDACTED_IDENTIFIER]");
  return textValue;
}

const bounded = (value, max = 500) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const safe = redact(value);
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
};
const list = (value, max = 50) => Array.isArray(value) ? value.slice(0, max).map((item) => bounded(item, 240)) : [];
const unique = (values) => [...new Set((values ?? []).filter(Boolean).map(String))];
const timestamp = (value) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const safeStatus = (value, fallback = "UNKNOWN") => bounded(value, 100) ?? fallback;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) { return createHash("sha256").update(stable(value), "utf8").digest("hex"); }

function approvalEvidence(approval) {
  if (!approval) return [];
  return [{
    ApprovalId: bounded(approval.ApprovalId, 128), ApprovalState: safeStatus(approval.ApprovalState), ApprovedRisk: safeStatus(approval.ApprovedRisk),
    ApprovedWorkspace: bounded(approval.ApprovedWorkspace, 260), ApprovedBranch: bounded(approval.ApprovedBranch, 160), ApprovedHead: bounded(approval.ApprovedHead, 80),
    InputFingerprint: bounded(approval.InputFingerprint, 128), CreatedAt: timestamp(approval.CreatedAt), ExpiresAt: timestamp(approval.ExpiresAt),
    InvalidatedAt: timestamp(approval.InvalidatedAt), InvalidationReason: bounded(approval.InvalidationReason, 240),
  }];
}

function decisionEvidence(history = []) {
  return history.slice(-50).map((decision) => ({
    DecisionId: bounded(decision.DecisionId, 128), Decision: safeStatus(decision.Decision), DecisionReasonCodes: list(decision.DecisionReasonCodes),
    CreatedAt: timestamp(decision.CreatedAt), ExpiresAt: timestamp(decision.ExpiresAt), LeaseEligible: decision.LeaseEligible === true,
    ImplementerProvider: bounded(decision.ImplementerProvider, 100), ImplementerModel: bounded(decision.ImplementerModel, 160),
    ReviewerProvider: bounded(decision.ReviewerProvider, 100), ReviewerModel: bounded(decision.ReviewerModel, 160),
  }));
}

function queueEvidence(queueItem, queueEvents = []) {
  const item = queueItem ? {
    QueueItemId: bounded(queueItem.QueueItemId, 128), TaskId: bounded(queueItem.TaskId, 128), QueueState: safeStatus(queueItem.QueueState), Priority: safeStatus(queueItem.Priority),
    Dependencies: list(queueItem.Dependencies), Conflicts: list(queueItem.Conflicts), DispatchClaim: queueItem.Dispatch ? {
      DispatchId: bounded(queueItem.Dispatch.DispatchId, 128), ClaimedAt: timestamp(queueItem.Dispatch.ClaimedAt), ClaimExpiresAt: timestamp(queueItem.Dispatch.ClaimExpiresAt),
    } : null,
    ExecutionEligibility: queueItem.QueueState === "READY" ? "READY" : "NOT_READY", WaitingReason: list(queueItem.BlockReasonCodes, 10),
  } : null;
  const history = queueEvents.slice(-50).map((event) => ({ Type: bounded(event.Type, 100), Timestamp: timestamp(event.Timestamp), Summary: bounded(event.Summary, 240), ReasonCodes: list(event.ReasonCodes, 10) }));
  return { Current: item, History: history };
}

function executionEvidence(events = [], lease = null, task = null) {
  const source = events.length ? events : (task?.ExecutionStatus ? [{ ExecutionId: task.ExecutionId, Attempt: task.ExecutionAttempt, Provider: task.ImplementerProvider, Model: task.ImplementerModel, StartedAt: task.ExecutionStartedAt, CompletedAt: task.ExecutionCompletedAt, Status: task.ExecutionStatus, LeaseState: lease?.status, InterruptedFlag: task.ExecutionStatus === "INTERRUPTED", ValidationSummary: task.ValidationSummary }] : []);
  return source.slice(-50).map((event) => ({
    ExecutionId: bounded(event.executionId ?? event.ExecutionId, 128), Attempt: Number.isFinite(Number(event.attempt ?? event.Attempt)) ? Number(event.attempt ?? event.Attempt) : null,
    Provider: bounded(event.provider ?? event.Provider, 100), Model: bounded(event.model ?? event.Model, 160), StartedAt: timestamp(event.startedAt ?? event.StartedAt ?? event.timestamp),
    CompletedAt: timestamp(event.completedAt ?? event.CompletedAt), Status: safeStatus(event.status ?? event.Status), LeaseState: safeStatus(event.leaseState ?? event.LeaseState, "UNKNOWN"),
    InterruptedFlag: Boolean(event.status === "INTERRUPTED" || event.Status === "INTERRUPTED" || event.event === "RECONCILED_INTERRUPTED"), ValidationSummary: bounded(event.validationSummary ?? event.details, 300),
  }));
}

function reviewEvidence(task) {
  if (!task) return [];
  const findings = Array.isArray(task.ClaudeReviewFindings) ? task.ClaudeReviewFindings : [];
  return [{
    Reviewer: bounded(task.Reviewer, 120), ReviewStatus: safeStatus(task.ClaudeReviewStatus, "NOT_RECORDED"), FindingCount: findings.length,
    FindingSeveritySummary: unique(findings.map((finding) => typeof finding === "object" ? finding.severity ?? "UNKNOWN" : "UNKNOWN")),
    ReviewDecision: safeStatus(task.ReviewVerdict ?? task.ClaudeReviewStatus, "NOT_RECORDED"),
  }];
}

function repairEvidence(task) {
  const attempts = Number.isFinite(Number(task?.RepairCyclesUsed)) ? Number(task.RepairCyclesUsed) : 0;
  return [{ RepairAttemptsUsed: attempts, RepairAttemptsRemaining: Math.max(0, MAX_AUTOMATIC_REPAIR_ATTEMPTS - attempts), RepairLimit: MAX_AUTOMATIC_REPAIR_ATTEMPTS, RepairStatus: safeStatus(task?.State === "REPAIR_REQUIRED" ? "REPAIR_REQUIRED" : attempts ? "RECORDED" : "NOT_RECORDED") }];
}

export function createAuditExport({ task = null, intent = null, projectContext = null, approval = null, decisionHistory = [], queueItem = null, queueEvents = [], executionEvents = [], executionLease = null, timeline = null, operatorSummary = null, now = new Date() } = {}) {
  const taskId = bounded(task?.TaskId ?? intent?.TaskId, 128);
  const content = {
    ExportVersion: EXPORT_VERSION, ProjectId: bounded(projectContext?.ProjectId ?? intent?.ProjectId, 128), TaskId: taskId,
    Title: bounded(intent?.Title ?? task?.Description, 240), Domain: safeStatus(intent?.Domain, "UNKNOWN"), OperationType: safeStatus(intent?.OperationType, "UNKNOWN"),
    Risk: safeStatus(intent?.Risk ?? task?.Risk), Workspace: bounded(projectContext?.ActiveWorkspace ?? intent?.SuggestedWorkspace, 260), Branch: bounded(projectContext?.Branch, 160),
    IntentSummary: bounded(intent?.RequestedOutcome ?? task?.Description, 500), AllowedScope: list(intent?.AllowedPathFamilies ?? [], 50), ProtectedScope: list(intent?.ProtectedPathFamilies ?? projectContext?.ProtectedPaths ?? [], 50),
    ApprovalHistory: approvalEvidence(approval), DecisionHistory: decisionEvidence(decisionHistory), QueueHistory: queueEvidence(queueItem, queueEvents),
    ExecutionHistory: executionEvidence(executionEvents, executionLease, task), ReviewHistory: reviewEvidence(task), RepairHistory: repairEvidence(task),
    Blockers: list(operatorSummary?.Blockers ?? task?.BlockingIssues, 30), RequiredHumanActions: unique([operatorSummary?.RequiredHumanAction]).filter(Boolean),
    FinalState: safeStatus(task?.State ?? operatorSummary?.ExecutionStatus, "UNKNOWN"), ValidationSummary: bounded(task?.ValidationSummary ?? task?.ValidationResult, 500) ?? "NOT_RECORDED",
    SourceVersion: "H0-H7-DURABLE-STATE", DataQuality: timeline?.DataQuality ?? (task ? "LEGACY_INCOMPLETE" : "UNKNOWN"), MissingFields: [
      ...(approval ? [] : ["ApprovalHistory"]), ...(decisionHistory.length ? [] : ["DecisionHistory"]), ...(executionEvents.length || task?.ExecutionStatus ? [] : ["ExecutionHistory"]), ...(timeline?.DataQuality === "LEGACY_INCOMPLETE" ? ["HistoricalLifecycleEvents"] : []),
    ],
  };
  const normalizedForDigest = { ...content };
  const generatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const inputRecordCount = decisionHistory.length + queueEvents.length + executionEvents.length + (approval ? 1 : 0) + (timeline?.Events?.length ?? 0);
  return {
    ...content,
    GeneratedAt: generatedAt,
    InputRecordCount: inputRecordCount,
    ExportRecordCount: Object.values(content).reduce((count, value) => count + (Array.isArray(value) ? value.length : value && typeof value === "object" ? 1 : value !== null && value !== undefined ? 1 : 0), 0),
    ExportDigest: digest(normalizedForDigest),
  };
}

export function serializeAuditExport(exported) { return JSON.stringify(exported, null, 2); }

export function buildOperatorEvidence(exported) {
  if (!exported) return { EvidenceStatus: "UNKNOWN", Reason: "No task evidence is available." };
  return {
    EvidenceStatus: exported.FinalState, TaskId: exported.TaskId, Requested: exported.IntentSummary, Classification: { Domain: exported.Domain, OperationType: exported.OperationType, Risk: exported.Risk },
    Workspace: exported.Workspace, Branch: exported.Branch, AllowedScope: exported.AllowedScope, ProtectedScope: exported.ProtectedScope,
    Approval: exported.ApprovalHistory.at(-1) ?? { ApprovalState: "NOT_RECORDED" }, Decision: exported.DecisionHistory.at(-1) ?? { Decision: "NOT_RECORDED" },
    Queue: exported.QueueHistory.Current ?? { QueueState: "NOT_RECORDED" }, Execution: exported.ExecutionHistory.at(-1) ?? { Status: "NOT_RECORDED" },
    Review: exported.ReviewHistory.at(-1) ?? { ReviewStatus: "NOT_RECORDED" }, Repair: exported.RepairHistory.at(-1), Blockers: exported.Blockers,
    RequiredHumanActions: exported.RequiredHumanActions, ValidationSummary: exported.ValidationSummary, ExportDigest: exported.ExportDigest,
  };
}

function isReferenced(record, references = {}) {
  const id = record?.ArtifactId ?? record?.TaskId ?? record?.id;
  return [references.ActiveTaskIds, references.QueueTaskIds, references.DependencyTaskIds, references.ApprovalTaskIds, references.DecisionTaskIds, references.LeaseTaskIds, references.ReviewTaskIds, references.RepairTaskIds, references.AuditTaskIds].some((ids) => (ids ?? []).map(String).includes(String(id)));
}

export function planRetention(records = [], { now = new Date(), historicalAgeDays = DEFAULT_HISTORICAL_RETENTION_DAYS, references = {} } = {}) {
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  return records.map((record) => {
    const ageMs = record?.CompletedAt ? current - Date.parse(record.CompletedAt) : null;
    const oldTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(record?.State) && ageMs !== null && ageMs >= historicalAgeDays * 86_400_000;
    let action = "KEEP";
    let reasonCodes = ["RECENT_HISTORY"];
    if (record?.LegacyIncomplete || record?.DataQuality === "LEGACY_INCOMPLETE") { action = "REVIEW_REQUIRED"; reasonCodes = ["LEGACY_INCOMPLETE"]; }
    else if (record?.IntegrityUnknown) { action = "REVIEW_REQUIRED"; reasonCodes = ["INTEGRITY_UNKNOWN"]; }
    else if (record?.Active || record?.OpenApproval || record?.OpenReview || record?.OpenRepair || record?.UnresolvedBlocker) { action = "KEEP"; reasonCodes = [record.Active ? "ACTIVE_TASK" : record.OpenApproval ? "OPEN_APPROVAL" : record.OpenReview ? "OPEN_REVIEW" : record.OpenRepair ? "OPEN_REPAIR" : "UNRESOLVED_BLOCKER"]; }
    else if (isReferenced(record, references)) { action = "KEEP"; reasonCodes = ["DEPENDENCY_REFERENCED"]; }
    else if (oldTerminal) { action = "ARCHIVE_ELIGIBLE"; reasonCodes = ["TERMINAL_OLD"]; }
    return { ArtifactId: bounded(record?.ArtifactId ?? record?.TaskId ?? record?.id, 128), Category: safeStatus(record?.Category, record?.LegacyIncomplete ? "LEGACY_INCOMPLETE" : record?.Active ? "ACTIVE_RUNTIME" : "RECENT_AUDIT"), Action: action, ReasonCodes: reasonCodes };
  });
}
