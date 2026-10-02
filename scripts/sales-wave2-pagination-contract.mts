import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clampPage, normalizePage, pageCountFor, pageRange } from "../lib/sales/pagination.ts";

assert.equal(normalizePage("-1"), 1);
assert.equal(normalizePage("999"), 999);
assert.equal(pageCountFor(0, 20), 0);
assert.equal(pageCountFor(20, 20), 1);
assert.equal(pageCountFor(41, 20), 3);
assert.equal(clampPage(2, 3), 2);
assert.equal(clampPage(99, 3), 3);
assert.equal(clampPage(99, 0), 1);
assert.deepEqual(pageRange(2, 20), { from: 20, to: 39 });
assert.deepEqual(pageRange(clampPage(99, 3), 20), { from: 40, to: 59 });

const routes = [
  ["Leads", "../app/admin/(protected)/sales/leads/page.tsx"],
  ["Opportunities", "../app/admin/(protected)/sales/opportunities/page.tsx"],
  ["Quotations", "../app/admin/(protected)/sales/quotations/page.tsx"],
] as const;
for (const [name, route] of routes) {
  const source = await readFile(new URL(route, import.meta.url), "utf8");
  assert.match(source, /normalizePage/, `${name} should normalize the requested page`);
  assert.match(source, /clampPage/, `${name} should clamp an out-of-range page against its exact count`);
  assert.match(source, /count:\s*"exact"/, `${name} should retain exact filtered counts`);
  assert.match(source, /\.order\("(?:lead_metadata_id|id)"/, `${name} should keep deterministic tie ordering`);
}

const opportunitiesSource = await readFile(new URL("../app/admin/(protected)/sales/opportunities/page.tsx", import.meta.url), "utf8");
assert.match(opportunitiesSource, /query\.range\(requestedRange\.from, requestedRange\.to\)/, "Opportunities should fetch only the clamped page range from the filtered query");
assert.doesNotMatch(opportunitiesSource, /pageRangesFor|batchRange|allRows\.push|rawRows\?\.length/, "Opportunities must not collect multiple offset ranges or use capped-response heuristics");

console.log("Sales Wave 2 pagination contract: PASS");
