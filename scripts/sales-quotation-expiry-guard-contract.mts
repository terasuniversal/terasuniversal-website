import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// CRM quotation expiry guard (Slice 1). The expiry rule is exercised directly with a
// fixed clock; the Server Action and screen wiring are checked as source contracts
// because they need a live session. This is NOT full backend enforcement: the
// accept_quotation RPC itself still does not check valid_until.

const { quotationExpiryState, quotationAcceptExpiryBlock, QUOTATION_EXPIRED_ACCEPT_MESSAGE } = await import("../lib/sales/quotation-workflow.ts");

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// 2026-11-18 12:00 in Malaysia (UTC+8).
const midday = new Date("2026-11-18T04:00:00Z");

check("yesterday's validity date is expired and blocks acceptance", () => {
  assert.equal(quotationExpiryState("2026-11-17", midday), "expired");
  assert.equal(quotationAcceptExpiryBlock("2026-11-17", midday), QUOTATION_EXPIRED_ACCEPT_MESSAGE);
});

check("today's validity date is still acceptable (valid through the whole day)", () => {
  assert.notEqual(quotationExpiryState("2026-11-18", midday), "expired");
  assert.equal(quotationAcceptExpiryBlock("2026-11-18", midday), null);
});

check("tomorrow's validity date is acceptable", () => {
  assert.equal(quotationAcceptExpiryBlock("2026-11-19", midday), null);
});

check("a missing validity date never blocks acceptance (no expiry)", () => {
  assert.equal(quotationExpiryState(null, midday), "none");
  assert.equal(quotationAcceptExpiryBlock(null, midday), null);
  assert.equal(quotationAcceptExpiryBlock("", midday), null);
});

check("Malaysia midnight boundary: last second of the day is not expired", () => {
  // 2026-11-18 23:59:59 MYT == 2026-11-18 15:59:59 UTC
  assert.equal(quotationAcceptExpiryBlock("2026-11-18", new Date("2026-11-18T15:59:59Z")), null);
});

check("Malaysia midnight boundary: first second of the next day is expired", () => {
  // 2026-11-19 00:00:00 MYT == 2026-11-18 16:00:00 UTC; UTC is still on the 18th.
  assert.equal(quotationAcceptExpiryBlock("2026-11-18", new Date("2026-11-18T16:00:00Z")), QUOTATION_EXPIRED_ACCEPT_MESSAGE);
});

check("UTC date alone would be wrong: early MYT morning uses the Malaysia day", () => {
  // 2026-11-19 07:30 MYT == 2026-11-18 23:30 UTC. A UTC-based check would still call
  // a 2026-11-18 quotation valid; the Malaysia calendar day says it expired.
  assert.equal(quotationExpiryState("2026-11-18", new Date("2026-11-18T23:30:00Z")), "expired");
});

check("month and year rollover", () => {
  assert.equal(quotationAcceptExpiryBlock("2026-12-31", new Date("2026-12-31T15:59:59Z")), null);
  assert.equal(quotationAcceptExpiryBlock("2026-12-31", new Date("2026-12-31T16:00:00Z")), QUOTATION_EXPIRED_ACCEPT_MESSAGE);
});

// Sources are checked out with CRLF on Windows; normalise so function bodies are
// sliced exactly and a check can never pass on text from a neighbouring function.
async function source(path: string): Promise<string> {
  return (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}
function bodyOf(text: string, signature: string): string {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  const end = text.indexOf("\n}\n", start);
  assert.ok(end > start, `end of ${signature} not found`);
  return text.slice(start, end);
}

const actions = await source("../app/admin/(protected)/sales/quotations/actions.ts");
const acceptBody = bodyOf(actions, "export async function acceptQuotationAction");

check("acceptQuotationAction keeps its admin and module guards first", () => {
  const role = acceptBody.indexOf('requireRole("admin")');
  const moduleGuard = acceptBody.indexOf('requireModuleAccess("sales_quotations", "edit")');
  const run = acceptBody.indexOf("runQuotationAccept(supabase, quotationId)");
  assert.ok(role >= 0 && moduleGuard > role && run > moduleGuard, "guards must run before the quotation is read");
});

check("acceptQuotationAction delegates to runQuotationAccept after its guards and never calls the RPC itself", () => {
  const moduleGuard = acceptBody.indexOf('requireModuleAccess("sales_quotations", "edit")');
  const run = acceptBody.indexOf("runQuotationAccept(supabase, quotationId)");
  assert.ok(run > moduleGuard, "acceptance must run after the guards");
  assert.match(acceptBody, /if \(!result\.ok\) return \{ message: result\.message \};/);
  assert.doesNotMatch(acceptBody, /rpc\("accept_quotation"/, "the action must not bypass the gated helper");
});

const workflow = await source("../lib/sales/quotation-workflow.ts");
const runBody = bodyOf(workflow, "export async function runQuotationAccept");

check("runQuotationAccept: read error, missing row and expiry all return before the RPC", () => {
  const rpc = runBody.indexOf('rpc("accept_quotation"');
  const readErr = runBody.indexOf("if (readError) return");
  const missing = runBody.indexOf("if (!existing) return");
  const expiry = runBody.indexOf("if (expiryBlock) return");
  assert.ok(rpc > 0, "RPC call not found");
  for (const [name, at] of [["read error", readErr], ["missing row", missing], ["expiry", expiry]] as const) {
    assert.ok(at >= 0 && at < rpc, `${name} check must come before the RPC`);
  }
});

check("the accept_quotation RPC call itself is unchanged", () => {
  assert.match(runBody, /supabase\.rpc\("accept_quotation", \{ p_quotation_id: quotationId \}\)/);
});

// Runtime: the real helper against a stubbed Supabase client that records the RPC.
const { runQuotationAccept, QUOTATION_ACCEPT_READ_ERROR_MESSAGE, QUOTATION_ACCEPT_NOT_FOUND_MESSAGE } = await import("../lib/sales/quotation-workflow.ts");

function stubClient(read: { data: unknown; error: unknown }, rpcError: unknown = null) {
  const calls = { rpc: [] as unknown[][], reads: 0 };
  const client = {
    from(table: string) {
      assert.equal(table, "sales_quotations");
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() { calls.reads += 1; return read; },
      };
      return builder;
    },
    async rpc(...args: unknown[]) { calls.rpc.push(args); return { data: null, error: rpcError }; },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

await checkAsync("runtime: a missing quotation never reaches the RPC", async () => {
  const { client, calls } = stubClient({ data: null, error: null });
  const result = await runQuotationAccept(client, "q-1", midday);
  assert.deepEqual(result, { ok: false, message: QUOTATION_ACCEPT_NOT_FOUND_MESSAGE });
  assert.equal(calls.rpc.length, 0);
});

await checkAsync("runtime: a failed read never reaches the RPC", async () => {
  const { client, calls } = stubClient({ data: null, error: { code: "PGRST000", message: "connection lost" } });
  const result = await runQuotationAccept(client, "q-1", midday);
  assert.deepEqual(result, { ok: false, message: QUOTATION_ACCEPT_READ_ERROR_MESSAGE });
  assert.equal(calls.rpc.length, 0);
});

await checkAsync("runtime: an expired quotation never reaches the RPC", async () => {
  const { client, calls } = stubClient({ data: { opportunity_id: "o-1", valid_until: "2026-11-17" }, error: null });
  const result = await runQuotationAccept(client, "q-1", midday);
  assert.deepEqual(result, { ok: false, message: QUOTATION_EXPIRED_ACCEPT_MESSAGE });
  assert.equal(calls.rpc.length, 0);
});

await checkAsync("runtime: a valid quotation calls accept_quotation exactly once", async () => {
  const { client, calls } = stubClient({ data: { opportunity_id: "o-1", valid_until: "2026-11-18" }, error: null });
  const result = await runQuotationAccept(client, "q-1", midday);
  assert.deepEqual(result, { ok: true, opportunityId: "o-1" });
  assert.deepEqual(calls.rpc, [["accept_quotation", { p_quotation_id: "q-1" }]]);
});

await checkAsync("runtime: a quotation without a validity date is not blocked", async () => {
  const { client, calls } = stubClient({ data: { opportunity_id: "o-1", valid_until: null }, error: null });
  const result = await runQuotationAccept(client, "q-1", midday);
  assert.equal(result.ok, true);
  assert.equal(calls.rpc.length, 1);
});

await checkAsync("runtime: an RPC error is returned, not reported as success", async () => {
  const { client } = stubClient({ data: { opportunity_id: "o-1", valid_until: "2026-11-19" }, error: null }, { message: "invalid_transition: only a sent quotation can be accepted" });
  const result = await runQuotationAccept(client, "q-1", midday);
  assert.deepEqual(result, { ok: false, message: "invalid_transition: only a sent quotation can be accepted" });
});

const panel = await source("../app/admin/(protected)/sales/quotations/[id]/QuotationActionsPanel.tsx");

check("Accept is hidden for an expired sent quotation and an explanation is shown", () => {
  assert.match(panel, /isExpired: boolean;/);
  assert.match(panel, /\{!isExpired && \(\s*<Card title="Accept">/);
  assert.match(panel, /status === "sent" && isExpired && \(\s*<Card title="Expired">/);
});

check("Create Revision stays available and is promoted when expired", () => {
  assert.match(panel, /\(status === "sent" \|\| status === "rejected" \|\| status === "expired"\) && \(\s*<Card title="Revision">/);
  assert.match(panel, /status === "sent" && isExpired \? "ta-btn-primary" : "ta-btn-outline"/);
});

const page = await source("../app/admin/(protected)/sales/quotations/[id]/page.tsx");

check("the detail page passes the shared expiry rule to the panel", () => {
  assert.match(page, /const expiry = quotationExpiryState\(q\.valid_until\);/);
  assert.match(page, /isExpired=\{expiry === "expired"\}/);
});

check("a revision draft that inherited an expired date shows a warning", () => {
  assert.match(page, /q\.status === "draft" && expiry === "expired" && \(/);
});

check("nothing extends valid_until automatically", () => {
  for (const source of [actions, panel, page, workflow]) {
    assert.doesNotMatch(source, /valid_until\s*:\s*addCalendarDays|valid_until = /);
  }
});

console.log(`\n${passed} checks passed`);
