// Application-side contract for the WAH Failed hold: the shared hold lookup, and
// that single and bulk generation plus the Generate page use it before issuing.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.env.NODE_PATH = [resolve(root, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const ts = require("typescript");
const dir = mkdtempSync(resolve(tmpdir(), "teras-wah-hold-"));
mkdirSync(resolve(dir, "certificates"));
for (const [source, target] of [["lib/working-at-height-programme.ts", "working-at-height-programme.js"], ["lib/certificates/wah-failed-hold.ts", "certificates/wah-failed-hold.js"], ["lib/certificates/wah-legacy-block.ts", "certificates/wah-legacy-block.js"]]) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(root, source), "utf8"), { compilerOptions: { module: "commonjs", target: "es2021" } });
  writeFileSync(resolve(dir, target), outputText);
}
const hold = require(resolve(dir, "certificates/wah-failed-hold.js"));

const WAH = "963b1f6b-4c15-4833-90da-21aa0af0f544";
const client = (result, calls = []) => {
  const chain = { select: () => chain, eq: (k, v) => { calls.push([k, v]); return chain; }, is: (k, v) => { calls.push([k, v]); return Promise.resolve(result); } };
  return { from: (table) => { calls.push(["table", table]); return chain; } };
};

const calls = [];
const ids = await hold.loadWahFailedHoldParticipantIds(client({ data: [{ participant_id: "p1" }], error: null }, calls), "s1", WAH);
assert.deepEqual([...ids], ["p1"]);
for (const expected of [["table", "participant_skill_results"], ["schedule_id", "s1"], ["area", "practical_assessment"], ["status", "failed"], ["deleted_at", null]]) {
  assert.ok(calls.some(([k, v]) => k === expected[0] && v === expected[1]), `query must filter ${expected[0]}`);
}
console.log("PASS hold lookup reads only active Failed Practical Assessment rows for the schedule");

const noQuery = [];
assert.equal((await hold.loadWahFailedHoldParticipantIds(client({ data: [{ participant_id: "p1" }], error: null }, noQuery), "s1", "other-course")).size, 0);
assert.equal(noQuery.length, 0);
console.log("PASS other courses are not queried or held");

await assert.rejects(hold.loadWahFailedHoldParticipantIds(client({ data: null, error: { message: "x" } }), "s1", WAH), /could not be completed/);
console.log("PASS a failed lookup throws instead of reporting nobody held");

const actions = readFileSync(resolve(root, "app/admin/(protected)/certificates/actions.ts"), "utf8");
const single = actions.slice(actions.indexOf("export async function generateCertificate"), actions.indexOf("export async function bulkGenerate"));
assert.ok(single.indexOf("if (held.has(participantId)) return WAH_FAILED_HOLD_REASON") < single.indexOf("insertEligibleCertificate"));
const bulk = actions.slice(actions.indexOf("export async function bulkGenerate"), actions.indexOf("export async function revokeCertificate"));
assert.ok(bulk.indexOf("!heldIds.has(r.participant_id)") < bulk.indexOf("insertEligibleCertificate"));
console.log("PASS single and bulk generation check the hold before calling the issuer");

const page = readFileSync(resolve(root, "app/admin/(protected)/certificates/generate/[scheduleId]/page.tsx"), "utf8");
assert.match(page, /WAH_FAILED_HOLD_LABEL/);
assert.match(page, /r\.eligible && !holdCheckFailed && !isHeld\(r\)/);
assert.match(page, /rows\.filter\(\(r\) => r\.eligible && !isHeld\(r\)\)/);
assert.doesNotMatch(page, /holder_name[^;]*encodeURIComponent/);
assert.equal(hold.WAH_FAILED_HOLD_LABEL, "Held — Failed Practical Assessment");
console.log("PASS Generate page labels held rows, disables them, excludes them from the count, and keeps names out of the URL");

// C4E-2K: the real route handler and mapping action, with only the boundaries stubbed.
const block = require(resolve(dir, "certificates/wah-legacy-block.js"));
// Same list as app.is_wah_course_label in c4-wah-db-contract.mjs.
for (const [label, expected] of [["Working at Height", true], ["WORKING-AT-HEIGHT", true], ["working_at_heights", true], ["Workingatheight", true], ["Work at Height", true], ["WAH", true], ["Refresher (WAH)", true], ["Basic Scaffolding", false], ["OSH Awareness", false], ["Wahana Safety", false], ["Height Safety", false], ["Network at Heights", false], [null, false]]) {
  assert.equal(block.isWahCourseLabel(label), expected, String(label));
}
console.log("PASS WAH label recognition matches the database list");

const compile = (source, target) => {
  const { outputText } = ts.transpileModule(readFileSync(resolve(root, source), "utf8"), { compilerOptions: { module: "commonjs", target: "es2021", allowJs: true } });
  writeFileSync(resolve(dir, target), outputText);
  return resolve(dir, target);
};
const stubs = { current: {} };
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request.endsWith("lib/certificates/wah-legacy-block")) return block;
  if (request.endsWith("lib/supabase/server")) return { createSupabaseServerClient: async () => stubs.current.client, createSupabaseServiceClient: () => ({ rpc: async () => ({ error: null }) }) };
  if (request.endsWith("lib/auth/rbac")) return { hasMinRole: () => true };
  if (request.endsWith("lib/auth/session")) return { requireRole: async () => ({ id: "admin", email: "a@synthetic.test" }), requireModuleAccess: async () => {} };
  if (request.endsWith("lib/validation/schemas")) return { legacyCourseMappingSchema: { safeParse: (v) => ({ success: true, data: v }) }, legacyLinkParticipantSchema: {}, legacyRejectRowSchema: {} };
  if (request === "next/cache") return { revalidatePath: () => {} };
  if (request === "next/navigation") return { redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); } };
  return realLoad.call(this, request, ...rest);
};

const OTHER_ID = "11111111-1111-4111-8111-111111111111";
function fakeClient({ existingCourse = null, course = null } = {}) {
  const writes = [];
  const query = (table) => {
    const q = {
      select: () => q, ilike: () => q, is: () => q, limit: () => q, eq: () => q,
      insert: (row) => { writes.push(["insert", table, row]); return q; },
      maybeSingle: async () => ({ data: table === "courses" ? (course ?? existingCourse) : { normalized_course_name: "x" }, error: null }),
      single: async () => ({ data: { id: `${table}-new` }, error: null }),
    };
    return q;
  };
  return {
    writes,
    auth: { getUser: async () => ({ data: { user: { id: "admin" } }, error: null }) },
    from: (table) => (table === "profiles" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "admin", is_active: true }, error: null }) }) }) } : query(table)),
    rpc: async (name, args) => {
      if (name === "has_module_access_level") return { data: true, error: null };
      writes.push(["rpc", name, args]);
      return { data: 1, error: null };
    },
  };
}
const route = require(compile("app/api/admin/certificates/route.js", "certificates-route.js"));
const row = (course_name) => ({ participant_name: "SYNTHETIC", identity_no: "SYN123", course_name, course_date: "2020-01-01", certificate_no: "SYN-1" });
const importRows = async (client, rows) => {
  stubs.current.client = client;
  const response = await route.POST({ json: async () => ({ action: "legacy_import", rows }) });
  return response.json();
};

for (const [label, name, existing] of [["by name", "Working at Height", null], ["by name variant", "WORKING-AT-HEIGHT Refresher", null], ["by resolved course id", "Differently Named", { id: WAH }]]) {
  const client = fakeClient({ existingCourse: existing });
  const body = await importRows(client, [row(name)]);
  assert.equal(body.imported, 0);
  assert.equal(body.failed, 1);
  assert.match(body.errors[0], /Working at Height tidak dibenarkan/);
  assert.deepEqual(client.writes, [], `${label}: nothing may be written`);
  console.log(`PASS API rejects WAH ${label} with no participant, course or RPC call`);
}

const otherClient = fakeClient({ existingCourse: { id: OTHER_ID } });
assert.equal((await importRows(otherClient, [row("Basic Scaffolding")])).imported, 1);
assert.deepEqual(otherClient.writes.map(([kind, name]) => `${kind}:${name}`), ["insert:participants", "rpc:import_legacy_certificate"]);
const sent = otherClient.writes[1][2];
assert.equal(sent.p_course_id, OTHER_ID);
assert.equal("course_date" in sent.p_certificate, false, "the unrelated course_date bug is deliberately left as it was");
const newCourseClient = fakeClient();
assert.equal((await importRows(newCourseClient, [row("New Unrelated Course")])).imported, 1);
assert.deepEqual(newCourseClient.writes.map(([kind, name]) => `${kind}:${name}`), ["insert:participants", "insert:courses", "rpc:import_legacy_certificate"]);
const mixedClient = fakeClient();
const mixed = await importRows(mixedClient, [row("Working at Height"), row("Basic Scaffolding")]);
assert.deepEqual([mixed.imported, mixed.failed], [1, 1]);
console.log("PASS API keeps other courses' behaviour and write order, and one WAH row does not stop the others");

const legacyActions = require(compile("app/admin/(protected)/participants/legacy-import/actions.ts", "legacy-actions.js"));
const mapForm = (course_id) => new Map([["course_map_id", "map-1"], ["course_id", course_id]]);
const redirected = async (client, course_id) => {
  stubs.current.client = client;
  try { await legacyActions.approveCourseMapping("batch-1", mapForm(course_id)); } catch (error) { return error.url; }
  throw new Error("expected a redirect");
};
for (const [label, id, course] of [["by course id", WAH, { title: "Anything" }], ["by course id when the course read returns nothing", WAH, null], ["by course name", OTHER_ID, { title: "Working At Heights Training" }], ["by course code", OTHER_ID, { title: "X", course_code: "WAH" }]]) {
  const client = fakeClient({ course });
  const url = await redirected(client, id);
  assert.match(decodeURIComponent(url), /error=Working at Height cannot be mapped in a legacy import/);
  assert.deepEqual(client.writes, [], `${label}: mapping RPC must not run`);
  console.log(`PASS mapping to WAH refused ${label}, with an Admin-facing error`);
}
const mapClient = fakeClient({ course: { title: "Basic Scaffolding" } });
assert.doesNotMatch(await redirected(mapClient, OTHER_ID), /error=/);
assert.deepEqual(mapClient.writes.map(([kind, name]) => `${kind}:${name}`), ["rpc:legacy_course_map_approve"]);
console.log("PASS mapping to another course still calls the existing RPC");
Module._load = realLoad;
