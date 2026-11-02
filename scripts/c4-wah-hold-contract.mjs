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
for (const [source, target] of [["lib/working-at-height-programme.ts", "working-at-height-programme.js"], ["lib/certificates/wah-failed-hold.ts", "certificates/wah-failed-hold.js"], ["lib/certificates/wah-legacy-block.ts", "certificates/wah-legacy-block.js"], ["lib/certificates/wah-skills-gate.ts", "certificates/wah-skills-gate.js"], ["lib/certificates/wah-super-admin.ts", "certificates/wah-super-admin.js"]]) {
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
const gate = require(resolve(dir, "certificates/wah-skills-gate.js"));
const superAdmin = require(resolve(dir, "certificates/wah-super-admin.js"));
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
  if (request.endsWith("lib/certificates/wah-failed-hold")) return hold;
  if (request.endsWith("lib/certificates/wah-skills-gate")) return gate;
  if (request.endsWith("lib/certificates/wah-super-admin")) return superAdmin;
  if (request.endsWith("lib/scheduleGroupContext")) return { UNGROUPED: "__ungrouped__" };
  if (request.endsWith("lib/supabase/server")) return { createSupabaseServerClient: async () => stubs.current.client, createSupabaseServiceClient: () => ({ rpc: async () => ({ error: null }) }) };
  if (request.endsWith("lib/auth/rbac")) return { hasMinRole: () => true, isSuperAdmin: () => true };
  if (request.endsWith("lib/auth/session")) {
    const profile = async () => ({ id: "staff-now", email: "a@synthetic.test", role: stubs.current.role ?? "super_admin", is_active: true });
    return { requireRole: profile, requireAssessment: profile, requireCertificate: profile, getCurrentProfile: profile, requireModuleAccess: async () => {} };
  }
  if (request.endsWith("lib/validation/schemas")) {
    const pass = { safeParse: (v) => ({ success: true, data: v }) };
    return { legacyCourseMappingSchema: pass, legacyLinkParticipantSchema: {}, legacyRejectRowSchema: {}, participantSkillResultSchema: pass, wahFailedCorrectionSchema: pass, certificateReissueSchema: pass, certificateRevokeSchema: pass };
  }
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

// Real Skills Record save action: only changed areas are written.
const assessmentActions = require(compile("app/admin/(protected)/assessment/actions.ts", "assessment-actions.js"));
const AREAS = ["theory_session", "practical_training", "safety_awareness", "practical_assessment"];
const stored = (values, extra = {}) => Object.entries(values).map(([area, status]) => ({ participant_id: "p1", area, status, deleted_at: null, ...extra }));
function table(rows, filters = {}, error = null) {
  const matching = () => rows.filter((r) => Object.entries(filters).every(([k, v]) => k === "schedule_id" || r[k] === undefined || r[k] === v));
  const q = {
    select: () => q,
    neq: () => q,
    eq: (k, v) => { filters[k] = v; return q; },
    is: (k, v) => { filters[k] = v; return q; },
    then: (resolve) => resolve({ data: error ? null : matching(), error }),
    maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
  };
  return q;
}
function saveClient({ rows = [], courseId = WAH, locked = false, readError = null } = {}) {
  const upserts = [];
  return {
    upserts,
    from: (name) => {
      if (name === "schedule_participants") return table([{ participant_id: "p1" }]);
      if (name === "assessments") return table([{ locked }]);
      if (name === "course_schedules") return table([{ course_id: courseId }]);
      const q = table(rows, {}, readError);
      q.upsert = async (written, options) => { upserts.push({ written, options }); return { error: null }; };
      return q;
    },
  };
}
const saveForm = (values, originals = values) => {
  const form = new FormData();
  form.set("participant_id", "p1");
  for (const [area, status] of Object.entries(values)) form.set(area, status);
  if (originals) for (const [area, status] of Object.entries(originals)) form.set(`original_${area}`, status);
  return form;
};
const save = async (target, form) => {
  stubs.current.client = target;
  return assessmentActions.updateParticipantSkillResults("s1", {}, form);
};
const ALL_NOT_RECORDED = Object.fromEntries(AREAS.map((a) => [a, "not_recorded"]));
const THREE_DONE = { theory_session: "completed", practical_training: "completed", safety_awareness: "not_recorded", practical_assessment: "passed" };

let saver = saveClient({ rows: stored(THREE_DONE) });
let saved = await save(saver, saveForm({ ...THREE_DONE, safety_awareness: "completed" }, THREE_DONE));
assert.equal(saved.message, "Skills record saved.");
assert.equal(saver.upserts.length, 1);
assert.deepEqual(saver.upserts[0].written.map((r) => [r.area, r.status, r.assessed_by]), [["safety_awareness", "completed", "staff-now"]]);
console.log("PASS changing one area writes only that area, leaving the others' assessor and time alone");

saver = saveClient({ rows: stored(THREE_DONE) });
saved = await save(saver, saveForm(THREE_DONE));
assert.equal(saved.message, "No changes to save.");
assert.equal(saver.upserts.length, 0);
console.log("PASS an unchanged save writes nothing");

saver = saveClient();
saved = await save(saver, saveForm(ALL_NOT_RECORDED));
assert.equal(saved.message, "No changes to save.");
assert.equal(saver.upserts.length, 0);
console.log("PASS Not Recorded with no stored row creates nothing");

saver = saveClient();
await save(saver, saveForm({ ...ALL_NOT_RECORDED, theory_session: "completed", practical_assessment: "passed" }, ALL_NOT_RECORDED));
assert.deepEqual(saver.upserts[0].written.map((r) => r.area), ["theory_session", "practical_assessment"]);
console.log("PASS a first entry writes only the areas that have a result");

saver = saveClient({ rows: stored({ ...ALL_NOT_RECORDED, safety_awareness: "completed" }) });
saved = await save(saver, saveForm({ ...ALL_NOT_RECORDED, theory_session: "completed" }, ALL_NOT_RECORDED));
assert.match(saved.error, /changed by someone else/);
assert.equal(saver.upserts.length, 0);
console.log("PASS a stale form is refused without writing any area");

saver = saveClient({ rows: stored(THREE_DONE) });
await save(saver, saveForm({ ...THREE_DONE, theory_session: "not_recorded" }, THREE_DONE));
assert.deepEqual(saver.upserts[0].written.map((r) => [r.area, r.status]), [["theory_session", "not_recorded"]]);
console.log("PASS a deliberate change back to Not Recorded is still a recorded change");

saver = saveClient({ rows: stored({ theory_session: "completed" }, { deleted_at: "2026-01-01" }) });
await save(saver, saveForm({ ...ALL_NOT_RECORDED, theory_session: "completed" }, ALL_NOT_RECORDED));
assert.deepEqual(saver.upserts[0].written.map((r) => [r.area, r.deleted_at]), [["theory_session", null]]);
console.log("PASS re-recording over a soft-deleted row makes it active rather than leaving it hidden");

saver = saveClient({ rows: stored({ ...THREE_DONE, practical_assessment: "failed" }) });
await save(saver, saveForm({ theory_session: "completed", practical_training: "completed", safety_awareness: "completed" }, { theory_session: "completed", practical_training: "completed", safety_awareness: "not_recorded" }));
assert.deepEqual(saver.upserts[0].written.map((r) => r.area), ["safety_awareness"]);
saver = saveClient({ rows: stored({ ...THREE_DONE, practical_assessment: "failed" }) });
saved = await save(saver, saveForm({ ...THREE_DONE, practical_assessment: "passed" }, null));
assert.match(saved.error, /Admin correction/);
assert.equal(saver.upserts.length, 0);
console.log("PASS a recorded Failed stays out of the save and can't be changed here");

saver = saveClient({ locked: true });
saved = await save(saver, saveForm({ ...ALL_NOT_RECORDED, theory_session: "completed" }, ALL_NOT_RECORDED));
assert.match(saved.error, /locked/);
assert.equal(saver.upserts.length, 0);
saver = saveClient({ readError: { message: "x" }, courseId: OTHER_ID });
saved = await save(saver, saveForm(THREE_DONE));
assert.match(saved.error, /Unable to read/);
assert.equal(saver.upserts.length, 0);
console.log("PASS a lock or read failure writes nothing");

saver = saveClient({ rows: stored(THREE_DONE), courseId: OTHER_ID });
await save(saver, saveForm({ ...THREE_DONE, safety_awareness: "completed" }, null));
assert.deepEqual(saver.upserts[0].written.map((r) => r.area), ["safety_awareness"]);
console.log("PASS other courses and an already-open form without original values also save only changes");

const tableSource = readFileSync(resolve(root, "app/admin/(protected)/assessment/AssessmentTable.tsx"), "utf8");
assert.match(tableSource, /name=\{`original_\$\{area\}`\}/);
console.log("PASS the Skills Record form submits the values it was showing");

// Real generation actions: incomplete WAH rows are held before the issuer.
const certificateActions = require(compile("app/admin/(protected)/certificates/actions.ts", "certificate-actions.js"));
const ALL_DONE = { theory_session: "completed", practical_training: "completed", safety_awareness: "completed", practical_assessment: "passed" };
function issueClient({ eligible = [], skills = [], courseId = WAH, readError = null, rpcError = null } = {}) {
  const issued = [];
  const via = [];
  const elig = eligible.map((id) => ({ schedule_id: "s1", participant_id: id, course_id: courseId, certificate_template_id: "t1", eligible: true, holder_name: "SYNTHETIC" }));
  return {
    issued,
    via,
    from: (name) => {
      if (name === "v_certificate_eligibility") return table(elig);
      if (name === "certificate_templates") return table([{ config: {} }]);
      return table(skills, {}, readError);
    },
    rpc: async (name, args) => {
      if (rpcError) return { data: null, error: rpcError };
      issued.push(args.p_participant_id);
      via.push(name);
      return { data: [{ id: "c1", verification_token: "t" }], error: null };
    },
  };
}
const generate = async (target) => { stubs.current.client = target; return certificateActions.generateCertificate("s1", "p1"); };
const bulkRun = async (target) => { stubs.current.client = target; return certificateActions.bulkGenerate("s1"); };

let issuer = issueClient({ eligible: ["p1"], skills: stored(ALL_DONE) });
assert.equal(await generate(issuer), "ok");
assert.deepEqual(issuer.issued, ["p1"]);
for (const area of AREAS) {
  issuer = issueClient({ eligible: ["p1"], skills: stored({ ...ALL_DONE, [area]: "not_recorded" }) });
  assert.equal(await generate(issuer), gate.WAH_SKILLS_HOLD_REASON, area);
  assert.deepEqual(issuer.issued, []);
}
issuer = issueClient({ eligible: ["p1"] });
assert.equal(await generate(issuer), gate.WAH_SKILLS_HOLD_REASON);
console.log("PASS single generation issues complete WAH and holds any incomplete record before the issuer");

issuer = issueClient({ eligible: ["p1"], skills: stored({ ...ALL_DONE, practical_assessment: "failed" }) });
assert.equal(await generate(issuer), hold.WAH_FAILED_HOLD_REASON);
assert.deepEqual(issuer.issued, []);
console.log("PASS Failed keeps its own reason");

issuer = issueClient({ eligible: ["p1", "p2", "p3"], skills: [...stored(ALL_DONE), ...stored(ALL_DONE, { participant_id: "p2" }), ...stored(ALL_DONE, { participant_id: "p3" })] });
const bulkResult = await bulkRun(issuer);
assert.deepEqual([bulkResult.generated, bulkResult.held, bulkResult.skipped], [0, 0, 3]);
assert.deepEqual(bulkResult.failureReasons, [superAdmin.WAH_BULK_EXCLUDED_REASON]);
assert.deepEqual(issuer.issued, []);
console.log("PASS bulk generation never issues Working at Height, even when every participant is complete");

issuer = issueClient({ eligible: ["p1", "p2"], courseId: OTHER_ID });
const otherBulk = await bulkRun(issuer);
assert.deepEqual([otherBulk.generated, otherBulk.skipped], [2, 0]);
assert.deepEqual(issuer.via, ["issue_certificate_with_skill_snapshot", "issue_certificate_with_skill_snapshot"]);
console.log("PASS bulk generation still works for other courses through the unchanged issuer");

issuer = issueClient({ eligible: ["p1"], skills: stored(ALL_DONE) });
assert.equal(await generate(issuer), "ok");
assert.deepEqual(issuer.via, ["issue_wah_certificate_as_super_admin"]);
for (const role of ["admin", "editor", "trainer"]) {
  stubs.current.role = role;
  issuer = issueClient({ eligible: ["p1"], skills: stored(ALL_DONE) });
  assert.equal(await generate(issuer), superAdmin.WAH_SUPER_ADMIN_REASON, role);
  assert.deepEqual(issuer.issued, [], role);
}
stubs.current.role = undefined;
for (const [message, reason] of [["WAH_SUPER_ADMIN_REQUIRED: x", superAdmin.WAH_SUPER_ADMIN_REASON], ["WAH_ISSUANCE_NOT_AUTHORIZED: x", superAdmin.WAH_NOT_AUTHORIZED_REASON], ["WAH_AUTHORIZATION_INVALID: not eligible (x).", superAdmin.WAH_AUTHORIZATION_REASON]]) {
  issuer = issueClient({ eligible: ["p1"], skills: stored(ALL_DONE), rpcError: { message } });
  assert.equal(await generate(issuer), reason, message);
}
issuer = issueClient({ eligible: ["p1"], courseId: OTHER_ID });
assert.equal(await generate(issuer), "ok");
assert.deepEqual(issuer.via, ["issue_certificate_with_skill_snapshot"]);
console.log("PASS individual WAH generation uses the Super Admin issuer, others keep the old one, and database refusals reach staff as plain reasons");

issuer = issueClient({ eligible: ["p1"], readError: { message: "x" } });
assert.match(await generate(issuer), /could not be completed/);
assert.deepEqual(issuer.issued, []);
console.log("PASS a failed check issues nothing");

issuer = issueClient({ eligible: ["p1"], skills: stored(ALL_DONE), rpcError: { message: "WAH_SKILLS_RECORD_INCOMPLETE: certificate not issued because the Skills Record is incomplete." } });
assert.equal(await generate(issuer), gate.WAH_SKILLS_HOLD_REASON);
console.log("PASS the database gate's error reaches staff as the plain reason");

issuer = issueClient({ eligible: ["p1"], courseId: OTHER_ID });
assert.equal(await generate(issuer), "ok");
assert.deepEqual(issuer.issued, ["p1"]);
console.log("PASS other courses with no skill rows still issue as before");

assert.match(page, /WAH_SKILLS_HOLD_LABEL/);
assert.match(page, /isFailedHeld\(r\) \? WAH_FAILED_HOLD_LABEL : WAH_SKILLS_HOLD_LABEL/);
assert.match(page, /incompleteRows\.length/);
assert.doesNotMatch(page, /incompleteRows\.map/);
console.log("PASS Generate page labels incomplete rows, disables them through isHeld, and lists no names in the new notice");
Module._load = realLoad;
