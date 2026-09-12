import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("app/admin/(protected)/sales/quotations/actions.ts", "utf8");

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

assert.doesNotMatch(source, /createRevision[\s\S]{0,1200}course_commercial_profiles/);

console.log("Quotation revision SST snapshot source contract: PASS");
