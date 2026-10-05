import type { createSupabaseServerClient } from "../supabase/server";
import { OPEN_OPPORTUNITY_STAGES, type SalesOpportunityStage, type SalesTaskRow } from "./crm";

const QUALIFIED_LEAD_STATUSES = new Set(["qualified", "proposal_sent", "negotiation", "won", "lost"]);
const INACTIVE_TASK_STATUSES = new Set(["completed", "cancelled"]);
const SALES_STATE_PAGE_SIZE = 500;
const SALES_STATE_ID_BATCH_SIZE = 100;

export async function fetchSalesRowsInPages<T>(
  total: number,
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown | null }>,
): Promise<{ rows: T[]; error: unknown | null }> {
  const rows: T[] = [];
  for (let from = 0; from < total; from += SALES_STATE_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + SALES_STATE_PAGE_SIZE - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < SALES_STATE_PAGE_SIZE) break;
  }
  return { rows, error: null };
}

export async function fetchSalesRowsByIdsInBatches<T>(
  ids: readonly string[],
  loadBatch: (batch: string[]) => PromiseLike<{ data: T[] | null; error: unknown | null }>,
): Promise<{ rows: T[]; error: unknown | null }> {
  const rows: T[] = [];
  for (let from = 0; from < ids.length; from += SALES_STATE_ID_BATCH_SIZE) {
    const { data, error } = await loadBatch(ids.slice(from, from + SALES_STATE_ID_BATCH_SIZE));
    if (error) return { rows, error };
    rows.push(...(data ?? []));
  }
  return { rows, error: null };
}

export interface ActiveStateLead {
  id: string;
  status: string;
}

export interface ActiveStateOpportunity {
  id: string;
  lead_metadata_id: string;
  stage: SalesOpportunityStage;
}

export function filterActiveOpenOpportunities<T extends ActiveStateOpportunity>(
  opportunities: readonly T[],
  archivedLeadIds: ReadonlySet<string>,
): T[] {
  return opportunities.filter((opportunity) =>
    OPEN_OPPORTUNITY_STAGES.includes(opportunity.stage)
    && !archivedLeadIds.has(opportunity.lead_metadata_id),
  );
}

/** Applies the existing status-or-opportunity qualification model to active current state. */
export function qualifiedNowLeadIds(
  leads: readonly ActiveStateLead[],
  opportunities: readonly ActiveStateOpportunity[],
): Set<string> {
  const opportunitiesByLead = new Map<string, ActiveStateOpportunity[]>();
  for (const opportunity of opportunities) {
    const rows = opportunitiesByLead.get(opportunity.lead_metadata_id) ?? [];
    rows.push(opportunity);
    opportunitiesByLead.set(opportunity.lead_metadata_id, rows);
  }

  const qualified = new Set<string>();
  for (const lead of leads) {
    if (lead.status === "archived") continue;
    const linkedOpportunities = opportunitiesByLead.get(lead.id) ?? [];
    const hasActiveOpportunity = linkedOpportunities.some((opportunity) => opportunity.stage !== "archived");
    const hasOnlyArchivedOpportunities = linkedOpportunities.length > 0 && !hasActiveOpportunity;
    if (hasOnlyArchivedOpportunities) continue;
    if (hasActiveOpportunity || QUALIFIED_LEAD_STATUSES.has(lead.status)) qualified.add(lead.id);
  }
  return qualified;
}

export interface TaskArchiveState {
  archivedLeadIds: ReadonlySet<string>;
  archivedOpportunityIds: ReadonlySet<string>;
  opportunityLeadById: ReadonlyMap<string, string>;
  quotationOpportunityById: ReadonlyMap<string, string>;
}

export function isCurrentActiveTask(
  task: Pick<SalesTaskRow, "status" | "deleted_at" | "lead_metadata_id" | "opportunity_id" | "quotation_id">,
  archiveState: TaskArchiveState,
): boolean {
  if (task.deleted_at !== null || INACTIVE_TASK_STATUSES.has(task.status)) return false;
  if (task.lead_metadata_id && archiveState.archivedLeadIds.has(task.lead_metadata_id)) return false;

  const opportunityIds = new Set<string>();
  if (task.opportunity_id) opportunityIds.add(task.opportunity_id);
  const quotationOpportunityId = task.quotation_id
    ? archiveState.quotationOpportunityById.get(task.quotation_id)
    : undefined;
  if (quotationOpportunityId) opportunityIds.add(quotationOpportunityId);

  for (const opportunityId of opportunityIds) {
    if (archiveState.archivedOpportunityIds.has(opportunityId)) return false;
    const sourceLeadId = archiveState.opportunityLeadById.get(opportunityId);
    if (sourceLeadId && archiveState.archivedLeadIds.has(sourceLeadId)) return false;
  }
  return true;
}

export function isCurrentLeadFollowUp(status: string, followUpAt: string | null): boolean {
  return status !== "archived" && followUpAt !== null;
}

export async function loadTaskArchiveState(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tasks: readonly Pick<SalesTaskRow, "lead_metadata_id" | "opportunity_id" | "quotation_id">[],
): Promise<{ state: TaskArchiveState; error: unknown | null }> {
  const quotationIds = [...new Set(tasks.map((task) => task.quotation_id).filter((id): id is string => Boolean(id)))];
  const { rows: quotations, error: quotationError } = await fetchSalesRowsByIdsInBatches<{ id: string; opportunity_id: string | null }>(
    quotationIds,
    (batch) => supabase.from("sales_quotations").select("id, opportunity_id").in("id", batch),
  );
  if (quotationError) return { state: emptyTaskArchiveState(), error: quotationError };

  const quotationOpportunityById = new Map<string, string>(
    quotations.flatMap((quotation) => quotation.opportunity_id ? [[quotation.id, quotation.opportunity_id] as const] : []),
  );
  const opportunityIds = [...new Set([
    ...tasks.map((task) => task.opportunity_id).filter((id): id is string => Boolean(id)),
    ...quotationOpportunityById.values(),
  ])];
  const { rows: opportunities, error: opportunityError } = await fetchSalesRowsByIdsInBatches<{ id: string; stage: SalesOpportunityStage; lead_metadata_id: string }>(
    opportunityIds,
    (batch) => supabase.from("sales_opportunities").select("id, stage, lead_metadata_id").in("id", batch),
  );
  if (opportunityError) return { state: emptyTaskArchiveState(), error: opportunityError };

  const opportunityLeadById = new Map<string, string>(
    opportunities.map((opportunity: { id: string; lead_metadata_id: string }) => [opportunity.id, opportunity.lead_metadata_id]),
  );
  const leadIds = [...new Set([
    ...tasks.map((task) => task.lead_metadata_id).filter((id): id is string => Boolean(id)),
    ...opportunityLeadById.values(),
  ])];
  const { rows: leads, error: leadError } = await fetchSalesRowsByIdsInBatches<{ id: string; status: string }>(
    leadIds,
    (batch) => supabase.from("sales_lead_metadata").select("id, status").in("id", batch),
  );
  if (leadError) return { state: emptyTaskArchiveState(), error: leadError };

  const archivedLeadIds = new Set<string>(
    leads.filter((lead: { id: string; status: string }) => lead.status === "archived").map((lead: { id: string }) => lead.id),
  );
  const archivedOpportunityIds = new Set<string>(
    opportunities.filter((opportunity: { id: string; stage: SalesOpportunityStage }) => opportunity.stage === "archived").map((opportunity: { id: string }) => opportunity.id),
  );

  return {
    state: { archivedLeadIds, archivedOpportunityIds, opportunityLeadById, quotationOpportunityById },
    error: null,
  };
}

function emptyTaskArchiveState(): TaskArchiveState {
  return {
    archivedLeadIds: new Set<string>(),
    archivedOpportunityIds: new Set<string>(),
    opportunityLeadById: new Map<string, string>(),
    quotationOpportunityById: new Map<string, string>(),
  };
}
