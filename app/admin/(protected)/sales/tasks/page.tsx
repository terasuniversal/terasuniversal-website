import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { dueDateState, mytEndOfTodayUtc, sanitizeSearchTerm, type SalesTaskRow } from "../../../../../lib/sales/crm";
import { loadStaffOptions } from "./options";
import { formatMalaysiaDateTime } from "../../../../../lib/date-time";

export const metadata = { title: "Sales Tasks — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const VIEWS = ["all", "overdue", "today", "upcoming", "completed"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = { all: "All Open", overdue: "Overdue", today: "Due Today", upcoming: "Upcoming", completed: "Completed" };

function RelatedRecordLink({ task }: { task: SalesTaskRow }) {
  if (task.opportunity_id) return <Link href={`/admin/sales/opportunities/${task.opportunity_id}`}>Opportunity →</Link>;
  if (task.lead_metadata_id) return <Link href={`/admin/sales/leads/${task.lead_metadata_id}`}>Lead →</Link>;
  if (task.quotation_id) return <Link href={`/admin/sales/quotations/${task.quotation_id}`}>Quotation →</Link>;
  return <>—</>;
}

export default async function SalesTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; owner?: string; q?: string }>;
}) {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_tasks");
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "all";
  const owner = sp.owner ?? "mine";

  const supabase = await createSupabaseServerClient();
  const staff = await loadStaffOptions();
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  const now = new Date();
  const endOfTodayMyt = mytEndOfTodayUtc(now).toISOString();
  const nowIso = now.toISOString();

  let query = supabase
    .from("sales_tasks")
    .select("*")
    .is("deleted_at", null)
    .order("due_at", { ascending: true, nullsFirst: false });

  if (view === "completed") {
    query = query.eq("status", "completed");
  } else {
    query = query.not("status", "in", "(completed,cancelled)");
    if (view === "overdue") query = query.not("due_at", "is", null).lt("due_at", nowIso);
    else if (view === "today") query = query.not("due_at", "is", null).gte("due_at", nowIso).lt("due_at", endOfTodayMyt);
    else if (view === "upcoming") query = query.not("due_at", "is", null).gte("due_at", endOfTodayMyt);
  }

  if (owner === "mine") query = query.eq("assigned_to", profile.id);
  else if (owner !== "all") query = query.eq("assigned_to", owner);

  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) query = query.ilike("title", `%${term}%`);
  }

  const { data: rows } = await query.limit(200);
  const tasks = (rows ?? []) as SalesTaskRow[];

  const qsBase: Record<string, string> = {};
  if (sp.q) qsBase.q = sp.q;

  return (
    <>
      <PageHead
        title="Sales Tasks"
        subtitle="Production to-dos linked to leads, opportunities and quotations — no demo records."
        action={<Link href="/admin/sales/tasks/new" className="ta-btn ta-btn-primary">+ New Task</Link>}
      />

      <form className="ta-toolbar" style={{ flexWrap: "wrap" }}>
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={`/admin/sales/tasks?${new URLSearchParams({ ...qsBase, view: v, owner }).toString()}`}
            className={`ta-btn ta-btn-sm ${view === v ? "ta-btn-primary" : "ta-btn-outline"}`}
          >
            {VIEW_LABELS[v]}
          </Link>
        ))}
        <div className="ta-spacer" />
        <select name="owner" defaultValue={owner} className="ta-filter-select" style={{ maxWidth: 180 }} aria-label="Owner filter">
          <option value="mine">My Tasks</option>
          <option value="all">All Tasks</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <input type="hidden" name="view" value={view} />
        <div className="ta-search" style={{ maxWidth: 220 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search title…" />
        </div>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
      </form>

      <Card title={VIEW_LABELS[view]}>
        {tasks.length > 0 ? (
          <>
            <div className="ta-table-wrap ta-tasks-table">
              <table className="ta-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Related record</th>
                    <th>Owner</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    const state = t.status === "open" || t.status === "in_progress" ? dueDateState(t.due_at) : "none";
                    return (
                      <tr key={t.id}>
                        <td>
                          <strong>{t.title}</strong>
                        </td>
                        <td style={{ color: "var(--ta-muted)", fontSize: 12.5 }}>
                          <RelatedRecordLink task={t} />
                        </td>
                        <td>{t.assigned_to ? staffNames.get(t.assigned_to) ?? "—" : "Unassigned"}</td>
                        <td>
                          <Badge status={t.priority} />
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {t.due_at ? formatMalaysiaDateTime(t.due_at) : "—"}
                          {state === "overdue" && <span style={{ color: "var(--ta-danger)", marginLeft: 6, fontWeight: 700 }}>Overdue</span>}
                          {state === "today" && <span style={{ color: "var(--ta-info)", marginLeft: 6, fontWeight: 700 }}>Today</span>}
                        </td>
                        <td>
                          <Badge status={t.status} />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <Link href={`/admin/sales/tasks/${t.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
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
              {tasks.map((t) => {
                const state = t.status === "open" || t.status === "in_progress" ? dueDateState(t.due_at) : "none";
                return (
                  <li className="ta-card ta-lead-card" key={t.id}>
                    <div className="ta-lead-card-top">
                      <strong>{t.title}</strong>
                      <Badge status={t.status} />
                    </div>
                    <div className="ta-lead-card-grid">
                      <span>Related</span>
                      <span><RelatedRecordLink task={t} /></span>
                      <span>Owner</span>
                      <span>{t.assigned_to ? staffNames.get(t.assigned_to) ?? "—" : "Unassigned"}</span>
                      <span>Priority</span>
                      <span><Badge status={t.priority} /></span>
                      <span>Due</span>
                      <span>
                        {t.due_at ? formatMalaysiaDateTime(t.due_at) : "—"}
                        {state === "overdue" && <span style={{ color: "var(--ta-danger)", marginLeft: 6, fontWeight: 700 }}>Overdue</span>}
                        {state === "today" && <span style={{ color: "var(--ta-info)", marginLeft: 6, fontWeight: 700 }}>Today</span>}
                      </span>
                    </div>
                    <div className="ta-lead-card-action">
                      <Link href={`/admin/sales/tasks/${t.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View task →</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState icon="☑" message="No tasks in this view." />
        )}
      </Card>
    </>
  );
}
