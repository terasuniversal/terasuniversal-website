/**
 * F-T1-r1 (PROPOSAL, local only; requires a separate Owner decision before use): the public-design-foundation contract
 * exempts exactly the 29 app/admin/(protected) files that CRM Training T1 (OWNER-TRAINING-T1-20261125) modifies, and
 * only while each file's content is exactly the approved T1 content. This is the CE-1 pattern applied to a fixed list:
 *   - no wildcard, no directory entry, no new / deleted / renamed file: only status "M" paths listed in the manifest;
 *   - the manifest (scripts/ft1r1-admin-manifest.json) is pinned by SHA-256 and must declare the pinned baseline;
 *   - the baseline a03b8062 must resolve to exactly that commit (no HEAD, no merge-base fallback);
 *   - per path: the file at the pinned baseline must be the manifest's base_blob, and the file now must hash
 *     (LF-normalised) to approved_sha256 and approved_blob;
 *   - anything missing, malformed or different fails closed: the path is simply not exempted, so the contract's
 *     existing protected-path assertion rejects it exactly as before.
 * The "no new files" assertion is NOT given this exception (T1 adds no protected file), and CE-1 is untouched.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FT1R1_PIN = "b7ea35f2cf7bcf53ede34cbbf477bb85d5251d85";
// One CRM manifest for all 43 paths (F-T1-r1_43_PATHS_r6_OPTB.json, baseline b7ea35f2); each contract uses only its own entries.
// r6 (Owner Option B, 2026-11-27) adds exactly one foundation path: app/admin/(protected)/participants/ParticipantForm.tsx.
export const FT1R1_MANIFEST = "scripts/ft1r1-manifest.json";
export const FT1R1_MANIFEST_SHA256 = "088745a0cac9657cc2647ff489741a2937a0431699932a057c1d1886dfcef6e4";
export const FT1R1_COUNT = 29; // foundation entries
export const FT1R1_TOTAL = 43;
const PREFIX = "app/admin/(protected)/";
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

type Entry = { path: string; status: string; base_blob: string; approved_blob: string; approved_sha256: string; eol: string };
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const gitBlob = (s: string) => createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");

function git(root: URL, args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: fileURLToPath(root), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** The pinned baseline must exist and be exactly the pinned commit; otherwise null (fail closed). */
export function ft1r1Baseline(root: URL, pin: string = FT1R1_PIN): string | null {
  if (!HEX40.test(pin)) return null;
  try { return git(root, ["rev-parse", "--verify", "--quiet", `${pin}^{commit}`]) === pin ? pin : null; } catch { return null; }
}

/** The approved manifest, validated in full; null on any problem (fail closed). */
export function ft1r1Manifest(root: URL, pin: string = FT1R1_PIN): Map<string, Entry> | null {
  try {
    const file = join(fileURLToPath(root), FT1R1_MANIFEST);
    if (!existsSync(file)) return null;
    const text = lf(readFileSync(file, "utf8"));
    if (sha256(text) !== FT1R1_MANIFEST_SHA256) return null;
    const m = JSON.parse(text);
    if (m.baseline !== pin || m.count !== FT1R1_TOTAL || !Array.isArray(m.files) || m.files.length !== FT1R1_TOTAL) return null;
    if (m.by_contract?.foundation !== FT1R1_COUNT || m.by_contract?.w9g1 !== 1 || m.by_contract?.s6 !== 13) return null;
    const out = new Map<string, Entry>();
    for (const e of (m.files as (Entry & { contract: string })[]).filter((x) => /^public-design-foundation-contract /.test(x.contract))) {
      const ok = typeof e.path === "string" && e.path.startsWith(PREFIX) && !/[*?\\]|\.\.|\/\/|\/$/.test(e.path)
        && e.status === "M" && e.eol === "LF" && HEX40.test(e.base_blob) && HEX40.test(e.approved_blob) && HEX64.test(e.approved_sha256)
        && e.base_blob !== e.approved_blob && !out.has(e.path);
      if (!ok) return null;
      out.set(e.path, e);
    }
    return out.size === FT1R1_COUNT ? out : null;
  } catch { return null; }
}

/**
 * True only for one of the 29 approved paths whose current content is exactly the approved T1 content, whose
 * pinned-baseline blob is the declared base, AND whose blob at the contract base being compared against is that same
 * declared base. The last condition keeps the exception to exactly the T1 delta: against an older contract base, any
 * earlier change to the same file is still reported exactly as it was before (the path is then not exempted).
 * Every other path, and every failure, is false.
 */
export function ft1r1AdminApproved(root: URL, path: string, base: string, pin: string = FT1R1_PIN): boolean {
  try {
    if (ft1r1Baseline(root, pin) !== pin) return false;
    const entry = ft1r1Manifest(root, pin)?.get(path);
    if (!entry) return false;
    if (git(root, ["rev-parse", "--verify", "--quiet", `${pin}:${path}`]) !== entry.base_blob) return false;
    if (git(root, ["rev-parse", "--verify", "--quiet", `${base}:${path}`]) !== entry.base_blob) return false;
    const file = join(fileURLToPath(root), path);
    if (!existsSync(file)) return false;
    const content = lf(readFileSync(file, "utf8"));
    return sha256(content) === entry.approved_sha256 && gitBlob(content) === entry.approved_blob;
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner GO F-T1-r1 43 paths (r6): 14 more T1 paths in two more Website contracts.
//   lib/validation/schemas.ts   -> scripts/w9g1-ebook-lead-contract.mts (named-edit integrity, BEFORE pin)
//   13 supabase/ paths          -> scripts/s6-content-contract.mts (protected areas: Supabase)
// Same rules: manifest pinned by SHA-256 and bound to the pinned baseline; exact paths; content-gated; fail closed.
export const FT1R1_ADDENDUM = FT1R1_MANIFEST; // same combined manifest (its w9g1 and s6 entries)
export const FT1R1_ADDENDUM_SHA256 = FT1R1_MANIFEST_SHA256;
export const FT1R1_SCHEMAS = "lib/validation/schemas.ts";
type AEntry = { path: string; status: string; base_blob: string | null; approved_blob: string; approved_sha256: string; eol: string; contract: string };

export function ft1r1Addendum(root: URL, pin: string = FT1R1_PIN): Map<string, AEntry> | null {
  try {
    if (ft1r1Baseline(root, pin) !== pin) return null;
    const file = join(fileURLToPath(root), FT1R1_ADDENDUM);
    if (!existsSync(file)) return null;
    const text = lf(readFileSync(file, "utf8"));
    if (sha256(text) !== FT1R1_ADDENDUM_SHA256) return null;
    const m = JSON.parse(text);
    if (m.baseline !== pin || m.count !== FT1R1_TOTAL || !Array.isArray(m.files) || m.files.length !== FT1R1_TOTAL) return null;
    const out = new Map<string, AEntry>();
    for (const e of (m.files as AEntry[]).filter((x) => !/^public-design-foundation-contract /.test(x.contract))) {
      const isSchemas = e.path === FT1R1_SCHEMAS && e.status === "M" && /^w9g1-ebook-lead-contract /.test(e.contract);
      const isSupabase = typeof e.path === "string" && /^supabase\/(migrations|tests\/crm_rbac)\/[A-Za-z0-9_.-]+$/.test(e.path)
        && (e.status === "A" || e.status === "M") && /^s6-content-contract /.test(e.contract);
      const blobs = e.status === "A" ? e.base_blob === null : HEX40.test(e.base_blob ?? "");
      const ok = (isSchemas || isSupabase) && blobs && e.eol === "LF" && HEX40.test(e.approved_blob) && HEX64.test(e.approved_sha256) && !out.has(e.path);
      if (!ok) return null;
      out.set(e.path, e);
    }
    if (out.size !== 14 || [...out.values()].filter((e) => e.path.startsWith("supabase/")).length !== 13 || !out.has(FT1R1_SCHEMAS)) return null;
    return out;
  } catch { return null; }
}

const blobAt = (root: URL, rev: string, path: string): string | null => { try { return git(root, ["rev-parse", "--verify", "--quiet", `${rev}:${path}`]) || null; } catch { return null; } };
const contentOk = (root: URL, e: AEntry): boolean => {
  const file = join(fileURLToPath(root), e.path);
  if (!existsSync(file)) return false;
  const c = lf(readFileSync(file, "utf8"));
  return sha256(c) === e.approved_sha256 && gitBlob(c) === e.approved_blob;
};

/** The two T1 named edits to lib/validation/schemas.ts, as [now, before]. */
const SCHEMAS_EDITS: [string, string][] = [
  [
    "    trainer_name: z.string().trim().max(160).optional().or(z.literal(\"\")),\n    // T1: optional link to a trainer record (app.t1_guard_schedule_trainer requires it to be active when set or\n    // changed). trainer_name stays free text for legacy schedules and display.\n    trainer_id: z.string().trim().uuid(\"Select an active trainer\").optional().or(z.literal(\"\")),\n",
    "    trainer_name: z.string().trim().max(160).optional().or(z.literal(\"\")),\n",
  ],
  [
    "export type WahFailedCorrectionInput = z.infer<typeof wahFailedCorrectionSchema>;\n\n// T1 assessment accountability: the qualified Assessor who actually assessed the participant (public.assessors,\n// active and assigned to the schedule or the participant's group) and a reference to the retained evidence. Limits\n// mirror app.t1_assert_assessment_evidence, which re-checks them (and the assignment) in the database.\nexport const assessmentEvidenceSchema = z.object({\n  evidence_assessor_id: z.string().trim().uuid(\"Select the Assessor who assessed this participant.\"),\n  evidence_reference: z.string().trim().min(3, \"Enter an evidence reference of at least 3 characters.\").max(200),\n});\nexport type AssessmentEvidenceInput = z.infer<typeof assessmentEvidenceSchema>;\n",
    "export type WahFailedCorrectionInput = z.infer<typeof wahFailedCorrectionSchema>;\n",
  ],
];

/**
 * For the w9g1 integrity check: when (and only when) lib/validation/schemas.ts is exactly the approved T1 content,
 * undo the two T1 named edits (each must be found exactly once) so the existing W9-G3 / W9-G1 reverts and the BEFORE
 * pin see the pre-T1 file. Any other content is returned unchanged, so a third edit, a changed edit or a missing
 * manifest/baseline still fails the pin exactly as before. Other paths are untouched.
 */
export function revertFt1r1Schemas(root: URL, path: string, text: string, pin: string = FT1R1_PIN): string {
  if (path !== FT1R1_SCHEMAS) return text;
  const e = ft1r1Addendum(root, pin)?.get(FT1R1_SCHEMAS);
  if (!e || blobAt(root, pin, FT1R1_SCHEMAS) !== e.base_blob || sha256(lf(text)) !== e.approved_sha256) return text;
  let out = lf(text);
  for (const [now, before] of SCHEMAS_EDITS) {
    if (out.split(now).length !== 2) throw new Error("F-T1-r1: schemas.ts T1 edit not found exactly once");
    out = out.replace(now, () => before);
  }
  if (gitBlob(out) !== e.base_blob) throw new Error("F-T1-r1: schemas.ts revert does not reproduce the pinned base");
  return out;
}

/**
 * For the s6 protected-areas check: true only for a status line of one of the 11 approved supabase/ paths whose status
 * matches the manifest (A -> "?? path", M -> " M path"), whose content is exactly the approved T1 content, and whose
 * base is right (A: absent at the pinned baseline AND at the contract base; M: base_blob at both). Deletions, renames,
 * other paths and every failure are false.
 */
export function ft1r1S6Approved(root: URL, line: string, base: string, pin: string = FT1R1_PIN): boolean {
  try {
    const m = /^( M|\?\?) (supabase\/.+)$/.exec(line);
    if (!m) return false;
    const e = ft1r1Addendum(root, pin)?.get(m[2]);
    if (!e || !e.path.startsWith("supabase/")) return false;
    if ((e.status === "A" ? "??" : " M") !== m[1]) return false;
    const want = e.status === "A" ? null : e.base_blob;
    if (blobAt(root, pin, e.path) !== want || blobAt(root, base, e.path) !== want) return false;
    return contentOk(root, e);
  } catch { return false; }
}

/** F-T1-r1 named edits, as [now, before], per file. revertFt1r1(path, text) undoes ONLY these (fails closed). */
export const FT1R1_EDITS: Record<string, [string, string][]> = {
  "scripts/public-design-foundation-contract.mts": [
    [
      "import { w10uxAdminBoundaryApproved } from \"./w10ux-approved.mts\"; // CE-1: the one admin loading boundary, content-gated\nimport { ft1r1AdminApproved } from \"./ft1r1-approved.mts\"; // F-T1-r1: the 28 exact Training T1 admin paths, content-gated\n",
      "import { w10uxAdminBoundaryApproved } from \"./w10ux-approved.mts\"; // CE-1: the one admin loading boundary, content-gated\n",
    ],
    [
      "  const outsideT1 = changed.filter((path) => !ft1r1AdminApproved(new URL(\"../\", import.meta.url), path, CONTRACT_BASE)); /* F-T1-r1 exact paths */\n  assert.deepEqual(outsideT1, [], outsideT1.join(\", \"));\n",
      "  assert.deepEqual(changed, [], changed.join(\", \"));\n",
    ],
  ],
  "scripts/w9g3-ebook-contract.mts": [
    [
      "import { revertW10uxFoundation, W10UX_FOUNDATION } from \"./w10ux-approved.mts\"; // CE-1 is later than W9-G3: undone first\nimport { revertFt1r1Foundation } from \"./ft1r1-approved.mts\"; // F-T1-r1 is later than CE-1: undone before it\n",
      "import { revertW10uxFoundation, W10UX_FOUNDATION } from \"./w10ux-approved.mts\"; // CE-1 is later than W9-G3: undone first\n",
    ],
    [
      "return p === W10UX_FOUNDATION ? revertW10uxFoundation(revertFt1r1Foundation(t)) : t; };",
      "return p === W10UX_FOUNDATION ? revertW10uxFoundation(t) : t; };",
    ],
  ],
  "scripts/w9g1-ebook-lead-contract.mts": [
    [
      "import { revertW9g3 } from \"./w9g3-approved.mts\";\nimport { revertFt1r1Schemas } from \"./ft1r1-approved.mts\"; // F-T1-r1: T1's two schemas.ts named edits, content-gated, undone first\n",
      "import { revertW9g3 } from \"./w9g3-approved.mts\";\n",
    ],
    [
      "assert(sha256(revertW9g1(p, revertW9g3(p, revertFt1r1Schemas(new URL(\"../\", import.meta.url), p, read(p))))) === hash, p);",
      "assert(sha256(revertW9g1(p, revertW9g3(p, read(p)))) === hash, p);",
    ],
  ],
  "scripts/s6-content-contract.mts": [
    [
      "import { CONTRACT_BASE, changedSinceBase } from \"./contract-base.mts\";\nimport { ft1r1S6Approved } from \"./ft1r1-approved.mts\"; // F-T1-r1: the 11 exact T1 supabase/ paths, content-gated\n",
      "import { changedSinceBase } from \"./contract-base.mts\";\n",
    ],
    [
      "assert.ok(allowed.has(line) || ft1r1S6Approved(root, line, CONTRACT_BASE) /* F-T1-r1 exact paths */, line);",
      "assert.ok(allowed.has(line), line);",
    ],
  ],
  "scripts/w9lp-lc.test.mts": [
    [
      "} from \"./w10ux-approved.mts\";\nimport { revertFt1r1Foundation } from \"./ft1r1-approved.mts\"; // F-T1-r1 is later than CE-1: undone first\n",
      "} from \"./w10ux-approved.mts\";\n",
    ],
    [
      "test(\"CE-1: reverting the three named edits restores the foundation contract at HEAD exactly (LF and CRLF)\", () => {\n  const now = revertFt1r1Foundation(read(W10UX_FOUNDATION));\n",
      "test(\"CE-1: reverting the three named edits restores the foundation contract at HEAD exactly (LF and CRLF)\", () => {\n  const now = read(W10UX_FOUNDATION);\n",
    ],
    [
      "test(\"CE-1 named edits fail closed: missing, doubled or altered edits are refused\", () => {\n  const now = revertFt1r1Foundation(read(W10UX_FOUNDATION));\n",
      "test(\"CE-1 named edits fail closed: missing, doubled or altered edits are refused\", () => {\n  const now = read(W10UX_FOUNDATION);\n",
    ],
  ],
};
export const FT1R1_CHANGED = Object.keys(FT1R1_EDITS).sort();

export function revertFt1r1(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of FT1R1_EDITS[path] ?? []) {
    if (out.split(eol(now)).length !== 2) throw new Error(`F-T1-r1: expected edit not found exactly once in ${path}`);
    out = out.replace(eol(now), () => eol(before));
  }
  return out;
}
export const revertFt1r1Foundation = (text: string) => revertFt1r1("scripts/public-design-foundation-contract.mts", text);
