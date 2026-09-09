import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";
import {
  CANONICAL_WORKSPACE,
  HERMES_WORKSPACE,
  TOOLS,
  discoverProjectContext,
  evaluateStateFreshness,
  validateControlledActionAwareness,
  validateProjectAwareness,
} from "./hermes-gateway.mjs";

const git = promisify(execFile);
const runGit = async (cwd, args) => git("git", ["-C", cwd, ...args], { windowsHide: true, shell: false });

async function fixtureRepo() {
  const root = await mkdtemp(join(tmpdir(), "hermes-h2-"));
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "hermes-tests@example.invalid"]);
  await runGit(root, ["config", "user.name", "Hermes Tests"]);
  await writeFile(join(root, "README.md"), "fixture\n");
  await runGit(root, ["add", "README.md"]);
  await runGit(root, ["commit", "-m", "fixture"]);
  const mainSha = (await runGit(root, ["rev-parse", "main"])).stdout.trim();
  await runGit(root, ["update-ref", "refs/remotes/origin/main", mainSha]);
  await runGit(root, ["remote", "add", "origin", root]);
  await runGit(root, ["checkout", "-b", "feature"]);
  await runGit(root, ["branch", "--set-upstream-to=origin/main", "feature"]);
  await writeFile(join(root, "feature.txt"), "feature\n");
  await runGit(root, ["add", "feature.txt"]);
  await runGit(root, ["commit", "-m", "feature"]);
  return root;
}

test("recognizes Hermes and canonical workspace roles", async () => {
  assert.equal((await discoverProjectContext({ repoRoot: HERMES_WORKSPACE })).WorkspaceRole, "ISOLATED_HERMES");
  assert.equal((await discoverProjectContext({ repoRoot: CANONICAL_WORKSPACE })).WorkspaceRole, "CANONICAL_ACTIVE");
});

test("unknown, missing, and wrong repositories are blocked without recursive discovery", async () => {
  const root = await fixtureRepo();
  try {
    const unknown = await discoverProjectContext({ repoRoot: root });
    assert.equal(unknown.WorkspaceRole, "UNKNOWN");
    assert.ok(unknown.Blockers.includes("UNKNOWN_WORKSPACE_ROLE"));
    assert.equal(validateProjectAwareness(unknown).allowed, false);
    const missing = await discoverProjectContext({ repoRoot: join(root, "missing") });
    assert.ok(missing.Blockers.includes("WORKSPACE_MISSING_OR_NOT_REPOSITORY"));
    await mkdir(join(root, "nested"));
    const wrong = await discoverProjectContext({ repoRoot: join(root, "nested") });
    assert.ok(wrong.Blockers.includes("WRONG_REPOSITORY"));
    assert.equal(TOOLS.some((tool) => /filesystem|shell|git|sql|deploy/i.test(tool.name)), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports branch, HEAD, dirty, staged, ahead/behind, upstream, and bounded fingerprints", async () => {
  const root = await fixtureRepo();
  try {
    const clean = await discoverProjectContext({ repoRoot: root });
    assert.equal(clean.Branch, "feature");
    assert.equal(clean.WorkingTreeState, "CLEAN");
    assert.equal(clean.StagedCount, 0);
    assert.equal(clean.UntrackedCount, 0);
    assert.equal(clean.AheadCount, 1);
    assert.equal(clean.BehindCount, 0);
    assert.equal(clean.RemoteFreshness, "REMOTE_FRESHNESS_UNKNOWN");
    assert.ok(clean.StatusFingerprint);
    const unchanged = await discoverProjectContext({ repoRoot: root });
    assert.equal(unchanged.StatusFingerprint, clean.StatusFingerprint);
    await writeFile(join(root, "README.md"), "material change\n");
    await runGit(root, ["add", "README.md"]);
    await writeFile(join(root, "untracked.txt"), "untracked\n");
    const dirty = await discoverProjectContext({ repoRoot: root });
    assert.equal(dirty.WorkingTreeState, "DIRTY");
    assert.equal(dirty.StagedCount, 1);
    assert.equal(dirty.UntrackedCount, 1);
    assert.notEqual(dirty.StatusFingerprint, clean.StatusFingerprint);
    assert.equal(validateProjectAwareness(dirty, { StatusFingerprint: clean.StatusFingerprint }).blockers.includes("STATUS_FINGERPRINT_DRIFT"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("task binding detects workspace, branch, HEAD, and Hermes-to-CRM drift", async () => {
  const root = await fixtureRepo();
  try {
    const context = await discoverProjectContext({ repoRoot: root });
    const mismatch = validateProjectAwareness(context, { WorkspaceBoundary: { CanonicalWorkspace: HERMES_WORKSPACE }, Branch: "main", ExpectedHeadSha: "old", HermesOnly: true });
    assert.equal(mismatch.allowed, false);
    assert.ok(mismatch.blockers.includes("TASK_WORKSPACE_MISMATCH"));
    assert.ok(mismatch.blockers.includes("BRANCH_BINDING_MISMATCH"));
    assert.ok(mismatch.blockers.includes("HEAD_DRIFT"));
    const crmContext = { ...context, ActiveWorkspace: CANONICAL_WORKSPACE, WorkspaceRole: "CANONICAL_ACTIVE" };
    const crmBlocked = validateProjectAwareness(crmContext, { WorkspaceBoundary: { CanonicalWorkspace: CANONICAL_WORKSPACE }, HermesOnly: true });
    assert.ok(crmBlocked.blockers.includes("HERMES_TASK_CANNOT_USE_CRM_WORKSPACE"));
    assert.equal(validateControlledActionAwareness("hermes_start_task", crmContext, { HermesOnly: true }).allowed, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("freshness remains CURRENT, STALE, or NEEDS_REFRESH and survives recomputation", () => {
  const current = evaluateStateFreshness({ repoRoot: CANONICAL_WORKSPACE, project: `Repository: \`${CANONICAL_WORKSPACE}\``, roadmap: `Workspace: \`${CANONICAL_WORKSPACE}\`` });
  assert.equal(current.status, "CURRENT");
  const stale = evaluateStateFreshness({ repoRoot: CANONICAL_WORKSPACE, project: "Repository: `D:\\Projects\\terasuniversal-website`", roadmap: "# ROADMAP" });
  assert.equal(stale.documents[0].status, "STALE");
  assert.equal(stale.documents[1].status, "NEEDS_REFRESH");
});

test("canonical awareness is read-only and exposes no file contents", async () => {
  const before = (await runGit(CANONICAL_WORKSPACE, ["rev-parse", "HEAD"])).stdout.trim();
  const context = await discoverProjectContext({ repoRoot: CANONICAL_WORKSPACE });
  const after = (await runGit(CANONICAL_WORKSPACE, ["rev-parse", "HEAD"])).stdout.trim();
  assert.equal(before, after);
  assert.equal(context.WorkspaceRole, "CANONICAL_ACTIVE");
  assert.equal(Object.values(context).some((value) => typeof value === "string" && value.includes("AGENTS.md")), false);
});
