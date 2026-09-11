import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { CRM_STATUS_ORDER, CRM_STATUS_LABELS, SOURCE_LABELS, mytEndOfTodayUtc, sanitizeSearchTerm, type SalesLeadInboxRow } from "../../../../../lib/sales/crm";
import { ageLabel, daysSinceActivityLabel, qualificationLabel, temperatureLabel } from "../../../../../lib/sales/qualification";
import { LeadInboxTable } from "./LeadInboxTable";

export const metadata = { title: "Sales Leads — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function SalesLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string; q?: string; status?: string; source?: string; assigned?: string; followup?: string; from?: string; to?: string; qualification?: string; temperature?: string; priority?: string; age?: string;
  }>;
}) {
  await requireRole("editor"); // read allowed for all sales-CRM staff; mutations are admin-gated in actions.ts
  await requireModuleAccess("sales_leads");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  // Staff list for the "Assigned To" filter + display name lookups.
  const { data: staffRows } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name");
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  let query = supabase
    .from("v_sales_lead_inbox")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) query = query.or(`contact_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%,subject.ilike.%${term}%`);
  }
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.source) query = query.eq("lead_source", sp.source);
  if (sp.assigned) query = sp.assigned === "unassigned" ? query.is("assigned_to", null) : query.eq("assigned_to", sp.assigned);
  const now = new Date();
  const nowIso = now.toISOString();
  const endOfTodayMyt = mytEndOfTodayUtc(now).toISOString();
  const hasQualificationFilter = Boolean(sp.qualification || sp.temperature || sp.priority || sp.age);
  let qualificationIds: string[] | null = null;
  if (hasQualificationFilter) {
    let qualificationQuery = supabase.from("sales_lead_metadata").select("id, created_at");
    if (sp.qualification) qualificationQuery = qualificationQuery.eq("qualification_status", sp.qualification);
    if (sp.temperature === "none") qualificationQuery = qualificationQuery.is("temperature", null);
    else if (sp.temperature) qualificationQuery = qualificationQuery.eq("temperature", sp.temperature);
    if (sp.priority) qualificationQuery = qualificationQuery.eq("priority", sp.priority);
    if (sp.age) {
      const ageDays = sp.age === "0_3" ? 3 : sp.age === "4_7" ? 7 : sp.age === "8_14" ? 14 : sp.age === "15_plus" ? 15 : null;
      if (ageDays !== null) {
        const boundary = new Date(now.getTime() - ageDays * 86400000).toISOString();
        if (sp.age === "15_plus") qualificationQuery = qualificationQuery.lte("created_at", boundary);
        else if (sp.age === "0_3") qualificationQuery = qualificationQuery.gte("created_at", boundary);
        else {
          const lowerDays = sp.age === "4_7" ? 7 : 14;
          const lower = new Date(now.getTime() - lowerDays * 86400000).toISOString();
          qualificationQuery = qualificationQuery.gte("created_at", lower).lt("created_at", boundary);
        }
      }
    }
    const { data: qualificationRows } = await qualificationQuery;
    const ids = (qualificationRows ?? []).map((item: { id: string }) => item.id);
    qualificationIds = ids;
  }
  if (qualificationIds) query = query.in("lead_metadata_id", qualificationIds.length ? qualificationIds : ["00000000-0000-0000-0000-000000000000"]);
  if (sp.followup === "overdue") query = query.not("status", "in", "(won,lost,archived)").not("follow_up_at", "is", null).lt("follow_up_at", nowIso);
  else if (sp.followup === "today") query = query.not("status", "in", "(won,lost,archived)").not("follow_up_at", "is", null).gte("follow_up_at", nowIso).lt("follow_up_at", endOfTodayMyt);
  else if (sp.followup === "upcoming") query = query.not("status", "in", "(won,lost,archived)").not("follow_up_at", "is", null).gte("follow_up_at", endOfTodayMyt);
  else if (sp.followup === "none") query = query.or("follow_up_at.is.null,status.in.(won,lost,archived)");
  if (sp.from) query = query.gte("created_at", sp.from);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59`);

  const { data: rows, count } = qualificationIds?.length === 0 ? { data: [], count: 0 } : await query;
  const leadRows = (rows ?? []) as SalesLeadInboxRow[];
  const leadIds = leadRows.map((lead) => lead.lead_metadata_id);
  const { data: qualificationRows } = leadIds.length ? await supabase.from("sales_lead_metadata").select("id, qualification_status, temperature, qualification_reason, disqualification_reason, created_at").in("id", leadIds) : { data: [] };
  const qualificationByLead = new Map<string, { qualification_status: string; temperature: string | null }>((qualificationRows ?? []).map((item: { id: string; qualification_status: string; temperature: string | null }) => [item.id, item]));
  const { data: activityRows } = leadIds.length ? await supabase.from("sales_activity").select("lead_metadata_id, created_at").in("lead_metadata_id", leadIds).order("created_at", { ascending: false }) : { data: [] };
  const lastActivityByLead = new Map<string, string>();
  for (const activity of activityRows ?? []) if (!lastActivityByLead.has(activity.lead_metadata_id)) lastActivityByLead.set(activity.lead_metadata_id, activity.created_at);
  const { data: taskRows } = leadIds.length
    ? await supabase
        .from("sales_tasks")
        .select("id, title, status, priority, due_at, lead_metadata_id, created_at")
        .in("lead_metadata_id", leadIds)
        .is("deleted_at", null)
        .not("status", "in", "(completed,cancelled)")
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
    : { data: [] };
  const nextActions = new Map<string, { id: string; title: string; status: string; priority: string; due_at: string | null }>();
  for (const task of taskRows ?? []) {
    if (task.lead_metadata_id && !nextActions.has(task.lead_metadata_id)) nextActions.set(task.lead_metadata_id, task);
  }
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "source", "assigned", "followup", "from", "to", "qualification", "temperature", "priority", "age"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const exportQs = new URLSearchParams(qsBase).toString();

  return (
    <>
      <PageHead
        title="Sales Leads"
        subtitle="Unified inbox — public contact enquiries and proposal requests in one pipeline."
        action={<Link href="/admin/sales/leads/new" className="ta-btn ta-btn-primary">+ Create Lead</Link>}
      />

      <form className="ta-toolbar">
        <div className="ta-search">
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, company, email…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="ta-filter-select" aria-label="Status filter">
          <option value="">All statuses</option>
          {CRM_STATUS_ORDER.map((s) => <option key={s} value={s}>{CRM_STATUS_LABELS[s]}</option>)}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className="ta-filter-select" aria-label="Source filter">
          <option value="">All sources</option>
          <option value="enquiry">{SOURCE_LABELS.enquiry}</option>
          <option value="proposal_request">{SOURCE_LABELS.proposal_request}</option>
          <option value="marketing_contact">{SOURCE_LABELS.marketing_contact}</option>
          <option value="internal">{SOURCE_LABELS.internal}</option>
        </select>
        <select name="assigned" defaultValue={sp.assigned ?? ""} className="ta-filter-select" style={{ maxWidth: 180 }} aria-label="Assigned to filter">
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <select name="followup" defaultValue={sp.followup ?? ""} className="ta-filter-select" aria-label="Follow-up filter">
          <option value="">All follow-ups</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due Today</option>
          <option value="upcoming">Upcoming</option>
          <option value="none">No Follow-up</option>
        </select>
        <select name="qualification" defaultValue={sp.qualification ?? ""} className="ta-filter-select" aria-label="Qualification filter">
          <option value="">All qualification</option><option value="pending">Pending</option><option value="qualified">Qualified</option><option value="unqualified">Unqualified</option>
        </select>
        <select name="temperature" defaultValue={sp.temperature ?? ""} className="ta-filter-select" aria-label="Temperature filter">
          <option value="">All temperatures</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option><option value="none">Not Set</option>
        </select>
        <select name="priority" defaultValue={sp.priority ?? ""} className="ta-filter-select" aria-label="Priority filter">
          <option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select name="age" defaultValue={sp.age ?? ""} className="ta-filter-select" aria-label="Lead age filter">
          <option value="">All ages</option><option value="0_3">0–3 days</option><option value="4_7">4–7 days</option><option value="8_14">8–14 days</option><option value="15_plus">15+ days</option>
        </select>
        <label className="ta-filter-date-group">
          From
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="ta-filter-date" />
        </label>
        <label className="ta-filter-date-group">
          To
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="ta-filter-date" />
        </label>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.status || sp.source || sp.assigned || sp.followup || sp.from || sp.to || sp.qualification || sp.temperature || sp.priority || sp.age) && (
          <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/sales/leads">Reset filters</Link>
        )}
      </form>

      <Card
        title="Lead Inbox"
        action={
          <a href={`/admin/sales/leads/export${exportQs ? "?" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">Export CSV</a>
        }
      >
        {rows && rows.length > 0 ? (
          <LeadInboxTable rows={leadRows} staffNames={staffNames} nextActions={nextActions} qualificationByLead={qualificationByLead} lastActivityByLead={lastActivityByLead} />
        ) : (
          <EmptyState icon="🧲" message="No leads match this view. Leads appear automatically here as soon as a visitor submits a contact enquiry or a proposal request." />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} {count === 1 ? "lead" : "leads"}</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/sales/leads" query={qsBase} />
      </div>
    </>
  );
}
