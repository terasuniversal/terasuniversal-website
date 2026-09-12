import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("app/admin/invoice-pdf/[id]/page.tsx", "utf8");

assert.match(source, /\/teras-universal-logo\.png/);
assert.match(source, /TERAS UNIVERSAL SDN\. BHD\./);
assert.match(source, /201201003207 \(976732-P\)/);
assert.match(source, /Lot 1961, Jalan Tanah Merah/);
assert.match(source, /Training \/ Service Address/);
assert.match(source, /const showTax =/);
assert.match(source, /\{showTax &&/);
assert.match(source, /function fmtTaxRate/);
assert.match(source, /taxDisplayLabel\(inv\.tax_label_snapshot, Number\(inv\.tax_rate\)\)/);
assert.doesNotMatch(source, /SST 6%/);
assert.match(source, /p\.payment_source === "hrdf" \? "HRDF"/);
assert.doesNotMatch(source, /202201038223 \(1477529-X\)/);

const detailSource = await readFile("app/admin/(protected)/invoices/[id]/page.tsx", "utf8");
assert.match(detailSource, /ta-invoice-mobile-items/);
assert.match(detailSource, /ta-invoice-mobile-payments/);
assert.match(detailSource, /taxDisplayLabel\(inv\.tax_label_snapshot, Number\(inv\.tax_rate\)\)/);

console.log("Invoice corporate PDF source contract: PASS");
