/**
 * W7-a calendar reliability test (owner-approved W7-a-G1, local only). Runs the REAL lib/public-content.ts against
 * recording fakes: Supabase (scripts/fixtures/public-registration-gate-fakes.mjs, fabricated rows only) and a next/cache
 * double with unstable_cache semantics (scripts/fixtures/w7-next-cache-fakes.mjs). Global fetch throws on ANY request.
 * B0 runs the same scenarios against the main bytes (revertW7) to show the defect W7-a removes.
 *
 * Run: node --experimental-transform-types scripts/w7-calendar-reliability.test.mts
 */
import { existsSync, mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revertW7 } from "./w7-approved.mts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FAKES = pathToFileURL(path.join(root, "scripts", "fixtures", "public-registration-gate-fakes.mjs")).href;
const CACHE = pathToFileURL(path.join(root, "scripts", "fixtures", "w7-next-cache-fakes.mjs")).href;
const FAKED = [/[\\/]lib[\\/]supabase\.js$/, /[\\/]lib[\\/]supabase[\\/]server\.ts$/, /[\\/]lib[\\/]rate-limit\.js$/];
// The main bytes of lib/public-content.ts, written outside the repository; its relative imports resolve from lib/.
const baseDir = mkdtempSync(path.join(tmpdir(), "w7-base-"));
const BASE_COPY = path.join(baseDir, "public-content.ts");
writeFileSync(BASE_COPY, revertW7("lib/public-content.ts", readFileSync(path.join(root, "lib", "public-content.ts"), "utf8")));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true };
    if (specifier === "next/cache") return { url: CACHE, shortCircuit: true };
    const parent = context.parentURL;
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent?.startsWith("file:") && !/\.(m?[jt]sx?|cjs|json)$/.test(specifier)) {
      const parentPath = fileURLToPath(parent);
      const fromDir = parentPath === BASE_COPY ? path.join(root, "lib") : path.dirname(parentPath);
      if (parentPath === BASE_COPY || (parentPath.startsWith(root) && !parentPath.includes(`${path.sep}node_modules${path.sep}`))) {
        const base = path.resolve(fromDir, specifier);
        for (const suffix of [".ts", ".tsx", ".js", ".mjs", `${path.sep}index.ts`, `${path.sep}index.js`]) {
          const candidate = base + suffix;
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            if (FAKED.some((pattern) => pattern.test(candidate))) return { url: FAKES, shortCircuit: true };
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
globalThis.fetch = (async () => { throw new Error("unexpected outbound request in offline test"); }) as typeof fetch;

type Answer = { data: unknown; error: unknown };
type Gate = { rpcs: { name: string; args: Record<string, unknown> }[]; reads: string[]; rateLimits: string[]; rpcAnswer?: (name: string, args: Record<string, unknown>) => Answer };
type CacheState = { now: number; entries: Map<string, { value: unknown; at: number; tags: string[] }>; sets: string[]; pending: Promise<unknown>[] };
const cacheMod = await import(CACHE);
const cache = () => (globalThis as unknown as { __w7cache: CacheState }).__w7cache;
const gate = () => (globalThis as unknown as { __gate: Gate }).__gate;
const logs: unknown[][] = [];
console.error = (...args: unknown[]) => { logs.push(args); };
function reset(answer: Gate["rpcAnswer"], flag?: string) {
  if (flag === undefined) delete process.env.TERAS_PUBLIC_REGISTRATION; else process.env.TERAS_PUBLIC_REGISTRATION = flag;
  (globalThis as { __gate?: Gate }).__gate = { rpcs: [], reads: [], rateLimits: [], rpcAnswer: answer };
  cacheMod.resetW7Cache();
  logs.length = 0;
}
const setAnswer = (answer: Gate["rpcAnswer"]) => { gate().rpcAnswer = answer; };
const scheduleRpcs = () => gate().rpcs.filter((r) => r.name === "get_public_upcoming_schedules");

let failures = 0;
const results: string[] = [];
async function check(id: string, name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push(`LULUS ${id} ${name}`); } catch (error) { failures += 1; results.push(`GAGAL ${id} ${name} -> ${(error as Error).message.split("\n")[0]}`); }
}
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// Seven synthetic sessions across six synthetic courses (the Production shape: one course has two sessions).
const COURSES = ["c-1", "c-2", "c-3", "c-4", "c-5", "c-6", "c-1"];
const ROWS = COURSES.map((course, i) => ({
  schedule_id: `00000000-0000-4000-8000-00000000000${i + 1}`, course_id: course, course_title: `Synthetic Course ${course}`, course_slug: `synthetic-${course}`,
  start_date: `2099-0${i + 1}-10`, end_date: `2099-0${i + 1}-11`, start_time: null, end_time: null, venue: null, delivery_mode: null,
  status: "open", capacity: 10, available_seats: 5, fee: 650, registration_available: true,
}));
const SECRET_DETAIL = "synthetic internal detail: relation course_schedules";
const ok: Gate["rpcAnswer"] = (name, args) => name === "get_public_upcoming_schedules"
  ? { data: args.p_include_past === false ? ROWS : ROWS, error: null }
  : name === "get_public_registration_schedule" ? { data: [ROWS.find((r) => r.schedule_id === args.p_schedule_id)], error: null }
  : { data: null, error: { message: "unexpected rpc" } };
const failing = (code: unknown = "57014"): Gate["rpcAnswer"] => (name, args) => name === "get_public_upcoming_schedules"
  ? { data: null, error: { code, message: SECRET_DETAIL, details: JSON.stringify(ROWS[0]) } }
  : ok!(name, args);

const w7 = await import("../lib/public-content.ts");
const base = await import(pathToFileURL(BASE_COPY).href);
const KEY_CAL = "public-schedules-v2";
const KEY_HOME = "public-upcoming-schedules-v2";

// B0: the main bytes cache an RPC failure as a normal result (the defect), and a failed refresh replaces good data.
await check("B0", "main (before W7-a): a failure is cached, and a failed background refresh overwrites good data", async () => {
  reset(failing());
  await base.getPublishedSchedulesWithState();
  assert(cache().entries.get("public-schedules")?.value && (cache().entries.get("public-schedules")!.value as { error: boolean }).error === true, "main did not cache the error state");
  reset(ok);
  await base.getPublishedSchedulesWithState();
  cache().now = 61; setAnswer(failing());
  await base.getPublishedSchedulesWithState(); await Promise.all(cache().pending);
  assert((cache().entries.get("public-schedules")!.value as { error: boolean }).error === true, "main kept the good entry");
});

await check("T1", "success: 7 sessions, error false, cached once for 60 s under the versioned key and the schedules tag", async () => {
  reset(ok);
  const first = await w7.getPublishedSchedulesWithState();
  assert(first.error === false && first.schedules.length === 7, `result ${first.error} ${first.schedules.length}`);
  assert(JSON.stringify(scheduleRpcs().map((r) => r.args)) === JSON.stringify([{ p_include_past: true }]), "rpc args");
  assert(cache().entries.size === 1 && cache().entries.has(KEY_CAL), [...cache().entries.keys()].join(","));
  assert(JSON.stringify(cache().entries.get(KEY_CAL)!.tags) === JSON.stringify(["schedules"]), "tag");
  cache().now = 59;
  const again = await w7.getPublishedSchedulesWithState();
  assert(scheduleRpcs().length === 1 && JSON.stringify(again) === JSON.stringify(first), "not served from cache within 60 s");
  cache().now = 60;
  await w7.getPublishedSchedulesWithState(); await Promise.all(cache().pending);
  assert(scheduleRpcs().length === 2, "not refreshed after 60 s");
  // Same public result as main for the same rows (structure, mapping, fee, registration flag).
  reset(ok); const baseline = await base.getPublishedSchedulesWithState();
  assert(JSON.stringify(baseline) === JSON.stringify(first), "result differs from main");
  // revalidateTag("schedules") still empties the entry.
  reset(ok); await w7.getPublishedSchedulesWithState(); cacheMod.revalidateTag("schedules");
  assert(cache().entries.size === 0, "revalidateTag did not clear");
});

await check("T2", "RPC failure on an empty cache: unchanged error state, nothing cached, no table read", async () => {
  reset(failing());
  const result = await w7.getPublishedSchedulesWithState();
  assert(JSON.stringify(result) === JSON.stringify({ schedules: [], error: true }), JSON.stringify(result));
  assert(cache().entries.size === 0 && cache().sets.length === 0, "failure was cached");
  assert(gate().reads.length === 0, "direct table read");
  assert(w7.courseIdentityFromSchedules("synthetic-c-1", result.schedules) === null, "W3 identity fallback");
});

await check("T3", "recovery: the next request after a failure succeeds at once (no 60 s wait) and restores the W3 identity", async () => {
  reset(failing());
  assert((await w7.getPublishedSchedulesWithState()).error === true, "first call");
  setAnswer(ok);
  const next = await w7.getPublishedSchedulesWithState();
  assert(next.error === false && next.schedules.length === 7 && cache().now === 0, "not recovered immediately");
  assert(JSON.stringify(w7.courseIdentityFromSchedules("synthetic-c-1", next.schedules)) === JSON.stringify({ id: "c-1", slug: "synthetic-c-1" }), "identity");
});

await check("T4", "failed background refresh of a stale entry keeps the good entry (not after a full invalidation)", async () => {
  reset(ok);
  const good = await w7.getPublishedSchedulesWithState();
  cache().now = 61; setAnswer(failing());
  const stale = await w7.getPublishedSchedulesWithState(); await Promise.all(cache().pending);
  assert(JSON.stringify(stale) === JSON.stringify(good), "stale good data not served");
  assert(cache().entries.get(KEY_CAL)!.at === 0 && Array.isArray(cache().entries.get(KEY_CAL)!.value), "good entry replaced");
  assert((await w7.getPublishedSchedulesWithState()).error === false, "second stale read");
  setAnswer(ok); await w7.getPublishedSchedulesWithState(); await Promise.all(cache().pending);
  assert(cache().entries.get(KEY_CAL)!.at === 61, "refresh after recovery not stored");
  // Limitation, asserted so it stays documented: after revalidateTag (or a cold cache) there is nothing to fall back on.
  cacheMod.revalidateTag("schedules"); setAnswer(failing());
  assert((await w7.getPublishedSchedulesWithState()).error === true, "expected the error state after a full invalidation");
});

await check("T5", "10 concurrent requests during a failure and then after recovery", async () => {
  reset(failing());
  const failed = await Promise.all(Array.from({ length: 10 }, () => w7.getPublishedSchedulesWithState()));
  assert(failed.every((r) => r.error === true && r.schedules.length === 0), "not all error");
  assert(cache().entries.size === 0, "a concurrent failure was cached");
  assert(scheduleRpcs().length === 10, `rpc calls ${scheduleRpcs().length} (no negative cache expected)`);
  setAnswer(ok);
  const recovered = await Promise.all(Array.from({ length: 10 }, () => w7.getPublishedSchedulesWithState()));
  assert(recovered.every((r) => r.error === false && JSON.stringify(r) === JSON.stringify(recovered[0])), "inconsistent results");
  const before = scheduleRpcs().length;
  const cached = await Promise.all(Array.from({ length: 10 }, () => w7.getPublishedSchedulesWithState()));
  assert(scheduleRpcs().length === before && cached.every((r) => JSON.stringify(r) === JSON.stringify(recovered[0])), "not served from cache");
});

await check("T6", "homepage: [] on failure (not cached), recovery at once, cap of 3, versioned key", async () => {
  reset(failing());
  const empty = await w7.getUpcomingSchedules();
  assert(Array.isArray(empty) && empty.length === 0 && cache().entries.size === 0, "failure cached or not []");
  setAnswer(ok);
  const three = await w7.getUpcomingSchedules();
  assert(three.length === 3 && cache().entries.has(KEY_HOME), `length ${three.length}`);
  assert(JSON.stringify(scheduleRpcs().map((r) => r.args.p_include_past)) === JSON.stringify([false, false]), "rpc args");
  reset(ok); const baseline = await base.getUpcomingSchedules();
  reset(ok); assert(JSON.stringify(await w7.getUpcomingSchedules()) === JSON.stringify(baseline), "result differs from main");
  reset(ok); await w7.getUpcomingSchedules(); cache().now = 61; setAnswer(failing());
  assert((await w7.getUpcomingSchedules()).length === 3, "stale homepage data not served"); await Promise.all(cache().pending);
  assert(cache().entries.get(KEY_HOME)!.at === 0, "good homepage entry replaced");
});

await check("T7", "F-1 OFF withholds registration and F-1 ON keeps it (synthetic; same as main)", async () => {
  for (const flag of [undefined, "disabled", "enabled"]) {
    reset(ok, flag);
    const calendar = await w7.getPublishedSchedulesWithState();
    const home = await w7.getUpcomingSchedules();
    const want = flag === "enabled";
    assert(calendar.schedules.every((s) => s.registration_available === want) && home.every((s) => s.registration_available === want), `flag ${flag}`);
    reset(ok, flag);
    assert(JSON.stringify(await base.getPublishedSchedulesWithState()) === JSON.stringify(calendar), `differs from main (${flag})`);
  }
  delete process.env.TERAS_PUBLIC_REGISTRATION;
});

await check("T8", "logging: one console.error per failure with a short code only (no message, details or rows)", async () => {
  reset(failing("57014"));
  await w7.getPublishedSchedulesWithState(); await w7.getUpcomingSchedules();
  assert(logs.length === 2, `log count ${logs.length}`);
  assert(JSON.stringify(logs[0]) === JSON.stringify(["public-content: published schedules unavailable", { code: "57014" }]), JSON.stringify(logs[0]));
  assert(JSON.stringify(logs[1]) === JSON.stringify(["public-content: upcoming schedules unavailable", { code: "57014" }]), JSON.stringify(logs[1]));
  for (const code of ["PGRST202", "42501"]) { reset(failing(code)); await w7.getPublishedSchedulesWithState(); assert((logs[0][1] as { code: string }).code === code, code); }
  for (const code of [SECRET_DETAIL, null, 42, "", "x".repeat(40)]) { reset(failing(code)); await w7.getPublishedSchedulesWithState(); assert((logs[0][1] as { code: string }).code === "unknown", String(code)); }
  reset(() => { throw new Error(SECRET_DETAIL); });
  const thrown = await w7.getPublishedSchedulesWithState();
  assert(thrown.error === true && (logs[0][1] as { code: string }).code === "exception", "exception path");
  const all = JSON.stringify(logs);
  assert(!all.includes("synthetic internal detail") && !all.includes("course_schedules") && !all.includes("Synthetic Course"), "sensitive detail logged");
  reset(ok); await w7.getPublishedSchedulesWithState(); await w7.getUpcomingSchedules();
  assert(logs.length === 0, "logged on success");
});

rmSync(baseDir, { recursive: true, force: true });
for (const line of results) console.log(line);
console.log(failures ? `\n${failures} semakan GAGAL` : `\nSemua ${results.length} semakan LULUS`);
process.exit(failures ? 1 : 0);
