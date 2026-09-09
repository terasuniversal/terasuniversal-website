import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, EmptyState, Pagination, StatCard } from "../../../../../components/admin/ui";
import {
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_ORDER,
  OPPORTUNITY_STAGE_LABELS,
  sanitizeSearchTerm,
  type SalesOpportunityRow,
  type SalesTaskRow,
} from "../../../../../lib/sales/crm";
import {
  expectedCloseState,
  formatMoney,
  isStalledOpportunity,
  latestOpportunityActivity,
  mytTodayKey,
  nextOpportunityTask,
  shiftMytDateKey,
  type OpportunityExpectedCloseState,
} from "../../../../../lib/sales/opportunity-pipeline";
import { OpportunityTable } from "./OpportunityTable";

export const metadata = { title: "Opportunities — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const RESOLVED_STAGES = ["won", "lost", "archived", "cancelled"] as const;

export type OpportunityPipelineRow = SalesOpportunityRow & {
  nextAction: SalesTaskRow | null;
  lastActivityAt: string;
  expectedCloseState: OpportunityExpectedCloseState;
  stalled: boolean;
};

type ActivitySignal = { opportunity_id: string | null; created_at: string };

async function loadSignals(supabase: any, opportunityIds: string[]) {
  if (!opportunityIds.length) return { tasksByOpportunity: new Map<string, SalesTaskRow[]>(), activityByOpportunity: new Map<string, ActivitySignal[]>() };
  const [{ data: taskRows }, { data: activityRows }] = await Promise.all([
    supabase.from("sales_tasks").select("id, title, description, status, priority, due_at, assigned_to, lead_metadata_id, opportunity_id, quotation_id, created_by, completed_at, created_at, updated_at, deleted_at").in("opportunity_id", opportunityIds).is("deleted_at", null),
    supabase.from("sales_activity").select("opportunity_id, created_at").in("opportunity_id", opportunityIds).order("created_at", { ascending: false }),
  ]);
  const tasksByOpportunity = new Map<string, SalesTaskRow[]>();
  for (const task of (taskRows ?? []) as SalesTaskRow[]) {
    if (!task.opportunity_id) continue;
    const list = tasksByOpportunity.get(task.opportunity_id) ?? [];
    list.push(task);
    tasksByOpportunity.set(task.opportunity_id, list);
  }
  const activityByOpportunity = new Map<string, ActivitySignal[]>();
  for (const activity of (activityRows ?? []) as ActivitySignal[]) {
    if (!activity.opportunity_id) continue;
    const list = activityByOpportunity.get(activity.opportunity_id) ?? [];
    list.push(activity);
    activityByOpportunity.set(activity.opportunity_id, list);
  }
  return { tasksByOpportunity, activityByOpportunity };
}

function enrichRows(rows: SalesOpportunityRow[], signals: Awaited<ReturnType<typeof loadSignals>>, now: Date): OpportunityPipelineRow[] {
  return rows.map((row) => {
    const tasks = signals.tasksByOpportunity.get(row.id) ?? [];
    const activities = signals.activityByOpportunity.get(row.id) ?? [];
    const lastActivityAt = latestOpportunityActivity(activities, row.created_at);
    return {
      ...row,
      nextAction: nextOpportunityTask(tasks),
      lastActivityAt,
      expectedCloseState: expectedCloseState(row.expected_close_date, now),
      stalled: isStalledOpportunity(row, tasks, activities, now),
    };
  });
}

function dateAgeRange(value: string | undefined, now: Date): { from?: string; to?: string } {
  if (!value) return {};
  if (value === "0_7") return { from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to: now.toISOString() };
  if (value === "8_14") return { from: new Date(now.getTime() - 14 * 86_400_000).toISOString(), to: new Date(now.getTime() - 7 * 86_400_000).toISOString() };
  if (value === "15_30") return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: new Date(now.getTime() - 14 * 86_400_000).toISOString() };
  return { to: new Date(now.getTime() - 30 * 86_400_000).toISOString() };
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; stage?: string; assigned?: string; from?: string; to?: string; state?: string; close?: string; stalled?: string; age?: string; value?: string }>;
}) {
  await requireRole("editor");
  await requireModuleAccess("sales_opportunities");
  const sp = await searchParams;
  const now = new Date();
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();
  const { data: staffRows } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  const needsDerivedFilter = sp.stalled === "true";
  let query = supabase.from("sales_opportunities").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) query = query.or(`opportunity_no.ilike.%${term}%,company_name.ilike.%${term}%,contact_person.ilike.%${term}%,title.ilike.%${term}%,programme.ilike.%${term}%`);
  }
  if (sp.stage) query = query.eq("stage", sp.stage);
  if (sp.assigned) query = sp.assigned === "unassigned" ? query.is("assigned_to", null) : query.eq("assigned_to", sp.assigned);
  if (sp.from) query = query.gte("created_at", sp.from);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59`);
  if (sp.state === "open") query = query.in("stage", OPEN_OPPORTUNITY_STAGES);
  if (sp.state === "resolved") query = query.in("stage", RESOLVED_STAGES);
  const today = mytTodayKey(now);
  if (sp.close === "none") query = query.is("expected_close_date", null);
  if (sp.close === "overdue") query = query.lt("expected_close_date", today);
  if (sp.close === "due_soon") query = query.gte("expected_close_date", today).lte("expected_close_date", shiftMytDateKey(today, 7));
  if (sp.value === "under_10k") query = query.gte("estimated_value", 0).lt("estimated_value", 10000);
  if (sp.value === "10k_50k") query = query.gte("estimated_value", 10000).lt("estimated_value", 50000);
  if (sp.value === "50k_plus") query = query.gte("estimated_value", 50000);
  const ageRange = dateAgeRange(sp.age, now);
  if (ageRange.from) query = query.gte("created_at", ageRange.from);
  if (ageRange.to) query = query.lte("created_at", ageRange.to);
  if (!needsDerivedFilter) query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data: rawRows, count }, { data: summaryRaw }] = await Promise.all([
    query,
    supabase.from("sales_opportunities").select("id, stage, estimated_value, probability, expected_close_date, created_at").in("stage", OPEN_OPPORTUNITY_STAGES),
  ]);
  const candidateRows = (rawRows ?? []) as SalesOpportunityRow[];
  const summaryRows = (summaryRaw ?? []) as Pick<SalesOpportunityRow, "id" | "stage" | "estimated_value" | "probability" | "expected_close_date" | "created_at">[];
  const allSignalIds = Array.from(new Set([...summaryRows.map((row) => row.id), ...candidateRows.map((row) => row.id)]));
  const signals = await loadSignals(supabase, allSignalIds);
  const enrichedCandidates = enrichRows(candidateRows, signals, now);
  const filteredRows = needsDerivedFilter ? enrichedCandidates.filter((row) => row.stalled) : enrichedCandidates;
  const rows = needsDerivedFilter ? filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : filteredRows;
  const totalCount = needsDerivedFilter ? filteredRows.length : count ?? 0;
  const pageCount = Math.ceil(totalCount / PAGE_SIZE);

  const summarySignals = enrichRows(summaryRows as SalesOpportunityRow[], signals, now);
  const openValue = summaryRows.reduce((sum, row) => sum + Number(row.estimated_value ?? 0), 0);
  const weightedValue = summaryRows.reduce((sum, row) => sum + Math.max(0, Number(row.estimated_value ?? 0)) * Math.max(0, Math.min(100, Number(row.probability ?? 0))) / 100, 0);
  const overdueClose = summaryRows.filter((row) => expectedCloseState(row.expected_close_date, now) === "overdue").length;
  const stalled = summarySignals.filter((row) => row.stalled).length;

  const qsBase: Record<string, string> = {};
  for (const key of ["q", "stage", "assigned", "from", "to", "state", "close", "stalled", "age", "value"] as const) if (sp[key]) qsBase[key] = sp[key]!;
  const filtersApplied = Object.keys(qsBase).length > 0;

  return (
    <>
      <PageHead title="Opportunities" subtitle="Pipeline intelligence from existing Opportunities, Tasks and Activity history." />
      <div className="ta-stat-grid">
        <StatCard label="Open Opportunities" value={summaryRows.length} icon="📊" />
        <StatCard label="Open Pipeline Value" value={formatMoney(openValue)} icon="💰" />
        <StatCard label="Weighted Pipeline" value={formatMoney(weightedValue)} icon="📈" context="Null probability counts as 0%." />
        <StatCard label="Overdue Close" value={overdueClose} icon="⏰" />
        <StatCard label="Stalled" value={stalled} icon="⚠️" context="Open, no future task, 7+ days since activity." />
      </div>
      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}><span className="ta-search-ico" aria-hidden="true">⌕</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Search opportunity no, company…" /></div>
        <select name="stage" defaultValue={sp.stage ?? ""} aria-label="Stage filter"><option value="">All stages</option>{OPPORTUNITY_STAGE_ORDER.map((s) => <option key={s} value={s}>{OPPORTUNITY_STAGE_LABELS[s]}</option>)}</select>
        <select name="assigned" defaultValue={sp.assigned ?? ""} aria-label="Owner filter"><option value="">Anyone</option><option value="unassigned">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
        <select name="state" defaultValue={sp.state ?? ""} aria-label="State filter"><option value="">All states</option><option value="open">Open</option><option value="resolved">Resolved</option></select>
        <select name="close" defaultValue={sp.close ?? ""} aria-label="Expected close filter"><option value="">Any close date</option><option value="none">No date</option><option value="due_soon">Due soon</option><option value="overdue">Overdue</option></select>
        <select name="stalled" defaultValue={sp.stalled ?? ""} aria-label="Stalled filter"><option value="">All workload</option><option value="true">Stalled only</option></select>
        <select name="age" defaultValue={sp.age ?? ""} aria-label="Age filter"><option value="">Any age</option><option value="0_7">0–7 days</option><option value="8_14">8–14 days</option><option value="15_30">15–30 days</option><option value="31_plus">31+ days</option></select>
        <select name="value" defaultValue={sp.value ?? ""} aria-label="Value filter"><option value="">Any value</option><option value="under_10k">Under RM10k</option><option value="10k_50k">RM10k–RM50k</option><option value="50k_plus">RM50k+</option></select>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--ta-muted)" }}>From<input type="date" name="from" defaultValue={sp.from ?? ""} /></label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--ta-muted)" }}>To<input type="date" name="to" defaultValue={sp.to ?? ""} /></label>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {filtersApplied && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/sales/opportunities">Reset filters</Link>}
      </form>
      <Card>
        {rows.length > 0 ? <OpportunityTable rows={rows} staffNames={staffNames} /> : <EmptyState icon="🎯" message={filtersApplied ? "No opportunities match these filters." : "No opportunities yet. Convert a qualified lead from Lead Detail to create one."} />}
      </Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{totalCount} opportunit{totalCount === 1 ? "y" : "ies"}</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/sales/opportunities" query={qsBase} />
      </div>
    </>
  );
}
