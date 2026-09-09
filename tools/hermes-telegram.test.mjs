import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOLS } from "./hermes-gateway.mjs";
import { authorizeOperator, MAX_TELEGRAM_MESSAGE_LENGTH, parseOperatorCommand, readOperatorNotifications, recordOperatorNotifications, renderOperatorCommand, selectOperatorNotifications } from "./hermes-telegram.mjs";

const state = {
  gatewayStatus: "AVAILABLE", projectContext: { ProjectName: "TERAS Universal Website / CRM", CanonicalWorkspace: "D:\\Projects\\terasuniversal-website-clean", ActiveWorkspace: "D:\\Projects\\_worktrees\\teras-hermes-source", WorkspaceRole: "ISOLATED_HERMES", Branch: "isolate/hermes-source", HeadSha: "abc123456789", OriginMainSha: "def987654321", AheadCount: 0, BehindCount: 2, WorkingTreeState: "DIRTY", StagedCount: 0, RemoteFreshness: "REMOTE_FRESHNESS_UNKNOWN", DevelopmentStream: { PrimaryDevelopmentStream: "CRM", SecondaryDevelopmentStream: "HERMES" }, Blockers: [] },
  agents: { Codex: { provider: "OpenAI Codex", model: "GPT-5.6 Luna", status: "AVAILABLE" }, Claude: { provider: "Anthropic", model: "Claude Sonnet 5", status: "AVAILABLE" } },
  tasks: [{ TaskId: "task-1", Title: "Routing audit", IntentSummary: "Validate routing", Domain: "HERMES_ROUTING", Risk: "MEDIUM", Workspace: "D:\\Projects\\_worktrees\\teras-hermes-source", Branch: "isolate/hermes-source", AllowedScope: ["tools/**"], ProtectedScope: ["app/**", "supabase/**"], Dependencies: [], Conflicts: [], DecisionStatus: "ALLOW", ApprovalStatus: "NOT_REQUIRED", ImplementerProvider: "OpenAI Codex", ImplementerModel: "GPT-5.6 Luna", ReviewerProvider: "Anthropic", ReviewerModel: "Claude Sonnet 5", ExecutionStatus: "COMPLETED", RepairAttempts: 0, ReviewStatus: "APPROVED", RequiredHumanAction: "NONE", Blockers: [] }],
  queueItems: [{ TaskId: "task-1", Priority: "P1", QueueState: "READY", ImplementerModel: "GPT-5.6 Luna" }, { TaskId: "task-2", Priority: "P0", QueueState: "WAITING_APPROVAL", WaitingReason: "APPROVAL_REQUIRED", ImplementerModel: "Claude Sonnet 5" }, { TaskId: "task-3", Priority: "P2", QueueState: "WAITING_CONFLICT", WaitingReason: "WRITE_CONFLICT", ImplementerModel: "GPT-5.6 Luna" }],
  blockers: ["APPROVAL_REQUIRED", "WRITE_CONFLICT"], requiredHumanAction: "APPROVE", approvals: [{ TaskId: "task-2", Title: "High-risk review", ApprovalState: "PENDING", ApprovedRisk: "HIGH", ApprovedWorkspace: "D:\\Projects\\_worktrees\\teras-hermes-source", ApprovedBranch: "isolate/hermes-source", ApprovedHead: "abcdef123456", InputFingerprint: "fingerprint123", ExpiresAt: "2026-09-10T00:00:00Z" }],
  runs: [{ name: "H7 regression", status: "PASS", updatedAt: "2026-09-09T10:00:00Z" }], operatorEvidence: { ExportDigest: "digest123", FinalState: "COMPLETED" }, auditByTask: { "task-1": { ExportDigest: "digest123", FinalState: "COMPLETED" } },
};

test("live operator commands render only the five approved Telegram commands", () => {
  for (const command of ["/status", "/tasks", "/queue", "/project", "/help"]) {
    const parsed = parseOperatorCommand(command);
    assert.equal(parsed.ok, true, command);
    const output = renderOperatorCommand(parsed, state);
    assert.ok(output.length <= MAX_TELEGRAM_MESSAGE_LENGTH);
    assert.equal(output.includes("OPENAI_API_KEY"), false);
  }
  for (const command of ["/task task-1", "/blockers", "/approvals", "/runs", "/agents", "/audit task-1"]) {
    assert.equal(parseOperatorCommand(command).ok, false, command);
  }
});

test("unknown task and malformed/unknown commands are safe", () => {
  assert.match(renderOperatorCommand({ ok: true, command: "task", taskId: "missing" }, state), /not found/i);
  assert.match(renderOperatorCommand(parseOperatorCommand("/unknown"), state), /Unsupported|Help/);
  assert.match(renderOperatorCommand(parseOperatorCommand("status"), state), /Help/);
  assert.match(renderOperatorCommand(parseOperatorCommand("/task"), state), /Help/);
});

test("authorization requires configured user and chat allowlists", () => {
  assert.equal(authorizeOperator({ senderId: 1, chatId: 2, allowedUserIds: [1], allowedChatIds: [2] }).allowed, true);
  const denied = authorizeOperator({ senderId: 9, chatId: 2, allowedUserIds: [1], allowedChatIds: [2] });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "UNAUTHORIZED_OPERATOR");
});

test("shell, SQL, and filesystem-like input is rejected and never evaluated", () => {
  for (const input of ["/status; powershell.exe -Command whoami", "/status SELECT * FROM users", "/task C:\\secret\\file", "/audit ../../secrets"]) {
    const parsed = parseOperatorCommand(input);
    assert.equal(parsed.ok, false, input);
  }
});

test("queue and approval UX exposes blockers without bypassing them", () => {
  const queue = renderOperatorCommand(parseOperatorCommand("/queue"), state);
  assert.match(queue, /WAITING_APPROVAL/);
  assert.match(queue, /WAITING_CONFLICT/);
  const approvals = renderOperatorCommand({ ok: true, command: "approvals" }, { ...state, approvals: [{ ...state.approvals[0], ApprovalState: "INVALIDATED" }] });
  assert.match(approvals, /INVALIDATED/);
  assert.match(approvals, /read-only/i);
});

test("output excludes secrets, PII, prompts, raw commands, and hidden reviewer details", () => {
  const unsafe = { ...state, tasks: [{ ...state.tasks[0], Title: "OPENAI_API_KEY=secret user@example.com", IntentSummary: "powershell.exe -Command secret", HiddenReasoning: "private", RawCommand: "git push" }] };
  const output = renderOperatorCommand(parseOperatorCommand("/tasks"), unsafe);
  assert.equal(output.includes("secret"), false);
  assert.equal(output.includes("user@example.com"), false);
  assert.equal(output.includes("powershell.exe"), false);
  assert.equal(output.includes("git push"), false);
});

test("task lists are bounded and mobile-safe", () => {
  const many = { ...state, tasks: Array.from({ length: 20 }, (_, index) => ({ ...state.tasks[0], TaskId: `task-${index}`, Title: "x".repeat(600) })) };
  const output = renderOperatorCommand(parseOperatorCommand("/tasks"), many);
  assert.ok(output.length <= MAX_TELEGRAM_MESSAGE_LENGTH);
  assert.match(output, /Showing 8 of 20/);
});

test("notifications deduplicate meaningful transitions and ignore heartbeats", async () => {
  const events = [
    { TaskId: "task-1", Type: "TASK_READY", Timestamp: "2026-09-09T10:00:00Z", Summary: "Ready" },
    { TaskId: "task-1", Type: "TASK_READY", Timestamp: "2026-09-09T10:00:00Z", Summary: "Ready" },
    { TaskId: "task-1", Type: "HEARTBEAT", Timestamp: "2026-09-09T10:00:01Z" },
  ];
  assert.equal(selectOperatorNotifications(events).length, 1);
  const root = await mkdtemp(join(tmpdir(), "hermes-telegram-"));
  try {
    assert.equal((await recordOperatorNotifications(root, events)).length, 1);
    assert.equal((await recordOperatorNotifications(root, events)).length, 0);
    assert.equal((await readOperatorNotifications(root)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP registry remains 12 tools with 8 read-only and 4 controlled", () => {
  assert.equal(TOOLS.length, 12);
  assert.equal(TOOLS.filter((tool) => tool.annotations.readOnlyHint).length, 8);
  assert.equal(TOOLS.filter((tool) => tool.annotations.readOnlyHint === false).length, 4);
});
