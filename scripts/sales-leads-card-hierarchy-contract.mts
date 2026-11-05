import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// B2 contract: the Leads mobile card leads with the contact name and status, then source and qualification chips,
// follow-up and next action, and a View action with a 44px target, while keeping every existing field and leaving
// queries, filters, qualification and follow-up logic and the desktop table untouched. Static source checks; rendering
// is covered by the responsive QA.

const [rawTable, rawPage, rawCss] = await Promise.all([
  readFile("app/admin/(protected)/sales/leads/LeadInboxTable.tsx", "utf8"),
  readFile("app/admin/(protected)/sales/leads/page.tsx", "utf8"),
  readFile("app/admin/admin.css", "utf8"),
]);
const table = rawTable.replace(/\r\n/g, "\n");
const page = rawPage.replace(/\r\n/g, "\n");
const css = rawCss.replace(/\r\n/g, "\n");

const cardsStart = table.indexOf('<ul className="ta-lead-cards">');
assert.ok(cardsStart > 0, "the mobile card list and its marker are kept");
const desktop = table.slice(0, cardsStart);
const card = table.slice(cardsStart);

// 1. Desktop table is unchanged: same eight columns and the same cells.
assert.equal((desktop.match(/<th\b/g) ?? []).length, 8, "desktop table keeps its eight columns");
for (const needle of ["Lead / Enquiry", "Status / Qualification", "Activity / Age", "Owner unavailable", "staffNames.get(r.assigned_to)", "ageLabel(r.created_at)"]) {
  assert.ok(desktop.includes(needle), `desktop table still has ${needle}`);
}

// 2. Priority order inside the card: name and status, subject, source and chips, follow-up and next action, owner, View.
const order = [
  "ta-lead-m-name",
  "<Badge status={r.status} />",
  "ta-lead-m-subject",
  "SOURCE_LABELS[r.lead_source]",
  "Qualification <b>",
  "Temperature <b>",
  "Priority <b>",
  "<span>Follow-up</span>",
  "<span>Next Action</span>",
  "<span>Owner</span>",
  "<span>Last activity</span>",
  "View lead",
].map((needle) => ({ needle, at: card.indexOf(needle) }));
for (const { needle, at } of order) assert.ok(at >= 0, `the card still shows ${needle}`);
assert.deepEqual([...order.map((o) => o.at)].sort((a, b) => a - b), order.map((o) => o.at), "card fields appear in priority order");

// 3. Nothing is dropped from the card.
for (const [needle, why] of [
  ["r.contact_name", "contact name"],
  ["r.company", "company"],
  ["r.is_test", "test marker"],
  ["No enquiry subject", "empty subject text"],
  ["qualificationLabel(qualificationByLead.get(r.lead_metadata_id)?.qualification_status)", "qualification"],
  ["temperatureLabel(qualificationByLead.get(r.lead_metadata_id)?.temperature)", "temperature"],
  ["PRIORITY_LABELS[r.priority]", "priority"],
  ["<FollowUpBadge state={followUpState(r.follow_up_at, r.status)} />", "follow-up state"],
  ["formatMalaysiaDate(r.follow_up_at)", "follow-up date"],
  ["nextActions.get(r.lead_metadata_id)!.title", "next action title"],
  ["/admin/sales/tasks/${nextActions.get(r.lead_metadata_id)!.id}", "next action link"],
  ["Owner unavailable", "owner failure state"],
  ["Unassigned", "unassigned owner"],
  ["daysSinceActivityLabel(lastActivityByLead.get(r.lead_metadata_id) ?? null)", "last activity"],
  ["/admin/sales/leads/${r.lead_metadata_id}", "lead detail destination"],
  ["aria-label={`View lead ${r.contact_name ?? r.company ?? \"\"}`.trim()}", "per-lead accessible name for the action"],
] as const) {
  assert.ok(card.includes(needle), `${why} is kept`);
}

// 4. No logic change: the page query, filters and follow-up and qualification rules are untouched.
assert.match(page, /\.from\("v_sales_lead_inbox"\)/, "the lead query is unchanged");
assert.match(page, /sp\.followup === "overdue"/, "follow-up filters are unchanged");
assert.match(page, /buildAssigneeFilterState/, "assignee filter is unchanged");
assert.ok(!/status\s*===|\.status\s*==|qualification_status\s*===|followUpState\([^)]*\)\s*===/.test(card), "the card adds no status, qualification or follow-up logic");

// 5. Styles: classes exist, wrap long values, use existing tokens, and the View link is 44px at 900px and below.
for (const cls of [".ta-lead-m ", ".ta-lead-m-head", ".ta-lead-m-name", ".ta-lead-m-meta", ".ta-lead-m-chip", ".ta-lead-m-grid"]) assert.ok(css.includes(cls), `${cls.trim()} is styled`);
assert.match(css, /\.ta-lead-m-id \{[^}]*overflow-wrap: anywhere;/, "long names and company text wrap");
assert.match(css, /\.ta-lead-m-subject \{[^}]*overflow-wrap: anywhere;/, "long subjects and emails wrap");
assert.match(css, /\.ta-lead-m-grid \{[^}]*minmax\(0, 1fr\)/, "value column can shrink");
assert.match(css, /@media \(max-width: 900px\) \{ \.ta-lead-m \.ta-lead-card-action > \.ta-btn \{ min-height: 44px; \} \}/, "the View lead link is at least 44px high at 900px and below");
assert.match(css, /@media \(max-width: 900px\) \{\s*\.ta-lead-table, \.ta-opp-table, \.ta-q-table[^}]*display: none; \}\s*\.ta-lead-cards \{ display: grid; \}/, "cards still replace the table at 900px and below");

console.log("Sales leads card hierarchy contract passed.");
