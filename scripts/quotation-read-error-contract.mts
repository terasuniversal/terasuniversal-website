import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/admin/quotation-pdf/[id]/page.tsx", import.meta.url), "utf8");
const quotationRead = source.indexOf("const { data: quotation, error: quotationError }");
const quotationErrorGuard = source.indexOf("if (quotationError) return <QuotationReadFailure />;");
const quotationNotFound = source.indexOf("if (!quotation) notFound();");
const opportunityRead = source.indexOf("const { data: opportunity, error: opportunityError }");
const opportunityErrorGuard = source.indexOf("if (opportunityError) return <QuotationReadFailure />;");
const companyRead = source.indexOf("const { data: company, error: companyError }");
const companyErrorGuard = source.indexOf("if (companyError) return <QuotationReadFailure />;");
const itemsRead = source.indexOf("const { data: itemRows, error: itemsError }");
const itemsErrorGuard = source.indexOf("if (itemsError) return <QuotationReadFailure />;");
const itemFallback = source.indexOf("const items = (itemRows ?? [])");
const normalQuotation = source.indexOf("return <div className=\"quotation-print-root\">");
const totals = source.indexOf("className=\"quotation-print-totals\"");

for (const [name, index] of [
  ["quotation read", quotationRead], ["quotation error guard", quotationErrorGuard],
  ["opportunity read", opportunityRead], ["opportunity error guard", opportunityErrorGuard],
  ["company read", companyRead], ["company error guard", companyErrorGuard],
  ["items read", itemsRead], ["items error guard", itemsErrorGuard],
  ["normal quotation output", normalQuotation], ["commercial totals", totals],
] as const) {
  assert.ok(index >= 0, `${name} exists`);
}

assert.ok(quotationRead < quotationErrorGuard && quotationErrorGuard < quotationNotFound, "quotation query errors fail before valid missing-record notFound handling");
assert.ok(opportunityRead < opportunityErrorGuard && opportunityErrorGuard < companyRead, "opportunity query errors fail before company/customer rendering");
assert.ok(companyRead < companyErrorGuard && companyErrorGuard < itemsRead, "company query errors fail before item and totals rendering");
assert.ok(itemsRead < itemsErrorGuard && itemsErrorGuard < itemFallback, "item query errors fail before empty-item fallback");
assert.ok(itemFallback < normalQuotation && normalQuotation < totals, "successful reads retain the existing normal quotation and totals output");
assert.match(source, /function QuotationReadFailure\(\)[\s\S]*?role="alert"[\s\S]*?This quotation was not generated[\s\S]*?no totals or printable quotation are available/);
assert.match(source, /opportunity\?\.company_id[\s\S]*?: \{ data: null, error: null \}/, "missing optional company relationship remains a valid null result");
assert.match(source, /if \(!quotation\) notFound\(\)/, "a valid query with no quotation remains not-found");
assert.match(source, /const items = \(itemRows \?\? \[\]\)/, "a valid empty item result retains existing behavior");

console.log("Quotation read-error fail-closed contract: PASS");
