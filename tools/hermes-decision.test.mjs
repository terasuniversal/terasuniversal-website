import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeTaskIntent } from "./hermes-task-intent.mjs";
import { HERMES_WORKSPACE } from "./hermes-project-config.mjs";
import { createFinalDecision, decisionInputFingerprint, decisionSummary, evaluateDecisionFreshness, persistDecisionRecord, readDecisionRecord } from "./hermes-decision.mjs";

const context = (overrides = {}) => ({ ProjectId: "teras-universal-website", ActiveWorkspace: HERMES_WORKSPACE, WorkspaceRole: "ISOLATED_HERMES", Branch: "isolate/hermes-source", HeadSha: "head-1", StatusFingerprint: "status-1", Blockers: [], ...overrides });

test("valid LOW and MEDIUM Hermes tasks produce ALLOW with Codex routing", () => {
  for (const description of ["Inspect Hermes status", "Update Hermes model routing source"]) {
    const intent = analyzeTaskIntent({ taskId: "h4-low", description });
    const decision = createFinalDecision({ taskId: "h4-low", intent, projectContext: context() });
    assert.equal(decision.Decision, "ALLOW");
    assert.equal(decision.ImplementerProvider, "OpenAI Codex");
    assert.equal(decision.ImplementerModel, "GPT-5.6 Luna");
  }
});

test("HIGH and CRITICAL decisions require bound approval, then allow", () => {
  for (const description of ["Harden Hermes process supervision"]) {
    const intent = analyzeTaskIntent({ taskId: "h4-high", description });
    const waiting = createFinalDecision({ taskId: "h4-high", intent, projectContext: context(), approvalState: "MISSING" });
    assert.equal(waiting.Decision, "WAITING_APPROVAL");
    assert.ok(waiting.DecisionReasonCodes.includes("APPROVAL_MISSING"));
    const approved = createFinalDecision({ taskId: "h4-high", intent, projectContext: context(), approvalState: "APPROVED" });
    assert.equal(approved.Decision, "ALLOW");
    assert.equal(approved.ImplementerModel, "Claude Sonnet 5");
    assert.equal(approved.ApprovalRequired, true);
  }
  const criticalIntent = analyzeTaskIntent({ taskId: "h4-critical", description: "Drop production database table" });
  const critical = createFinalDecision({ taskId: "h4-critical", intent: criticalIntent, projectContext: context(), approvalState: "MISSING" });
  assert.equal(critical.Decision, "WAITING_APPROVAL");
  assert.equal(critical.ImplementerModel, "Claude Sonnet 5");
});

test("approval and ALLOW survive restart when inputs are unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "hermes-h4-decision-"));
  try {
    const intent = analyzeTaskIntent({ taskId: "restart", description: "Harden Hermes process supervision" });
    const decision = createFinalDecision({ taskId: "restart", intent, projectContext: context(), approvalState: "APPROVED" });
    await persistDecisionRecord(root, decision);
    const reloaded = await readDecisionRecord(root, "restart");
    assert.equal(evaluateDecisionFreshness(reloaded, { taskId: "restart", intent, projectContext: context(), approvalState: "APPROVED" }).valid, true);
    assert.equal((await readFile(join(root, ".ai", "hermes-decisions", "restart.jsonl"), "utf8")).trim().split(/\r?\n/).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("HEAD, branch, status, expiry, and workspace changes invalidate decisions", () => {
  const intent = analyzeTaskIntent({ taskId: "drift", description: "Update Hermes routing" });
  const decision = createFinalDecision({ taskId: "drift", intent, projectContext: context() });
  for (const changed of [
    context({ HeadSha: "head-2" }),
    context({ Branch: "other" }),
    context({ StatusFingerprint: "status-2" }),
    context({ ActiveWorkspace: "D:\\Projects\\terasuniversal-website-clean", WorkspaceRole: "CANONICAL_ACTIVE" }),
  ]) {
    const result = evaluateDecisionFreshness(decision, { taskId: "drift", intent, projectContext: changed });
    assert.equal(result.valid, false);
    assert.ok(["STALE_CONTEXT", "STALE_DECISION"].includes(result.code));
  }
  const expired = createFinalDecision({ taskId: "expired", intent, projectContext: context(), now: new Date("2020-01-01T00:00:00Z"), ttlMs: 1000 });
  assert.equal(evaluateDecisionFreshness(expired, { taskId: "expired", intent, projectContext: context(), now: new Date("2020-01-01T00:01:00Z") }).code, "STALE_DECISION");
});

test("scope, mixed ownership, dependency, conflict, decomposition, and validation blockers are explicit", () => {
  const cases = [
    [analyzeTaskIntent({ taskId: "scope", description: "Update Hermes code in app/admin/page" }), "PROTECTED_SCOPE"],
    [analyzeTaskIntent({ taskId: "mixed", description: "Update Hermes routing and package.json" }), "MIXED_OWNERSHIP_REVIEW_REQUIRED"],
    [Object.assign(analyzeTaskIntent({ taskId: "dep", description: "Update Hermes routing after task prerequisite" }), { DependencyStatus: "BLOCKED_BY prerequisite" }), "DEPENDENCY_INCOMPLETE"],
    [Object.assign(analyzeTaskIntent({ taskId: "conflict", description: "Update Hermes routing" }), { Conflicts: [{ Type: "WRITE_CONFLICT" }] }), "WRITE_CONFLICT"],
    [analyzeTaskIntent({ taskId: "cross", description: "Build Hermes feature and fix CRM Sales page" }), "DECOMPOSITION_REQUIRED"],
    [Object.assign(analyzeTaskIntent({ taskId: "novalidate", description: "Update Hermes routing" }), { ValidationRequirements: [] }), "VALIDATION_PLAN_MISSING"],
  ];
  for (const [intent, code] of cases) assert.ok(createFinalDecision({ taskId: intent.TaskId, intent, projectContext: context() }).DecisionReasonCodes.includes(code), code);
  const unknown = analyzeTaskIntent({ taskId: "unknown", description: "Change the thing" });
  assert.equal(createFinalDecision({ taskId: "unknown", intent: unknown, projectContext: context() }).Decision, "UNKNOWN_SCOPE");
});

test("non-ALLOW decisions are never lease eligible and TOCTOU changes cannot reuse ALLOW", () => {
  const intent = analyzeTaskIntent({ taskId: "gate", description: "Harden Hermes process supervision" });
  const waiting = createFinalDecision({ taskId: "gate", intent, projectContext: context(), approvalState: "MISSING" });
  assert.equal(evaluateDecisionFreshness(waiting, { taskId: "gate", intent, projectContext: context(), approvalState: "MISSING" }).valid, false);
  const allowed = createFinalDecision({ taskId: "gate", intent, projectContext: context(), approvalState: "APPROVED" });
  const changed = evaluateDecisionFreshness(allowed, { taskId: "gate", intent, projectContext: context({ HeadSha: "changed" }), approvalState: "APPROVED" });
  assert.equal(changed.valid, false);
  assert.equal(decisionSummary(allowed).LeaseEligible, true);
});

test("decision fingerprint is deterministic and stores bounded metadata only", () => {
  const intent = analyzeTaskIntent({ taskId: "same", description: "Update Hermes routing" });
  const a = createFinalDecision({ taskId: "same", intent, projectContext: context() });
  const b = createFinalDecision({ taskId: "same", intent, projectContext: context() });
  assert.equal(a.InputFingerprint, b.InputFingerprint);
  assert.equal(JSON.stringify(a).includes("powershell"), false);
  assert.equal(JSON.stringify(a).includes("chain-of-thought"), false);
  assert.equal(JSON.stringify(a).includes("secret"), false);
  assert.equal(decisionInputFingerprint({ taskId: "same", intent, projectContext: context() }), a.InputFingerprint);
});
