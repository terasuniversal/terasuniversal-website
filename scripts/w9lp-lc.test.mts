/**
 * W9-LAUNCH-PREP Lane L-C (W10-UX-01 Option B) tests, local only: the root loading boundary is MOVED (not copied) to
 * /calendar with exactly its two named edits, no other route gains a loading boundary, and the calendar fallback carries
 * a meaningful <noscript> message.
 *
 * Run: node --experimental-transform-types --no-warnings --test scripts/w9lp-lc.test.mts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approvedAdminLoading, approvedRootLoading, revertW10ux, revertW10uxFoundation, w10uxAdminBoundaryApproved, W10UX_ADMIN, W10UX_FOUNDATION, W10UX_FROM, W10UX_TO } from "./w10ux-approved.mts";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
// The tree W10-UX-01 was built on: main before L-C, pinned like the W9-G3 contract pins main 45672429, so the test
// holds before commit, after commit and after merge (once committed, HEAD is the change itself). Fails closed: the
// pin must resolve to exactly this commit; there is no fallback to HEAD or to a merge base.
const PRE_W10UX = "08721bd5f617c65ecd30bf20bc435dfeb06f4565";
function pinnedBase(): string {
  let resolved = "";
  try { resolved = execFileSync("git", ["rev-parse", "--verify", "--quiet", `${PRE_W10UX}^{commit}`], { cwd: rootPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { resolved = ""; }
  if (!/^[0-9a-f]{40}$/.test(PRE_W10UX) || resolved !== PRE_W10UX) throw new Error(`W10-UX-01: pinned pre-L-C baseline ${PRE_W10UX} is unavailable or invalid`);
  return PRE_W10UX;
}
const atMain = (p: string) => execFileSync("git", ["-c", "core.autocrlf=false", "show", `${pinnedBase()}:${p}`], { cwd: rootPath, encoding: "utf8" });

function loadingFiles(dir = path.join(rootPath, "app")): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...loadingFiles(full));
    else if (/^loading\.(js|jsx|ts|tsx)$/.test(name)) out.push(path.relative(rootPath, full).split(path.sep).join("/"));
  }
  return out.sort();
}

test("L-C: the root boundary is moved, and reverting the two named edits reproduces the original exactly", () => {
  assert.equal(existsSync(new URL(W10UX_FROM, root)), false);
  assert.equal(approvedRootLoading(root), atMain(W10UX_FROM));
});

test("L-C: no other route gains a loading boundary (public: only /calendar and the existing /verify; admin: unchanged)", () => {
  const all = loadingFiles();
  assert.deepEqual(all.filter((p) => !p.startsWith("app/admin/")), ["app/calendar/loading.js", "app/verify/loading.js"]);
  const adminAtMain = execFileSync("git", ["-c", "core.autocrlf=false", "ls-tree", "-r", "--name-only", pinnedBase(), "--", "app/admin"], { cwd: rootPath, encoding: "utf8" })
    .split(/\r?\n/).filter((p) => /\/loading\.(js|jsx|ts|tsx)$/.test(p)).sort();
  // The one admin addition is app/admin/loading.js (see scripts/w10ux-approved.mts); every existing admin boundary is unchanged.
  assert.deepEqual(all.filter((p) => p.startsWith("app/admin/")), [...adminAtMain, W10UX_ADMIN].sort());
  for (const p of adminAtMain) assert.equal(read(p), atMain(p).replace(/\r\n/g, "\n"), p);
  assert.equal(read("app/verify/loading.js"), atMain("app/verify/loading.js"));
});

test("L-C: the admin-scoped boundary is the original root boundary byte for byte (admin behaviour unchanged)", () => {
  assert.equal(approvedAdminLoading(root), atMain(W10UX_FROM).replace(/\r\n/g, "\n"));
  const loginAtMain = atMain("app/admin/login/page.tsx").replace(/\r\n/g, "\n");
  assert.equal(read("app/admin/login/page.tsx"), loginAtMain, "no admin source change");
});

test("L-C: the calendar fallback keeps the loading UI and adds a meaningful no-JavaScript message with plain links", () => {
  const t = read(W10UX_TO);
  assert.match(t, /className="loading-screen" role="status" aria-label="Loading TERAS UNIVERSAL"/);
  const noscript = t.slice(t.indexOf("<noscript>"), t.indexOf("</noscript>"));
  assert.match(noscript, /The training calendar needs JavaScript\./);
  assert.match(noscript, /<a href="\/training">training courses<\/a>/);
  assert.match(noscript, /<a href="\/contact">contact us<\/a>/);
});

test("L-C named edits fail closed: a copy, a missing edit, a doubled edit or an altered message is refused", () => {
  const now = read(W10UX_TO);
  assert.throws(() => revertW10ux(atMain(W10UX_FROM)), /not found exactly once/);
  assert.throws(() => revertW10ux(now + now), /not found exactly once/);
  assert.throws(() => revertW10ux(now.replace("needs JavaScript", "requires JavaScript")), /not found exactly once/);
  assert.equal(revertW10ux(now.replace(/\n/g, "\r\n")), atMain(W10UX_FROM), "CRLF accepted (normalised)");
});

test("CE-1: reverting the three named edits restores the foundation contract at HEAD exactly (LF and CRLF)", () => {
  const now = read(W10UX_FOUNDATION);
  assert.equal(revertW10uxFoundation(now), atMain(W10UX_FOUNDATION).replace(/\r\n/g, "\n"));
  assert.equal(revertW10uxFoundation(now.replace(/\n/g, "\r\n")), atMain(W10UX_FOUNDATION).replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
  assert.equal((now.match(/w10uxAdminBoundaryApproved/g) || []).length, 3, "used only in the import and the two protected-path filters");
});

test("CE-1 named edits fail closed: missing, doubled or altered edits are refused", () => {
  const now = read(W10UX_FOUNDATION);
  assert.throws(() => revertW10uxFoundation(atMain(W10UX_FOUNDATION)), /not found exactly once/);
  assert.throws(() => revertW10uxFoundation(now + now), /not found exactly once/);
  assert.throws(() => revertW10uxFoundation(now.replace("/* CE-1 exact path */);", "/* CE-1 exact path */ || true);")), /not found exactly once/);
});

test("CE-1: the exception covers exactly app/admin/loading.js and nothing else (no wildcard or directory)", () => {
  assert.equal(w10uxAdminBoundaryApproved(root, W10UX_ADMIN, pinnedBase()), true);
  for (const p of ["app/admin", "app/admin/", "app/admin/login/loading.js", "app/admin/(protected)/x/loading.tsx", "app/admin/layout.tsx", "app/admin/loading.tsx", "./app/admin/loading.js", "app/loading.js", "app/calendar/loading.js"]) {
    assert.equal(w10uxAdminBoundaryApproved(root, p, pinnedBase()), false, p);
  }
});
