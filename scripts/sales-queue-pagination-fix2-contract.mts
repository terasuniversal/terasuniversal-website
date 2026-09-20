import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clampPage, normalizePage, pageCountFor, pageRange, SALES_QUEUE_PAGE_SIZE } from "../lib/sales/pagination.ts";

assert.equal(SALES_QUEUE_PAGE_SIZE, 50);
assert.equal(normalizePage(undefined), 1);
assert.equal(normalizePage(""), 1);
assert.equal(normalizePage("0"), 1);
assert.equal(normalizePage("-2"), 1);
assert.equal(normalizePage("2.5"), 1);
assert.equal(normalizePage("3"), 3);
assert.deepEqual(pageRange(1), { from: 0, to: 49 });
assert.deepEqual(pageRange(2), { from: 50, to: 99 });
assert.deepEqual(pageRange(3, 25), { from: 50, to: 74 });
assert.equal(pageCountFor(0), 0);
assert.equal(pageCountFor(1), 1);
assert.equal(pageCountFor(50), 1);
assert.equal(pageCountFor(51), 2);
assert.equal(clampPage(1, 0), 1);
assert.equal(clampPage(9, 2), 2);

const tasks = await readFile(new URL("../app/admin/(protected)/sales/tasks/page.tsx", import.meta.url), "utf8");
const followUps = await readFile(new URL("../app/admin/(protected)/sales/follow-ups/page.tsx", import.meta.url), "utf8");
for (const [name, source] of [["tasks", tasks], ["follow-ups", followUps]] as const) {
  assert.ok(!source.includes("limit(200)"), `${name} retains the hidden 200-row cap`);
  assert.ok(source.includes("count: \"exact\""), `${name} must request an authoritative count`);
  assert.ok(source.includes("pageRange("), `${name} must calculate a server-side range`);
  assert.ok(source.includes("<Pagination"), `${name} must render pagination controls`);
}
assert.ok(tasks.includes('.order("id", { ascending: true })'), "tasks need a deterministic tie-breaker");
assert.ok(followUps.includes('.order("lead_metadata_id", { ascending: true })'), "follow-ups need a deterministic tie-breaker");
assert.ok(followUps.includes("&page=${page}"), "follow-up mutation return context must preserve page");
assert.ok(followUps.includes('query={{ view, owner }}'), "follow-up pagination must preserve view and owner");

console.log("Sales queue pagination Fix Pack 2 contract: PASS");
