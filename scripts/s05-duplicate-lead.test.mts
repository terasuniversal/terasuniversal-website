// S-05: potential duplicate lead warning — normalization, matching, privacy and wiring.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DUPLICATE_CANDIDATE_LIMIT, escapeIlike, findPotentialDuplicateLeads, matchDuplicateCandidates,
  normalizeEmail, normalizePhone, phoneIlikePattern, type DuplicateLeadCandidate,
} from "../lib/sales/duplicate-lead.ts";

let passed = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log(`ok - ${name}`); };
const cand = (id: string, over: Partial<DuplicateLeadCandidate> = {}): DuplicateLeadCandidate => ({
  lead_metadata_id: id, contact_name: `Lead ${id}`, company: "Synthetic Co", email: null, phone: null,
  status: "new", is_test: true, created_at: `2026-11-2${id.length % 9}T00:00:00Z`, ...over,
});

await check("email normalization: trim + lower-case; invalid or empty is null", () => {
  assert.equal(normalizeEmail("  Finance@Example.TEST "), "finance@example.test");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(null), null);
});
await check("phone normalization: +60 / 60 / 0 prefixes and separators collapse to one key", () => {
  const key = "0123456789";
  for (const v of ["+60 12-345 6789", "60123456789", "012-345 6789", "(012) 345.6789", "0060123456789"]) assert.equal(normalizePhone(v), key, v);
  assert.equal(normalizePhone("019-512 3834"), "0195123834");
});
await check("phone normalization: too short or missing is ignored (no false matches)", () => {
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("ext 204"), null);
  assert.equal(normalizePhone(undefined), null);
});
await check("ILIKE escaping keeps wildcards literal; phone pattern is digits and % only", () => {
  assert.equal(escapeIlike("a_b%c\\d@x.test"), "a\\_b\\%c\\\\d@x.test");
  const pattern = phoneIlikePattern("0123456789");
  assert.equal(pattern, "%2%3%4%5%6%7%8%9%");
  assert.match(pattern, /^[%0-9]+$/);
});
await check("legitimate duplicates are reported with every reason, newest first", () => {
  const m = matchDuplicateCandidates({ leadId: "self", email: "A@x.test", phone: "+60 12 345 6789" }, [
    cand("self", { email: "a@x.test" }),
    cand("e1", { email: " a@X.test ", created_at: "2026-11-01T00:00:00Z" }),
    cand("p1", { phone: "012-3456789", created_at: "2026-11-03T00:00:00Z" }),
    cand("both", { email: "a@x.test", phone: "60123456789", created_at: "2026-11-02T00:00:00Z" }),
    cand("other", { email: "b@x.test", phone: "0199999999" }),
  ]);
  assert.deepEqual(m.map((x) => x.leadId), ["p1", "both", "e1"]);
  assert.deepEqual(m.find((x) => x.leadId === "both")?.reasons, ["email", "phone"]);
  assert.ok(!m.some((x) => x.leadId === "self"), "the lead itself is never its own duplicate");
});
await check("same candidate returned by both queries is merged once", () => {
  const c = cand("dup", { email: "a@x.test", phone: "0123456789" });
  const m = matchDuplicateCandidates({ leadId: "self", email: "a@x.test", phone: "0123456789" }, [c, c]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].reasons, ["email", "phone"]);
});
await check("ILIKE over-match (last 8 digits) is filtered out by exact normalized comparison", () => {
  const m = matchDuplicateCandidates({ leadId: "self", email: null, phone: "0123456789" }, [cand("near", { phone: "0113456789" })]);
  assert.equal(m.length, 0);
});
await check("missing contact details: no lookup, no warning", async () => {
  let calls = 0;
  const client = { from() { calls++; throw new Error("must not query"); } } as never;
  const r = await findPotentialDuplicateLeads(client, { leadId: "self", email: null, phone: "" });
  assert.deepEqual(r, { matches: [], failed: false });
  assert.equal(calls, 0);
});

type Call = { relation: string; ops: Array<[string, ...unknown[]]> };
function fakeClient(rows: DuplicateLeadCandidate[], fail = false) {
  const calls: Call[] = [];
  const client = {
    from(relation: string) {
      const call: Call = { relation, ops: [] }; calls.push(call);
      const q = {
        select(c: string) { call.ops.push(["select", c]); return q; },
        ilike(col: string, p: string) { call.ops.push(["ilike", col, p]); return q; },
        neq(col: string, v: string) { call.ops.push(["neq", col, v]); return q; },
        limit(n: number) { call.ops.push(["limit", n]); return Promise.resolve(fail ? { data: null, error: { message: "boom" } } : { data: rows, error: null }); },
      };
      return q;
    },
  };
  return { client, calls };
}
await check("queries are bounded, exclude the lead itself, read only v_sales_lead_inbox, and never use .or()", async () => {
  const { client, calls } = fakeClient([cand("e1", { email: "a@x.test" })]);
  const r = await findPotentialDuplicateLeads(client, { leadId: "self", email: "A@x.test", phone: "012-345 6789" });
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.relation, "v_sales_lead_inbox");
    assert.deepEqual(c.ops.find((o) => o[0] === "limit"), ["limit", DUPLICATE_CANDIDATE_LIMIT]);
    assert.deepEqual(c.ops.find((o) => o[0] === "neq"), ["neq", "lead_metadata_id", "self"]);
    assert.ok(!c.ops.some((o) => o[0] === "or"));
  }
  assert.deepEqual(calls[0].ops.find((o) => o[0] === "ilike"), ["ilike", "email", "a@x.test"]);
  assert.equal(r.matches.length, 1);
});
await check("privacy: only rows the RLS-bound client returns can appear (restricted rows never invented)", async () => {
  // The fake client stands in for RLS: a user who cannot see a lead simply gets no row for it.
  const { client } = fakeClient([]);
  const r = await findPotentialDuplicateLeads(client, { leadId: "self", email: "a@x.test", phone: null });
  assert.deepEqual(r.matches, []);
});
await check("query failure degrades to a notice, never throws", async () => {
  const { client } = fakeClient([], true);
  const r = await findPotentialDuplicateLeads(client, { leadId: "self", email: "a@x.test", phone: null });
  assert.equal(r.failed, true);
  assert.deepEqual(r.matches, []);
});

const root = join(import.meta.dirname, "..");
const page = readFileSync(join(root, "app/admin/(protected)/sales/leads/[id]/page.tsx"), "utf8");
const notice = readFileSync(join(root, "app/admin/(protected)/sales/leads/[id]/PotentialDuplicateNotice.tsx"), "utf8");
const lib = readFileSync(join(root, "lib/sales/duplicate-lead.ts"), "utf8");
await check("unauthorized access: the lookup runs only after requireRole + requireModuleAccess(sales_leads) on the page", () => {
  const guard = page.indexOf('await requireModuleAccess("sales_leads")');
  const role = page.indexOf('await requireRole("editor")');
  const lookup = page.indexOf("findPotentialDuplicateLeads(supabase");
  assert.ok(role >= 0 && guard > role && lookup > guard);
  assert.match(page, /const supabase = await createSupabaseServerClient\(\)/);
  assert.doesNotMatch(page + lib, /createSupabaseServiceClient/);
});
await check("no new endpoint: no server action or route handler exposes duplicate search", () => {
  assert.doesNotMatch(lib, /^"use server"/m);
  assert.doesNotMatch(notice, /^"use (server|client)"/m);
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const routes = walk(join(root, "app")).filter((f) => /route\.(ts|js)$/.test(f)).map((f) => readFileSync(f, "utf8"));
  assert.ok(!routes.some((r) => r.includes("duplicate-lead") || r.includes("findPotentialDuplicateLeads")));
});
await check("warning is non-blocking and offers no merge, delete or overwrite", () => {
  assert.doesNotMatch(notice, /<form|<button|onClick|action=|\.(delete|update|insert|upsert)\(/);
  assert.match(notice, /This is a warning only/);
  assert.match(notice, /Nothing has been\s+merged or changed/);
});

console.log(`\n# s05-duplicate-lead: pass ${passed} fail 0`);
