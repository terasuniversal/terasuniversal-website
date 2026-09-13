import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_AUTOMATIC_REPAIR_ATTEMPTS } from "./hermes-repair-policy.mjs";

export const QUEUE_STATES = [
  "QUEUED", "WAITING_APPROVAL", "WAITING_DEPENDENCY", "WAITING_CONFLICT", "READY",
  "RUNNING", "REVIEW_PENDING", "REPAIR_REQUIRED", "BLOCKED", "COMPLETED", "FAILED", "CANCELLED",
];
export const PRIORITY_VALUES = ["P0", "P1", "P2", "P3"];
export const MAX_CONCURRENT_EXECUTIONS = 2;
export const DEFAULT_CLAIM_TTL_MS = 30_000;
export const QUEUE_TRANSITIONS = {
  QUEUED: new Set(["WAITING_APPROVAL", "WAITING_DEPENDENCY", "WAITING_CONFLICT", "READY", "BLOCKED", "CANCELLED"]),
  WAITING_APPROVAL: new Set(["READY", "BLOCKED", "CANCELLED"]),
  WAITING_DEPENDENCY: new Set(["READY", "BLOCKED", "CANCELLED"]),
  WAITING_CONFLICT: new Set(["READY", "BLOCKED", "CANCELLED"]),
  READY: new Set(["RUNNING", "WAITING_APPROVAL", "WAITING_DEPENDENCY", "WAITING_CONFLICT", "BLOCKED", "CANCELLED"]),
  RUNNING: new Set(["REVIEW_PENDING", "REPAIR_REQUIRED", "COMPLETED", "FAILED", "BLOCKED", "CANCELLED"]),
  REVIEW_PENDING: new Set(["COMPLETED", "REPAIR_REQUIRED", "BLOCKED", "FAILED"]),
  REPAIR_REQUIRED: new Set(["READY", "RUNNING", "BLOCKED", "CANCELLED"]),
  BLOCKED: new Set(["WAITING_APPROVAL", "WAITING_DEPENDENCY", "READY", "CANCELLED"]),
  COMPLETED: new Set(), FAILED: new Set(), CANCELLED: new Set(),
};

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const PRIORITY_ORDER = new Map(PRIORITY_VALUES.map((value, index) => [value, index]));

const text = (value, fallback = "") => String(value ?? fallback).trim();
const unique = (values) => [...new Set((values ?? []).filter(Boolean).map(String))];
const normalizePath = (value) => text(value).replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
const normalizePaths = (values) => unique(values).map((value) => value.replaceAll("\\", "/").toLowerCase());
const pathFamilyOverlaps = (left = [], right = []) => normalizePaths(left).some((a) => normalizePaths(right).some((b) => {
  if (a === b || a === "**" || b === "**") return true;
  const clean = (v) => v.replace(/\*\*?$/g, "").replace(/\/$/, "");
  return clean(a) === clean(b) || clean(a).startsWith(`${clean(b)}/`) || clean(b).startsWith(`${clean(a)}/`);
}));

export function normalizeQueueItem(item = {}, { now = new Date() } = {}) {
  const taskId = text(item.TaskId || item.taskId);
  const queueItemId = text(item.QueueItemId || item.queueItemId, `queue-${taskId || randomUUID()}`);
  const state = QUEUE_STATES.includes(item.QueueState) ? item.QueueState : "QUEUED";
  const priority = PRIORITY_ORDER.has(item.Priority) ? item.Priority : "P2";
  return {
    QueueItemId: queueItemId,
    TaskId: taskId || null,
    Priority: priority,
    QueueState: state,
    Domain: text(item.Domain, "UNKNOWN"),
    DevelopmentStream: text(item.DevelopmentStream, "HERMES"),
    Workspace: item.Workspace ?? null,
    WorkspaceRole: text(item.WorkspaceRole, "UNKNOWN"),
    AllowedPaths: normalizePaths(item.AllowedPaths),
    ProtectedPaths: normalizePaths(item.ProtectedPaths),
    Risk: text(item.Risk, "UNKNOWN"),
    Dependencies: unique(item.Dependencies),
    Conflicts: unique(item.Conflicts),
    DecisionStatus: text(item.DecisionStatus, "NONE"),
    ApprovalStatus: text(item.ApprovalStatus, "UNKNOWN"),
    LeaseStatus: text(item.LeaseStatus, "NONE"),
    ImplementerProvider: item.ImplementerProvider ?? null,
    ImplementerModel: item.ImplementerModel ?? null,
    ReviewerProvider: item.ReviewerProvider ?? null,
    ReviewerModel: item.ReviewerModel ?? null,
    EnqueuedAt: item.EnqueuedAt ?? now.toISOString(),
    EligibleAt: item.EligibleAt ?? null,
    StartedAt: item.StartedAt ?? null,
    CompletedAt: item.CompletedAt ?? null,
    BlockedAt: item.BlockedAt ?? null,
    BlockReasonCodes: unique(item.BlockReasonCodes),
    RetryCount: Number.isFinite(Number(item.RetryCount)) ? Number(item.RetryCount) : 0,
    RepairAttempts: Number.isFinite(Number(item.RepairAttempts)) ? Number(item.RepairAttempts) : 0,
    SchedulingGroup: text(item.SchedulingGroup, "HERMES_DEFAULT"),
    ConcurrencyKey: text(item.ConcurrencyKey, taskId || queueItemId),
    IdempotencyKey: item.IdempotencyKey ?? null,
    DependenciesState: item.DependenciesState ?? "UNKNOWN",
    ValidationPlanPresent: item.ValidationPlanPresent !== false,
    DecisionFresh: item.DecisionFresh !== false,
    ModelAvailable: item.ModelAvailable !== false,
    WorkspaceAllowed: item.WorkspaceAllowed !== false,
    DecompositionComplete: item.DecompositionComplete !== false,
    AwarenessPassed: item.AwarenessPassed !== false,
    IntentValid: item.IntentValid !== false,
    ApprovalValid: item.ApprovalValid !== false,
    DecisionContextCurrent: item.DecisionContextCurrent !== false,
    Dispatch: item.Dispatch ?? null,
  };
}

export function detectDependencyGraph(items = []) {
  const normalized = items.map((item) => normalizeQueueItem(item));
  const byTask = new Map(normalized.filter((item) => item.TaskId).map((item) => [item.TaskId, item]));
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const walk = (taskId, path = []) => {
    if (visiting.has(taskId)) {
      const start = path.indexOf(taskId);
      cycles.push(path.slice(start < 0 ? 0 : start).concat(taskId));
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    const node = byTask.get(taskId);
    for (const dependency of node?.Dependencies ?? []) if (byTask.has(dependency)) walk(dependency, [...path, taskId]);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const item of normalized) if (item.TaskId) walk(item.TaskId);
  const cycleTasks = new Set(cycles.flat());
  return { Items: normalized, ByTask: byTask, Cycles: cycles, CycleTasks: cycleTasks };
}

export function canTransitionQueueState(from, to) { return from === to || Boolean(QUEUE_TRANSITIONS[from]?.has(to)); }

export function transitionQueueItem(itemInput, to, { now = new Date(), reasonCodes = [] } = {}) {
  const item = normalizeQueueItem(itemInput, { now });
  if (!canTransitionQueueState(item.QueueState, to)) return { transitioned: false, status: "INVALID_QUEUE_TRANSITION", item, reasonCodes: ["INVALID_QUEUE_TRANSITION"] };
  const next = { ...item, QueueState: to, BlockReasonCodes: unique(reasonCodes) };
  if (to === "READY") next.EligibleAt ??= now.toISOString();
  if (to === "RUNNING") next.StartedAt ??= now.toISOString();
  if (["BLOCKED", "FAILED"].includes(to)) next.BlockedAt ??= now.toISOString();
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(to)) next.CompletedAt ??= now.toISOString();
  return { transitioned: true, status: "TRANSITIONED", item: next, reasonCodes: [] };
}

function dependencyResult(item, graph) {
  if (graph.CycleTasks.has(item.TaskId)) return { state: "BLOCKED", codes: ["DEPENDENCY_CYCLE"] };
  const missing = (item.Dependencies ?? []).filter((id) => !graph.ByTask.has(id));
  if (missing.length) return { state: "WAITING_DEPENDENCY", codes: ["DEPENDENCY_MISSING"], details: missing };
  const prerequisites = (item.Dependencies ?? []).map((id) => graph.ByTask.get(id));
  if (prerequisites.some((dependency) => dependency.QueueState === "FAILED")) return { state: "BLOCKED", codes: ["DEPENDENCY_FAILED"] };
  if (prerequisites.some((dependency) => dependency.QueueState === "CANCELLED")) return { state: "BLOCKED", codes: ["DEPENDENCY_CANCELLED"] };
  if (prerequisites.some((dependency) => !["COMPLETED"].includes(dependency.QueueState))) return { state: "WAITING_DEPENDENCY", codes: ["DEPENDENCY_INCOMPLETE"] };
  return { state: null, codes: [] };
}

function conflictWith(item, other) {
  if (!other || other.QueueItemId === item.QueueItemId || TERMINAL.has(other.QueueState)) return false;
  if (item.ConcurrencyKey && item.ConcurrencyKey === other.ConcurrencyKey) return true;
  if (normalizePath(item.Workspace) && normalizePath(item.Workspace) === normalizePath(other.Workspace)) {
    if (pathFamilyOverlaps(item.AllowedPaths, other.AllowedPaths)) return true;
    if (item.Domain && item.Domain === other.Domain) return true;
    if (item.WorkspaceRole === "CANONICAL_ACTIVE" || other.WorkspaceRole === "CANONICAL_ACTIVE") return true;
  }
  return (item.Conflicts ?? []).includes(other.TaskId) || (other.Conflicts ?? []).includes(item.TaskId);
}

export function evaluateQueueItem(itemInput, allItems = [], {
  activeExecutionCount = 0,
  maxConcurrent = MAX_CONCURRENT_EXECUTIONS,
  now = new Date(),
} = {}) {
  const item = normalizeQueueItem(itemInput, { now });
  if (TERMINAL.has(item.QueueState)) return { item, state: item.QueueState, codes: [], conflicts: [], eligible: false };
  if (item.QueueState === "CANCELLED") return { item, state: "CANCELLED", codes: [], conflicts: [], eligible: false };
  const graph = detectDependencyGraph(allItems);
  const dependency = dependencyResult(item, graph);
  if (dependency.state) return { item: { ...item, QueueState: dependency.state, BlockReasonCodes: dependency.codes }, state: dependency.state, codes: dependency.codes, conflicts: [], eligible: false, details: dependency.details ?? [] };
  const flags = [
    [!item.AwarenessPassed, "UNKNOWN_WORKSPACE"],
    [!item.IntentValid, "UNKNOWN_SCOPE"],
    [!item.DecompositionComplete, "DECOMPOSITION_REQUIRED"],
    [!item.WorkspaceAllowed, "WORKSPACE_BLOCKED"],
    [!item.ValidationPlanPresent, "VALIDATION_PLAN_MISSING"],
    [!item.ModelAvailable, "MODEL_UNAVAILABLE"],
    [!item.DecisionContextCurrent, "STALE_CONTEXT"],
    [!item.DecisionFresh || ["STALE_DECISION", "STALE_CONTEXT"].includes(item.DecisionStatus), "STALE_DECISION"],
  ];
  const failedFlag = flags.find(([failed]) => failed);
  if (failedFlag) return { item: { ...item, QueueState: "BLOCKED", BlockReasonCodes: [failedFlag[1]], BlockedAt: now.toISOString() }, state: "BLOCKED", codes: [failedFlag[1]], conflicts: [], eligible: false };
  if (item.RepairAttempts >= MAX_AUTOMATIC_REPAIR_ATTEMPTS && ["REPAIR_REQUIRED", "READY", "QUEUED"].includes(item.QueueState)) return { item: { ...item, QueueState: "BLOCKED", BlockReasonCodes: ["REPAIR_LIMIT_REACHED"], BlockedAt: now.toISOString() }, state: "BLOCKED", codes: ["REPAIR_LIMIT_REACHED"], conflicts: [], eligible: false };
  if (item.ApprovalValid === false || ["PENDING", "EXPIRED", "INVALIDATED", "REJECTED", "REVOKED"].includes(item.ApprovalStatus)) {
    return { item: { ...item, QueueState: "WAITING_APPROVAL", BlockReasonCodes: ["APPROVAL_REQUIRED"] }, state: "WAITING_APPROVAL", codes: ["APPROVAL_REQUIRED"], conflicts: [], eligible: false };
  }
  if (item.DecisionStatus !== "ALLOW") return { item: { ...item, QueueState: "BLOCKED", BlockReasonCodes: ["LEASE_NOT_ELIGIBLE"] }, state: "BLOCKED", codes: ["LEASE_NOT_ELIGIBLE"], conflicts: [], eligible: false };
  const conflicts = allItems.filter((other) => conflictWith(item, normalizeQueueItem(other))).map((other) => other.TaskId).filter(Boolean).sort();
  if (conflicts.length) return { item: { ...item, QueueState: "WAITING_CONFLICT", BlockReasonCodes: ["WRITE_CONFLICT"], Conflicts: conflicts }, state: "WAITING_CONFLICT", codes: ["WRITE_CONFLICT"], conflicts, eligible: false };
  if (item.LeaseStatus === "RUNNING" || item.LeaseStatus === "VALID") return { item: { ...item, QueueState: "WAITING_CONFLICT", BlockReasonCodes: ["EXECUTION_LOCKED"] }, state: "WAITING_CONFLICT", codes: ["EXECUTION_LOCKED"], conflicts: [item.TaskId], eligible: false };
  if (activeExecutionCount >= Math.max(1, Math.min(MAX_CONCURRENT_EXECUTIONS, Number(maxConcurrent) || MAX_CONCURRENT_EXECUTIONS))) return { item: { ...item, QueueState: "READY" }, state: "READY", codes: ["CONCURRENCY_LIMIT"], conflicts: [], eligible: false };
  return { item: { ...item, QueueState: "READY", EligibleAt: item.EligibleAt ?? now.toISOString(), BlockReasonCodes: [] }, state: "READY", codes: [], conflicts: [], eligible: true };
}

export function scheduleQueue(items = [], { activeExecutionCount = 0, maxConcurrent = MAX_CONCURRENT_EXECUTIONS, now = new Date() } = {}) {
  const normalized = items.map((item) => normalizeQueueItem(item, { now }));
  const evaluated = normalized.map((item) => evaluateQueueItem(item, normalized, { activeExecutionCount, maxConcurrent, now }));
  const slots = Math.max(0, Math.min(MAX_CONCURRENT_EXECUTIONS, Number(maxConcurrent) || MAX_CONCURRENT_EXECUTIONS) - activeExecutionCount);
  const candidates = evaluated.filter((result) => result.eligible).sort((a, b) => (PRIORITY_ORDER.get(a.item.Priority) - PRIORITY_ORDER.get(b.item.Priority)) || String(a.item.EligibleAt ?? a.item.EnqueuedAt).localeCompare(String(b.item.EligibleAt ?? b.item.EnqueuedAt)) || String(a.item.TaskId).localeCompare(String(b.item.TaskId)));
  const dispatch = [];
  const selected = [];
  for (const candidate of candidates) {
    if (dispatch.length >= slots) break;
    if (selected.some((other) => conflictWith(candidate.item, other))) continue;
    selected.push(candidate.item);
    dispatch.push(candidate.item);
  }
  const selectedIds = new Set(dispatch.map((item) => item.QueueItemId));
  return { Items: evaluated.map((result) => selectedIds.has(result.item.QueueItemId) ? { ...result.item, QueueState: "READY" } : result.item), Dispatch: dispatch, Evaluated: evaluated, MaxConcurrent: Math.min(MAX_CONCURRENT_EXECUTIONS, Number(maxConcurrent) || MAX_CONCURRENT_EXECUTIONS) };
}

export function claimDispatch(itemInput, { schedulerInstanceId = `scheduler-${randomUUID()}`, now = new Date(), ttlMs = DEFAULT_CLAIM_TTL_MS } = {}) {
  const item = normalizeQueueItem(itemInput, { now });
  const current = item.Dispatch;
  if (current?.ClaimExpiresAt && Date.parse(current.ClaimExpiresAt) > now.getTime()) return { claimed: false, status: "EXECUTION_LOCKED", item, reasonCodes: ["DISPATCH_CLAIM_ACTIVE"] };
  if (item.QueueState !== "READY") return { claimed: false, status: "NOT_READY", item, reasonCodes: ["QUEUE_NOT_READY"] };
  const claim = { DispatchId: `dispatch-${randomUUID()}`, SchedulerInstanceId: text(schedulerInstanceId).slice(0, 128), ClaimedAt: now.toISOString(), ClaimExpiresAt: new Date(now.getTime() + Math.max(1000, ttlMs)).toISOString() };
  return { claimed: true, status: "CLAIMED", item: { ...item, Dispatch: claim }, claim, reasonCodes: [] };
}

export function recoverDispatchClaim(itemInput, { now = new Date() } = {}) {
  const item = normalizeQueueItem(itemInput, { now });
  if (!item.Dispatch?.ClaimExpiresAt || Date.parse(item.Dispatch.ClaimExpiresAt) <= now.getTime()) return { recoverable: true, item: { ...item, Dispatch: null, QueueState: item.QueueState === "RUNNING" ? "RUNNING" : "QUEUED" }, reasonCodes: item.Dispatch ? ["STALE_DISPATCH_CLAIM"] : [] };
  return { recoverable: false, item, reasonCodes: ["DISPATCH_CLAIM_ACTIVE"] };
}

export function enqueueQueueItem(items = [], input = {}, { now = new Date() } = {}) {
  const candidate = normalizeQueueItem({ ...input, QueueState: input.QueueState ?? "QUEUED" }, { now });
  const duplicate = items.find((item) => (candidate.IdempotencyKey && item.IdempotencyKey === candidate.IdempotencyKey) || (candidate.TaskId && item.TaskId === candidate.TaskId && !TERMINAL.has(item.QueueState)));
  if (duplicate) return { created: false, duplicate: true, item: normalizeQueueItem(duplicate, { now }) };
  return { created: true, duplicate: false, item: candidate, items: [...items, candidate] };
}

export function summarizeQueueItem(item, allItems = []) {
  const normalized = normalizeQueueItem(item);
  const ordered = allItems.filter((candidate) => ["READY", "QUEUED", "WAITING_APPROVAL", "WAITING_DEPENDENCY", "WAITING_CONFLICT"].includes(candidate.QueueState)).sort((a, b) => (PRIORITY_ORDER.get(a.Priority) - PRIORITY_ORDER.get(b.Priority)) || String(a.EnqueuedAt).localeCompare(String(b.EnqueuedAt)) || String(a.TaskId).localeCompare(String(b.TaskId)));
  const position = ordered.findIndex((candidate) => candidate.QueueItemId === normalized.QueueItemId);
  return { QueueItemId: normalized.QueueItemId, TaskId: normalized.TaskId, QueueState: normalized.QueueState, Priority: normalized.Priority, Position: position < 0 ? null : position + 1, Eligibility: normalized.QueueState === "READY" ? "READY" : "WAITING", WaitingReason: normalized.BlockReasonCodes[0] ?? null, ConflictingTasks: normalized.Conflicts, DependencyState: normalized.DependenciesState, ConcurrencyState: normalized.Dispatch ? "CLAIMED" : normalized.LeaseStatus === "RUNNING" ? "RUNNING" : "AVAILABLE" };
}

function queuePaths(root) { const directory = join(root, ".ai", "hermes-queue"); return { directory, latest: join(directory, "queue.json"), history: join(directory, "events.jsonl") }; }
async function readJsonLines(path) { try { return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } }

export async function persistQueueState(root, items = [], events = []) {
  const paths = queuePaths(root);
  await mkdir(paths.directory, { recursive: true });
  const temp = `${paths.latest}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify({ Items: items.map((item) => normalizeQueueItem(item)), UpdatedAt: new Date().toISOString() }, null, 2), "utf8");
  await rename(temp, paths.latest);
  if (events.length) await writeFile(paths.history, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, { encoding: "utf8", flag: "a" });
  return paths.latest;
}

export async function readQueueState(root) {
  const paths = queuePaths(root);
  let items = [];
  try { items = JSON.parse(await readFile(paths.latest, "utf8")).Items ?? []; } catch { /* no queue yet */ }
  return { Items: items.map((item) => normalizeQueueItem(item)), Events: await readJsonLines(paths.history) };
}

export async function claimQueueDispatch(root, queueItemId, options = {}) {
  const paths = queuePaths(root);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const lockPath = join(paths.directory, "dispatch.lock");
  await mkdir(paths.directory, { recursive: true });
  let acquired = false;
  try {
    try {
      await mkdir(lockPath);
      acquired = true;
      await writeFile(join(lockPath, "owner.json"), JSON.stringify({ SchedulerInstanceId: options.schedulerInstanceId ?? "unknown", ClaimExpiresAt: new Date(now.getTime() + Math.max(1000, options.ttlMs ?? DEFAULT_CLAIM_TTL_MS)).toISOString() }), "utf8");
    } catch {
      let owner = null;
      try { owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")); } catch { /* incomplete owner is conservatively active */ }
      if (!owner?.ClaimExpiresAt || Date.parse(owner.ClaimExpiresAt) > now.getTime()) return { claimed: false, status: "EXECUTION_LOCKED", reasonCodes: ["SCHEDULER_CLAIM_ACTIVE"] };
      await rm(lockPath, { recursive: true, force: true });
      await mkdir(lockPath);
      acquired = true;
      await writeFile(join(lockPath, "owner.json"), JSON.stringify({ SchedulerInstanceId: options.schedulerInstanceId ?? "unknown", ClaimExpiresAt: new Date(now.getTime() + Math.max(1000, options.ttlMs ?? DEFAULT_CLAIM_TTL_MS)).toISOString() }), "utf8");
    }
    const state = await readQueueState(root);
    const item = state.Items.find((candidate) => candidate.QueueItemId === queueItemId || candidate.TaskId === queueItemId);
    if (!item) return { claimed: false, status: "NOT_FOUND", reasonCodes: ["QUEUE_ITEM_NOT_FOUND"] };
    const result = claimDispatch(item, options);
    if (!result.claimed) return result;
    await persistQueueState(root, state.Items.map((candidate) => candidate.QueueItemId === item.QueueItemId ? result.item : candidate), [{ Type: "DISPATCH_CLAIMED", TaskId: item.TaskId, Timestamp: now.toISOString(), Summary: "Scheduler dispatch claim acquired.", ReasonCodes: [] }]);
    return result;
  } finally {
    if (acquired) await rm(lockPath, { recursive: true, force: true });
  }
}
