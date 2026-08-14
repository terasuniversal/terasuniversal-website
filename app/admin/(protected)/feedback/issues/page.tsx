import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { updateIssueStatus } from "../actions";
import { IssueForm } from "./IssueForm";

export const metadata = { title: "Feedback Issues — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const ISSUE_NEXT: Record<string, string[]> = {
  open: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["closed"],
};

export default async function FeedbackIssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; create?: string }>;
}) {
  await requireRole("editor");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const showCreate = sp.create === "1";

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("feedback_issues")
    .select("id, title, category, department, priority, status, schedule_id, created_at, source_feedback_id, course_schedules(schedule_code)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.status) query = query.eq("status", sp.status);

  const [{ data: rows, count }, { data: schedules }] = await Promise.all([
    query,
    supabase.from("course_schedules").select("id, schedule_code").is("deleted_at", null).order("start_date", { ascending: false }).limit(200),
  ]);
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <>
      <PageHead
        title="Feedback Issues"
        subtitle="Manually converted actionable feedback — issues are never auto-created."
        action={<Link href="/admin/feedback" className="ta-btn ta-btn-outline">← Dashboard</Link>}
      />

      <div style={{ marginBottom: 16 }}>
        {showCreate ? (
          <IssueForm />
        ) : (
          <Link className="ta-btn ta-btn-primary" href="/admin/feedback/issues?create=1">+ Create Issue</Link>
        )}
      </div>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Schedule</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      {r.department && <div className="ta-lead-sub">{r.department}</div>}
                    </td>
                    <td>{r.category ?? "—"}</td>
                    <td><span className={`ta-fb-pill ta-fb-priority ${r.priority}`}>{r.priority}</span></td>
                    <td><span className={`ta-fb-pill ta-fb-issue ${r.status}`}>{r.status.replace(/_/g, " ")}</span></td>
                    <td className="ta-lead-sub">{r.course_schedules?.schedule_code ?? "—"}</td>
                    <td className="ta-lead-sub" style={{ whiteSpace: "nowrap" }}>
                      {new Date(r.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td>
                      <form action={updateIssueStatus.bind(null, r.id)} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <select name="status" defaultValue={r.status} className="ta-filter-select" aria-label={`Update status for ${r.title}`} style={{ padding: "5px 8px", minHeight: 0 }}>
                          {[r.status, ...(ISSUE_NEXT[r.status] ?? [])].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                        </select>
                        <button className="ta-btn ta-btn-outline ta-btn-sm" type="submit">Update</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🚩" message="No issues yet. Convert actionable feedback into an issue manually." />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/feedback/issues" query={sp.status ? { status: sp.status } : {}} />
    </>
  );
}
