import assert from "node:assert/strict";
import test from "node:test";
import { compareSalesActivityRows } from "../lib/sales/activity-ordering.ts";
import type { SalesActivityRow } from "../lib/sales/crm.ts";

const row = (id: string, type: SalesActivityRow["type"], created_at: string): SalesActivityRow => ({
  id,
  lead_metadata_id: "lead-1",
  opportunity_id: "opportunity-1",
  quotation_id: null,
  type,
  note: null,
  actor_id: null,
  created_at,
});

test("accepted quotation precedes won opportunity at the same timestamp", () => {
  const timestamp = "2026-09-08T10:00:00.000Z";
  const sorted = [row("won", "opportunity_won", timestamp), row("accepted", "quotation_accepted", timestamp)].sort(compareSalesActivityRows);
  assert.deepEqual(sorted.map((activity) => activity.type), ["quotation_accepted", "opportunity_won"]);
});

test("cancelled quotation precedes reversed opportunity at the same timestamp", () => {
  const timestamp = "2026-09-08T10:00:00.000Z";
  const sorted = [row("reversed", "opportunity_reversed", timestamp), row("cancelled", "quotation_cancelled", timestamp)].sort(compareSalesActivityRows);
  assert.deepEqual(sorted.map((activity) => activity.type), ["quotation_cancelled", "opportunity_reversed"]);
});

test("different timestamps remain chronological", () => {
  const sorted = [
    row("later", "quotation_accepted", "2026-09-08T10:00:01.000Z"),
    row("earlier", "opportunity_won", "2026-09-08T10:00:00.000Z"),
  ].sort(compareSalesActivityRows);
  assert.deepEqual(sorted.map((activity) => activity.id), ["earlier", "later"]);
});

test("unrelated equal-timestamp events use the stable id tie-breaker", () => {
  const timestamp = "2026-09-08T10:00:00.000Z";
  const sorted = [row("z-event", "note_added", timestamp), row("a-event", "assigned", timestamp)].sort(compareSalesActivityRows);
  assert.deepEqual(sorted.map((activity) => activity.id), ["a-event", "z-event"]);
});
