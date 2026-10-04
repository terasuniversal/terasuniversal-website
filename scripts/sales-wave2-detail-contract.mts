import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../app/admin/(protected)/sales/", import.meta.url);
const [leadDetail, leadActions, opportunityDetail, quotationDetail] = await Promise.all([
  readFile(new URL("leads/[id]/page.tsx", root), "utf8"),
  readFile(new URL("leads/[id]/LeadActionsPanel.tsx", root), "utf8"),
  readFile(new URL("opportunities/[id]/page.tsx", root), "utf8"),
  readFile(new URL("quotations/[id]/page.tsx", root), "utf8"),
]);

assert.match(leadDetail, /href=\"#lead-primary-action\"/, "Lead detail should make its primary workflow action directly reachable from the header");
assert.match(leadActions, /id=\"lead-primary-action\"/, "Lead conversion action should have a stable in-page target");
assert.match(leadDetail, /ta-lead-actions-first/, "Lead actions should precede secondary handoff/context cards");
assert.match(opportunityDetail, /ta-sales-summary/, "Opportunity stage, value, owner and close context should be summarized before detail cards");
assert.match(opportunityDetail, /ta-btn-primary ta-btn-sm/, "Opportunity's primary state-appropriate action should be prominent");
assert.match(quotationDetail, /ta-quotation-summary/, "Quotation identity, status, total and customer relationship should be grouped clearly");
assert.match(quotationDetail, /ta-quotation-primary-action/, "Quotation action panel should be clearly identified as state-dependent workflow");
for (const [name, source] of [["Lead", leadDetail], ["Opportunity", opportunityDetail], ["Quotation", quotationDetail]] as const) {
  assert.match(source, /ReadErrorState/, `${name} detail should surface failed reads instead of implying empty data`);
}
assert.match(opportunityDetail, /quotationsResult\.error/, "Opportunity quotation history should distinguish a read failure from no quotations");
assert.match(quotationDetail, /itemReadError/, "Quotation editor should not offer an empty editor when line-item reads fail");

console.log("Sales Wave 2 detail hierarchy contract: PASS");
