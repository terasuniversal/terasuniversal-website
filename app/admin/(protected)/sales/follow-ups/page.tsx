import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { mytEndOfTodayUtc, type SalesLeadInboxRow } from "../../../../../lib/sales/crm";
import { setLeadFollowUp } from "../leads/actions";
import { formatMalaysiaDate } from "../../../../../lib/date-time";

/** Plain-form wrapper — the inline table row uses fire-and-revalidate semantics (no field errors to surface here; the full Lead/Opportunity detail page's own follow-up form already handles that case with useActionState). */
async function saveFollowUp(leadMetadataId: string, formData: FormData): Promise<void> {
  "use server";
  await setLeadFollowUp(leadMetadataId, {}, formData);
}

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
  searchParams: Promise<{ view?: string; owner?: string }>;
}) {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_followups");
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "overdue";
  const owner = sp.owner ?? "mine";

  const supabase = await createSupabaseServerClient();
  const { data: staffRows } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  const now = new Date();
  const nowIso = now.toISOString();
  const endOfTodayMyt = mytEndOfTodayUtc(now).toISOString();

  // Resolved (won/lost/archived) leads never show as active follow-ups —
  // matches followUpState()'s own "none" rule.
  let query = supabase
    .from("v_sales_lead_inbox")
    .select("*")
    .not("follow_up_at", "is", null)
    .not("status", "in", "(won,lost,archived)")
    .order("follow_up_at", { ascending: true });

  if (view === "overdue") query = query.lt("follow_up_at", nowIso);
  else if (view === "today") query = query.gte("follow_up_at", nowIso).lt("follow_up_at", endOfTodayMyt);
  else query = query.gte("follow_up_at", endOfTodayMyt);

  if (owner === "mine") query = query.eq("assigned_to", profile.id);
  else if (owner !== "all") query = query.eq("assigned_to", owner);

  const { data: rows } = await query.limit(200);
  const leads = (rows ?? []) as SalesLeadInboxRow[];
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
          <div className="ta-table-wrap">
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
                        <form action={saveFollowUp.bind(null, l.lead_metadata_id)} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="datetime-local"
                            name="follow_up_at"
                            defaultValue={l.follow_up_at ? l.follow_up_at.slice(0, 16) : ""}
                            style={{ fontSize: 12, padding: "4px 6px", maxWidth: 170 }}
                          />
                          <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" title="Set / reschedule">
                            Save
                          </button>
                        </form>
                        <form action={saveFollowUp.bind(null, l.lead_metadata_id)} style={{ marginTop: 4 }}>
                          <input type="hidden" name="follow_up_at" value="" />
                          <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" title="Clear follow-up">
                            Clear
                          </button>
                        </form>
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
        ) : (
          <EmptyState icon="🗓" message="No follow-ups in this view." />
        )}
      </Card>
    </>
  );
}
