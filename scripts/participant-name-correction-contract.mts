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
function stub(row: Row | null, opts: { readError?: boolean; writeError?: boolean; auditError?: boolean; raceName?: string } = {}) {
  const ops: Op[] = [];
  const rpcs: unknown[][] = [];
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
    async rpc(...args: unknown[]) {
      rpcs.push(args);
      return { data: null, error: opts.auditError ? { message: "audit down" } : null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, ops, rpcs, stored: () => stored };
}

const OLD = "MOHD TESTNAME BIN SYNTHETIC";
const NEW = "MOHD TESTNAMA BIN SYNTHETIC";
const base: Row = { id: "p-1", full_name: OLD, deleted_at: null };
const input = { id: "p-1", expectedFullName: OLD, fullName: NEW, actorId: "admin-1" };

await check("runtime: writes ONLY full_name, conditional on id, not-deleted and the expected name", async () => {
  const s = stub(base);
  const r = await runParticipantNameCorrection(s.client, input);
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
  const r = await runParticipantNameCorrection(s.client, input);
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
  await runParticipantNameCorrection(s.client, input);
  assert.equal(s.ops[0].kind, "select");
  assert.equal(s.ops[0].cols, "id, full_name, deleted_at");
});

await check("runtime: unchanged name performs no write and no audit event", async () => {
  const s = stub(base);
  const r = await runParticipantNameCorrection(s.client, { ...input, fullName: OLD });
  assert.deepEqual(r, { ok: true, changed: false });
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
  assert.equal(s.rpcs.length, 0);
});

await check("runtime: stale expected name (changed before the read) is rejected without a write", async () => {
  const s = stub({ ...base, full_name: "SOMEONE ELSE CORRECTED" });
  const r = await runParticipantNameCorrection(s.client, input);
  assert.deepEqual(r, { ok: false, code: "stale", message: NAME_CORRECTION_MESSAGES.stale });
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
});

await check("runtime: concurrent change between read and write is not overwritten", async () => {
  const s = stub(base, { raceName: "CONCURRENT CORRECTION" });
  const r = await runParticipantNameCorrection(s.client, input);
  assert.deepEqual(r, { ok: false, code: "stale", message: NAME_CORRECTION_MESSAGES.stale });
  assert.equal(s.stored()!.full_name, "CONCURRENT CORRECTION");
  assert.equal(s.rpcs.length, 0);
});

await check("runtime: missing participant is rejected without a write", async () => {
  const s = stub(null);
  const r = await runParticipantNameCorrection(s.client, input);
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "not_found");
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
});

await check("runtime: soft-deleted participant is rejected without a write", async () => {
  const s = stub({ ...base, deleted_at: "2026-11-01T00:00:00Z" });
  const r = await runParticipantNameCorrection(s.client, input);
  assert.equal((r as { code: string }).code, "deleted");
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
});

await check("runtime: read failure fails closed without a write", async () => {
  const s = stub(base, { readError: true });
  const r = await runParticipantNameCorrection(s.client, input);
  assert.equal((r as { code: string }).code, "read_failed");
  assert.equal(s.ops.filter((o) => o.kind === "update").length, 0);
});

await check("runtime: write failure is reported with a generic message", async () => {
  const s = stub(base, { writeError: true });
  const r = await runParticipantNameCorrection(s.client, input);
  assert.deepEqual(r, { ok: false, code: "write_failed", message: NAME_CORRECTION_MESSAGES.write_failed });
});

await check("runtime: audit event records before/after name and actor, no IC or contact data", async () => {
  const s = stub(base);
  await runParticipantNameCorrection(s.client, input);
  assert.equal(s.rpcs.length, 1);
  const [fn, args] = s.rpcs[0] as [string, Record<string, unknown>];
  assert.equal(fn, "log_event");
  assert.equal(args.p_action, "participant_name_corrected");
  assert.equal(args.p_entity_id, "p-1");
  assert.deepEqual(args.p_metadata, { previous_full_name: OLD, new_full_name: NEW, actor_id: "admin-1" });
  assert.doesNotMatch(JSON.stringify(args), /ic_passport|phone|address|email/);
});

await check("runtime: audit failure is surfaced, the saved name is not reported as unsaved", async () => {
  const s = stub(base, { auditError: true });
  const r = await runParticipantNameCorrection(s.client, input);
  assert.deepEqual(r, { ok: true, changed: true, auditLogged: false });
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

await check("contract: admin and participants-module guards run first", () => {
  const role = correct.indexOf('requireRole("admin")');
  const mod = correct.indexOf('requireModuleAccess("participants")');
  const parse = correct.indexOf("participantNameCorrectionSchema.safeParse");
  assert.ok(role >= 0 && mod > role && parse > mod);
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

console.log(`\n${passed} checks passed`);
