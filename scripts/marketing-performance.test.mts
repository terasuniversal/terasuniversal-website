import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateMarketingPerformance } from "../lib/marketing/performance.ts";

const campaign = { id: "campaign-1", campaign_number: "CMP-1", name: "Test campaign", actual_spend: 100 };

test("lost, archived and cancelled opportunities are not sales-ready", () => {
  const result = calculateMarketingPerformance(
    [campaign],
    [{ lead_metadata_id: "lead-1", campaign_id: campaign.id }],
    [{ id: "lead-1", status: "new" }],
    [
      { id: "opp-lost", lead_metadata_id: "lead-1", stage: "lost" },
      { id: "opp-archived", lead_metadata_id: "lead-1", stage: "archived" },
      { id: "opp-cancelled", lead_metadata_id: "lead-1", stage: "cancelled" },
    ],
    [],
  );

  assert.equal(result.overall.salesReady, 0);
  assert.equal(result.overall.won, 0);
  assert.equal(result.overall.attributedRevenue, 0);
});

test("reversed won lead is not restored to sales-ready by stale lead status", () => {
  const result = calculateMarketingPerformance(
    [campaign],
    [{ lead_metadata_id: "lead-1", campaign_id: campaign.id }],
    [{ id: "lead-1", status: "won" }],
    [{ id: "opp-1", lead_metadata_id: "lead-1", stage: "cancelled" }],
    [{ opportunity_id: "opp-1", revision_no: 1, status: "cancelled", total: 250, accepted_at: "2026-09-07T10:00:00Z" }],
  );

  assert.equal(result.overall.salesReady, 0);
  assert.equal(result.overall.won, 0);
  assert.equal(result.overall.attributedRevenue, 0);
});

test("won happy path counts one lead and one accepted quotation revenue", () => {
  const result = calculateMarketingPerformance(
    [campaign],
    [
      { lead_metadata_id: "lead-1", campaign_id: campaign.id },
      { lead_metadata_id: "lead-1", campaign_id: campaign.id },
    ],
    [{ id: "lead-1", status: "won" }],
    [{ id: "opp-1", lead_metadata_id: "lead-1", stage: "won" }],
    [{ opportunity_id: "opp-1", revision_no: 1, status: "accepted", total: 250, accepted_at: "2026-09-07T10:00:00Z" }],
  );

  assert.equal(result.overall.leads, 1);
  assert.equal(result.overall.salesReady, 1);
  assert.equal(result.overall.won, 1);
  assert.equal(result.overall.attributedRevenue, 250);
  assert.equal(result.overall.costPerAcquisition, 100);
  assert.equal(result.overall.roas, 2.5);
});

test("accepted quotation history selects the newest accepted revision once", () => {
  const result = calculateMarketingPerformance(
    [campaign],
    [{ lead_metadata_id: "lead-1", campaign_id: campaign.id }],
    [{ id: "lead-1", status: "won" }],
    [{ id: "opp-1", lead_metadata_id: "lead-1", stage: "won" }],
    [
      { opportunity_id: "opp-1", revision_no: 1, status: "accepted", total: 200, accepted_at: "2026-09-07T09:00:00Z" },
      { opportunity_id: "opp-1", revision_no: 2, status: "accepted", total: 250, accepted_at: "2026-09-07T10:00:00Z" },
    ],
  );

  assert.equal(result.overall.attributedRevenue, 250);
});

test("reversal activity types have defined timeline labels and icons", () => {
  const crmSource = readFileSync(new URL("../lib/sales/crm.ts", import.meta.url), "utf8");
  assert.match(crmSource, /quotation_cancelled: "↩️"/);
  assert.match(crmSource, /opportunity_reversed: "↪️"/);
  assert.match(crmSource, /quotation_cancelled: "Quotation cancelled"/);
  assert.match(crmSource, /opportunity_reversed: "Opportunity reversed"/);
});

test("Sales Reports includes cancelled quotations in the status distribution", () => {
  const reportSource = readFileSync(new URL("../app/admin/(protected)/sales/reports/page.tsx", import.meta.url), "utf8");
  assert.match(reportSource, /\[\"draft\", \"sent\", \"accepted\", \"rejected\", \"expired\", \"superseded\", \"cancelled\"\]/);
});

test("revenue integrity migration contains the Round 3 guards", () => {
  const migrationSource = readFileSync(new URL("../supabase/migrations/20260907034620_sales_revenue_integrity_hardening.sql", import.meta.url), "utf8");
  assert.match(migrationSource, /quotation_opportunity_changed_during_acceptance/);
  assert.match(migrationSource, /source_quotation_id = v_quotation_id/);
  assert.match(migrationSource, /ip\.status in \('pending', 'successful'\)/);
});
