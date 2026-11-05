import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const actions = await readFile("app/admin/(protected)/sales/quotations/actions.ts", "utf8");
// The revision sequence (and so the SST snapshot copy) lives in lib/sales/quotation-revision.ts; the action delegates to it.
const source = await readFile("lib/sales/quotation-revision.ts", "utf8");
assert.match(actions, /runQuotationRevision\(supabase, \{ quotationId, actorId: profile\.id \}\)/, "createRevision delegates to the revision helper");

for (const field of [
  "sst_applicable",
  "sst_rate",
  "sst_amount",
  "tax_label_snapshot",
  "tax_basis_snapshot",
  "sst_registration_number_snapshot",
  "sst_effective_date_snapshot",
]) {
  assert.match(source, new RegExp(`${field}: source\\.${field}`));
}

assert.doesNotMatch(actions, /createRevision[\s\S]{0,1200}course_commercial_profiles/);
assert.doesNotMatch(source, /course_commercial_profiles/, "a revision copies the stored snapshots; it never re-reads the course profile");

console.log("Quotation revision SST snapshot source contract: PASS");
