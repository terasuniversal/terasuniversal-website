import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// B3 contract: the Quotations mobile card puts quotation number and customer first, then a prominent total, then
// status, expiry, dates, next action / invoice and the View action, while keeping every existing field and leaving the
// data, calculations and status logic untouched. Static source checks; rendering is covered by the responsive QA.

const [rawPage, rawCss] = await Promise.all([
  readFile("app/admin/(protected)/sales/quotations/page.tsx", "utf8"),
  readFile("app/admin/admin.css", "utf8"),
]);
const page = rawPage.replace(/\r\n/g, "\n");
const css = rawCss.replace(/\r\n/g, "\n");

const cardsStart = page.indexOf('<ul className="ta-lead-cards">');
assert.ok(cardsStart > 0, "the mobile card list and its marker are kept");
const table = page.slice(0, cardsStart);
const card = page.slice(cardsStart, page.indexOf("</ul>", cardsStart));

// 1. Desktop table is unchanged: same seven columns and the same total formatting.
assert.equal((table.match(/<th\b/g) ?? []).length, 7, "desktop table keeps its seven columns");
assert.match(table, /<td>RM \{Number\(q\.total\)\.toLocaleString\("en-MY", \{ minimumFractionDigits: 2 \}\)\}<\/td>/, "desktop total formatting is unchanged");

// 2. Hierarchy: number and customer, then total, then status, then dates, next action, invoice, action.
const order = [
  "{q.quotation_no}",
  "company_name",
  'className="ta-q-card-total"',
  "<Badge status={q.status} />",
  "QUOTATION_EXPIRY_LABELS[expiry]",
  "<span>Issued</span>",
  "<span>Next Action</span>",
  "<span>Invoice</span>",
  "View quotation",
].map((needle) => ({ needle, at: card.indexOf(needle) }));
for (const { needle, at } of order) assert.ok(at >= 0, `the card still shows ${needle}`);
const headEnd = card.indexOf('className="ta-q-card-total"');
assert.ok(card.indexOf("<Badge status={q.status} />") < headEnd, "status badge is in the header, before the total block");
const positions = ["{q.quotation_no}", "company_name", 'className="ta-q-card-total"', "<span>Issued</span>", "<span>Next Action</span>", "<span>Invoice</span>", "View quotation"].map((n) => card.indexOf(n));
assert.deepEqual([...positions].sort((a, b) => a - b), positions, "number, customer, total, dates, next action, invoice, action appear in priority order");

// 3. Nothing is dropped from the card.
for (const [needle, why] of [
  ["revisionLabel(q.revision_no)", "revision label"],
  ["Superseded; view history only", "superseded history note"],
  ["q.superseded_at &&", "superseded pill"],
  ["q.sales_opportunities?.opportunity_no", "opportunity number link"],
  ["formatMalaysiaDate(q.valid_until)", "valid-until date"],
  ["formatMalaysiaDate(q.issue_date)", "issue date"],
  ["pickNextQuotationTask", "next-action task selection (kept above the card)"],
  ["invoiceStatusLabel(invoice.status)", "invoice status cue"],
  ["paymentVisibilityLabel(invoice.status", "payment visibility cue"],
  ['aria-label={`View quotation ${q.quotation_no}`}', "per-quotation accessible name for the action"],
  ["No Follow-up", "empty next-action text"],
] as const) {
  assert.ok((needle === "pickNextQuotationTask" ? page : card).includes(needle), `${why} is kept`);
}
assert.match(card, /data-state=\{expiry\}/, "the existing expiry state drives the expiry indicator");
assert.match(card, /taskState === "overdue" \? "var\(--ta-danger\)"/, "overdue next action keeps its danger colour");

// 4. No data, calculation or status-logic change.
assert.match(page, /\.select\("\*, sales_opportunities\(opportunity_no, company_name\)", \{ count: "exact" \}\)/, "the quotation query is unchanged");
assert.match(page, /const expiry = quotationExpiryState\(q\.valid_until\);/, "expiry still comes from quotationExpiryState");
assert.ok(!/q\.total\s*[-+*/]|Number\(q\.total\)\s*[-+*/]|\.reduce\(/.test(card), "the total is displayed, never recalculated");
assert.ok(!/status\s*===|\.status\s*==|status\s*!==/.test(card), "the card adds no status logic");

// 5. Styles: the new card classes exist, wrap long values and use the existing tokens.
for (const cls of [".ta-q-card ", ".ta-q-card-head", ".ta-q-card-total", ".ta-q-card-amount", ".ta-q-card-customer", ".ta-q-card-expiry"]) assert.ok(css.includes(cls), `${cls.trim()} is styled`);
assert.match(css, /\.ta-q-card-amount \{[^}]*overflow-wrap: anywhere;[^}]*var\(--ta-navy\)/, "large totals wrap and use the navy token");
assert.match(css, /\.ta-q-card-total \{[^}]*border-left: 3px solid var\(--ta-gold\)/, "restrained gold accent on the total");
assert.match(css, /\.ta-q-card-customer \{[^}]*overflow-wrap: anywhere;/, "long customer names wrap");
assert.match(css, /\.ta-q-card \.ta-badge-pill\.sent/, "sent status is styled on the card");
assert.match(css, /\.ta-q-card \.ta-badge-pill\.accepted/, "accepted status is styled on the card");
assert.match(css, /@media \(max-width: 900px\) \{ \.ta-q-card \.ta-lead-card-action > \.ta-btn \{ min-height: 44px; \} \}/, "the View quotation link is at least 44px high at 900px and below");
assert.match(css, /@media \(max-width: 900px\) \{\s*\.ta-lead-table, \.ta-opp-table, \.ta-q-table[^}]*display: none; \}\s*\.ta-lead-cards \{ display: grid; \}/, "cards still replace the table at 900px and below");

console.log("Sales quotations card hierarchy contract passed.");
