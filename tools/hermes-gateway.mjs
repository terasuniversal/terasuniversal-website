import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTaskIntent, analyzeTaskPlan, validateTaskIntentForAction } from "./hermes-task-intent.mjs";
import { createFinalDecision, decisionSummary, evaluateDecisionFreshness, persistDecisionRecord, readDecisionRecord } from "./hermes-decision.mjs";
import { buildAuditTimeline, buildOperatorSummary, controlledActionAuditResponse, normalizeApprovalRecord, readAuditInputs } from "./hermes-audit.mjs";
import { readQueueState, summarizeQueueItem } from "./hermes-queue.mjs";
import { buildOperatorEvidence, createAuditExport } from "./hermes-export.mjs";
import { CANONICAL_WORKSPACE, HERMES_WORKSPACE } from "./hermes-project-config.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AI_ROOT = join(REPO_ROOT, ".ai");
export { CANONICAL_WORKSPACE, HERMES_WORKSPACE };
export const PRIMARY_DEVELOPMENT_STREAM = "CRM";
export const HERMES_DEVELOPMENT_STREAM = "HERMES";
export const PROTECTED_PATHS = ["app/**", "components/**", "lib/**", "supabase/**", "database", "staging", "production", "Vercel", "ToyyibPay", "Telegram runtime", "Public Registration"];
const LEGACY_WORKSPACE = "D:\\Projects\\terasuniversal-website";
const PROTOCOL_VERSION = "2025-06-18";
const MAX_DOCUMENT_LENGTH = 120_000;

const STATE_FILES = {
  task: join(AI_ROOT, "task-state.json"),
  currentTask: join(AI_ROOT, "CURRENT_TASK.md"),
  project: join(AI_ROOT, "PROJECT_STATUS.md"),
  roadmap: join(AI_ROOT, "ROADMAP.md"),
};

const REPORT_FILES = [
  "FINAL_REPORT.md",
  "IMPLEMENTATION_REPORT.md",
  "REVIEW_REPORT.md",
  "PREVIEW_REPORT.md",
  "RELEASE_REPORT.md",
  "PR_REPORT.md",
  "DATABASE_REPORT.md",
  "HANDOFF.md",
];

const HANDOFF_FILES = [
  "HANDOFF.md",
  "CLAUDE_HANDOFF.md",
  "CLAUDE_ESCALATION_HANDOFF.md",
  "CODEX_IMPLEMENTATION_HANDOFF.md",
  "CODEX_REVIEW_HANDOFF.md",
  "CODEX_DATABASE_REVIEW_HANDOFF.md",
  "DEEPSEEK_HANDOFF.md",
  "REPAIR_HANDOFF.md",
];

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const mutationAnnotations = (destructiveHint, idempotentHint) => ({
  readOnlyHint: false,
  destructiveHint,
  idempotentHint,
  openWorldHint: false,
});

const tool = (name, title, description, inputSchema = { type: "object", properties: {}, additionalProperties: false }) => ({
  name,
  title,
  description,
  inputSchema,
  annotations: readOnlyAnnotations,
});

const actionTool = (name, title, description, properties) => ({
  name, title, description,
  inputSchema: { type: "object", properties, required: Object.keys(properties).filter((key) => key !== "testScope"), additionalProperties: false },
  annotations: mutationAnnotations(name === "hermes_start_task" || name === "hermes_request_review", name === "hermes_create_task" || name === "hermes_run_tests"),
});

export const TOOLS = [
  tool("hermes_status", "Hermes status", "Use this when you need the current Hermes orchestration state and safety boundary."),
  tool("hermes_gateway_health", "Hermes gateway health", "Use this when you need to verify that the Hermes MCP gateway and its durable state sources are readable."),
  tool("hermes_project_status", "Project status", "Use this when you need the current durable project status recorded by Hermes."),
  tool("hermes_roadmap", "Project roadmap", "Use this when you need the durable Hermes roadmap and its current, next, and later work."),
  tool("hermes_active_tasks", "Active tasks", "Use this when you need tasks currently in progress in the existing Hermes task state."),
  tool("hermes_task_detail", "Task detail", "Use this when you need details for the current durable Hermes task. This reads the existing task store and never creates or changes tasks.", {
    type: "object",
    properties: { taskId: { type: "string", description: "Optional task ID; when omitted, return the current task." } },
    additionalProperties: false,
  }),
  tool("hermes_recent_runs", "Recent runs", "Use this when you need the latest durable Hermes reports and their file timestamps."),
  tool("hermes_agent_status", "Agent status", "Use this when you need the current implementer, reviewer, and approval status recorded by Hermes."),
  actionTool("hermes_create_task", "Create Hermes task", "Use this when you need to create one safely routed task in the existing Hermes task store.", {
    description: { type: "string", minLength: 1, maxLength: 4000 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
  }),
  actionTool("hermes_start_task", "Start Hermes task", "Use this when you need to start the current approved Hermes task through its normal runtime.", {
    taskId: { type: "string", minLength: 1, maxLength: 128 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
  }),
  actionTool("hermes_run_tests", "Run Hermes tests", "Use this when you need to run the bounded existing Hermes QA workflow for the current task.", {
    taskId: { type: "string", minLength: 1, maxLength: 128 },
    testScope: { type: "string", enum: ["targeted", "full"] },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
  }),
  actionTool("hermes_request_review", "Request Hermes review", "Use this when you need to request the reviewer already assigned by Hermes routing.", {
    taskId: { type: "string", minLength: 1, maxLength: 128 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
  }),
];

export const MUTATING_TOOLS = TOOLS.filter((candidate) => candidate.annotations.readOnlyHint === false);
const ACTION_NAMES = new Set(MUTATING_TOOLS.map((candidate) => candidate.name));

const jsonRpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });

async function readJson(path) {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

async function readDocument(path) {
  try {
    const text = await readFile(path, "utf8");
    return text.length > MAX_DOCUMENT_LENGTH ? `${text.slice(0, MAX_DOCUMENT_LENGTH)}\n\n[truncated]` : text;
  } catch {
    return null;
  }
}

async function isReadable(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeWorkspacePath(value) {
  return String(value ?? "").trim().replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
}

function pathEquals(a, b) { return normalizeWorkspacePath(a) === normalizeWorkspacePath(b); }

async function runBoundedGit(repoRoot, args) {
  return new Promise((resolvePromise, reject) => {
    execFile("git", ["-C", repoRoot, ...args], { windowsHide: true, shell: false, maxBuffer: 2_000_000, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr?.trim() || error.message));
      resolvePromise(String(stdout ?? "").trim());
    });
  });
}

function hashStatus(statusText) {
  return createHash("sha256").update(statusText, "utf8").digest("hex");
}

function classifyWorkspaceRole(repoRoot) {
  if (pathEquals(repoRoot, CANONICAL_WORKSPACE)) return "CANONICAL_ACTIVE";
  if (pathEquals(repoRoot, HERMES_WORKSPACE)) return "ISOLATED_HERMES";
  return "UNKNOWN";
}

export async function discoverProjectContext({ repoRoot = REPO_ROOT, task = null, project = null, roadmap = null, now = new Date() } = {}) {
  const context = {
    ProjectId: "teras-universal-website",
    ProjectName: "TERAS Universal Website / CRM",
    RepositoryRoot: repoRoot,
    CanonicalWorkspace: CANONICAL_WORKSPACE,
    ActiveWorkspace: repoRoot,
    WorkspaceRole: classifyWorkspaceRole(repoRoot),
    Branch: null,
    HeadSha: null,
    OriginMainSha: null,
    Upstream: null,
    AheadCount: null,
    BehindCount: null,
    WorkingTreeState: "UNKNOWN",
    TrackedModifiedCount: null,
    UntrackedCount: null,
    StagedCount: null,
    StatusFingerprint: null,
    CurrentTaskId: task?.TaskId ?? null,
    CurrentTaskState: task?.State ?? "NONE",
    TaskWorkspace: task?.WorkspaceBoundary?.CanonicalWorkspace ?? null,
    RoadmapFreshness: null,
    ProjectStatusFreshness: null,
    ProtectedPaths: [...PROTECTED_PATHS],
    DevelopmentStream: { PrimaryDevelopmentStream: PRIMARY_DEVELOPMENT_STREAM, SecondaryDevelopmentStream: HERMES_DEVELOPMENT_STREAM, status: pathEquals(repoRoot, HERMES_WORKSPACE) ? "HERMES_ISOLATED_WORK_ACTIVE" : pathEquals(repoRoot, CANONICAL_WORKSPACE) ? "CRM_WORK_ACTIVE" : "UNKNOWN_WORKSPACE" },
    LastObservedAt: now.toISOString(),
    Warnings: [],
    Blockers: [],
    RemoteFreshness: "REMOTE_FRESHNESS_UNKNOWN",
  };
  const freshness = evaluateStateFreshness({ repoRoot, project, roadmap });
  context.RoadmapFreshness = freshness.documents.find((item) => item.name === "roadmap")?.status ?? "NEEDS_REFRESH";
  context.ProjectStatusFreshness = freshness.documents.find((item) => item.name === "projectStatus")?.status ?? "NEEDS_REFRESH";
  if (context.WorkspaceRole === "UNKNOWN") context.Blockers.push("UNKNOWN_WORKSPACE_ROLE");
  if (context.ProjectStatusFreshness !== "CURRENT") context.Warnings.push(`PROJECT_STATUS_${context.ProjectStatusFreshness}`);
  if (context.RoadmapFreshness !== "CURRENT") context.Warnings.push(`ROADMAP_${context.RoadmapFreshness}`);
  try {
    const root = await runBoundedGit(repoRoot, ["rev-parse", "--show-toplevel"]);
    if (!pathEquals(root, repoRoot)) context.Blockers.push("WRONG_REPOSITORY");
    context.Branch = await runBoundedGit(repoRoot, ["branch", "--show-current"]);
    context.HeadSha = await runBoundedGit(repoRoot, ["rev-parse", "HEAD"]);
    try { context.OriginMainSha = await runBoundedGit(repoRoot, ["rev-parse", "origin/main"]); } catch { context.Warnings.push("ORIGIN_MAIN_UNAVAILABLE"); }
    try { context.Upstream = await runBoundedGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]); } catch { context.Warnings.push("NO_UPSTREAM"); }
    if (context.Upstream) {
      try {
        const divergence = await runBoundedGit(repoRoot, ["rev-list", "--left-right", "--count", `${context.Upstream}...HEAD`]);
        const [behind, ahead] = divergence.split(/\s+/).map((value) => Number(value));
        context.BehindCount = Number.isFinite(behind) ? behind : null;
        context.AheadCount = Number.isFinite(ahead) ? ahead : null;
      } catch { context.Warnings.push("DIVERGENCE_UNKNOWN"); }
    }
    const porcelain = await runBoundedGit(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--", ".", ":(exclude).ai/hermes-decisions/**", ":(exclude).ai/hermes-execution/**"]);
    const observedLines = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
    context.StagedCount = observedLines.filter((line) => line[0] && line[0] !== " " && line.slice(0, 2) !== "??").length;
    context.UntrackedCount = observedLines.filter((line) => line.slice(0, 2) === "??").length;
    context.TrackedModifiedCount = observedLines.filter((line) => line.slice(0, 2) !== "??" && (line[0] !== " " || line[1] !== " ")).length;
    context.WorkingTreeState = observedLines.length === 0 ? "CLEAN" : "DIRTY";
    context.StatusFingerprint = hashStatus(observedLines.join("\n"));
  } catch (error) {
    context.Blockers.push("WORKSPACE_MISSING_OR_NOT_REPOSITORY");
    context.Warnings.push("GIT_AWARENESS_UNAVAILABLE");
  }
  if (context.RemoteFreshness === "REMOTE_FRESHNESS_UNKNOWN") context.Warnings.push("REMOTE_FRESHNESS_UNKNOWN");
  return context;
}

export function validateProjectAwareness(context, task = null, { requestedWorkspace = context?.ActiveWorkspace } = {}) {
  const blockers = [];
  if (!context || context.WorkspaceRole === "UNKNOWN") blockers.push("UNKNOWN_WORKSPACE_ROLE");
  if (context?.Blockers?.length) blockers.push(...context.Blockers);
  if (requestedWorkspace && !pathEquals(requestedWorkspace, context?.ActiveWorkspace)) blockers.push("REQUESTED_WORKSPACE_MISMATCH");
  const taskWorkspace = task?.WorkspaceBoundary?.CanonicalWorkspace ?? null;
  if (taskWorkspace && !pathEquals(taskWorkspace, context?.ActiveWorkspace)) blockers.push("TASK_WORKSPACE_MISMATCH");
  if (task?.Branch && context?.Branch && task.Branch !== context.Branch) blockers.push("BRANCH_BINDING_MISMATCH");
  if (task?.ExpectedBranch && context?.Branch && task.ExpectedBranch !== context.Branch) blockers.push("BRANCH_BINDING_MISMATCH");
  if (task?.ExpectedHeadSha && context?.HeadSha && task.ExpectedHeadSha !== context.HeadSha) blockers.push("HEAD_DRIFT");
  if (task?.HeadSha && task.HeadSha !== context.HeadSha) blockers.push("HEAD_DRIFT");
  if (task?.StatusFingerprint && task.StatusFingerprint !== context.StatusFingerprint) blockers.push("STATUS_FINGERPRINT_DRIFT");
  if (pathEquals(context?.ActiveWorkspace, CANONICAL_WORKSPACE) && task?.HermesOnly === true) blockers.push("HERMES_TASK_CANNOT_USE_CRM_WORKSPACE");
  return { allowed: blockers.length === 0, status: blockers.length === 0 ? "ALLOWED" : "BLOCKED", blockers: [...new Set(blockers)], reason: blockers.length === 0 ? "Project awareness checks passed." : "Project awareness blocked execution." };
}

export function validateControlledActionAwareness(name, context, task = null) {
  if (name === "hermes_create_task") return { allowed: context?.WorkspaceRole !== "UNKNOWN", status: context?.WorkspaceRole === "UNKNOWN" ? "BLOCKED" : "ALLOWED", blockers: context?.WorkspaceRole === "UNKNOWN" ? ["UNKNOWN_WORKSPACE_ROLE"] : [], reason: context?.WorkspaceRole === "UNKNOWN" ? "Project awareness blocked task creation." : "Project awareness passed." };
  return validateProjectAwareness(context, task, { requestedWorkspace: context?.ActiveWorkspace });
}

function extractDeclaredWorkspace(document) {
  if (typeof document !== "string") return null;
  const match = document.match(/^\s*(?:repository|workspace|worktree|development worktree)\s*:\s*`?([^`\r\n]+)`?\s*$/im);
  return match?.[1]?.trim() ?? null;
}

export function evaluateStateFreshness({ repoRoot = REPO_ROOT, project, roadmap } = {}) {
  const canonicalBinding = normalizeWorkspacePath(repoRoot) === normalizeWorkspacePath(CANONICAL_WORKSPACE);
  const projectRoot = extractDeclaredWorkspace(project);
  const roadmapRoot = extractDeclaredWorkspace(roadmap);
  const documentStatus = (name, declaredRoot) => {
    if (!declaredRoot) return { name, status: "NEEDS_REFRESH", reason: "No workspace binding marker was found.", recordedWorkspace: null };
    if (normalizeWorkspacePath(declaredRoot) === normalizeWorkspacePath(LEGACY_WORKSPACE)) {
      return { name, status: "STALE", reason: "Legacy workspace binding detected.", recordedWorkspace: declaredRoot };
    }
    if (normalizeWorkspacePath(declaredRoot) !== normalizeWorkspacePath(CANONICAL_WORKSPACE)) {
      return { name, status: "STALE", reason: "Workspace binding does not match the canonical workspace.", recordedWorkspace: declaredRoot };
    }
    return { name, status: "CURRENT", reason: "Workspace binding matches the canonical workspace.", recordedWorkspace: declaredRoot };
  };
  const documents = [documentStatus("projectStatus", projectRoot), documentStatus("roadmap", roadmapRoot)];
  const status = !canonicalBinding ? "STALE" : documents.some((item) => item.status === "STALE") ? "STALE" : documents.some((item) => item.status === "NEEDS_REFRESH") ? "NEEDS_REFRESH" : "CURRENT";
  return { status, canonicalWorkspace: CANONICAL_WORKSPACE, resolvedWorkspace: repoRoot, canonicalBinding: canonicalBinding ? "CURRENT" : "STALE", documents };
}

function taskSummary(state) {
  if (!state || typeof state !== "object") return null;
  return {
    taskId: state.TaskId ?? null,
    createdAt: state.CreatedAt ?? null,
    category: state.Category ?? null,
    risk: state.Risk ?? null,
    routingReason: state.Reason ?? null,
    fullRepoAudit: state.FullRepoAudit ?? null,
    description: state.Description ?? null,
    state: state.State ?? null,
    humanDecision: state.HumanDecision ?? null,
    implementer: state.Implementer ?? null,
    implementerModel: state.ImplementerModel ?? null,
    implementerProvider: state.ImplementerProvider ?? null,
    reviewer: state.Reviewer ?? null,
    reviewerModel: state.ReviewerModel ?? null,
    reviewerProvider: state.ReviewerProvider ?? null,
    executionStatus: state.ExecutionStatus ?? null,
    executionAttempt: state.ExecutionAttempt ?? 0,
    executionResultSummary: state.ExecutionResultSummary ?? null,
    reviewStatus: state.ClaudeReviewStatus ?? null,
    reviewVerdict: state.ReviewVerdict ?? null,
    scopeCheck: state.ScopeCheck ?? null,
    workspace: state.WorkspaceBoundary?.CanonicalWorkspace ?? null,
    branch: state.Branch ?? null,
    expectedBranch: state.ExpectedBranch ?? null,
    expectedHeadSha: state.ExpectedHeadSha ?? null,
    statusFingerprint: state.StatusFingerprint ?? null,
    hermesOnly: state.HermesOnly ?? false,
    taskGeneratedFiles: Array.isArray(state.TaskGeneratedFiles) ? state.TaskGeneratedFiles : [],
  };
}

function taskDetail(state) {
  if (!state || typeof state !== "object") return null;
  return {
    ...taskSummary(state),
    allowedFiles: Array.isArray(state.AllowedFiles) ? state.AllowedFiles : [],
    blockedFiles: Array.isArray(state.BlockedFiles) ? state.BlockedFiles : [],
    qa: state.QA ?? null,
    execution: {
      status: state.ExecutionStatus ?? null,
      attempt: state.ExecutionAttempt ?? 0,
      startedAt: state.ExecutionStartedAt ?? null,
      heartbeatAt: state.ExecutionHeartbeatAt ?? null,
      completedAt: state.ExecutionCompletedAt ?? null,
      resultSummary: state.ExecutionResultSummary ?? null,
    },
    transitionHistory: Array.isArray(state.TransitionHistory) ? state.TransitionHistory : [],
    handoffHistory: Array.isArray(state.HandoffHistory) ? state.HandoffHistory : [],
    recoveryEvents: Array.isArray(state.RecoveryEvents) ? state.RecoveryEvents : [],
    blockers: Array.isArray(state.BlockingIssues) ? state.BlockingIssues : [],
    databaseSafety: {
      databaseTask: state.DatabaseTask ?? null,
      databaseState: state.DatabaseState ?? null,
      migrationFile: state.MigrationFile ?? null,
      migrationApproved: state.MigrationApproved ?? null,
      migrationApplyStatus: state.MigrationApplyStatus ?? null,
    },
    approval: {
      humanApprovalRequired: state.HumanApprovalRequired ?? null,
      commitAllowed: state.CommitAllowed ?? null,
      pushAllowed: state.PushAllowed ?? null,
      deployAllowed: state.DeployAllowed ?? null,
    },
  };
}

function leaseFileKey(taskId) {
  return String(taskId ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
}

export function summarizeExecutionLease(lease, { now = new Date() } = {}) {
  if (!lease || typeof lease !== "object") return { status: "NONE", active: false, stale: false, executionId: null, heartbeatAt: null, leaseExpiresAt: null, attempt: 0 };
  const expires = Date.parse(lease.leaseExpiresAt ?? "");
  const active = ["RUNNING", "STARTING"].includes(lease.status) && Number.isFinite(expires) && expires > now.getTime();
  return {
    status: active ? "ACTIVE" : (lease.status ?? "UNKNOWN"),
    active,
    stale: ["RUNNING", "STARTING"].includes(lease.status) && !active,
    executionId: lease.executionId ? `${String(lease.executionId).slice(0, 12)}…` : null,
    heartbeatAt: lease.heartbeatAt ?? null,
    leaseExpiresAt: lease.leaseExpiresAt ?? null,
    attempt: Number(lease.attempt ?? 0),
    agent: lease.agent ?? null,
    provider: lease.provider ?? null,
    model: lease.model ?? null,
  };
}

async function readExecutionLease(taskId) {
  if (!taskId) return null;
  return readJson(join(AI_ROOT, "hermes-execution", `${leaseFileKey(taskId)}.lease.json`));
}

async function getReports() {
  const reports = [];
  for (const name of REPORT_FILES) {
    const path = join(AI_ROOT, name);
    try {
      const info = await stat(path);
      reports.push({ name, modifiedAt: info.mtime.toISOString(), size: info.size });
    } catch {
      // Missing reports are expected for a task that has not reached that stage.
    }
  }
  return reports.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function getHandoffArtifacts() {
  const artifacts = [];
  for (const name of HANDOFF_FILES) {
    const path = join(AI_ROOT, name);
    try {
      const [info, markdown] = await Promise.all([stat(path), readDocument(path)]);
      artifacts.push({
        name,
        modifiedAt: info.mtime.toISOString(),
        taskId: markdown?.match(/Task ID:\s*([^\r\n]+)/i)?.[1]?.trim() ?? null,
        populated: Boolean(markdown && !/No (?:review|database review) currently pending/i.test(markdown) && !/\(_|\(copy from CURRENT_TASK/i.test(markdown)),
      });
    } catch {
      // Missing handoffs are expected when an agent stage has not run.
    }
  }
  return artifacts.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function asList(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== "");
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

export function agentVisibility(state, task, handoffs = [], reports = []) {
  const qa = state?.QA ?? {};
  const blockingIssues = [
    ...asList(state?.BlockingIssues),
    ...asList(state?.PreviewBlockingIssues),
    ...asList(state?.ProductionBlockingIssues),
    ...asList(state?.DbBlockingFindings),
    ...asList(state?.ReleaseBlockingReasons),
  ];
  const has = (name) => state && Object.prototype.hasOwnProperty.call(state, name);
  const durableApprovals = has("PendingHumanApprovals");
  const pendingHumanApprovals = durableApprovals ? asList(state.PendingHumanApprovals) : [];
  if (!durableApprovals && state?.HumanApprovalRequired === "REQUIRED" && state?.HumanDecision !== "APPROVED") pendingHumanApprovals.push("Human task approval");
  if (!durableApprovals && state?.DbApplyApproved !== "YES" && state?.DbApplyTarget) pendingHumanApprovals.push("Database apply approval");
  if (!durableApprovals && state?.ReleaseApproved !== "YES" && state?.ReleaseEligibility === "READY") pendingHumanApprovals.push("Release approval");
  const durableCodex = has("CodexExecutionStatus") || has("CodexExecutionResult");
  const durableClaude = has("ClaudeReviewStatus") || has("ClaudeReviewFindings");
  const durableHandoffs = has("HandoffHistory");
  return {
    assignment: task ? { implementer: task.implementer, implementerModel: task.implementerModel, reviewer: task.reviewer, reviewerModel: task.reviewerModel } : null,
    routing: task ? { category: task.category, risk: task.risk, reason: state?.Reason ?? null, fullRepoAudit: state?.FullRepoAudit ?? null, fallback: { originalImplementer: state?.OriginalImplementer ?? null, fallbackImplementer: state?.FallbackImplementer ?? null, fallbackReason: state?.ImplementerFallbackReason ?? null } } : null,
    codex: {
      assigned: task?.implementer === "Codex" || task?.reviewer === "Codex",
      source: durableCodex ? ".ai/task-state.json" : "artifact-derived",
      executionStatus: durableCodex ? (state?.CodexExecutionStatus ?? "NOT_STARTED") : task?.implementer === "Codex" ? task.state : task?.reviewer === "Codex" ? (task.reviewVerdict === "PENDING" ? "PENDING_REVIEW" : "REVIEWED") : "NOT_ASSIGNED",
      startedAt: state?.CodexExecutionStartedAt ?? null,
      completedAt: state?.CodexExecutionCompletedAt ?? null,
      result: durableCodex ? (state?.CodexExecutionResult ?? null) : task?.implementer === "Codex" ? { qa, scopeCheck: task.scopeCheck, state: task.state } : { verdict: task?.reviewVerdict ?? null },
    },
    claude: {
      assigned: task?.implementer === "Claude Code" || task?.reviewer === "Claude Code",
      source: durableClaude ? ".ai/task-state.json" : "artifact-derived",
      reviewStatus: durableClaude ? (state?.ClaudeReviewStatus ?? "NOT_STARTED") : task?.reviewer === "Claude Code" ? (task.reviewVerdict ?? "PENDING") : task?.implementer === "Claude Code" ? "IMPLEMENTER" : "NOT_ASSIGNED",
      startedAt: state?.ClaudeReviewStartedAt ?? null,
      completedAt: state?.ClaudeReviewCompletedAt ?? null,
      findings: durableClaude ? (state?.ClaudeReviewFindings ?? []) : { reviewNotes: state?.ReviewNotes ?? null, blockingIssues: asList(state?.BlockingIssues), reportSources: reports.filter((report) => /REVIEW|FINAL/i.test(report.name)).map((report) => report.name) },
      result: state?.ClaudeReviewResult ?? null,
    },
    handoffHistory: durableHandoffs ? { source: ".ai/task-state.json", historicalLogAvailable: state.HandoffHistory.length > 0, records: state.HandoffHistory, artifacts: [] } : { source: ".ai/*HANDOFF*.md", historicalLogAvailable: false, note: "Legacy task: Hermes retains current handoff artifacts; no separate handoff history store exists.", records: [], artifacts: handoffs },
    blockers: blockingIssues,
    pendingHumanApprovals,
    missingDurableFields: [
      ...(state?.CodexExecutionStatus === undefined ? ["CodexExecutionStatus"] : []),
      ...(state?.CodexExecutionResult === undefined ? ["CodexExecutionResult"] : []),
      ...(state?.ClaudeReviewFindings === undefined ? ["ClaudeReviewFindings"] : []),
      ...(state?.HandoffHistory === undefined ? ["HandoffHistory"] : []),
      ...(state?.PendingHumanApprovals === undefined ? ["PendingHumanApprovals"] : []),
    ],
  };
}

const LEGACY_MODEL_ALIASES = new Set(["DEEPSEEK_FAST", "CLAUDE_FAST", "CLAUDE_DEEP", "CODEX_REVIEW"]);
const LEGACY_STATE_MAP = new Map([
  ["IMPLEMENTING", "RUNNING"],
  ["IMPLEMENTING_REPAIR", "REPAIR_REQUIRED"],
  ["PENDING_CODEX_REPAIR", "REPAIR_REQUIRED"],
  ["PENDING_CLAUDE_REVIEW", "REVIEW_PENDING"],
  ["REVIEWING", "REVIEW_PENDING"],
  ["QA", "RUNNING"],
  ["AWAITING_APPROVAL", "WAITING_APPROVAL"],
  ["COMPLETE", "COMPLETED"],
]);

export function assessTaskRecovery(state, { repoRoot = REPO_ROOT, canonicalWorkspace = CANONICAL_WORKSPACE, lease = null, now = new Date() } = {}) {
  if (!state || typeof state !== "object") return { needsReconciliation: false, recommendedState: "NONE", findings: [], safeToResume: false };
  const findings = [];
  const currentState = LEGACY_STATE_MAP.get(state.State) ?? state.State ?? "NONE";
  const recordedWorkspace = state.WorkspaceBoundary?.CanonicalWorkspace ?? state.CanonicalWorkspace ?? null;
  const leaseSummary = summarizeExecutionLease(lease, { now });
  const normalize = (value) => String(value ?? "").replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
  if (recordedWorkspace && normalize(recordedWorkspace) !== normalize(repoRoot)) findings.push("WORKSPACE_BINDING_MISMATCH");
  if (LEGACY_MODEL_ALIASES.has(state.ImplementerModel) || state.Implementer === "DeepSeek" || !state.ImplementerProvider) findings.push("LEGACY_ROUTING_METADATA");
  if (currentState === "RUNNING" && state.ExecutionStatus !== "COMPLETED" && !leaseSummary.active && state.ExecutionLeaseActive !== true) findings.push(leaseSummary.stale ? "STALE_EXECUTION_LEASE" : "INTERRUPTED_EXECUTION");
  if (currentState === "REVIEW_PENDING" && !["STARTED", "COMPLETED", "FAILED", "UNAVAILABLE"].includes(state.ClaudeReviewStatus)) findings.push("MISSING_REVIEW_ACTIVITY");
  if (["HIGH", "CRITICAL"].includes(state.Risk) && state.HumanApprovalRequired === "REQUIRED" && state.HumanDecision !== "APPROVED" && ["CREATED", "ROUTED"].includes(currentState)) findings.push("WAITING_FOR_HUMAN_APPROVAL");
  const blocking = findings.some((item) => ["WORKSPACE_BINDING_MISMATCH", "INTERRUPTED_EXECUTION", "STALE_EXECUTION_LEASE", "MISSING_REVIEW_ACTIVITY"].includes(item));
  return {
    needsReconciliation: findings.length > 0,
    recommendedState: blocking ? "BLOCKED" : findings.includes("WAITING_FOR_HUMAN_APPROVAL") ? "WAITING_APPROVAL" : currentState,
    findings,
    safeToResume: !blocking && !["COMPLETED", "CANCELLED", "FAILED"].includes(currentState),
    recordedWorkspace,
    resolvedWorkspace: repoRoot,
    canonicalWorkspace,
    executionLease: leaseSummary,
  };
}

export function validateActionInput(name, args = {}) {
  if (!ACTION_NAMES.has(name)) throw new Error(`Not a mutating Hermes action: ${name}`);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be an object.");
  const allowed = new Set(TOOLS.find((candidate) => candidate.name === name).inputSchema.required.concat(Object.keys(TOOLS.find((candidate) => candidate.name === name).inputSchema.properties)));
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}`);
  const key = args.idempotencyKey;
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new Error("idempotencyKey must be 1-128 safe characters.");
  if (name === "hermes_create_task" && (typeof args.description !== "string" || args.description.trim().length < 1 || args.description.length > 4000)) throw new Error("description must be 1-4000 characters.");
  if (name !== "hermes_create_task" && (typeof args.taskId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(args.taskId))) throw new Error("taskId is required and must be a bounded task identifier.");
  if (name === "hermes_run_tests" && args.testScope !== undefined && !["targeted", "full"].includes(args.testScope)) throw new Error("testScope must be targeted or full.");
  return { ...args, testScope: args.testScope ?? "targeted" };
}

async function runHermesAction(name, args) {
  const task = await readJson(STATE_FILES.task);
  const awarenessContext = await discoverProjectContext({ repoRoot: REPO_ROOT, task });
  const awareness = validateControlledActionAwareness(name, awarenessContext, task);
  const taskIntent = analyzeTaskIntent({ taskId: args.taskId ?? task?.TaskId ?? null, description: args.description ?? task?.Description ?? "", projectContext: awarenessContext, existingTask: task });
  const intentCheck = validateTaskIntentForAction(name, taskIntent, { projectContext: awarenessContext, task });
  const decisionTaskId = task?.TaskId ?? args.taskId ?? `planned-${args.idempotencyKey}`;
  const approvalState = task?.HumanDecision === "APPROVED" ? "APPROVED" : task?.HumanApprovalRequired === "REQUIRED" ? "MISSING" : "NOT_REQUIRED";
  let decision = createFinalDecision({ taskId: decisionTaskId, intent: taskIntent, projectContext: awarenessContext, approvalState });
  const combinedBlockers = [...new Set([...awareness.blockers, ...intentCheck.blockers])];
  if (combinedBlockers.length) {
    decision.Decision = combinedBlockers.includes("DEPENDENCY_INCOMPLETE") ? "WAITING_DEPENDENCY" : combinedBlockers.includes("WRITE_CONFLICT") ? "WRITE_CONFLICT" : combinedBlockers.includes("DECOMPOSITION_REQUIRED") ? "DECOMPOSITION_REQUIRED" : combinedBlockers.includes("APPROVAL_MISSING") ? "WAITING_APPROVAL" : "BLOCK";
    decision.DecisionReasonCodes = [...new Set([...decision.DecisionReasonCodes, ...combinedBlockers])];
    decision.DecisionReason = `H4 pre-execution decision: ${decision.DecisionReasonCodes.join(", ")}.`;
    decision.LeaseEligible = false;
  }
  const previous = await readDecisionRecord(REPO_ROOT, decisionTaskId);
  if (!previous || previous.InputFingerprint !== decision.InputFingerprint || previous.Decision !== decision.Decision) await persistDecisionRecord(REPO_ROOT, decision);
  else decision = previous;
  if (decision.Decision !== "ALLOW") {
    const approval = normalizeApprovalRecord({ task, intent: taskIntent, projectContext: awarenessContext, decision });
    const summary = buildOperatorSummary({ task, intent: taskIntent, projectContext: awarenessContext, decision, approval });
    return { status: decision.Decision, blocked: true, reason: decision.DecisionReason, blockers: decision.DecisionReasonCodes, projectContext: awarenessContext, taskIntent, decision: decisionSummary(decision), audit: summary, ...controlledActionAuditResponse({ action: name, taskId: decisionTaskId, result: "BLOCKED", summary, decision }) };
  }
  const script = join(REPO_ROOT, "tools", "teras-agent.ps1");
  const commandArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-McpAction", name, "-McpIdempotencyKey", args.idempotencyKey];
  if (args.taskId) commandArgs.push("-McpTaskId", args.taskId);
  if (args.description) commandArgs.push("-McpDescription", args.description);
  if (args.testScope) commandArgs.push("-McpTestScope", args.testScope);
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn("powershell.exe", commandArgs, { cwd: REPO_ROOT, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const marker = stdout.split(/\r?\n/).find((line) => line.startsWith("HERMES_MCP_RESULT:"));
      if (!marker) return reject(new Error(stderr.trim() || `Hermes action exited with code ${code}.`));
      try { resolvePromise({ ...JSON.parse(marker.slice("HERMES_MCP_RESULT:".length)), processExitCode: code }); } catch { reject(new Error("Hermes action returned invalid structured output.")); }
    });
  });
  const approval = normalizeApprovalRecord({ task, intent: taskIntent, projectContext: awarenessContext, decision });
  const summary = buildOperatorSummary({ task, intent: taskIntent, projectContext: awarenessContext, decision, approval });
  return { ...output, projectContext: awarenessContext, taskIntent, decision: decisionSummary(decision), audit: summary, ...controlledActionAuditResponse({ action: name, taskId: decisionTaskId, result: output?.status ?? "COMPLETED", summary, decision }) };
}

export async function readHermesState() {
  const [task, currentTask, project, roadmap] = await Promise.all([
    readJson(STATE_FILES.task),
    readDocument(STATE_FILES.currentTask),
    readDocument(STATE_FILES.project),
    readDocument(STATE_FILES.roadmap),
  ]);
  const projectContext = await discoverProjectContext({ repoRoot: REPO_ROOT, task, project, roadmap });
  const taskIntent = task ? analyzeTaskIntent({ taskId: task.TaskId, description: task.Description ?? "", projectContext, existingTask: task }) : null;
  const lastDecisionRecord = task ? await readDecisionRecord(REPO_ROOT, task.TaskId) : null;
  const lastDecision = decisionSummary(lastDecisionRecord);
  const auditInputs = await readAuditInputs(REPO_ROOT, task?.TaskId);
  const approval = normalizeApprovalRecord({ task, intent: taskIntent, projectContext, decision: lastDecisionRecord, existing: auditInputs.approval });
  const queueState = await readQueueState(REPO_ROOT);
  const queueItem = task ? queueState.Items.find((item) => item.TaskId === task.TaskId) ?? null : null;
  const queueSummary = queueItem ? summarizeQueueItem(queueItem, queueState.Items) : null;
  const auditTimeline = buildAuditTimeline({ task, decisionHistory: auditInputs.decisionHistory, approval, executionEvents: auditInputs.executionEvents, queueEvents: queueState.Events });
  const rawLease = await readExecutionLease(task?.TaskId);
  const executionLease = summarizeExecutionLease(rawLease);
  const operatorSummary = buildOperatorSummary({ task, intent: taskIntent, projectContext, decision: lastDecisionRecord, approval, executionLease, timeline: auditTimeline });
  const auditExport = task ? createAuditExport({ task, intent: taskIntent, projectContext, approval, decisionHistory: auditInputs.decisionHistory, queueItem, queueEvents: queueState.Events, executionEvents: auditInputs.executionEvents, executionLease: rawLease, timeline: auditTimeline, operatorSummary }) : null;
  const operatorEvidence = buildOperatorEvidence(auditExport);
  return { task, currentTask, project, roadmap, projectContext, taskIntent, lastDecision, approval, auditTimeline, operatorSummary, operatorEvidence, auditExport, queue: queueSummary, executionLease, freshness: evaluateStateFreshness({ project, roadmap }), recovery: assessTaskRecovery(task, { lease: rawLease }) };
}

export async function callTool(name, args = {}) {
  if (ACTION_NAMES.has(name)) return runHermesAction(name, validateActionInput(name, args));
  const state = await readHermesState();
  const task = taskSummary(state.task);
  const [handoffs, reports] = await Promise.all([getHandoffArtifacts(), getReports()]);
  const visibility = agentVisibility(state.task, task, handoffs, reports);

  switch (name) {
    case "hermes_status":
      return {
        gateway: "Hermes Gateway",
        phase: "ChatGPT MCP Phase 1",
        mode: "tool-only",
        readOnly: true,
        destructive: false,
        arbitraryShellExecution: false,
        taskStore: ".ai/task-state.json",
        taskStoreShared: true,
        canonicalWorkspace: CANONICAL_WORKSPACE,
        projectContext: state.projectContext,
        taskIntent: state.taskIntent,
        lastDecision: state.lastDecision,
        operatorSummary: state.operatorSummary,
        queue: state.queue,
        operatorEvidence: state.operatorEvidence,
        auditExport: state.auditExport ? { ExportVersion: state.auditExport.ExportVersion, GeneratedAt: state.auditExport.GeneratedAt, ExportDigest: state.auditExport.ExportDigest, DataQuality: state.auditExport.DataQuality, InputRecordCount: state.auditExport.InputRecordCount, ExportRecordCount: state.auditExport.ExportRecordCount } : null,
        auditTimeline: state.auditTimeline,
        stateFreshness: state.freshness,
        recovery: state.recovery,
        executionLease: state.executionLease,
        agentVisibility: visibility,
        task,
      };
    case "hermes_gateway_health": {
      const readable = await Promise.all(Object.entries(STATE_FILES).map(async ([name, path]) => ({ name, readable: await isReadable(path) })));
      return { ok: readable.every((item) => item.readable), readOnly: true, canonicalWorkspace: CANONICAL_WORKSPACE, projectContext: state.projectContext, stateFreshness: state.freshness, recovery: state.recovery, executionLease: state.executionLease, stateSources: readable, reportsAvailable: reports.length, handoffsAvailable: handoffs.length };
    }
    case "hermes_project_status":
      return { source: ".ai/PROJECT_STATUS.md", workspace: CANONICAL_WORKSPACE, projectContext: state.projectContext, stateFreshness: state.freshness.documents.find((item) => item.name === "projectStatus"), markdown: state.project ?? "Project status is unavailable." };
    case "hermes_roadmap":
      return { source: ".ai/ROADMAP.md", workspace: CANONICAL_WORKSPACE, projectContext: state.projectContext, stateFreshness: state.freshness.documents.find((item) => item.name === "roadmap"), markdown: state.roadmap ?? "Roadmap is unavailable." };
    case "hermes_active_tasks":
      return { source: ".ai/task-state.json", workspace: CANONICAL_WORKSPACE, projectContext: state.projectContext, taskIntent: state.taskIntent, lastDecision: state.lastDecision, operatorSummary: state.operatorSummary, operatorEvidence: state.operatorEvidence, auditExport: state.auditExport ? { ExportVersion: state.auditExport.ExportVersion, GeneratedAt: state.auditExport.GeneratedAt, ExportDigest: state.auditExport.ExportDigest, DataQuality: state.auditExport.DataQuality, InputRecordCount: state.auditExport.InputRecordCount, ExportRecordCount: state.auditExport.ExportRecordCount } : null, queue: state.queue, auditTimeline: state.auditTimeline, recovery: state.recovery, tasks: task && !["NONE", "COMPLETE", "BLOCKED"].includes(task.state) ? [{ ...task, agentVisibility: visibility }] : [], currentTaskState: task?.state ?? "NONE" };
    case "hermes_task_detail": {
      if (args && typeof args !== "object") throw new Error("Arguments must be an object.");
      const requestedId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
      if (requestedId && requestedId !== state.task?.TaskId) return { found: false, taskId: requestedId, source: ".ai/task-state.json", workspace: CANONICAL_WORKSPACE, stateFreshness: state.freshness, agentVisibility: visibility };
      return { found: Boolean(state.task), source: ".ai/task-state.json", workspace: CANONICAL_WORKSPACE, projectContext: state.projectContext, taskIntent: state.taskIntent, lastDecision: state.lastDecision, operatorSummary: state.operatorSummary, operatorEvidence: state.operatorEvidence, auditExport: state.auditExport ? { ExportVersion: state.auditExport.ExportVersion, GeneratedAt: state.auditExport.GeneratedAt, ExportDigest: state.auditExport.ExportDigest, DataQuality: state.auditExport.DataQuality, InputRecordCount: state.auditExport.InputRecordCount, ExportRecordCount: state.auditExport.ExportRecordCount } : null, queue: state.queue, auditTimeline: state.auditTimeline, stateFreshness: state.freshness, recovery: state.recovery, executionLease: state.executionLease, task: taskDetail(state.task), agentVisibility: visibility };
    }
    case "hermes_recent_runs":
      return { source: ".ai/*.md", workspace: CANONICAL_WORKSPACE, projectContext: state.projectContext, stateFreshness: state.freshness, runs: reports };
    case "hermes_agent_status":
      return {
        source: ".ai/task-state.json",
        workspace: CANONICAL_WORKSPACE,
        projectContext: state.projectContext,
        taskIntent: state.taskIntent,
        lastDecision: state.lastDecision,
        operatorSummary: state.operatorSummary,
        queue: state.queue,
        operatorEvidence: state.operatorEvidence,
        auditTimeline: state.auditTimeline,
        stateFreshness: state.freshness,
        recovery: state.recovery,
        executionLease: state.executionLease,
        agentVisibility: visibility,
        implementer: task ? { name: task.implementer, provider: task.implementerProvider, model: task.implementerModel } : null,
        reviewer: task ? { name: task.reviewer, provider: task.reviewerProvider, model: task.reviewerModel, verdict: task.reviewVerdict } : null,
        taskState: task?.state ?? "NONE",
        humanDecision: task?.humanDecision ?? null,
        approvalRequired: state.task?.HumanApprovalRequired ?? null,
      };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

async function handleRpc(message, authToken = "", configuredToken = "") {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return jsonRpcError(message?.id, -32600, "Invalid Request");
  if (message.method === "notifications/initialized") return null;
  if (message.method === "ping") return { jsonrpc: "2.0", id: message.id, result: {} };
  if (message.method === "initialize") {
    return { jsonrpc: "2.0", id: message.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "hermes-gateway", version: "1.0.0" } } };
  }
  if (message.method === "tools/list") return { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (!TOOLS.some((candidate) => candidate.name === name)) return jsonRpcError(message.id, -32602, `Unknown tool: ${name}`);
    if (ACTION_NAMES.has(name) && (!configuredToken || authToken !== `Bearer ${configuredToken}`)) return jsonRpcError(message.id, -32001, "Mutating Hermes MCP tools require configured bearer authentication.");
    try {
      return { jsonrpc: "2.0", id: message.id, result: toolResult(await callTool(name, message.params?.arguments ?? {})) };
    } catch (error) {
      return { jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Tool failed" }] } };
    }
  }
  return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (body.length > 1_000_000) throw new Error("Request body too large");
  return JSON.parse(body || "{}");
}

export function createHermesGatewayServer({
  host = process.env.HERMES_HOST ?? "127.0.0.1",
  port = Number(process.env.HERMES_PORT ?? 8787),
  token = process.env.HERMES_MCP_TOKEN ?? "",
  requireAuth = process.env.HERMES_REQUIRE_AUTH === "1",
} = {}) {
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!isLoopback && !token) throw new Error("HERMES_MCP_TOKEN is required when Hermes is not bound to loopback.");
  return createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    if (request.url !== "/mcp") { response.writeHead(404, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "Not found" })); return; }
    if (request.method !== "POST") { response.writeHead(405, { "allow": "POST, OPTIONS", "content-type": "application/json" }); response.end(JSON.stringify({ error: "MCP endpoint accepts POST" })); return; }
    if (requireAuth && !token) { response.writeHead(503, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "MCP authentication is not configured" })); return; }
    if (token && request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401, { "www-authenticate": "Bearer", "content-type": "application/json" }); response.end(JSON.stringify({ error: "Unauthorized" })); return; }
    try {
      const message = await readRequestBody(request);
        const authToken = request.headers.authorization ?? "";
        const result = Array.isArray(message) ? await Promise.all(message.map((item) => handleRpc(item, authToken, token))) : await handleRpc(message, authToken, token);
      if (result === null || (Array.isArray(result) && result.every((item) => item === null))) { response.writeHead(202); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify(jsonRpcError(null, -32700, error instanceof Error ? error.message : "Parse error")));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const server = createHermesGatewayServer({ requireAuth: process.env.HERMES_REQUIRE_AUTH === "1" });
  server.listen(Number(process.env.HERMES_PORT ?? 8787), process.env.HERMES_HOST ?? "127.0.0.1", () => {
    console.log(`Hermes MCP gateway listening on http://${process.env.HERMES_HOST ?? "127.0.0.1"}:${process.env.HERMES_PORT ?? 8787}/mcp`);
  });
}
