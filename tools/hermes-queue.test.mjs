import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_CONCURRENT_EXECUTIONS,
  claimDispatch,
  claimQueueDispatch,
  canTransitionQueueState,
  detectDependencyGraph,
  enqueueQueueItem,
  evaluateQueueItem,
  persistQueueState,
  readQueueState,
  recoverDispatchClaim,
  scheduleQueue,
  summarizeQueueItem,
  transitionQueueItem,
} from "./hermes-queue.mjs";
import { buildAuditTimeline } from "./hermes-audit.mjs";
import { TOOLS } from "./hermes-gateway.mjs";

const base = (overrides = {}) => ({
  QueueItemId: `queue-${overrides.TaskId ?? "task"}`,
  TaskId: overrides.TaskId ?? "task-1",
  Priority: "P2",
  QueueState: "QUEUED",
  Domain: "HERMES_TOOLING",
  DevelopmentStream: "HERMES",
  Workspace: "D:\\Projects\\_worktrees\\teras-hermes-source",
  WorkspaceRole: "ISOLATED_HERMES",
  Risk: "LOW",
  AllowedPaths: [`tools/${overrides.TaskId ?? "task"}/**`],
  Dependencies: [],
  DecisionStatus: "ALLOW",
  DecisionFresh: true,
  ApprovalStatus: "NOT_REQUIRED",
  ApprovalValid: true,
  LeaseStatus: "NONE",
  ValidationPlanPresent: true,
  ModelAvailable: true,
  WorkspaceAllowed: true,
  DecompositionComplete: true,
  AwarenessPassed: true,
  IntentValid: true,
  DecisionContextCurrent: true,
  EnqueuedAt: "2026-09-09T10:00:00.000Z",
  ...overrides,
});

test("eligible task enters READY", () => {
  const result = evaluateQueueItem(base(), [base()]);
  assert.equal(result.state, "READY");
  assert.equal(result.eligible, true);
});

test("approval, dependency, model, and workspace gates wait or block safely", () => {
  assert.equal(evaluateQueueItem(base({ ApprovalStatus: "PENDING", ApprovalValid: false }), [base({ ApprovalStatus: "PENDING", ApprovalValid: false })]).state, "WAITING_APPROVAL");
  assert.equal(evaluateQueueItem(base({ Dependencies: ["missing"] }), [base({ Dependencies: ["missing"] })]).state, "WAITING_DEPENDENCY");
  assert.equal(evaluateQueueItem(base({ ModelAvailable: false }), [base({ ModelAvailable: false })]).codes[0], "MODEL_UNAVAILABLE");
  assert.equal(evaluateQueueItem(base({ WorkspaceRole: "UNKNOWN", AwarenessPassed: false }), [base({ WorkspaceRole: "UNKNOWN", AwarenessPassed: false })]).codes[0], "UNKNOWN_WORKSPACE");
});

test("dependency completion, failure, cancellation, missing dependency, and cycle are deterministic", () => {
  const prerequisite = base({ TaskId: "task-a", QueueState: "COMPLETED" });
  const dependent = base({ TaskId: "task-b", Dependencies: ["task-a"] });
  assert.equal(evaluateQueueItem(dependent, [prerequisite, dependent]).state, "READY");
  assert.equal(evaluateQueueItem({ ...dependent, Dependencies: ["failed"] }, [base({ TaskId: "failed", QueueState: "FAILED" }), { ...dependent, Dependencies: ["failed"] }]).codes[0], "DEPENDENCY_FAILED");
  assert.equal(evaluateQueueItem({ ...dependent, Dependencies: ["cancelled"] }, [base({ TaskId: "cancelled", QueueState: "CANCELLED" }), { ...dependent, Dependencies: ["cancelled"] }]).codes[0], "DEPENDENCY_CANCELLED");
  assert.equal(evaluateQueueItem(dependent, [dependent]).state, "WAITING_DEPENDENCY");
  const cycle = [base({ TaskId: "a", Dependencies: ["b"] }), base({ TaskId: "b", Dependencies: ["a"] })];
  assert.equal(detectDependencyGraph(cycle).Cycles.length, 1);
  assert.equal(evaluateQueueItem(cycle[0], cycle).codes[0], "DEPENDENCY_CYCLE");
});

test("conflicts wait and release after the conflicting task completes", () => {
  const running = base({ TaskId: "running", QueueState: "RUNNING", AllowedPaths: ["tools/shared/**"] });
  const waiting = base({ TaskId: "waiting", AllowedPaths: ["tools/shared/**"] });
  const blocked = evaluateQueueItem(waiting, [running, waiting]);
  assert.equal(blocked.state, "WAITING_CONFLICT");
  assert.deepEqual(blocked.conflicts, ["running"]);
  const released = evaluateQueueItem(waiting, [{ ...running, QueueState: "COMPLETED" }, waiting]);
  assert.equal(released.state, "READY");
});

test("priority ordering is deterministic and blocked P0 does not consume a slot", () => {
  const p1 = base({ TaskId: "p1", Domain: "HERMES_MCP", Priority: "P1", EnqueuedAt: "2026-09-09T10:01:00.000Z", AllowedPaths: ["tools/p1/**"] });
  const p2 = base({ TaskId: "p2", Domain: "HERMES_ROUTING", Priority: "P2", EnqueuedAt: "2026-09-09T10:00:00.000Z", AllowedPaths: ["tools/p2/**"] });
  const blockedP0 = base({ TaskId: "blocked-p0", Domain: "HERMES_RELIABILITY", Priority: "P0", ApprovalStatus: "PENDING", ApprovalValid: false, AllowedPaths: ["tools/p0/**"] });
  const result = scheduleQueue([p2, blockedP0, p1], { maxConcurrent: 2 });
  assert.deepEqual(result.Dispatch.map((item) => item.TaskId), ["p1", "p2"]);
  assert.equal(result.Items.find((item) => item.TaskId === "blocked-p0").QueueState, "WAITING_APPROVAL");
});

test("maximum concurrency and same-workspace serialization are enforced", () => {
  const items = [base({ TaskId: "one", Domain: "HERMES_MCP", AllowedPaths: ["tools/one/**"] }), base({ TaskId: "two", Domain: "HERMES_ROUTING", AllowedPaths: ["tools/two/**"] }), base({ TaskId: "three", Domain: "HERMES_RELIABILITY", AllowedPaths: ["tools/three/**"] })];
  assert.equal(scheduleQueue(items, { maxConcurrent: 99 }).Dispatch.length, MAX_CONCURRENT_EXECUTIONS);
  const running = base({ TaskId: "running", QueueState: "RUNNING", AllowedPaths: ["tools/shared/**"] });
  const sameWorkspace = base({ TaskId: "same", AllowedPaths: ["tools/shared/**"] });
  assert.equal(evaluateQueueItem(sameWorkspace, [running, sameWorkspace]).state, "WAITING_CONFLICT");
  const independent = base({ TaskId: "independent", Domain: "HERMES_MCP", AllowedPaths: ["docs/independent/**"] });
  assert.equal(evaluateQueueItem(independent, [running, independent]).state, "READY");
});

test("dispatch claims are atomic, valid claims cannot be stolen, and stale claims recover", () => {
  const now = new Date("2026-09-09T10:00:00.000Z");
  const item = base({ QueueState: "READY" });
  const first = claimDispatch(item, { schedulerInstanceId: "scheduler-a", now });
  assert.equal(first.claimed, true);
  const second = claimDispatch(first.item, { schedulerInstanceId: "scheduler-b", now: new Date("2026-09-09T10:00:01.000Z") });
  assert.equal(second.status, "EXECUTION_LOCKED");
  const recovered = recoverDispatchClaim(first.item, { now: new Date("2026-09-09T10:01:00.000Z") });
  assert.equal(recovered.recoverable, true);
  assert.equal(recovered.item.Dispatch, null);
});

test("lease, decision drift, cancellation, and repair limits prevent unsafe dispatch", () => {
  assert.equal(evaluateQueueItem(base({ LeaseStatus: "RUNNING" }), [base({ LeaseStatus: "RUNNING" })]).state, "WAITING_CONFLICT");
  assert.equal(evaluateQueueItem(base({ DecisionFresh: false, DecisionStatus: "STALE_DECISION" }), [base({ DecisionFresh: false, DecisionStatus: "STALE_DECISION" })]).codes[0], "STALE_DECISION");
  const cancelled = base({ QueueState: "CANCELLED" });
  assert.equal(scheduleQueue([cancelled]).Dispatch.length, 0);
  assert.equal(evaluateQueueItem(base({ RepairAttempts: 2 }), [base({ RepairAttempts: 2 })]).codes[0], "REPAIR_LIMIT_REACHED");
});

test("queue state transitions reject invalid lifecycle jumps", () => {
  assert.equal(canTransitionQueueState("QUEUED", "READY"), true);
  assert.equal(canTransitionQueueState("COMPLETED", "RUNNING"), false);
  assert.equal(transitionQueueItem(base({ QueueState: "COMPLETED" }), "RUNNING").transitioned, false);
  assert.equal(transitionQueueItem(base(), "READY").item.QueueState, "READY");
});

test("enqueue is idempotent and durable queue/audit history survives restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "hermes-queue-"));
  try {
    const first = enqueueQueueItem([], base({ IdempotencyKey: "idem-1" }));
    const duplicate = enqueueQueueItem([first.item], base({ IdempotencyKey: "idem-1" }));
    assert.equal(first.created, true);
    assert.equal(duplicate.duplicate, true);
    await persistQueueState(root, [first.item], [{ Type: "TASK_ENQUEUED", TaskId: first.item.TaskId, Timestamp: "2026-09-09T10:00:00.000Z" }]);
    const restored = await readQueueState(root);
    assert.equal(restored.Items.length, 1);
    assert.equal(restored.Events[0].Type, "TASK_ENQUEUED");
    const summary = summarizeQueueItem({ ...first.item, QueueState: "WAITING_DEPENDENCY", Dependencies: ["prereq"] }, [first.item]);
    assert.equal(summary.WaitingReason, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("queue events enter the bounded audit timeline and MCP registry remains unchanged", () => {
  const timeline = buildAuditTimeline({ task: { TaskId: "task-1", CreatedAt: "2026-09-09T10:00:00.000Z" }, queueEvents: [
    { TaskId: "task-1", Type: "TASK_ENQUEUED", Timestamp: "2026-09-09T10:01:00.000Z", Summary: "Task enqueued." },
    { TaskId: "task-1", Type: "DISPATCH_CLAIMED", Timestamp: "2026-09-09T10:02:00.000Z", Summary: "Dispatch claimed." },
  ] });
  assert.deepEqual(timeline.Events.map((event) => event.Type), ["TASK_CREATED", "TASK_ENQUEUED", "DISPATCH_CLAIMED"]);
  assert.equal(TOOLS.length, 12);
  assert.equal(TOOLS.filter((tool) => tool.annotations.readOnlyHint).length, 8);
  assert.equal(TOOLS.filter((tool) => tool.annotations.readOnlyHint === false).length, 4);
});

test("durable scheduler claim serializes dispatch and preserves claim history", async () => {
  const root = await mkdtemp(join(tmpdir(), "hermes-dispatch-"));
  try {
    const item = base({ QueueState: "READY" });
    await persistQueueState(root, [item]);
    const first = await claimQueueDispatch(root, item.QueueItemId, { schedulerInstanceId: "a", now: new Date("2026-09-09T10:00:00.000Z") });
    assert.equal(first.claimed, true);
    const restored = await readQueueState(root);
    assert.equal(restored.Events[0].Type, "DISPATCH_CLAIMED");
    const second = await claimQueueDispatch(root, item.QueueItemId, { schedulerInstanceId: "b", now: new Date("2026-09-09T10:00:01.000Z") });
    assert.equal(second.status, "EXECUTION_LOCKED");
  } finally { await rm(root, { recursive: true, force: true }); }
});
