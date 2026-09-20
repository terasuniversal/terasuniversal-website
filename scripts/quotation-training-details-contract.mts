import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseQuotationTrainingDetails, quotationTrainingDetailsSchema } from "../lib/documents/quotation-training-details.ts";

const valid = {
  schema_version: 1 as const,
  programme: { course_id: null, course_name_snapshot: "Working at Height", start_date: "2026-10-01", end_date: "2026-10-02", duration_label: "2 days" },
  venue: { type: "in_house" as const, name: "Client Site", address: "Jitra" },
  participants: { count: 2, names: ["Ali Ahmad", "Siti Aminah"], tbc: false },
  accommodation: { included: true, description: "Twin sharing", nights: 1 },
  meals: { included: true, meals_per_day: 2, description: "Lunch and tea" },
  inclusions: { training_notes: true, practical_assessment: true, certificate: true, other: ["Course materials"] },
};

assert.equal(quotationTrainingDetailsSchema.safeParse(valid).success, true);
assert.deepEqual(parseQuotationTrainingDetails(valid), valid);
assert.equal(parseQuotationTrainingDetails(undefined), null, "missing legacy snapshot must be treated as absent");
assert.equal(quotationTrainingDetailsSchema.safeParse({}).success, false, "legacy {} must be treated as absent");
assert.equal(parseQuotationTrainingDetails({ ...valid, participants: { ...valid.participants, count: "not-a-number" } }), null, "malformed legacy snapshot must be ignored");
assert.equal(quotationTrainingDetailsSchema.safeParse({ ...valid, venue: { ...valid.venue, type: "external" } }).success, false);
assert.equal(quotationTrainingDetailsSchema.safeParse({ ...valid, programme: { ...valid.programme, end_date: "2026-09-30" } }).success, false);
assert.equal(quotationTrainingDetailsSchema.safeParse({ ...valid, participants: { ...valid.participants, count: 1 } }).success, false);
assert.equal(quotationTrainingDetailsSchema.safeParse({ ...valid, participants: { ...valid.participants, names: [] , tbc: true } }).success, true);
assert.equal(quotationTrainingDetailsSchema.safeParse({ ...valid, accommodation: { ...valid.accommodation, nights: 0 } }).success, false);
assert.equal(quotationTrainingDetailsSchema.safeParse({ ...valid, meals: { ...valid.meals, meals_per_day: 0 } }).success, false);
const actions = readFileSync(new URL("../app/admin/(protected)/sales/quotations/actions.ts", import.meta.url), "utf8");
const crm = readFileSync(new URL("../lib/sales/crm.ts", import.meta.url), "utf8");
const print = readFileSync(new URL("../app/admin/quotation-pdf/[id]/page.tsx", import.meta.url), "utf8");
const invoice = readFileSync(new URL("../app/admin/invoice-pdf/[id]/page.tsx", import.meta.url), "utf8");
assert.doesNotMatch(actions, /training_details:\s*d\.training_details/, "current Sales actions must not write the removed global field");
assert.match(crm, /export function computeLineTotal/);
assert.match(crm, /export function computeQuotationTotals/);
assert.match(print, /Programme Details/);
assert.match(print, /Training Package Summary/);
assert.match(print, /parseQuotationTrainingDetails/);
assert.match(invoice, /from\("sales_quotations"\)\.select\("\*"\)/);
assert.match(invoice, /parseQuotationTrainingDetails/);
assert.doesNotMatch(readFileSync(new URL("../lib/validation/schemas.ts", import.meta.url), "utf8"), /training_details:\s*quotationTrainingDetailsSchema/);
assert.match(print, /Commercial Breakdown/);
assert.match(print, /pageNumber=\{pageIndex \+ 1\}/);
assert.doesNotMatch(print, /counter\(page\)|counter\(pages\)/);
assert.doesNotMatch(print, /Page 0 of 0/);
console.log("quotation training_details contract: PASS");
