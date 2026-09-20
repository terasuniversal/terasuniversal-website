import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { mytEndOfTodayUtc, type SalesLeadInboxRow } from "../../../../../lib/sales/crm";
import { clampPage, normalizePage, pageCountFor, pageRange, SALES_QUEUE_PAGE_SIZE } from "../../../../../lib/sales/pagination";
import { formatMalaysiaDate } from "../../../../../lib/date-time";
import { FollowUpInlineForm } from "./FollowUpInlineForm";

export const metadata = { title: "Follow-ups — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const VIEWS = ["overdue", "today", "upcoming"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = { overdue: "Overdue", today: "Due Today", upcoming: "Upcoming" };


/**
 * Sales CRM Phase 4B — real Follow-up Queue, sourced entirely from
 * sales_lead_metadata.follow_up_at/priority (Task 1/5: no second follow-up
 * store; opportunities don't have their own follow_up_at because they're
 * 1:1 with a lead_metadata row via convert_lead_to_opportunity()'s own
 * duplicate guard, so the lead's follow-up already covers it — a row here
 * is labelled "Opportunity" instead of "Lead" whenever one exists).
 */
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; owner?: string; feedback?: string; page?: string }>;
}) {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_followups");
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "overdue";
  const owner = sp.owner ?? "mine";
  const requestedPage = normalizePage(sp.page);

  const supabase = await createSupabaseServerClient();
  const { data: staffRows } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  const now = new Date();
  const nowIso = now.toISOString();
  const endOfTodayMyt = mytEndOfTodayUtc(now).toISOString();

  // Resolved (won/lost/archived) leads never show as active follow-ups —
  // matches followUpState()'s own "none" rule.
  const createQuery = (mode: "count" | "rows") => {
    let query = supabase.from("v_sales_lead_inbox");
    query = mode === "count" ? query.select("lead_metadata_id", { count: "exact", head: true }) : query.select("*");
    query = query
      .not("follow_up_at", "is", null)
      .not("status", "in", "(won,lost,archived)")
      .order("follow_up_at", { ascending: true })
      .order("lead_metadata_id", { ascending: true });

    if (view === "overdue") query = query.lt("follow_up_at", nowIso);
    else if (view === "today") query = query.gte("follow_up_at", nowIso).lt("follow_up_at", endOfTodayMyt);
    else query = query.gte("follow_up_at", endOfTodayMyt);

    if (owner === "mine") query = query.eq("assigned_to", profile.id);
    else if (owner !== "all") query = query.eq("assigned_to", owner);
    return query;
  };

  const { count = 0 } = await createQuery("count");
  const pageCount = pageCountFor(count ?? 0);
  const page = clampPage(requestedPage, pageCount);
  const range = pageRange(page, SALES_QUEUE_PAGE_SIZE);
  const { data: rows } = await createQuery("rows").range(range.from, range.to);
  const leads = (rows ?? []) as SalesLeadInboxRow[];
  const returnTo = `/admin/sales/follow-ups?view=${encodeURIComponent(view)}&owner=${encodeURIComponent(owner)}&page=${page}`;
  const leadIds = leads.map((l) => l.lead_metadata_id);

  // Batch-resolve: which of these leads already have an Opportunity, and
  // each one's most recent activity — two bounded queries, not N+1.
  const [{ data: oppRows }, { data: activityRows }] = await Promise.all([
    leadIds.length
      ? supabase.from("sales_opportunities").select("id, opportunity_no, lead_metadata_id").in("lead_metadata_id", leadIds)
      : Promise.resolve({ data: [] as any[] }),
    leadIds.length
      ? supabase
          .from("sales_activity")
          .select("lead_metadata_id, type, note, created_at")
          .in("lead_metadata_id", leadIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const oppByLead = new Map<string, any>((oppRows ?? []).map((o: any) => [o.lead_metadata_id, o]));
  const lastActivityByLead = new Map<string, any>();
  for (const a of activityRows ?? []) if (!lastActivityByLead.has(a.lead_metadata_id)) lastActivityByLead.set(a.lead_metadata_id, a);

  return (
    <>
      <PageHead title="Follow-ups" subtitle="Real follow-up queue — sourced from Lead/Opportunity follow-up dates, Malaysia time." />
      {sp.feedback === "saved" && <div className="ta-alert ta-alert-success" role="status">Follow-up saved.</div>}
      {sp.feedback === "cleared" && <div className="ta-alert ta-alert-success" role="status">Follow-up cleared.</div>}

      <form className="ta-toolbar" style={{ flexWrap: "wrap" }}>
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={`/admin/sales/follow-ups?${new URLSearchParams({ view: v, owner }).toString()}`}
            className={`ta-btn ta-btn-sm ${view === v ? "ta-btn-primary" : "ta-btn-outline"}`}
          >
            {VIEW_LABELS[v]}
          </Link>
        ))}
        <div className="ta-spacer" />
        <select name="owner" defaultValue={owner} className="ta-filter-select" style={{ maxWidth: 180 }} aria-label="Owner filter">
          <option value="mine">My Follow-ups</option>
          <option value="all">All Follow-ups</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <input type="hidden" name="view" value={view} />
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
      </form>

      <Card title={VIEW_LABELS[view]}>
        {leads.length > 0 ? (
          <>
            <div className="ta-table-wrap ta-followups-table">
              <table className="ta-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Company / Contact</th>
                    <th>Owner</th>
                    <th>Priority</th>
                    <th>Follow-up</th>
                    <th>Stage</th>
                    <th>Last Activity</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => {
                    const opp = oppByLead.get(l.lead_metadata_id);
                    const lastActivity = lastActivityByLead.get(l.lead_metadata_id);
                    const href = opp ? `/admin/sales/opportunities/${opp.id}` : `/admin/sales/leads/${l.lead_metadata_id}`;
                    return (
                      <tr key={l.lead_metadata_id}>
                        <td>
                          <Link href={href}>{opp ? opp.opportunity_no : "Lead"}</Link>
                        </td>
                        <td>
                          <strong>{l.company ?? "—"}</strong>
                          <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{l.contact_name ?? "—"}</div>
                        </td>
                        <td>{l.assigned_to ? staffNames.get(l.assigned_to) ?? "—" : "Unassigned"}</td>
                        <td>
                          <Badge status={l.priority} />
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          <FollowUpInlineForm leadMetadataId={l.lead_metadata_id} followUpAt={l.follow_up_at} returnTo={returnTo} />
                        </td>
                        <td>
                          <Badge status={l.status} />
                        </td>
                        <td style={{ color: "var(--ta-muted)", fontSize: 12 }}>
                          {lastActivity ? `${lastActivity.type.replace(/_/g, " ")} — ${formatMalaysiaDate(lastActivity.created_at)}` : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <Link href={href} className="ta-btn ta-btn-outline ta-btn-sm">
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="ta-lead-cards">
              {leads.map((l) => {
                const opp = oppByLead.get(l.lead_metadata_id);
                const lastActivity = lastActivityByLead.get(l.lead_metadata_id);
                const href = opp ? `/admin/sales/opportunities/${opp.id}` : `/admin/sales/leads/${l.lead_metadata_id}`;
                return (
                  <li className="ta-card ta-lead-card" key={l.lead_metadata_id}>
                    <div className="ta-lead-card-top">
                      <Link href={href}>{opp ? opp.opportunity_no : "Lead"}</Link>
                      <Badge status={l.status} />
                    </div>
                    <div className="ta-lead-card-company">
                      <strong>{l.company ?? "—"}</strong>
                      <div className="ta-lead-sub">{l.contact_name ?? "—"}</div>
                    </div>
                    <div className="ta-lead-card-grid">
                      <span>Owner</span>
                      <span>{l.assigned_to ? staffNames.get(l.assigned_to) ?? "—" : "Unassigned"}</span>
                      <span>Priority</span>
                      <span><Badge status={l.priority} /></span>
                      <span>Follow-up</span>
                      <span><FollowUpInlineForm leadMetadataId={l.lead_metadata_id} followUpAt={l.follow_up_at} returnTo={returnTo} /></span>
                      <span>Last Activity</span>
                      <span>{lastActivity ? `${lastActivity.type.replace(/_/g, " ")} — ${formatMalaysiaDate(lastActivity.created_at)}` : "—"}</span>
                    </div>
                    <div className="ta-lead-card-action">
                      <Link href={href} className="ta-btn ta-btn-outline ta-btn-sm">View →</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState icon="🗓" message="No follow-ups in this view." />
        )}
      </Card>
      <Pagination
        page={page}
        pageCount={pageCount}
        basePath="/admin/sales/follow-ups"
        query={{ view, owner }}
      />
    </>
  );
}
