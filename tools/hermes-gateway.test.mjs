import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { CANONICAL_WORKSPACE, HERMES_WORKSPACE, createHermesGatewayServer, TOOLS, MUTATING_TOOLS, callTool, evaluateStateFreshness, agentVisibility, assessTaskRecovery, summarizeExecutionLease, validateActionInput, projectStatusForTool, projectRoadmapForTool } from "./hermes-gateway.mjs";

test("binds Hermes to the canonical workspace and reads refreshed project state", async () => {
  const status = await callTool("hermes_status");
  assert.equal(status.canonicalWorkspace, "D:\\Projects\\terasuniversal-website-clean");
  assert.equal(CANONICAL_WORKSPACE, status.canonicalWorkspace);
  assert.equal(status.stateFreshness.canonicalBinding, "STALE");
  assert.equal(status.stateFreshness.resolvedWorkspace, HERMES_WORKSPACE);
  const canonical = evaluateStateFreshness({
    repoRoot: CANONICAL_WORKSPACE,
    project: "Repository: `D:\\Projects\\terasuniversal-website-clean`",
    roadmap: "Workspace: `D:\\Projects\\terasuniversal-website-clean`",
  });
  assert.equal(canonical.status, "CURRENT");
});

test("classifies canonical and outdated state bindings explicitly", () => {
  const current = evaluateStateFreshness({
    repoRoot: CANONICAL_WORKSPACE,
    project: "Repository: `D:\\Projects\\terasuniversal-website-clean`",
    roadmap: "Workspace: `D:\\Projects\\terasuniversal-website-clean`",
  });
  assert.equal(current.status, "CURRENT");
  assert.deepEqual(current.documents.map((item) => item.status), ["CURRENT", "CURRENT"]);

  const stale = evaluateStateFreshness({
    repoRoot: CANONICAL_WORKSPACE,
    project: "Repository: `D:\\Projects\\terasuniversal-website`",
    roadmap: "# ROADMAP",
  });
  assert.equal(stale.status, "STALE");
  assert.equal(stale.documents[0].status, "STALE");
  assert.equal(stale.documents[1].status, "NEEDS_REFRESH");
});

test("assesses interrupted, completed, and stale-workspace tasks without fabricating success", () => {
  const worktree = "D:\\Projects\\_worktrees\\teras-hermes-source";
  const interrupted = assessTaskRecovery({
    TaskId: "H1-RUNNING",
    State: "RUNNING",
    Risk: "LOW",
    Implementer: "Codex",
    ImplementerProvider: "OpenAI Codex",
    ImplementerModel: "GPT-5.6 Luna",
    ExecutionStatus: "RUNNING",
    WorkspaceBoundary: { CanonicalWorkspace: worktree },
  }, { repoRoot: worktree });
  assert.equal(interrupted.recommendedState, "BLOCKED");
  assert.ok(interrupted.findings.includes("INTERRUPTED_EXECUTION"));

  const completed = assessTaskRecovery({ State: "COMPLETED", ExecutionStatus: "COMPLETED", ImplementerProvider: "OpenAI Codex" }, { repoRoot: worktree });
  assert.equal(completed.needsReconciliation, false);
  assert.equal(completed.recommendedState, "COMPLETED");

  const stale = assessTaskRecovery({ State: "ROUTED", WorkspaceBoundary: { CanonicalWorkspace: "D:\\Projects\\terasuniversal-website-clean" }, ImplementerProvider: "OpenAI Codex" }, { repoRoot: worktree });
  assert.equal(stale.recommendedState, "BLOCKED");
  assert.ok(stale.findings.includes("WORKSPACE_BINDING_MISMATCH"));
});

test("reports bounded lease status and preserves a fresh execution across gateway reload", () => {
  const worktree = "D:\\Projects\\_worktrees\\teras-hermes-source";
  const fresh = summarizeExecutionLease({ status: "RUNNING", executionId: "exec-1234567890", heartbeatAt: "2026-09-09T12:00:00.000Z", leaseExpiresAt: "2026-09-09T12:01:00.000Z", attempt: 2, agent: "Codex", provider: "OpenAI Codex", model: "GPT-5.6 Luna" }, { now: new Date("2026-09-09T12:00:30.000Z") });
  assert.equal(fresh.active, true);
  assert.equal(fresh.status, "ACTIVE");
  assert.equal(fresh.executionId, "exec-1234567…");
  const stale = assessTaskRecovery({ State: "RUNNING", ExecutionStatus: "RUNNING", WorkspaceBoundary: { CanonicalWorkspace: worktree }, ImplementerProvider: "OpenAI Codex" }, { repoRoot: worktree, lease: { status: "RUNNING", heartbeatAt: "2026-09-09T11:00:00.000Z", leaseExpiresAt: "2026-09-09T11:01:00.000Z" }, now: new Date("2026-09-09T12:00:00.000Z") });
  assert.equal(stale.recommendedState, "BLOCKED");
  assert.ok(stale.findings.includes("STALE_EXECUTION_LEASE"));
});

test("registers exactly the Phase 1 read-only tools", () => {
  assert.deepEqual(TOOLS.slice(0, 8).map((tool) => tool.name), [
    "hermes_status", "hermes_gateway_health", "hermes_project_status", "hermes_roadmap",
    "hermes_active_tasks", "hermes_task_detail", "hermes_recent_runs", "hermes_agent_status",
  ]);
  for (const tool of TOOLS.slice(0, 8)) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
});

test("reads the shared task store without creating a second store", async () => {
  const status = await callTool("hermes_status");
  assert.equal(status.taskStore, ".ai/task-state.json");
  assert.equal(status.taskStoreShared, true);
  assert.equal(status.arbitraryShellExecution, false);
});

test("H-2 MCP project and roadmap tools return bounded projections, never raw markdown", async () => {
  const context = { ProjectId: "TERAS_UNIVERSAL_HERMES", ProjectName: "TERAS", WorkspaceRole: "ISOLATED_HERMES", ActiveWorkspace: HERMES_WORKSPACE, Branch: "isolate/hermes-source", HeadSha: "head", OriginMainSha: "main", WorkingTreeState: "CLEAN", StagedCount: 0, TrackedModifiedCount: 0, UntrackedCount: 0, Blockers: ["OPENAI_API_KEY=synthetic"], Warnings: [] };
  const freshness = { documents: [{ name: "projectStatus", status: "CURRENT" }, { name: "roadmap", status: "CURRENT" }] };
  const project = projectStatusForTool(context, freshness);
  const roadmap = projectRoadmapForTool("# Roadmap\nOPENAI_API_KEY=synthetic\n## powershell.exe -Command whoami\n## Safe milestone", context, freshness);
  assert.equal("markdown" in project, false);
  assert.equal("markdown" in roadmap, false);
  const serialized = JSON.stringify({ project, roadmap });
  assert.equal(serialized.includes("OPENAI_API_KEY=synthetic"), false);
  assert.equal(serialized.includes("powershell.exe"), false);
  assert.ok(serialized.length < 3800);
  const liveProject = await callTool("hermes_project_status");
  const liveRoadmap = await callTool("hermes_roadmap");
  assert.equal("markdown" in liveProject, false);
  assert.equal("markdown" in liveRoadmap, false);
  assert.ok(JSON.stringify(liveProject).length < 3800);
  assert.ok(JSON.stringify(liveRoadmap).length < 3800);
});

test("exposes durable agent assignment, routing, handoffs, blockers, and approval gaps", async () => {
  const status = await callTool("hermes_agent_status");
  assert.equal(status.agentVisibility.assignment, null);
  assert.equal(status.agentVisibility.routing, null);
  assert.equal(status.agentVisibility.codex.assigned, false);
  assert.equal(status.agentVisibility.claude.assigned, false);
  assert.equal(status.agentVisibility.handoffHistory.historicalLogAvailable, false);
  assert.ok(Array.isArray(status.agentVisibility.handoffHistory.artifacts));
  assert.ok(Array.isArray(status.agentVisibility.blockers));
  assert.ok(Array.isArray(status.agentVisibility.pendingHumanApprovals));
  assert.ok(status.agentVisibility.missingDurableFields.includes("HandoffHistory"));
});

test("prefers durable execution, review, handoff, and approval fields", () => {
  const task = { implementer: "Codex", implementerModel: "CODEX", reviewer: "Claude Code", reviewerModel: "CLAUDE", category: "MCP", risk: "MEDIUM", reviewVerdict: "PENDING", state: "IMPLEMENTING" };
  const visibility = agentVisibility({
    CodexExecutionStatus: "COMPLETED",
    CodexExecutionResult: { exitCode: 0, result: "implemented" },
    CodexExecutionStartedAt: "2026-09-08T00:00:00.000Z",
    CodexExecutionCompletedAt: "2026-09-08T00:01:00.000Z",
    ClaudeReviewStatus: "COMPLETED",
    ClaudeReviewFindings: ["finding from durable state"],
    ClaudeReviewResult: { verdict: "PASS_WITH_NOTES" },
    HandoffHistory: [{ fromAgent: "Codex", toAgent: "Claude Code", handoffType: "REVIEW" }],
    PendingHumanApprovals: [{ kind: "TASK_APPROVAL", status: "PENDING" }],
  }, task, [{ name: "legacy-artifact" }], []);
  assert.equal(visibility.codex.source, ".ai/task-state.json");
  assert.equal(visibility.codex.executionStatus, "COMPLETED");
  assert.equal(visibility.codex.result.result, "implemented");
  assert.deepEqual(visibility.claude.findings, ["finding from durable state"]);
  assert.equal(visibility.claude.result.verdict, "PASS_WITH_NOTES");
  assert.equal(visibility.handoffHistory.records[0].toAgent, "Claude Code");
  assert.deepEqual(visibility.pendingHumanApprovals, [{ kind: "TASK_APPROVAL", status: "PENDING" }]);
});

test("falls back to artifact-derived visibility for legacy task state", () => {
  const visibility = agentVisibility({ ReviewNotes: "legacy review", BlockingIssues: ["legacy blocker"] }, { implementer: "Codex", state: "QA", scopeCheck: "PASS", reviewVerdict: "PENDING" }, [{ name: "CLAUDE_HANDOFF.md" }], [{ name: "REVIEW_REPORT.md" }]);
  assert.equal(visibility.codex.source, "artifact-derived");
  assert.equal(visibility.codex.executionStatus, "QA");
  assert.equal(visibility.claude.source, "artifact-derived");
  assert.equal(visibility.handoffHistory.records.length, 0);
  assert.equal(visibility.handoffHistory.artifacts[0].name, "CLAUDE_HANDOFF.md");
  assert.ok(visibility.missingDurableFields.includes("CodexExecutionStatus"));
});

test("serves initialize, tools/list, and tools/call over /mcp", async (t) => {
  const server = createHermesGatewayServer({ port: 0 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const post = async (payload) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { status: response.status, body: response.status === 202 ? null : await response.json() };
  };
  const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  assert.equal(initialized.status, 200);
  assert.equal(initialized.body.result.serverInfo.name, "hermes-gateway");
  const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(listed.body.result.tools.length, 12);
  for (const [index, tool] of TOOLS.slice(0, 8).entries()) {
    const called = await post({ jsonrpc: "2.0", id: index + 3, method: "tools/call", params: { name: tool.name, arguments: {} } });
    assert.equal(called.body.result.isError, undefined, tool.name);
    assert.ok(called.body.result.structuredContent, tool.name);
  }
  const project = await post({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "hermes_project_status", arguments: {} } });
  assert.equal(project.body.result.structuredContent.workspace, CANONICAL_WORKSPACE);
  assert.equal(project.body.result.structuredContent.stateFreshness.status, "STALE");
});

test("registers controlled mutating action schemas and rejects unsafe inputs", () => {
  assert.deepEqual(MUTATING_TOOLS.map((tool) => tool.name), ["hermes_create_task", "hermes_start_task", "hermes_run_tests", "hermes_request_review"]);
  assert.equal(MUTATING_TOOLS[0].annotations.readOnlyHint, false);
  assert.equal(MUTATING_TOOLS[1].annotations.destructiveHint, true);
  assert.equal(MUTATING_TOOLS[1].annotations.idempotentHint, false);
  assert.deepEqual(MUTATING_TOOLS[0].inputSchema.required, ["description", "idempotencyKey"]);
  assert.deepEqual(validateActionInput("hermes_create_task", { description: "Add a safe feature", idempotencyKey: "create-1" }).testScope, "targeted");
  assert.throws(() => validateActionInput("hermes_create_task", { description: "x", idempotencyKey: "x", extra: true }), /Unknown argument/);
  assert.throws(() => validateActionInput("hermes_start_task", { taskId: "x", idempotencyKey: "bad key" }), /idempotencyKey/);
  assert.throws(() => validateActionInput("hermes_run_tests", { taskId: "x", idempotencyKey: "x", testScope: "shell" }), /testScope/);
});

test("returns JSON-RPC errors and does not expose arbitrary methods or shell execution", async () => {
  const server = createHermesGatewayServer({ port: 0 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "shell_exec", arguments: { command: "whoami" } } }) });
  const body = await response.json();
  assert.equal(body.error.code, -32602);
  const unknownMethod = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "shell/run" }) });
  assert.equal((await unknownMethod.json()).error.code, -32601);
  const malformed = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal((await malformed.json()).error.code, -32700);
  server.close();
});

test("requires the configured bearer token when authentication is enabled", async () => {
  const server = createHermesGatewayServer({ port: 0, token: "phase4-test-token", requireAuth: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" });
  const unauthorized = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  assert.equal(unauthorized.status, 401);
  const authorized = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer phase4-test-token" }, body: payload });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).result.tools.length, 12);
  server.close();
});

test("requires authentication before any mutating action validation or execution", async () => {
  const server = createHermesGatewayServer({ port: 0, token: "action-token", requireAuth: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const payload = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "hermes_create_task", arguments: { description: "safe test", idempotencyKey: "auth-1" } } };
  const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(response.status, 401);
  server.close();
});
