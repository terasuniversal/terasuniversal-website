import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildInvoiceSearchFilter, buildQuotationSearchFilter } from "../lib/sales/search.ts";

const quotationFilter = buildQuotationSearchFilter("QA Company", ["opp-1", "opp-2"]);
assert.match(quotationFilter, /quotation_no\.ilike\.%QA Company%/);
assert.match(quotationFilter, /opportunity_id\.in\.\(opp-1,opp-2\)/);
assert.match(buildQuotationSearchFilter("QT-2026-0016", []), /quotation_no\.ilike\.%QT-2026-0016%/);
assert.doesNotMatch(buildQuotationSearchFilter("not-found", []), /opportunity_id\.in/);

const invoiceFilter = buildInvoiceSearchFilter("QA Company");
for (const field of [
  "invoice_no",
  "billing_name",
  "billing_company",
  "customer_company_name",
  "customer_contact_name",
  "quotation_number_snapshot",
]) {
  assert.match(invoiceFilter, new RegExp(`${field}\\.ilike\\.%QA Company%`));
}

const followUpsPage = await readFile("app/admin/(protected)/sales/follow-ups/page.tsx", "utf8");
const followUpForm = await readFile("app/admin/(protected)/sales/follow-ups/FollowUpInlineForm.tsx", "utf8");
const followUpAction = await readFile("app/admin/(protected)/sales/leads/actions.ts", "utf8");
assert.match(followUpsPage, /FollowUpInlineForm/);
assert.match(followUpForm, /useActionState/);
assert.match(followUpForm, /disabled=\{savePending \|\| clearPending\}/);
assert.match(followUpForm, /disabled=\{clearPending \|\| savePending\}/);
assert.match(followUpForm, /Saving…/);
assert.match(followUpForm, /Clearing…/);
assert.match(followUpForm, /ta-alert-success/);
assert.match(followUpForm, /role=\{state\.status === "success" \? "status" : "alert"\}/);
assert.match(followUpAction, /Follow-up saved\./);
assert.match(followUpAction, /Follow-up cleared\./);
assert.match(followUpAction, /status: "error"/);
assert.match(followUpAction, /returnTo\.startsWith\("\/admin\/sales\/follow-ups"\)/);
assert.match(followUpsPage, /feedback === "cleared"/);

console.log("Sales staff efficiency fix pack contracts passed: quotation/invoice search fields and follow-up pending/success/error feedback.");
