/**
 * W3-a public-content reliability contract (owner-approved W3-G1, local only), step 1 of 2: the unused helpers are
 * removed. Proves the named edits in scripts/w3-approved.mts are exactly what was approved and that reverting them
 * restores the file byte for byte to the approved base (5b8a77ad). Synthetic data only; lib/supabase.js and next/cache
 * are replaced by the offline fakes, so no database, network or cache is touched.
 * Run: node --experimental-transform-types scripts/w3-public-content-contract.mts
 */
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revertW3, W3_CHANGED } from "./w3-approved.mts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
let failures = 0;
const check = async (name: string, fn: () => unknown) => {
  try { await fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// SHA-256 (LF-normalised) of each changed file at the approved base, before W3-a.
const BEFORE: Record<string, string> = {
  "lib/public-content.ts": "38dda1428d37b3eb162b86a824cce54d45b648bdc1a1239e1376f6b0e0e5592a",
};

await check("scope: only the approved file carries W3-a edits", () => {
  assert(JSON.stringify(W3_CHANGED) === JSON.stringify(Object.keys(BEFORE).sort()), W3_CHANGED.join(", "));
});
await check("integrity: reverting the named edits restores each file exactly (nothing else changed)", () => {
  for (const [p, hash] of Object.entries(BEFORE)) assert(sha256(revertW3(p, read(p))) === hash, p);
});

const source = read("lib/public-content.ts");
await check("public client: no cookie-bound or service-role access in lib/public-content.ts", () => {
  assert(!/supabase\/server/.test(source), "imports the cookie-bound server client");
  assert(!/cookies\(|headers\(|draftMode\(/.test(source), "reads request state");
  assert(!/ServiceClient|service_role|SERVICE_ROLE/.test(source), "service role");
  assert(!/select\("\*"\)/.test(source), "select *");
  // The direct anon `courses` lookup is replaced in step 2; it is the only table read left here.
  assert((source.match(/\.from\(/g) ?? []).length === 1 && /\.from\("courses"\)/.test(source), "table reads");
  assert((source.match(/getSupabaseClient\(\)/g) ?? []).length === 4, "anon client uses");
});
await check("removed: the five unused helpers are gone, with no remaining caller", () => {
  const removed = ["getPublishedCourses", "getFeaturedCourses", "getGallery", "getPublishedFaqs", "getCompanyProfile"];
  for (const name of removed) assert(!new RegExp(`export (const|async function|function) ${name}`).test(source), name);
  for (const p of ["app/page.js", "app/calendar/page.js", "app/training/[slug]/page.js", "app/registration/[scheduleId]/page.tsx"]) {
    for (const name of removed) assert(!new RegExp(name).test(read(p)), `${p} still uses ${name}`);
  }
});
await check("no sensitive fields: updated_by, email_admin and raw error messages never leave the helpers", () => {
  assert(!/updated_by|email_admin|company_profile/.test(source), "sensitive company-profile fields");
  assert(!/error\.message/.test(source), "error message passed on");
});
await check("kept verbatim: the F-1 gate, the schedule result model and the homepage contract", () => {
  assert((source.match(/publicRegistrationEnabled\(\) && row\.registration_available === true/g) ?? []).length === 2, "F-1 gate x2");
  assert(/Promise<\{ schedules: PublicSchedule\[\]; error: boolean \}>/.test(source), "result model");
  assert(/p_include_past: false \}\);\s*if \(error\) return \[\];/.test(source), "homepage fail-closed");
  assert(/\.map\(mapSchedule\)\.slice\(0, 3\)/.test(source), "homepage cap");
});

// ---- behaviour (offline fakes) ----------------------------------------------------------------------------------
const FAKES = pathToFileURL(path.join(root, "scripts", "fixtures", "public-registration-gate-fakes.mjs")).href;
const FAKED = [/[\\/]lib[\\/]supabase\.js$/, /[\\/]lib[\\/]supabase[\\/]server\.ts$/];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true };
    if (specifier === "next/cache") return { url: FAKES, shortCircuit: true };
    const parent = context.parentURL;
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent?.startsWith("file:") && !/\.(m?[jt]sx?|cjs|json)$/.test(specifier)) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const suffix of [".ts", ".js", ".mjs"]) {
        const candidate = base + suffix;
        if (existsSync(candidate) && statSync(candidate).isFile()) return { url: FAKED.some((p) => p.test(candidate)) ? FAKES : pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
globalThis.fetch = (async () => { throw new Error("unexpected outbound request in offline test"); }) as typeof fetch;
type Gate = { rpcs: unknown[]; reads: string[]; rateLimits: string[]; rpcAnswer?: (name: string) => { data: unknown; error: unknown } };
const gate = (rpcAnswer?: Gate["rpcAnswer"]) => { (globalThis as { __gate?: Gate }).__gate = { rpcs: [], reads: [], rateLimits: [], rpcAnswer }; return (globalThis as unknown as { __gate: Gate }).__gate; };
process.env.TERAS_PUBLIC_REGISTRATION = "disabled";
const { getPublishedSchedulesWithState } = await import("../lib/public-content.ts");

await check("errors: an RPC error is an explicit error state and no table is read", async () => {
  const g = gate((name) => name === "get_public_upcoming_schedules" ? { data: null, error: { code: "42501", message: "synthetic internal detail" } } : { data: null, error: null });
  const result = await getPublishedSchedulesWithState();
  assert(result.error === true && result.schedules.length === 0, "error state");
  assert(!JSON.stringify(result).includes("synthetic internal detail") && !JSON.stringify(result).includes("42501"), "internal error detail leaked");
  assert(g.reads.length === 0, `direct table reads: ${g.reads.join(",")}`);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
