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

const actions = await readFile(new URL("../app/admin/(protected)/sales/quotations/actions.ts", import.meta.url), "utf8");
const acceptStart = actions.indexOf("export async function acceptQuotationAction");
const acceptBody = actions.slice(acceptStart, actions.indexOf("\n}\n", acceptStart));

check("acceptQuotationAction keeps its admin and module guards first", () => {
  assert.ok(acceptStart >= 0, "acceptQuotationAction not found");
  const role = acceptBody.indexOf('requireRole("admin")');
  const moduleGuard = acceptBody.indexOf('requireModuleAccess("sales_quotations")');
  const read = acceptBody.indexOf('.from("sales_quotations")');
  assert.ok(role >= 0 && moduleGuard > role && read > moduleGuard, "guards must run before the quotation is read");
});

check("acceptQuotationAction checks expiry before calling accept_quotation", () => {
  const select = acceptBody.indexOf('select("opportunity_id, valid_until")');
  const block = acceptBody.indexOf("quotationAcceptExpiryBlock(");
  const rpc = acceptBody.indexOf('rpc("accept_quotation"');
  assert.ok(select >= 0, "valid_until must be read");
  assert.ok(block > select && rpc > block, "the expiry gate must run before the RPC");
  assert.match(acceptBody.slice(block, rpc), /if \(expiryBlock\) return \{ message: expiryBlock \};/);
});

check("acceptQuotationAction fails closed when the quotation cannot be read", () => {
  const readCheck = acceptBody.indexOf("if (readError) return");
  assert.ok(readCheck >= 0 && readCheck < acceptBody.indexOf('rpc("accept_quotation"'));
});

check("the accept_quotation RPC call itself is unchanged", () => {
  assert.match(acceptBody, /supabase\.rpc\("accept_quotation", \{ p_quotation_id: quotationId \}\)/);
});

const panel = await readFile(new URL("../app/admin/(protected)/sales/quotations/[id]/QuotationActionsPanel.tsx", import.meta.url), "utf8");

check("Accept is hidden for an expired sent quotation and an explanation is shown", () => {
  assert.match(panel, /isExpired: boolean;/);
  assert.match(panel, /\{!isExpired && \(\s*<Card title="Accept">/);
  assert.match(panel, /status === "sent" && isExpired && \(\s*<Card title="Expired">/);
});

check("Create Revision stays available and is promoted when expired", () => {
  assert.match(panel, /\(status === "sent" \|\| status === "rejected" \|\| status === "expired"\) && \(\s*<Card title="Revision">/);
  assert.match(panel, /status === "sent" && isExpired \? "ta-btn-primary" : "ta-btn-outline"/);
});

const page = await readFile(new URL("../app/admin/(protected)/sales/quotations/[id]/page.tsx", import.meta.url), "utf8");

check("the detail page passes the shared expiry rule to the panel", () => {
  assert.match(page, /const expiry = quotationExpiryState\(q\.valid_until\);/);
  assert.match(page, /isExpired=\{expiry === "expired"\}/);
});

check("a revision draft that inherited an expired date shows a warning", () => {
  assert.match(page, /q\.status === "draft" && expiry === "expired" && \(/);
});

check("nothing extends valid_until automatically", () => {
  for (const source of [actions, panel, page]) {
    assert.doesNotMatch(source, /valid_until\s*:\s*addCalendarDays|valid_until = /);
  }
});

console.log(`\n${passed} checks passed`);
