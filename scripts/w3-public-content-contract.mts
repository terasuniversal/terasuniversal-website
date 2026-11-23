/**
 * W3-a public-content reliability contract (owner-approved W3-G1, local only). Proves the named edits in
 * scripts/w3-approved.mts are exactly what was approved, that reverting them restores both files byte for byte to the
 * approved base (5b8a77ad), and that the course-identity replacement keeps the course page behaviour. Synthetic data
 * only; lib/supabase.js and next/cache are replaced by the offline fakes, so no database, network or cache is touched.
 * Run: node --experimental-transform-types scripts/w3-public-content-contract.mts
 */
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revertW3, W3_CHANGED } from "./w3-approved.mts";
import { revertW7 } from "./w7-approved.mts";
import { sessionsForCourse } from "../lib/course-session-map.ts";

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
  "app/training/[slug]/page.js": "76d34d03f0370f8133fe435d20056f075f9a040a5d75a182f5875f9b4daebcaf",
  "lib/public-content.ts": "38dda1428d37b3eb162b86a824cce54d45b648bdc1a1239e1376f6b0e0e5592a",
};

await check("scope: only the two approved files carry W3-a edits", () => {
  assert(JSON.stringify(W3_CHANGED) === JSON.stringify(Object.keys(BEFORE).sort()), W3_CHANGED.join(", "));
});
await check("integrity: reverting the named edits restores each file exactly (nothing else changed)", () => {
  // W7-a (owner-approved, scripts/w7-approved.mts) is later than W3-a, so it is undone first.
  for (const [p, hash] of Object.entries(BEFORE)) assert(sha256(revertW3(p, revertW7(p, read(p)))) === hash, p);
});

const source = read("lib/public-content.ts");
await check("public client: no cookie-bound, service-role or direct table access in lib/public-content.ts", () => {
  assert(!/supabase\/server/.test(source), "imports the cookie-bound server client");
  assert(!/cookies\(|headers\(|draftMode\(/.test(source), "reads request state");
  assert(!/ServiceClient|service_role|SERVICE_ROLE/.test(source), "service role");
  assert(!/\.from\(/.test(source), "direct table read");
  assert(!/select\("\*"\)/.test(source), "select *");
  assert((source.match(/getSupabaseClient\(\)/g) ?? []).length === 3, "anon client uses");
});
await check("removed: the unused helpers and the always-null courses lookup are gone, with no remaining caller", () => {
  const removed = ["getPublishedCourses", "getFeaturedCourses", "getGallery", "getPublishedFaqs", "getCompanyProfile", "getPublicCourseIdentity", "getPublishedSchedules\\b"];
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
  // W7-a: the cached loader throws and the uncached getUpcomingSchedules() wrapper still returns [] on failure.
  assert(/p_include_past: false \}\);\s*if \(error\) throw new PublicScheduleLoadError\(error\.code\);/.test(source), "homepage loader throws");
  assert(/export async function getUpcomingSchedules\(\): Promise<PublicSchedule\[\]> \{\s*try \{\s*return await loadUpcomingSchedules\(\);\s*\} catch \(error\) \{[\s\S]*?return \[\];\s*\}\s*\}/.test(source), "homepage fail-closed");
  assert(/\.map\(mapSchedule\)\.slice\(0, 3\)/.test(source), "homepage cap");
});
const page = read("app/training/[slug]/page.js");
await check("course page: identity from loaded sessions, catalogue fallback and SEO unchanged", () => {
  assert(/const canonicalCourse = courseIdentityFromSchedules\(course\.slug, publicSchedules\);/.test(page), "derived identity");
  assert(/sessionsForCourse\(course, canonicalCourse, publicSchedules\)/.test(page), "mapping unchanged");
  assert(/const courseId = canonicalCourse\?\.id \|\| courseSchedules\[0\]\?\.course_id;/.test(page), "courseId fallback");
  assert(/`\/calendar\?course=\$\{encodeURIComponent\(course\.slug\)\}`/.test(page), "slug fallback link");
  assert(/export const dynamicParams = false;/.test(page) && /export const revalidate = 60;/.test(page), "route config");
  assert(/export async function generateMetadata/.test(page) && /generateStaticParams\(\) \{ return courseCatalog\.map/.test(page), "metadata and params");
  assert(!/Promise\.all\(\[/.test(page), "no Promise.all left");
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
const { courseIdentityFromSchedules, getPublishedSchedulesWithState } = await import("../lib/public-content.ts");

const S = (id: string, course_id: string, slug: string | null, title: string, start_date = "2099-01-10") =>
  ({ id, course_id, slug, title, start_date, end_date: start_date, start_time: null, end_time: null, venue: null, delivery_mode: null, status: "open", capacity: 10, available_seats: 5, fee: 650, registration_available: false });

await check("identity: one course id for the slug; null for no session, other slugs or conflicting ids", () => {
  const sessions = [S("1", "A", "working-at-height", "Working at Height"), S("2", "A", "working-at-height", "Working at Height", "2099-02-01"), S("3", "B", "confined-space-safety", "Confined Space")];
  assert(JSON.stringify(courseIdentityFromSchedules("working-at-height", sessions)) === JSON.stringify({ id: "A", slug: "working-at-height" }), "single id");
  assert(courseIdentityFromSchedules("scaffolding-competency", sessions) === null, "no session");
  assert(courseIdentityFromSchedules("working-at-height", []) === null, "empty");
  assert(courseIdentityFromSchedules("x", [S("4", "C", "x", "X"), S("5", "D", "x", "X")]) === null, "conflicting ids");
  assert(courseIdentityFromSchedules("x", [S("6", "C", null, "X")]) === null, "null slug");
});

// The live helper always returned null (anon cannot read `courses`). Compare what the page shows and links to.
const pageView = (course: { slug: string; title: string; crmCourseId?: string }, canonical: { id: string } | null, all: ReturnType<typeof S>[]) => {
  const shown = sessionsForCourse(course, canonical, all).filter((s) => s.start_date >= "2026-01-01");
  const courseId = canonical?.id || shown[0]?.course_id;
  return JSON.stringify({ ids: shown.map((s) => s.id), href: courseId ? `/calendar?courseId=${courseId}` : `/calendar?course=${course.slug}` });
};
await check("behaviour: same sessions and links as before for matched, unmatched, past-only and CRM-id courses", () => {
  const all = [S("1", "A", "working-at-height", "Working at Height"), S("2", "A", "working-at-height", "Working at Height", "2099-03-01"), S("3", "B", "confined-space-safety", "Confined Space Safety"), S("4", "E", "old-course", "Old Course", "2020-01-01"), S("5", "904293c4", "crm-slug", "Intermediate Scaffolder")];
  const courses = [
    { slug: "working-at-height", title: "Working at Height" },
    { slug: "confined-space-safety", title: "Confined Space Safety" },
    { slug: "scaffolding-competency", title: "Scaffolding Competency" },
    { slug: "old-course", title: "Old Course" },
    { slug: "intermediate-scaffolder-level-2", title: "Intermediate Scaffolder Level 2", crmCourseId: "904293c4" },
  ];
  for (const course of courses) assert(pageView(course, null, all) === pageView(course, courseIdentityFromSchedules(course.slug, all), all), course.slug);
});
await check("behaviour (documented difference): a title-only match from a different CRM course is no longer shown", () => {
  // Only reachable when another published course has a different slug but exactly the same title: the identity path
  // shows the slug's own course only, which is what the original lookup was designed to do.
  const all = [S("1", "A", "working-at-height", "Working at Height"), S("2", "Z", "wah-legacy", "Working at Height")];
  const course = { slug: "working-at-height", title: "Working at Height" };
  assert(pageView(course, null, all) !== pageView(course, courseIdentityFromSchedules(course.slug, all), all), "difference expected");
});
await check("errors: an RPC error is an explicit error state, no table read, and the identity falls back to null", async () => {
  const g = gate((name) => name === "get_public_upcoming_schedules" ? { data: null, error: { code: "42501", message: "synthetic internal detail" } } : { data: null, error: null });
  const result = await getPublishedSchedulesWithState();
  assert(result.error === true && result.schedules.length === 0, "error state");
  assert(!JSON.stringify(result).includes("synthetic internal detail") && !JSON.stringify(result).includes("42501"), "internal error detail leaked");
  assert(courseIdentityFromSchedules("working-at-height", result.schedules) === null, "fallback");
  assert(g.reads.length === 0, `direct table reads: ${g.reads.join(",")}`);
});
await check("data: identity from the RPC rows (course_slug), registration still withheld while F-1 is off", async () => {
  const row = { schedule_id: "11111111-1111-4111-8111-111111111111", course_id: "c-1", course_title: "Working at Height", course_slug: "working-at-height", start_date: "2099-12-10", end_date: "2099-12-11", status: "open", capacity: 10, available_seats: 5, fee: 650, registration_available: true };
  const g = gate(() => ({ data: [row], error: null }));
  const result = await getPublishedSchedulesWithState();
  assert(result.error === false && result.schedules.length === 1, "rows");
  assert(result.schedules[0].registration_available === false, "F-1 off withholds registration");
  assert(JSON.stringify(courseIdentityFromSchedules("working-at-height", result.schedules)) === JSON.stringify({ id: "c-1", slug: "working-at-height" }), "identity");
  assert(g.reads.length === 0, "no direct table read");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
