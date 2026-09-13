import assert from "node:assert/strict";
import test from "node:test";
import { HERMES_WORKSPACE, CRM_WORKSPACE, analyzeTaskIntent, analyzeTaskPlan, classifyTaskDomain, validateTaskIntentForAction } from "./hermes-task-intent.mjs";

const hermesContext = { ActiveWorkspace: HERMES_WORKSPACE, WorkspaceRole: "ISOLATED_HERMES" };

test("classifies Hermes tooling and CRM/Public Registration domains", () => {
  assert.equal(classifyTaskDomain("Update Hermes agent router tests"), "HERMES_TOOLING");
  assert.equal(classifyTaskDomain("Fix CRM Sales lead pipeline"), "CRM_SALES");
  assert.equal(classifyTaskDomain("Improve Public Registration form"), "PUBLIC_REGISTRATION");
});

test("classifies operation and risk with approved model routing", () => {
  const low = analyzeTaskIntent({ taskId: "low", description: "Inspect Hermes status and report findings" });
  assert.equal(low.OperationType, "READ_ONLY");
  assert.equal(low.Risk, "LOW");
  assert.equal(low.ImplementerModel, "GPT-5.6 Luna");
  assert.equal(low.ImplementerProvider, "OpenAI Codex");
  const medium = analyzeTaskIntent({ taskId: "medium", description: "Update Hermes model routing source" });
  assert.equal(medium.Risk, "MEDIUM");
  assert.equal(medium.ImplementerModel, "GPT-5.6 Luna");
  const high = analyzeTaskIntent({ taskId: "high", description: "Harden Hermes process supervision and approval controls" });
  assert.equal(high.Risk, "HIGH");
  assert.equal(high.ImplementerModel, "Claude Sonnet 5");
  const critical = analyzeTaskIntent({ taskId: "critical", description: "Drop production database table and deploy" });
  assert.equal(critical.Risk, "CRITICAL");
  assert.equal(critical.ImplementerModel, "Claude Sonnet 5");
  assert.ok(critical.RiskReasons.length > 0);
});

test("unknown mutating tasks and protected Hermes paths are blocked", () => {
  const unknown = analyzeTaskIntent({ taskId: "unknown", description: "Change the thing" });
  assert.equal(unknown.Domain, "UNKNOWN");
  assert.equal(unknown.DecompositionRequired, true);
  assert.ok(unknown.Blockers.includes("UNKNOWN_MUTATING_INTENT"));
  const protectedTask = analyzeTaskIntent({ taskId: "protected", description: "Update Hermes code in app/admin/dashboard" });
  assert.ok(protectedTask.ProtectedPathFamilies.includes("app/admin/**"));
  assert.ok(protectedTask.Blockers.includes("PROTECTED_SCOPE_OUTSIDE_HERMES"));
  assert.equal(validateTaskIntentForAction("hermes_start_task", protectedTask, { projectContext: hermesContext }).allowed, false);
});

test("cross-stream and source-plus-deployment requests require decomposition", () => {
  const combined = analyzeTaskIntent({ taskId: "combo", description: "Build Hermes feature and fix CRM Sales page" });
  assert.equal(combined.CrossStreamDependencies, true);
  assert.equal(combined.DecompositionRequired, true);
  assert.ok(combined.Blockers.includes("BLOCKED_CROSS_STREAM"));
  assert.equal(combined.Subtasks.length, 2);
  const deploy = analyzeTaskIntent({ taskId: "deploy", description: "Implement Hermes feature and deploy to production" });
  assert.equal(deploy.DecompositionRequired, true);
  assert.ok(deploy.Blockers.includes("DECOMPOSITION_REQUIRED"));
});

test("mixed ownership requires review and approval", () => {
  const mixed = analyzeTaskIntent({ taskId: "mixed", description: "Update Hermes routing and package.json" });
  assert.ok(mixed.Warnings.includes("MIXED_OWNERSHIP_REVIEW"));
  assert.equal(mixed.RequiresHumanApproval, true);
  assert.equal(mixed.Risk, "HIGH");
});

test("dependencies and write conflicts prevent premature or concurrent execution", () => {
  const dependent = analyzeTaskIntent({ taskId: "dependent", description: "Update Hermes routing", existingTask: { DependencyStatus: "BLOCKED_BY prerequisite" } });
  dependent.DependencyStatus = "BLOCKED_BY prerequisite";
  assert.ok(validateTaskIntentForAction("hermes_start_task", dependent, { projectContext: hermesContext }).blockers.includes("DEPENDENCY_INCOMPLETE"));
  const left = analyzeTaskIntent({ taskId: "a", description: "Update Hermes routing" });
  const right = analyzeTaskIntent({ taskId: "b", description: "Update Hermes routing" });
  const conflict = analyzeTaskPlan([left, right]);
  assert.equal(conflict.Status, "BLOCKED");
  assert.equal(conflict.Conflicts[0].Type, "WRITE_CONFLICT");
  const isolated = analyzeTaskPlan([
    { ...left, TaskId: "a", SuggestedWorkspace: HERMES_WORKSPACE, AllowedPathFamilies: ["tools/hermes-*.mjs"], Domain: "HERMES_MCP" },
    { ...right, TaskId: "b", SuggestedWorkspace: CRM_WORKSPACE, AllowedPathFamilies: ["CRM-approved paths only"], Domain: "CRM_SALES" },
  ]);
  assert.equal(isolated.Status, "SAFE_TO_CONCURRENT");
  const explicit = analyzeTaskIntent({ taskId: "explicit", description: "Update Hermes routing after task prerequisite-1" });
  assert.equal(explicit.Dependencies[0].TaskId, "prerequisite-1");
  assert.ok(validateTaskIntentForAction("hermes_start_task", explicit, { projectContext: hermesContext }).blockers.includes("DEPENDENCY_INCOMPLETE"));
});

test("planning is concise, bounded, and does not expose hidden reasoning", () => {
  const intent = analyzeTaskIntent({ taskId: "bounded", description: "Inspect Hermes gateway" });
  assert.ok(intent.RequestedOutcome.length <= 4000);
  assert.equal(Object.keys(intent).some((key) => /prompt|chain|thought|content/i.test(key)), false);
  assert.equal(intent.SuggestedWorkspace, HERMES_WORKSPACE);
  assert.equal(intent.WorkspaceRole, "ISOLATED_HERMES");
});
