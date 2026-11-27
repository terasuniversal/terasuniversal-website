/**
 * F-T1-r1 (PROPOSAL, local only) tests: the content-gated foundation-contract exception for the 29 Training T1 admin
 * paths. Valid both without T1 (every path is then simply not exempt) and with the exact T1 content (every path exempt).
 * Run: node --experimental-transform-types --no-warnings --test scripts/ft1r1-foundation.test.mts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FT1R1_ADDENDUM, FT1R1_ADDENDUM_SHA256, FT1R1_CHANGED, FT1R1_COUNT, FT1R1_MANIFEST, FT1R1_MANIFEST_SHA256, FT1R1_PIN, FT1R1_SCHEMAS, ft1r1Addendum, ft1r1AdminApproved, ft1r1Baseline, ft1r1Manifest, ft1r1S6Approved, revertFt1r1, revertFt1r1Schemas } from "./ft1r1-approved.mts";
import { revertW10uxFoundation, w10uxAdminBoundaryApproved, W10UX_ADMIN, W10UX_FOUNDATION } from "./w10ux-approved.mts";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (p: string) => readFileSync(join(rootPath, p), "utf8").replace(/\r\n/g, "\n");
const atPin = (p: string) => execFileSync("git", ["-c", "core.autocrlf=false", "show", `${FT1R1_PIN}:${p}`], { cwd: rootPath, encoding: "utf8" }).replace(/\r\n/g, "\n");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

test("F-T1-r1: the pinned baseline resolves to exactly b7ea35f2 and fails closed otherwise (no HEAD fallback)", () => {
  assert.equal(ft1r1Baseline(root), FT1R1_PIN);
  for (const bad of ["HEAD", "b7ea35f2", "0".repeat(40), FT1R1_PIN.replace(/.$/, "0"), ""]) assert.equal(ft1r1Baseline(root, bad), null, bad);
});

test("F-T1-r1: the manifest is pinned by SHA-256, declares the baseline and lists exactly 29 status-M admin paths", () => {
  assert.equal(sha(read(FT1R1_MANIFEST)), FT1R1_MANIFEST_SHA256);
  const m = ft1r1Manifest(root);
  assert.ok(m, "manifest accepted");
  assert.equal(m!.size, FT1R1_COUNT);
  for (const [p, e] of m!) {
    assert.ok(p.startsWith("app/admin/(protected)/") && !/[*?]|\.\./.test(p) && !p.endsWith("/"), p);
    assert.equal(e.status, "M", p);
    assert.equal(execFileSync("git", ["rev-parse", `${FT1R1_PIN}:${p}`], { cwd: rootPath, encoding: "utf8" }).trim(), e.base_blob, `${p} base blob at pin`);
  }
  assert.ok(!m!.has(W10UX_ADMIN) && ![...m!.keys()].some((p) => /pdf|invoice|quotation|receipt|login|users|certificate/i.test(p)), "no CE-1, print, finance, auth or staff path");
  assert.equal(ft1r1Manifest(root, "0".repeat(40)), null, "manifest bound to the pinned baseline");
});

test("F-T1-r1: each of the 29 paths is exempt exactly when its content is the approved T1 content", () => {
  const m = ft1r1Manifest(root)!;
  for (const [p, e] of m) {
    const exact = existsSync(join(rootPath, p)) && sha(read(p)) === e.approved_sha256;
    assert.equal(ft1r1AdminApproved(root, p, FT1R1_PIN), exact, p);
    // against an older contract base where the file differed, earlier changes are never hidden
    const older = execFileSync("git", ["rev-parse", `b4f9275:${p}`], { cwd: rootPath, encoding: "utf8" }).trim();
    if (older !== e.base_blob) assert.equal(ft1r1AdminApproved(root, p, "b4f9275"), false, `${p} older base`);
  }
  for (const p of ["app/admin/(protected)/invoices/page.tsx", "app/admin/(protected)/assessment/AssessmentTable.tsx/", "app/admin/(protected)/assessment/*",
    "app/admin/(protected)", "app/admin/login/page.tsx", W10UX_ADMIN, "components/admin/Sidebar.tsx", "app/api/contact/route.js"]) {
    assert.equal(ft1r1AdminApproved(root, p, FT1R1_PIN), false, p);
  }
  assert.equal(ft1r1AdminApproved(root, [...m.keys()][0], FT1R1_PIN, "0".repeat(40)), false, "missing baseline fails closed");
  assert.equal(ft1r1AdminApproved(root, [...m.keys()][0], "0".repeat(40)), false, "unknown contract base fails closed");
});

test("F-T1-r1 named edits: reverting restores the three files at the pinned baseline exactly (LF and CRLF)", () => {
  assert.deepEqual(FT1R1_CHANGED, ["scripts/public-design-foundation-contract.mts", "scripts/s6-content-contract.mts", "scripts/w9g1-ebook-lead-contract.mts", "scripts/w9g3-ebook-contract.mts", "scripts/w9lp-lc.test.mts"]);
  for (const p of FT1R1_CHANGED) {
    const now = read(p);
    assert.equal(revertFt1r1(p, now), atPin(p), `${p} LF`);
    assert.equal(revertFt1r1(p, now.replace(/\n/g, "\r\n")), atPin(p).replace(/\n/g, "\r\n"), `${p} CRLF`);
  }
});

test("F-T1-r1 named edits fail closed: missing, doubled or altered edits throw; unrelated paths are untouched", () => {
  for (const p of FT1R1_CHANGED) {
    const now = read(p);
    assert.throws(() => revertFt1r1(p, atPin(p)), /not found exactly once/, `${p} missing`);
    assert.throws(() => revertFt1r1(p, now + now), /not found exactly once/, `${p} doubled`);
  }
  const f = read(W10UX_FOUNDATION);
  assert.throws(() => revertFt1r1(W10UX_FOUNDATION, f.replace("/* F-T1-r1 exact paths */", "/* F-T1-r1 exact paths */ || true")), /not found exactly once/);
  assert.equal(revertFt1r1("app/page.js", "x"), "x");
});

test("F-T1-r1 addendum: manifest pinned, 1 schemas.ts + 13 supabase/ paths, bound to the baseline, no wildcard", () => {
  assert.equal(sha(read(FT1R1_ADDENDUM)), FT1R1_ADDENDUM_SHA256);
  const a = ft1r1Addendum(root);
  assert.ok(a, "addendum accepted");
  assert.equal(a!.size, 14);
  const supa = [...a!.keys()].filter((p) => p.startsWith("supabase/"));
  assert.equal(supa.length, 13);
  assert.ok(supa.every((p) => /^supabase\/(migrations|tests\/crm_rbac)\/[A-Za-z0-9_.-]+$/.test(p)), "exact files only");
  assert.ok(a!.has(FT1R1_SCHEMAS) && [...a!.keys()].every((p) => p === FT1R1_SCHEMAS || p.startsWith("supabase/")));
  assert.equal(ft1r1Addendum(root, "0".repeat(40)), null, "bound to the pinned baseline");
});

test("F-T1-r1 addendum: schemas.ts is reverted only when it is exactly the approved T1 content", () => {
  const now = readFileSync(join(rootPath, FT1R1_SCHEMAS), "utf8");
  const e = ft1r1Addendum(root)!.get(FT1R1_SCHEMAS)!;
  const isT1 = sha(now.replace(/\r\n/g, "\n")) === e.approved_sha256;
  const out = revertFt1r1Schemas(root, FT1R1_SCHEMAS, now);
  assert.equal(out.replace(/\r\n/g, "\n"), isT1 ? atPin(FT1R1_SCHEMAS) : now.replace(/\r\n/g, "\n"), "T1 -> pinned base; anything else unchanged");
  if (isT1) {
    assert.equal(revertFt1r1Schemas(root, FT1R1_SCHEMAS, now.replace(/\n/g, "\r\n")).replace(/\r\n/g, "\n"), atPin(FT1R1_SCHEMAS), "CRLF accepted");
    const third = now.replace("export type AssessmentEvidenceInput", "export const extra = 1;\nexport type AssessmentEvidenceInput");
    assert.equal(revertFt1r1Schemas(root, FT1R1_SCHEMAS, third), third, "a third edit is not reverted (pin then fails)");
    assert.equal(revertFt1r1Schemas(root, FT1R1_SCHEMAS, now, "0".repeat(40)), now, "missing baseline: not reverted");
  }
  assert.equal(revertFt1r1Schemas(root, "lib/other.ts", "x"), "x", "other paths untouched");
});

test("F-T1-r1 addendum: s6 lines are approved only for the exact path, status and content", () => {
  const a = ft1r1Addendum(root)!;
  for (const [p, e] of a) {
    if (!p.startsWith("supabase/")) continue;
    const exact = existsSync(join(rootPath, p)) && sha(read(p)) === e.approved_sha256;
    const good = `${e.status === "A" ? "??" : " M"} ${p}`, wrong = `${e.status === "A" ? " M" : "??"} ${p}`;
    assert.equal(ft1r1S6Approved(root, good, FT1R1_PIN), exact, good);
    assert.equal(ft1r1S6Approved(root, wrong, FT1R1_PIN), false, `wrong status ${wrong}`);
    assert.equal(ft1r1S6Approved(root, ` D ${p}`, FT1R1_PIN), false, "deletion never approved");
    assert.equal(ft1r1S6Approved(root, good, FT1R1_PIN, "0".repeat(40)), false, "missing baseline fails closed");
    // against an older contract base where an M file differed from base_blob, the line is never approved, so earlier
    // changes to that file stay reported exactly as before (same rule as the admin paths)
    if (e.status === "M") {
      let older: string | null = null;
      try { older = execFileSync("git", ["rev-parse", "--verify", "--quiet", `b4f9275:${p}`], { cwd: rootPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { older = null; }
      if (older !== e.base_blob) assert.equal(ft1r1S6Approved(root, good, "b4f9275"), false, `${p} older base (${older ? "different blob" : "absent"})`);
    }
  }
  for (const l of ["?? supabase/migrations/20990101000000_other.sql", " M supabase/config.toml", "?? supabase/", "?? supabase/migrations/*", " M lib/supabase/server.ts"]) {
    assert.equal(ft1r1S6Approved(root, l, FT1R1_PIN), false, l);
  }
});

test("F-T1-r1: only the changed-files assertion is relaxed; the new-files assertion, PROTECTED list and CE-1 are unchanged", () => {
  const f = read(W10UX_FOUNDATION);
  assert.equal((f.match(/ft1r1AdminApproved/g) || []).length, 2, "import + one filter");
  const added = f.split("\n").find((l) => l.includes("const added = changedSinceBase(PROTECTED)"))!;
  assert.ok(!added.includes("ft1r1"), "new protected files are never exempted");
  assert.ok(f.includes('const PROTECTED = ["app/globals.css", "app/layout.js", "app/admin", "components/admin", "app/verify", "app/registration", "app/api", "lib/supabase", "middleware.ts", "next.config.mjs"];'));
  // Undoing F-T1-r1 leaves exactly the CE-1 version on main, and CE-1 still reverts cleanly from there.
  assert.equal(revertFt1r1(W10UX_FOUNDATION, f), atPin(W10UX_FOUNDATION));
  assert.doesNotThrow(() => revertW10uxFoundation(revertFt1r1(W10UX_FOUNDATION, f)));
  // CE-1 is checked against the pre-L-C tree it was built on (the L-C lane test's pin), where app/loading.js still exists.
  assert.equal(w10uxAdminBoundaryApproved(root, W10UX_ADMIN, "08721bd5f617c65ecd30bf20bc435dfeb06f4565"), true, "CE-1 still exempts app/admin/loading.js");
});
