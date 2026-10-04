import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const [leadList, oppList, quotationList, leadTable, oppTable, editor, css] = await Promise.all([
  read("app/admin/(protected)/sales/leads/page.tsx"),
  read("app/admin/(protected)/sales/opportunities/page.tsx"),
  read("app/admin/(protected)/sales/quotations/page.tsx"),
  read("app/admin/(protected)/sales/leads/LeadInboxTable.tsx"),
  read("app/admin/(protected)/sales/opportunities/OpportunityTable.tsx"),
  read("app/admin/(protected)/sales/quotations/QuotationItemsEditor.tsx"),
  read("app/admin/admin.css"),
]);

function desktopHeaderCount(source: string): number {
  const table = source.slice(0, source.indexOf("<ul className=\"ta-lead-cards\">") >= 0 ? source.indexOf("<ul className=\"ta-lead-cards\">") : source.length);
  const header = table.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
  return (header.match(/<th\b/g) ?? []).length;
}

assert.ok(desktopHeaderCount(leadTable) <= 9, "Leads desktop table should prioritize triage fields, not render 15 competing columns");
assert.match(leadTable, /staffNamesUnavailable/, "Lead owner failures should not render assigned owners as a blank or em dash");
assert.ok(desktopHeaderCount(oppTable) <= 9, "Opportunities desktop table should keep its primary scan fields to a compact set");
assert.match(oppTable, /staffNamesUnavailable/, "Opportunity owner failures should not be rendered as unassigned or a blank owner");
for (const [name, source, label] of [["Leads", leadList, "Lead"], ["Opportunities", oppList, "Opportunity"], ["Quotations", quotationList, "Quotation"]] as const) {
  assert.match(source, /<ListToolbar/, `${name} should use the shared list toolbar`);
  assert.match(source, /ta-filter-summary/, `${name} should make active filters visible with a clear-all affordance`);
  assert.match(source, new RegExp(`role="group" aria-label="${label} filters"`), `${name} filter controls should be grouped for scanning and assistive technology`);
}
assert.match(quotationList, /ReadErrorState/, "Quotation read failures should not render as an empty list");
const quotationStatusStart = quotationList.indexOf('<select name="status"');
const quotationStatusEnd = quotationList.indexOf("</select>", quotationStatusStart);
assert.ok(quotationStatusStart >= 0 && quotationStatusEnd > quotationStatusStart, "Quotation status filter markup should exist");
const quotationStatusFilter = quotationList.slice(quotationStatusStart, quotationStatusEnd);
assert.ok(quotationStatusFilter.includes('padding: "9px 10px"'), "Quotation status filter should keep the visible control padding");
assert.ok(quotationStatusFilter.includes("borderRadius: 9"), "Quotation status filter should keep its rounded border");
assert.ok(quotationStatusFilter.includes('border: "1px solid var(--ta-line)"'), "Quotation status filter should keep the shared border color");
assert.match(editor, /aria-label=\{`Quantity for line/, "Each line quantity control should have a contextual accessible name");
assert.match(editor, /aria-label=\{`Unit price for line/, "Each line unit price control should have a contextual accessible name");
assert.match(editor, /id="quotation-items-error"/, "Line-item validation errors should have a stable description target");
assert.match(editor, /aria-invalid=\{Boolean\(state\.errors\?\.items\)\}/, "Line-item validation state should be exposed to assistive technology");
assert.match(editor, /aria-describedby=\{state\.errors\?\.items/, "Line-item controls should reference their visible validation message");
assert.match(editor, /ta-quotation-editor-table/, "Quotation lines should have a mobile-specific reflow hook");
assert.match(editor, /role="alert"/, "Quotation editor validation errors should be announced");
assert.match(editor, /server-calculated/, "The totals preview should state that saved totals are server-calculated");
assert.match(css, /\.ta-filter-summary/, "Active-filter summary needs shared styling");
assert.match(css, /\.ta-quotation-editor-table/, "Quotation editor needs responsive line-item styling");

console.log("Sales Wave 2 UI contract: PASS");
