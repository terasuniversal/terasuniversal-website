/**
 * Release 2 S2-0 (owner-approved K-DEV, 19 Nov 2026): recognition claims, Company Profile PDF withdrawal and Director
 * credential. Checks R1–R9 of the S2-0 implementation spec.
 *
 * Run: node --experimental-transform-types scripts/r2-s2-0-recognition-contract.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { accreditations, confirmedFacts, leadership, pendingClaims } from "../data/companyProfile.js";
import { revertS2_0, S2_0_BASE_HASH, S2_0_CHANGED, S2_0_WITHHELD, S2_0_WITHHELD_SHA256 } from "./r2-s2-0-approved.mts";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const norm16 = (value: string) => createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
// Public source: everything a visitor can be served, minus the staff-only admin area and the API handlers.
const PUBLIC_SOURCE = ["app", "components", "content", "data", "lib", "next.config.mjs", "middleware.ts"];
const NOT_PUBLIC = [":!app/admin", ":!components/admin", ":!app/api"];
const ARCHIVE = "D:/Projects/_design/teras-hybrid-v2/docs/WEBSITE-R2-S2/withheld-assets/TERAS-UNIVERSAL-Company-Profile.pdf";
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const grepPublic = (args: string[]) => {
  try { return execFileSync("git", ["grep", "-l", "--untracked", ...args, "--", ...PUBLIC_SOURCE, ...NOT_PUBLIC], { cwd: rootPath, encoding: "utf8" }).trim().split("\n").filter(Boolean); }
  catch (error) { if ((error as { status?: number }).status === 1) return []; throw error; }
};

check("R1: every S2-0 file differs from 33514b4 only by its named S2-0 edit", () => {
  assert.deepEqual(S2_0_CHANGED, Object.keys(S2_0_BASE_HASH).sort());
  for (const path of S2_0_CHANGED) assert.equal(norm16(revertS2_0(path, read(path))), S2_0_BASE_HASH[path], path);
});
check("R2: company recognitions are exactly JKKP (DOSH), HRD Corp and SSM", () => {
  assert.deepEqual(accreditations.map((entry) => entry.org), ["JKKP (DOSH)", "HRD Corp", "SSM"]);
  assert.equal(accreditations[1].label, "Registered Training Provider");
  assert.equal(accreditations[2].label, "Company Registration");
});
check("R3: confirmed facts carry no CIDB or MOF claim; both are recorded as suspended", () => {
  assert.deepEqual(confirmedFacts, ["Established 2012", "JKKP (DOSH) Recognised Training Centre (Tube Scaffolding)", "HRD Corp Registered Training Provider", "SSM Registered Company (since 2012)"]);
  assert.ok(pendingClaims.includes("CIDB training-provider registration (suspended 19 Nov 2026 pending a valid official certificate)"));
  assert.ok(pendingClaims.includes("MOF supplier registration (suspended 19 Nov 2026 pending a valid official certificate)"));
});
check("R4: no public source names CIDB or MOF outside comments and the internal pendingClaims list", () => {
  const claim = /\b(CIDB|MOF)\b|Ministry of Finance|Construction Industry Development Board/i;
  const offenders: string[] = [];
  for (const path of grepPublic(["-i", "-E", "\\b(CIDB|MOF)\\b|Ministry of Finance|Construction Industry Development Board"])) {
    const lines = read(path).replace(/\r\n/g, "\n").replace(/export const pendingClaims = \[[\s\S]*?\n\];/, "").split("\n");
    lines.forEach((line, index) => { if (!/^\s*(\/\/|\/?\*)/.test(line) && claim.test(line)) offenders.push(`${path}:${index + 1}`); });
  }
  assert.deepEqual(offenders, []);
});
check("R5: recognition status rule unchanged; three current entries now, JKKP historical after 25 May 2027", () => {
  const status = read("components/home/recognitionStatus.js");
  assert.match(status, /export const isCurrent = \(recognition, now = Date\.now\(\)\) => !recognition \|\| now <= new Date\(`\$\{recognition\.validUntil\}T23:59:59\+08:00`\)\.getTime\(\);/);
  // Same rule as recognitionStatus.js, which Node cannot import directly (extensionless bundler import).
  const current = (now: number) => accreditations.filter((entry) => !entry.recognition || now <= new Date(`${entry.recognition.validUntil}T23:59:59+08:00`).getTime()).map((entry) => entry.org);
  assert.deepEqual(current(Date.parse("2026-11-20T12:00:00+08:00")), ["JKKP (DOSH)", "HRD Corp", "SSM"]);
  assert.ok(!current(Date.parse("2027-05-26T12:00:00+08:00")).includes("JKKP (DOSH)"));
});
check("R6: the Company Profile PDF is withdrawn from public/, unreferenced, and not duplicated under another name", () => {
  for (const path of S2_0_WITHHELD) assert.equal(existsSync(new URL(path, root)), false, path);
  assert.deepEqual(grepPublic(["-i", "-E", "Company-Profile\\.pdf|/downloads/"]), []);
  const pdfs: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const full = `${dir}/${name}`; if (statSync(full).isDirectory()) walk(full); else if (/\.pdf$/i.test(name)) pdfs.push(full); } };
  walk(fileURLToPath(new URL("public", root)));
  for (const file of pdfs) {
    assert.doesNotMatch(file, /company[-_ ]?profile/i, file);
    assert.notEqual(createHash("sha256").update(readFileSync(file)).digest("hex"), S2_0_WITHHELD_SHA256, `${file} is a copy of the withdrawn PDF`);
  }
  if (!existsSync(ARCHIVE)) { console.log("  (archive folder not on this machine: archive hash check NOT RUN)"); return; }
  assert.equal(createHash("sha256").update(readFileSync(ARCHIVE)).digest("hex"), S2_0_WITHHELD_SHA256, "archive copy");
});
check("R7: the Director's personal JKKP registration number is not published", () => {
  assert.equal(leadership[0].name, "Mohd Latifi Amir Bin Abu Bakar");
  assert.equal("credential" in leadership[0], false);
  assert.deepEqual(grepPublic(["-F", "KD/17/PP/03/2"]), []);
});
check("R8: /resources keeps About and Industries but no Company Profile download", () => {
  const page = read("app/resources/page.js");
  assert.doesNotMatch(page, /title: "Company Profile"|Download PDF|\/downloads\//);
  assert.match(page, /title: "About TERAS UNIVERSAL"/);
  assert.match(page, /title: "Industries We Serve"/);
});
check("R9: the homepage recognition intro states no number of bodies", () => {
  const component = read("components/home/Recognition.js");
  assert.doesNotMatch(component, /currentCount|with \{[^}]*\} bodies/);
  assert.match(component, /Established \{companyProfile\.established\}\. Company registrations and recognitions, with their current status\./);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
