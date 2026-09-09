import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DECISION_VALUES = ["ALLOW", "BLOCK", "WAITING_APPROVAL", "WAITING_DEPENDENCY", "DECOMPOSITION_REQUIRED", "WRITE_CONFLICT", "STALE_CONTEXT", "UNKNOWN_SCOPE"];
export const DECISION_REASON_CODES = [
  "WORKSPACE_MISMATCH", "BRANCH_MISMATCH", "HEAD_DRIFT", "STATUS_FINGERPRINT_DRIFT", "UNKNOWN_WORKSPACE", "UNKNOWN_DOMAIN",
  "PROTECTED_SCOPE", "MIXED_OWNERSHIP_REVIEW_REQUIRED", "APPROVAL_REQUIRED", "APPROVAL_MISSING", "DEPENDENCY_INCOMPLETE",
  "WRITE_CONFLICT", "DECOMPOSITION_REQUIRED", "MODEL_UNAVAILABLE", "LEASE_NOT_ELIGIBLE", "STALE_PROJECT_CONTEXT", "STALE_DECISION", "VALIDATION_PLAN_MISSING",
];

const bounded = (value, max = 4000) => String(value ?? "").slice(0, max);
const unique = (values) => [...new Set(values.filter(Boolean))];
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value ?? null;
};

export function decisionInputFingerprint({ taskId, projectContext, intent, approvalState = "NOT_REQUIRED", dependencies, conflicts }) {
  const input = stable({
    taskId,
    projectId: projectContext?.ProjectId,
    workspace: projectContext?.ActiveWorkspace,
    workspaceRole: projectContext?.WorkspaceRole,
    branch: projectContext?.Branch,
    expectedHeadSha: intent?.ExpectedHeadSha ?? null,
    observedHeadSha: projectContext?.HeadSha,
    statusFingerprint: projectContext?.StatusFingerprint,
    intent: intent?.Intent,
    domain: intent?.Domain,
    operationType: intent?.OperationType,
    risk: intent?.Risk,
    allowedPaths: intent?.AllowedPathFamilies,
    protectedPaths: intent?.ProtectedPathFamilies,
    dependencies: dependencies ?? intent?.Dependencies,
    conflicts: conflicts ?? intent?.Conflicts,
    decomposition: intent?.DecompositionRequired,
    approvalState,
    implementerProvider: intent?.ImplementerProvider,
    implementerModel: intent?.ImplementerModel,
    reviewerProvider: intent?.ReviewerProvider,
    reviewerModel: intent?.ReviewerModel,
  });
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

function baseDecision({ taskId, intent, projectContext, approvalState, now, expiresAt, decision, codes, reason }) {
  return {
    DecisionId: `decision-${randomUUID()}`,
    TaskId: taskId ?? null,
    Decision: decision,
    DecisionReasonCodes: unique(codes),
    DecisionReason: bounded(reason, 500),
    ProjectId: projectContext?.ProjectId ?? intent?.ProjectId ?? "teras-universal-website",
    Workspace: projectContext?.ActiveWorkspace ?? intent?.SuggestedWorkspace ?? null,
    WorkspaceRole: projectContext?.WorkspaceRole ?? intent?.WorkspaceRole ?? "UNKNOWN",
    Branch: projectContext?.Branch ?? null,
    ExpectedHeadSha: intent?.ExpectedHeadSha ?? null,
    ObservedHeadSha: projectContext?.HeadSha ?? null,
    StatusFingerprint: projectContext?.StatusFingerprint ?? null,
    Intent: bounded(intent?.Intent, 200),
    Domain: intent?.Domain ?? "UNKNOWN",
    OperationType: intent?.OperationType ?? "UNKNOWN",
    Risk: intent?.Risk ?? "CRITICAL",
    AllowedPaths: Array.isArray(intent?.AllowedPathFamilies) ? intent.AllowedPathFamilies.slice(0, 64) : [],
    ProtectedPaths: Array.isArray(intent?.ProtectedPathFamilies) ? intent.ProtectedPathFamilies.slice(0, 64) : [],
    Dependencies: intent?.Dependencies ?? [],
    Conflicts: intent?.Conflicts ?? [],
    ConflictState: intent?.Conflicts?.length ? "WRITE_CONFLICT" : "NONE",
    DecompositionState: intent?.DecompositionRequired ? "REQUIRED" : "NOT_REQUIRED",
    ApprovalRequired: Boolean(intent?.RequiresHumanApproval),
    ApprovalState: approvalState ?? "NOT_REQUIRED",
    ImplementerProvider: intent?.ImplementerProvider ?? null,
    ImplementerModel: intent?.ImplementerModel ?? null,
    ReviewerProvider: intent?.ReviewerProvider ?? null,
    ReviewerModel: intent?.ReviewerModel ?? null,
    LeaseEligible: decision === "ALLOW",
    ValidationPlan: intent?.ValidationRequirements ?? [],
    CreatedAt: now.toISOString(),
    ExpiresAt: expiresAt.toISOString(),
    InputFingerprint: decisionInputFingerprint({ taskId, projectContext, intent, approvalState }),
  };
}

export function createFinalDecision({ taskId = null, intent, projectContext, approvalState = "NOT_REQUIRED", now = new Date(), ttlMs = 5 * 60 * 1000 } = {}) {
  const codes = [];
  const contextBlockers = projectContext?.Blockers ?? [];
  if (projectContext?.WorkspaceRole === "UNKNOWN") codes.push("UNKNOWN_WORKSPACE");
  if (intent?.SuggestedWorkspace && projectContext?.ActiveWorkspace && String(intent.SuggestedWorkspace).toLowerCase() !== String(projectContext.ActiveWorkspace).toLowerCase()) codes.push("WORKSPACE_MISMATCH");
  if (contextBlockers.some((item) => /WORKSPACE|REPOSITORY/.test(item))) codes.push("WORKSPACE_MISMATCH");
  if (contextBlockers.includes("BRANCH_BINDING_MISMATCH")) codes.push("BRANCH_MISMATCH");
  if (contextBlockers.includes("HEAD_DRIFT")) codes.push("HEAD_DRIFT");
  if (contextBlockers.includes("STATUS_FINGERPRINT_DRIFT")) codes.push("STATUS_FINGERPRINT_DRIFT");
  if (["STALE", "NEEDS_REFRESH"].includes(projectContext?.RoadmapFreshness) || ["STALE", "NEEDS_REFRESH"].includes(projectContext?.ProjectStatusFreshness)) codes.push("STALE_PROJECT_CONTEXT");
  if (contextBlockers.includes("STALE_PROJECT_CONTEXT")) codes.push("STALE_PROJECT_CONTEXT");
  if (!intent || intent.Domain === "UNKNOWN") codes.push("UNKNOWN_DOMAIN");
  if (!intent?.ImplementerProvider || !intent?.ImplementerModel) codes.push("MODEL_UNAVAILABLE");
  if (intent?.ProtectedPathFamilies?.some((path) => intent.ExpectedTouchedPaths?.includes(path)) && intent?.DevelopmentStream === "HERMES") codes.push("PROTECTED_SCOPE");
  if (intent?.Warnings?.includes("MIXED_OWNERSHIP_REVIEW")) codes.push("MIXED_OWNERSHIP_REVIEW_REQUIRED");
  if (intent?.Dependencies?.length && intent.DependencyStatus !== "READY") codes.push("DEPENDENCY_INCOMPLETE");
  if (intent?.Conflicts?.length) codes.push("WRITE_CONFLICT");
  if (intent?.DecompositionRequired) codes.push("DECOMPOSITION_REQUIRED");
  if (!Array.isArray(intent?.ValidationRequirements) || intent.ValidationRequirements.length === 0) codes.push("VALIDATION_PLAN_MISSING");
  if (["HIGH", "CRITICAL"].includes(intent?.Risk) && intent?.RequiresHumanApproval) {
    if (approvalState !== "APPROVED") codes.push("APPROVAL_REQUIRED", "APPROVAL_MISSING");
  }
  let decision = "ALLOW";
  if (codes.includes("DEPENDENCY_INCOMPLETE")) decision = "WAITING_DEPENDENCY";
  else if (codes.includes("WRITE_CONFLICT")) decision = "WRITE_CONFLICT";
  else if (codes.includes("UNKNOWN_DOMAIN")) decision = "UNKNOWN_SCOPE";
  else if (codes.includes("DECOMPOSITION_REQUIRED")) decision = "DECOMPOSITION_REQUIRED";
  else if (codes.includes("APPROVAL_MISSING")) decision = "WAITING_APPROVAL";
  else if (codes.length) decision = "BLOCK";
  const reason = codes.length ? `H4 pre-execution decision: ${unique(codes).join(", ")}.` : "H4 pre-execution decision: all bounded checks passed.";
  return baseDecision({ taskId, intent, projectContext, approvalState, now, expiresAt: new Date(now.getTime() + Math.max(1000, ttlMs)), decision, codes, reason });
}

export function evaluateDecisionFreshness(decision, { taskId, intent, projectContext, approvalState = decision?.ApprovalState ?? "NOT_REQUIRED", now = new Date() } = {}) {
  if (!decision) return { valid: false, code: "STALE_DECISION", reason: "No decision record exists." };
  if (decision.Decision !== "ALLOW") return { valid: false, code: "LEASE_NOT_ELIGIBLE", reason: "Only ALLOW decisions are lease eligible." };
  if (Date.parse(decision.ExpiresAt ?? "") <= now.getTime()) return { valid: false, code: "STALE_DECISION", reason: "Decision expiry has elapsed." };
  const current = decisionInputFingerprint({ taskId, projectContext, intent, approvalState });
  if (current !== decision.InputFingerprint) return { valid: false, code: "STALE_CONTEXT", reason: "Decision inputs changed since approval." };
  if (decision.ApprovalRequired && approvalState !== "APPROVED") return { valid: false, code: "APPROVAL_MISSING", reason: "Approval is not bound and approved for this decision." };
  return { valid: true, code: null, reason: "Decision is current and lease eligible." };
}

export function decisionSummary(decision, { now = new Date() } = {}) {
  if (!decision) return null;
  const expired = Date.parse(decision.ExpiresAt ?? "") <= now.getTime();
  return { DecisionId: decision.DecisionId, Decision: decision.Decision, DecisionReasonCodes: decision.DecisionReasonCodes ?? [], DecisionCreatedAt: decision.CreatedAt ?? null, DecisionExpiresAt: decision.ExpiresAt ?? null, DecisionStale: expired || decision.Decision !== "ALLOW", ApprovalBound: Boolean(decision.ApprovalRequired && decision.ApprovalState === "APPROVED"), LeaseEligible: decision.Decision === "ALLOW" && !expired };
}

export function decisionFileKey(taskId) { return String(taskId ?? "planned").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96); }

export async function persistDecisionRecord(root, decision) {
  const directory = join(root, ".ai", "hermes-decisions");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${decisionFileKey(decision.TaskId ?? decision.DecisionId)}.json`);
  const history = join(directory, `${decisionFileKey(decision.TaskId ?? decision.DecisionId)}.jsonl`);
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(decision, null, 2), "utf8");
  await rename(temp, path);
  await writeFile(history, `${JSON.stringify(decision)}\n`, { encoding: "utf8", flag: "a" });
  return path;
}

export async function readDecisionRecord(root, taskId) {
  try { return JSON.parse(await readFile(join(root, ".ai", "hermes-decisions", `${decisionFileKey(taskId)}.json`), "utf8")); } catch { return null; }
}
