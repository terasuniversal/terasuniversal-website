import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { ActionForm } from "./ActionForm";
import { ActionTransition } from "./ActionTransition";

export const metadata = { title: "Improvement Actions — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function FeedbackActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; create?: string; status?: string }>;
}) {
  await requireRole("editor");
  await requireModuleAccess("feedback_actions");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const showCreate = sp.create === "1";

  const supabase = await createSupabaseServerClient();

  const [{ data: rows, count, error }, { data: issues }, { data: staff }] = await Promise.all([
    (() => {
      let q = supabase
        .from("feedback_improvement_actions")
        // feedback_improvement_actions has three separate FKs into profiles
        // (assigned_to/created_by/updated_by) — PostgREST can't infer which
        // one "profiles(...)" means without the FK name, and errors with
        // PGRST201 ("more than one relationship was found"). Qualify the
        // embed by the exact constraint name for the one we want (assignee).
        .select("id, title, category, department, priority, status, assigned_to, due_date, corrective_action, verification_note, feedback_issues(title), profiles!feedback_improvement_actions_assigned_to_fkey(full_name)")
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (sp.status) q = q.eq("status", sp.status);
      return q;
    })(),
    supabase.from("feedback_issues").select("id, title").is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  if (error) {
    console.error("FeedbackActionsPage: feedback_improvement_actions select failed", { status: sp.status || null, code: error.code, message: error.message });
  }
  const dataUnavailable = Boolean(error);
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <>
      <PageHead
        title="Improvement Actions"
        subtitle="Workflow: Open → Assigned → In Progress → Resolved → Verified → Closed."
        action={<Link href="/admin/feedback" className="ta-btn ta-btn-outline">← Dashboard</Link>}
      />

      <div style={{ marginBottom: 16 }}>
        {showCreate ? (
          <ActionForm issues={(issues ?? []) as any} staff={(staff ?? []) as any} />
        ) : (
          <Link className="ta-btn ta-btn-primary" href="/admin/feedback/actions?create=1">+ Create Improvement Action</Link>
        )}
      </div>

      <Card>
        {dataUnavailable ? (
          <EmptyState icon="⚠" message="Feedback data is currently unavailable." />
        ) : rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Due</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      <div className="ta-lead-sub">{r.feedback_issues?.title ?? ""}</div>
                      {r.category && <div className="ta-lead-sub">{r.category}</div>}
                    </td>
                    <td><span className={`ta-fb-pill ta-fb-priority ${r.priority}`}>{r.priority}</span></td>
                    <td><span className={`ta-fb-pill ta-fb-action ${r.status}`}>{r.status.replace(/_/g, " ")}</span></td>
                    <td className="ta-lead-sub">{r.profiles?.full_name ?? "Unassigned"}</td>
                    <td className="ta-lead-sub" style={{ whiteSpace: "nowrap" }}>{r.due_date ?? "—"}</td>
                    <td style={{ minWidth: 220 }}>
                      <ActionTransition actionId={r.id} currentStatus={r.status} />
                      {r.corrective_action && r.status !== "resolved" && <div className="ta-lead-sub" style={{ marginTop: 6 }}>✓ {r.corrective_action}</div>}
                      {r.verification_note && r.status !== "verified" && <div className="ta-lead-sub" style={{ marginTop: 6 }}>✓ {r.verification_note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="✓" message="No improvement actions yet. Create an action linked to an issue." />
        )}
      </Card>

      {!dataUnavailable && (
        <Pagination page={page} pageCount={pageCount} basePath="/admin/feedback/actions" query={sp.status ? { status: sp.status } : {}} />
      )}
    </>
  );
}
