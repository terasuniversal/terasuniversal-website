import assert from "node:assert/strict";
import { register } from "node:module";
import { readFile } from "node:fs/promises";

const loader = `export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\\.(?:c|m)?[jt]s$/.test(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    throw error;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const {
  fetchSalesRowsByIdsInBatches,
  fetchSalesRowsInPages,
  filterActiveOpenOpportunities,
  qualifiedNowLeadIds,
  isCurrentActiveTask,
  isCurrentLeadFollowUp,
} = await import("../lib/sales/active-state.ts");
const { buildMonthlyTrend, isTaskInArchivedReportChain, resolveReportArchiveState, resolveReportDateRange } = await import("../lib/sales/reports.ts");

const dashboard = await readFile(new URL("../app/admin/(protected)/sales/page.tsx", import.meta.url), "utf8");
const leadsPage = await readFile(new URL("../app/admin/(protected)/sales/leads/page.tsx", import.meta.url), "utf8");
const leadsExport = await readFile(new URL("../app/admin/(protected)/sales/leads/export/route.ts", import.meta.url), "utf8");
const opportunitiesPage = await readFile(new URL("../app/admin/(protected)/sales/opportunities/page.tsx", import.meta.url), "utf8");
const reportsPage = await readFile(new URL("../app/admin/(protected)/sales/reports/page.tsx", import.meta.url), "utf8");
const reportsExport = await readFile(new URL("../app/admin/(protected)/sales/reports/export/route.ts", import.meta.url), "utf8");
const tasksPage = await readFile(new URL("../app/admin/(protected)/sales/tasks/page.tsx", import.meta.url), "utf8");
const followUpsPage = await readFile(new URL("../app/admin/(protected)/sales/follow-ups/page.tsx", import.meta.url), "utf8");
const activeStateSource = await readFile(new URL("../lib/sales/active-state.ts", import.meta.url), "utf8");

function sliceBetween(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.notEqual(start, -1, `${label}: start marker exists`);
  assert.notEqual(end, -1, `${label}: end marker exists`);
  assert.ok(end > start, `${label}: end marker follows start marker`);
  return source.slice(start, end);
}

const activeLead = { id: "lead-active", status: "qualified" };
const archivedLead = { id: "lead-archived", status: "archived" };
const openOpportunity = { id: "opp-open", lead_metadata_id: activeLead.id, stage: "qualified" };
const archivedLeadOpportunity = { id: "opp-on-archived-lead", lead_metadata_id: archivedLead.id, stage: "qualified" };
const archivedOpportunity = { id: "opp-archived", lead_metadata_id: activeLead.id, stage: "archived" };
const archivedLeadIds = new Set([archivedLead.id]);

assert.deepEqual(filterActiveOpenOpportunities([openOpportunity], archivedLeadIds), [openOpportunity], "A: active lead with open opportunity counts");
assert.deepEqual(filterActiveOpenOpportunities([archivedLeadOpportunity], archivedLeadIds), [], "B: open opportunity under archived lead is excluded");
assert.deepEqual(qualifiedNowLeadIds([activeLead], [archivedOpportunity]), new Set(), "C: an active lead with only archived opportunities is not qualified now");
assert.deepEqual(qualifiedNowLeadIds([archivedLead], [openOpportunity]), new Set(), "D: an archived lead is not qualified now");

const pageRanges: Array<[number, number]> = [];
const pagedRows = await fetchSalesRowsInPages<number>(1201, async (from, to) => {
  pageRanges.push([from, to]);
  return { data: Array.from({ length: Math.min(to - from + 1, 1201 - from) }, (_, index) => from + index), error: null };
});
assert.deepEqual(pageRanges, [[0, 499], [500, 999], [1000, 1499]], "counted source rows are fetched with bounded 500-row pages");
assert.equal(pagedRows.rows.length, 1201, "paged collection does not truncate at the API row cap");
const idBatchSizes: number[] = [];
const batchedRows = await fetchSalesRowsByIdsInBatches<{ id: string }>(Array.from({ length: 213 }, (_, index) => `id-${index}`), async (batch) => {
  idBatchSizes.push(batch.length);
  return { data: batch.map((id) => ({ id })), error: null };
});
assert.deepEqual(idBatchSizes, [100, 100, 13], "archive lookups keep PostgREST ID filters bounded");
assert.equal(batchedRows.rows.length, 213, "batched archive lookup preserves every referenced row");

const monthRange = resolveReportDateRange("this_month", undefined, new Date("2026-10-05T04:00:00.000Z"));
const historicalTrend = buildMonthlyTrend({
  range: monthRange,
  leads: [{ id: archivedLead.id, created_at: "2026-10-02T04:00:00.000Z" }],
  qualifiedLeadIds: new Set(),
  opps: [],
  quotationsSent: [],
  won: [{ id: "opp-won-historical", won_at: "2026-10-03T04:00:00.000Z" }],
  lost: [],
  accepted: [{ opportunity_id: "opp-accepted-historical", total: 1250, accepted_at: "2026-10-03T05:00:00.000Z" }],
});
assert.equal(historicalTrend[0]?.won, 1, "E: archiving a source lead does not erase the Won event");
assert.equal(historicalTrend[0]?.acceptedQuotationValue, 1250, "F: accepted quotation value remains historical under an archived chain");

const taskContext = {
  archivedLeadIds: new Set([archivedLead.id]),
  archivedOpportunityIds: new Set([archivedOpportunity.id]),
  opportunityLeadById: new Map([[openOpportunity.id, activeLead.id], [archivedLeadOpportunity.id, archivedLead.id], [archivedOpportunity.id, activeLead.id]]),
  quotationOpportunityById: new Map([["quote-archived", archivedOpportunity.id]]),
};
const task = (overrides: Record<string, unknown> = {}) => ({
  status: "open", deleted_at: null, lead_metadata_id: null, opportunity_id: null, quotation_id: null, ...overrides,
});
assert.equal(isCurrentActiveTask(task({ lead_metadata_id: archivedLead.id }), taskContext), false, "G: task linked to archived lead is excluded");
assert.equal(isCurrentActiveTask(task({ opportunity_id: archivedOpportunity.id }), taskContext), false, "H: task linked to archived opportunity is excluded");
assert.equal(isCurrentActiveTask(task(), taskContext), true, "I: generic unlinked task remains active");
assert.equal(isCurrentActiveTask(task({ opportunity_id: archivedLeadOpportunity.id }), taskContext), false, "task linked to an opportunity under an archived lead is excluded");
assert.equal(isCurrentActiveTask(task({ quotation_id: "quote-archived" }), taskContext), false, "task linked through an archived quotation chain is excluded");
assert.equal(isCurrentActiveTask(task({ opportunity_id: openOpportunity.id, quotation_id: "quote-archived" }), taskContext), false, "all linked task chains are checked when multiple links are present");
assert.equal(isCurrentActiveTask(task({ deleted_at: "2026-10-01T00:00:00Z" }), taskContext), false, "soft-deleted task is excluded");
assert.equal(isCurrentActiveTask(task({ status: "completed" }), taskContext), false, "completed task is excluded from active queues");
assert.equal(isCurrentActiveTask(task({ status: "cancelled" }), taskContext), false, "cancelled task is excluded from active queues");

assert.equal(isCurrentLeadFollowUp("archived", "2026-10-05T04:00:00Z"), false, "J: archived lead follow-up is excluded");
assert.equal(isCurrentLeadFollowUp("qualified", "2026-10-05T04:00:00Z"), true, "K: active lead follow-up remains visible regardless of unrelated archived opportunities");
assert.equal(isCurrentLeadFollowUp("qualified", null), false, "lead without follow-up is not queued");
const reportArchiveState = resolveReportArchiveState(
  [activeLead],
  [archivedOpportunity],
  [activeLead],
  [archivedOpportunity],
);
assert.equal(reportArchiveState.excludedLeadIds.has(activeLead.id), false, "active Lead-level workload remains despite an archived Opportunity");
assert.equal(reportArchiveState.excludedOppIds.has(archivedOpportunity.id), true, "archived Opportunity is excluded from active Opportunity workload");
assert.equal(isTaskInArchivedReportChain(task({ lead_metadata_id: activeLead.id }), reportArchiveState, new Map()), false, "active Lead-linked task remains when only an unrelated Opportunity is archived");
assert.equal(isTaskInArchivedReportChain(task({ opportunity_id: archivedOpportunity.id }), reportArchiveState, new Map()), true, "task linked to archived Opportunity is excluded from Reports workload");
assert.equal(isTaskInArchivedReportChain(task(), reportArchiveState, new Map()), false, "generic unlinked report task remains active");
const archivedLeadState = resolveReportArchiveState(
  [archivedLead],
  [archivedLeadOpportunity],
  [archivedLead],
  [archivedLeadOpportunity],
);
assert.equal(archivedLeadState.excludedLeadIds.has(archivedLead.id), true, "archived Lead is excluded from current workload");
assert.equal(archivedLeadState.excludedOppIds.has(archivedLeadOpportunity.id), true, "opportunity linked to archived Lead is excluded from current workload");
assert.equal(isTaskInArchivedReportChain(task({ lead_metadata_id: archivedLead.id }), archivedLeadState, new Map()), true, "task linked directly to archived Lead is excluded from Reports workload");
assert.equal(isTaskInArchivedReportChain(task({ quotation_id: "quote-archived" }), reportArchiveState, new Map([["quote-archived", archivedOpportunity.id]])), true, "quotation-linked task is excluded when its Opportunity is archived");

assert.match(leadsPage, /\.neq\("status", "archived"\)/, "L: default Leads view excludes archived leads");
assert.match(leadsPage, /sp\.status\s*===\s*"archived"[\s\S]*?\.eq\("status",\s*"archived"\)/, "M: explicit archived status filter remains available");
assert.match(leadsExport, /\.neq\("status", "archived"\)/, "Lead export defaults to non-archived records");
assert.match(leadsExport, /p\.get\("status"\)\s*===\s*"archived"[\s\S]*?\.eq\("status",\s*"archived"\)/, "Lead export preserves an explicit archived filter");
assert.doesNotMatch(opportunitiesPage, /label="Open Pipeline Value"|label="Weighted Pipeline"/, "N: non-authoritative aggregate pipeline KPIs are absent");
assert.match(opportunitiesPage, /filterActiveOpenOpportunities/, "Opportunity active summary uses source-Lead archive filtering");
assert.match(opportunitiesPage, /else if \(sp\.state !== "resolved"\) query = query\.neq\("stage", "archived"\)/, "default Opportunities list excludes archived stage records");
assert.match(opportunitiesPage, /archivedLeadOpenOpportunityIds\.join\("[,]"\)|archivedLeadOpenOpportunityIds\.join\(","\)/, "default/open Opportunities list excludes open records under archived Leads");
assert.match(reportsPage, /qualifiedNowLeadIds/, "Reports use the shared current-state qualification helper");
assert.match(reportsExport, /qualifiedNowLeadIds/, "CSV uses the same current-state qualification helper");
assert.match(reportsPage, /buildMonthlyTrend/, "Reports retain the shared monthly event aggregation");
assert.match(reportsExport, /buildMonthlyTrend/, "CSV retains the shared monthly event aggregation");
const reportWonQuery = sliceBetween(reportsPage, "const wonOpportunitiesQuery", "const lostOpportunitiesQuery", "Historical Won query");
const reportAcceptedQuery = sliceBetween(reportsPage, "const acceptedQuotationsQuery", "const wonOpportunitiesQuery", "Historical accepted quotation query");
assert.match(reportWonQuery, /\.eq\("stage", "won"\)[\s\S]*?\.gte\("won_at"/, "Reports preserve historical Won events by won_at");
assert.doesNotMatch(reportWonQuery, /archived/i, "Reports do not exclude historical Won events by archive state");
assert.match(reportAcceptedQuery, /\.eq\("status", "accepted"\)[\s\S]*?\.gte\("accepted_at"/, "Reports preserve historical accepted quotation value by accepted_at");
assert.doesNotMatch(reportAcceptedQuery, /archived/i, "Reports do not exclude historical accepted quotation events by archive state");
assert.match(reportsExport, /\.eq\("stage", "won"\)[\s\S]*?\.gte\("won_at"/, "CSV preserves historical Won events by won_at");
assert.match(reportsExport, /\.eq\("status", "accepted"\)[\s\S]*?\.gte\("accepted_at"/, "CSV preserves historical accepted quotation value by accepted_at");
assert.match(dashboard, /filterActiveOpenOpportunities/, "Dashboard Open Opportunities excludes archived source Leads");
assert.match(dashboard, /isCurrentActiveTask/, "Dashboard task counts exclude archived operational chains");
assert.match(dashboard, /openOpportunitiesQuery = supabase\.from\("sales_opportunities"\)\.select\("id", \{ count: "exact", head: true \}\)/, "Dashboard retains an exact server-side Open Opportunities count");
assert.match(dashboard, /fetchSalesRowsInPages/, "Dashboard archive-aware counts use real bounded pagination");
assert.match(dashboard, /\.not\("status", "in", "\(won,lost,archived\)"\)/, "Dashboard follow-ups remain lead-level and exclude archived Leads");
assert.match(tasksPage, /isCurrentActiveTask/, "Active task queue excludes archived operational chains");
assert.match(tasksPage, /fetchSalesRowsInPages/, "Task archive filtering scans candidates through bounded pages");
assert.match(tasksPage, /Completed is a history surface; keep archived-chain records accessible here\./, "Completed task history remains available by design");
assert.match(followUpsPage, /isCurrentLeadFollowUp/, "Follow-up queue filters only lead-level archive/status state");
assert.match(activeStateSource, /SALES_STATE_ID_BATCH_SIZE = 100/, "Task archive lookups batch related-record ids to bounded queries");

console.log("Sales owner archive/current-state semantics contract: PASS (A–N plus archive-chain task cases).");
