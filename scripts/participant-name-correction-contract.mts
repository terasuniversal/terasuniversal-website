import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Dedicated participant full-name correction. The real helper runs against a stubbed
// Supabase client that records every statement, so the tests can prove exactly what
// is and is not written. Source contracts cover the guards and the unchanged flows.

const { runParticipantNameCorrection, NAME_CORRECTION_MESSAGES } = await import("../lib/participants/name-correction.ts");
const { participantNameCorrectionSchema, participantSchema } = await import("../lib/validation/schemas.ts");

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

type Op = { table: string; kind: "select" | "update"; payload?: unknown; cols?: string; filters: [string, string, unknown][] };
type Row = { id: string; full_name: string | null; deleted_at: string | null };

/** Stub: a single participants row, mutated only by a matching conditional update. */
function stub(row: Row | null, opts: { readError?: boolean; writeError?: boolean; auditError?: boolean; auditThrows?: boolean; raceName?: string } = {}) {
  const ops: Op[] = [];
  const rpcs: unknown[][] = [];
  const userRpcs: unknown[][] = [];
  let stored: Row | null = row ? { ...row } : null;
  const client = {
    from(table: string) {
      const op: Op = { table, kind: "select", filters: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select(cols?: string) { if (op.kind === "select") op.cols = cols; return b; },
        update(payload: unknown) { op.kind = "update"; op.payload = payload; return b; },
        eq(c: string, v: unknown) { op.filters.push(["eq", c, v]); return b; },
        is(c: string, v: unknown) { op.filters.push(["is", c, v]); return b; },
        async maybeSingle() {
          ops.push(op);
          if (opts.readError) return { data: null, error: { message: "boom" } };
          const snapshot = stored ? { ...stored } : null;
          // Simulate a concurrent correction landing between the read and the write.
          if (opts.raceName !== undefined && stored) stored.full_name = opts.raceName;
          return { data: snapshot, error: null };
        },
        then(resolve: (v: unknown) => unknown) {
          ops.push(op);
          if (opts.writeError) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
          const matches = !!stored && op.filters.every(([kind, c, v]) =>
            kind === "is" ? (stored as any)[c] === v : (stored as any)[c] === v);
          if (matches && op.kind === "update") Object.assign(stored as Row, op.payload);
          return Promise.resolve({ data: matches ? [{ id: stored!.id }] : [], error: null }).then(resolve);
        },
      };
      return b;
    },
    // The session client must never write audit events.
    async rpc(...args: unknown[]) {
      userRpcs.push(args);
      return { data: null, error: { message: "permission denied for function log_event" } };
    },
  };
  // Server-only audit client (service role in the app).
  const audit = {
    from() { throw new Error("audit client must not touch tables"); },
    async rpc(...args: unknown[]) {
      rpcs.push(args);
      if (opts.auditThrows) throw new Error("network down");
      return { data: null, error: opts.auditError ? { message: "audit down" } : null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, audit: audit as any, ops, rpcs, userRpcs, stored: () => stored };
}

const OLD = "MOHD TESTNAME BIN SYNTHETIC";
const NEW = "MOHD TESTNAMA BIN SYNTHETIC";
const base: Row = { id: "p-1", full_name: OLD, deleted_at: null };
const input = { id: "p-1", expectedFullName: OLD, fullName: NEW, actorId: "admin-1", actorEmail: "admin@example.invalid" };

await check("runtime: writes ONLY full_name, conditional on id, not-deleted and the expected name", async () => {
  const s = stub(base);
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.deepEqual(r, { ok: true, changed: true, auditLogged: true });
  const updates = s.ops.filter((o) => o.kind === "update");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].payload, { full_name: NEW });
  assert.deepEqual(updates[0].filters, [["eq", "id", "p-1"], ["is", "deleted_at", null], ["eq", "full_name", OLD]]);
  assert.equal(s.stored()!.full_name, NEW);
});

await check("runtime: historical record (empty company/phone, unknown schedule) is corrected and nothing else is written", async () => {
  const historical = { ...base, company: "", phone: null, schedule_id: "legacy-schedule", ic_passport_no: "SYNTH-0001", nationality: null } as unknown as Row;
  const s = stub(historical);
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.equal(r.ok, true);
  const after = s.stored() as unknown as Record<string, unknown>;
  assert.equal(after.company, "");
  assert.equal(after.phone, null);
  assert.equal(after.schedule_id, "legacy-schedule");
  assert.equal(after.ic_passport_no, "SYNTH-0001");
  assert.equal(after.nationality, null);
});

await check("runtime: the read selects only id, full_name and deleted_at", async () => {
  const s = stub(base);
  await runParticipantNameCorrection(s.client, s.audit, input);
  assert.equal(s.ops[0].kind, "select");
  assert.equal(s.ops[0].cols, "id, full_name, deleted_at");
});

await check("runtime: unchanged name performs no write and no audit event", async () => {
  const s = stub(base);
  const r = await runParticipantNameCorrection(s.client, s.audit, { ...input, fullName: OLD });
  assert.deepEqual(r, { ok: true, changed: false });
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
  assert.equal(s.rpcs.length, 0);
});

await check("runtime: stale expected name (changed before the read) is rejected without a write", async () => {
  const s = stub({ ...base, full_name: "SOMEONE ELSE CORRECTED" });
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.deepEqual(r, { ok: false, code: "stale", message: NAME_CORRECTION_MESSAGES.stale });
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
});

await check("runtime: concurrent change between read and write is not overwritten", async () => {
  const s = stub(base, { raceName: "CONCURRENT CORRECTION" });
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.deepEqual(r, { ok: false, code: "stale", message: NAME_CORRECTION_MESSAGES.stale });
  assert.equal(s.stored()!.full_name, "CONCURRENT CORRECTION");
  assert.equal(s.rpcs.length, 0);
});

await check("runtime: missing participant is rejected without a write", async () => {
  const s = stub(null);
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "not_found");
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
});

await check("runtime: soft-deleted participant is rejected without a write", async () => {
  const s = stub({ ...base, deleted_at: "2026-11-01T00:00:00Z" });
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.equal((r as { code: string }).code, "deleted");
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
});

await check("runtime: read failure fails closed without a write", async () => {
  const s = stub(base, { readError: true });
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.equal((r as { code: string }).code, "read_failed");
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
});

await check("runtime: write failure is reported with a generic message", async () => {
  const s = stub(base, { writeError: true });
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.deepEqual(r, { ok: false, code: "write_failed", message: NAME_CORRECTION_MESSAGES.write_failed });
});

await check("runtime: audit event records before/after name and actor, no IC or contact data", async () => {
  const s = stub(base);
  await runParticipantNameCorrection(s.client, s.audit, input);
  assert.equal(s.rpcs.length, 1);
  const [fn, args] = s.rpcs[0] as [string, Record<string, unknown>];
  assert.equal(fn, "log_event_as_service");
  assert.equal(args.p_actor_id, "admin-1");
  assert.equal(args.p_actor_email, "admin@example.invalid");
  assert.equal(args.p_action, "update");
  assert.equal(args.p_entity_type, "participants");
  assert.equal(args.p_summary, "Participant full name corrected");
  assert.equal(args.p_entity_id, "p-1");
  assert.deepEqual(args.p_metadata, { previous_full_name: OLD, new_full_name: NEW, actor_id: "admin-1" });
  assert.deepEqual(Object.keys(args).sort(), ["p_action", "p_actor_email", "p_actor_id", "p_entity_id", "p_entity_type", "p_metadata", "p_summary"]);
  assert.doesNotMatch(JSON.stringify(args.p_metadata), /ic_passport|phone|address|email/);
});

await check("runtime: audit failure is surfaced, the saved name is not reported as unsaved", async () => {
  const s = stub(base, { auditError: true });
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.deepEqual(r, { ok: true, changed: true, auditLogged: false });
});

await check("runtime: a thrown audit call (network) is reported as not logged, never as success", async () => {
  const s = stub(base, { auditThrows: true });
  const r = await runParticipantNameCorrection(s.client, s.audit, input);
  assert.deepEqual(r, { ok: true, changed: true, auditLogged: false });
});

await check("runtime: the session client never calls an audit RPC; only the audit client does", async () => {
  const s = stub(base);
  await runParticipantNameCorrection(s.client, s.audit, input);
  assert.equal(s.userRpcs.length, 0);
  assert.equal(s.rpcs.length, 1);
});

await check("runtime: rejected corrections write no audit event on either client", async () => {
  for (const s of [stub(null), stub({ ...base, deleted_at: "x" }), stub({ ...base, full_name: "OTHER" }), stub(base, { writeError: true }), stub(base, { raceName: "RACE" })]) {
    await runParticipantNameCorrection(s.client, s.audit, input);
    assert.equal(s.rpcs.length + s.userRpcs.length, 0);
  }
});

await check("schema: reuses the participant full_name rule (trim, 2-160)", () => {
  assert.equal(participantNameCorrectionSchema.shape.full_name, participantSchema.shape.full_name);
  assert.equal(participantNameCorrectionSchema.safeParse({ full_name: "  ", expected_full_name: OLD }).success, false);
  assert.equal(participantNameCorrectionSchema.safeParse({ full_name: "A", expected_full_name: OLD }).success, false);
  assert.equal(participantNameCorrectionSchema.safeParse({ full_name: "X".repeat(161), expected_full_name: OLD }).success, false);
  const ok = participantNameCorrectionSchema.safeParse({ full_name: `  ${NEW}  `, expected_full_name: OLD });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.full_name, NEW);
});

await check("schema: has no field other than full_name and expected_full_name", () => {
  assert.deepEqual(Object.keys(participantNameCorrectionSchema.shape).sort(), ["expected_full_name", "full_name"]);
});

await check("schema: create/edit participantSchema still requires company and phone", () => {
  assert.equal(participantSchema.safeParse({ full_name: NEW, ic_passport_no: "SYNTH-0001", company: "", phone: "" }).success, false);
});

async function source(path: string) {
  return (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}
function bodyOf(text: string, signature: string) {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  const end = text.indexOf("\n}\n", start);
  assert.ok(end > start, `end of ${signature} not found`);
  return text.slice(start, end);
}

const actions = await source("../app/admin/(protected)/participants/actions.ts");
const correct = bodyOf(actions, "export async function correctParticipantName");

await check("contract: the Participants Edit capability guard runs first", () => {
  // T1 (OWNER-TRAINING-T1-20261125): Admin, or an Editor with Custom access + Participants Edit (Training Ops Staff);
  // requireModuleCapability checks the role eligibility and the module level in one guard (M-09 level unchanged).
  const guard = correct.indexOf('requireModuleCapability("participants", "edit")');
  const parse = correct.indexOf("participantNameCorrectionSchema.safeParse");
  assert.ok(guard >= 0 && parse > guard && !correct.includes('requireRole("editor")'));
});

await check("security: the service-role audit client is created only after guards and validation, and before any write", () => {
  const parseFail = correct.indexOf("if (!parsed.success) return");
  const service = correct.indexOf("createSupabaseServiceClient()");
  const session = correct.indexOf("createSupabaseServerClient()");
  const run = correct.indexOf("runParticipantNameCorrection(");
  assert.ok(parseFail > 0 && service > parseFail, "service client after validation");
  assert.ok(session > service && run > session, "audit client exists before the update runs");
});

await check("security: if the audit client cannot be created, the action returns before changing anything", () => {
  const catchAt = correct.indexOf("} catch {");
  const returnAt = correct.indexOf("return { message: \"The audit log is unavailable, so the name was not changed.", catchAt);
  assert.ok(catchAt > 0 && returnAt > catchAt && returnAt < correct.indexOf("runParticipantNameCorrection("));
});

await check("security: actor identity comes only from the verified admin profile, never from the form", () => {
  assert.match(correct, /actorId: profile\.id,/);
  assert.match(correct, /actorEmail: profile\.email \?\? null,/);
  assert.doesNotMatch(correct, /formData\.get\("(actor|actor_id|actor_email|entity|entity_id|metadata|p_[a-z_]+)"\)/);
});

await check("security: the helper audits only via log_event_as_service on the audit client, never via the session client", async () => {
  const helper = await source("../lib/participants/name-correction.ts");
  assert.match(helper, /auditClient\.rpc\("log_event_as_service", \{/);
  assert.doesNotMatch(helper, /supabase\.rpc\(/);
  assert.doesNotMatch(helper, /rpc\("log_event"/);
});

await check("security: the service-role client is not referenced from client components or logged", async () => {
  const cardSrc = await source("../app/admin/(protected)/participants/[id]/NameCorrectionCard.tsx");
  assert.doesNotMatch(cardSrc, /createSupabaseServiceClient|SERVICE_ROLE/);
  assert.doesNotMatch(correct, /console\.(error|log)\([^)]*(auditClient|SERVICE_ROLE|key)/i);
});

await check("contract: the action reads only full_name and expected_full_name and never IC/passport", () => {
  assert.deepEqual([...correct.matchAll(/formData\.get\("([a-z_]+)"\)/g)].map((m) => m[1]).sort(), ["expected_full_name", "full_name"]);
  assert.doesNotMatch(correct, /ic_passport_no/);
  assert.doesNotMatch(correct, /\.from\("participants"\)/, "all writes go through the gated helper");
});

await check("contract: createParticipant and updateParticipant still use the full participantSchema", () => {
  assert.match(bodyOf(actions, "export async function createParticipant"), /participantSchema\.safeParse\(readForm\(formData\)\)/);
  assert.match(bodyOf(actions, "export async function updateParticipant"), /participantSchema\.safeParse\(readForm\(formData\)\)/);
});

const page = await source("../app/admin/(protected)/participants/[id]/page.tsx");
const card = await source("../app/admin/(protected)/participants/[id]/NameCorrectionCard.tsx");

await check("ui: card is shown only to admins on non-deleted participants", () => {
  assert.match(page, /\{canWrite && !isDeleted && <NameCorrectionCard /);
});

await check("ui: card submits only the name and the expected name, and warns about issued certificates", () => {
  assert.deepEqual([...new Set([...card.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]))].sort(), ["expected_full_name", "full_name"]);
  assert.doesNotMatch(card, /ic_passport_no|company|phone/);
  assert.match(card, /Certificates already issued keep the name they were issued with/);
});

// public.audit_action labels as read from the Custom Staging catalog (eokiaehnvzbggmacifcf,
// pg_enum, 2026-11-18). log_event(p_action audit_action, ...) rejects any other value, so
// an unlisted label makes every audit call fail.
const AUDIT_ACTION_LABELS = [
  "login", "logout", "create", "update", "delete", "archive", "restore", "publish", "upload", "export", "assign", "import",
  "staff_created", "staff_updated", "staff_activated", "staff_deactivated", "staff_role_changed", "staff_department_changed",
  "staff_module_access_changed", "password_changed", "assessor_created", "assessor_updated", "assessor_activated",
  "assessor_deactivated", "assessor_assigned", "assessor_unassigned", "assessor_reassigned",
];

await check("contract: every log_event p_action in the helper is a valid audit_action enum label", async () => {
  const helper = await source("../lib/participants/name-correction.ts");
  const actionsUsed = [...helper.matchAll(/p_action:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(actionsUsed.length > 0, "no p_action found");
  for (const action of actionsUsed) assert.ok(AUDIT_ACTION_LABELS.includes(action), `p_action "${action}" is not an audit_action label`);
});

await check("ui: an audit failure after a save is shown with error styling, not as plain information", () => {
  assert.match(card, /<div className="ta-alert ta-alert-error" role="alert">\{state\.message\}<\/div>/);
  assert.doesNotMatch(card, /state\.saved \? "ta-alert-info"/);
});

console.log(`\n${passed} checks passed`);
