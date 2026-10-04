import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { isAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge } from "../../../../../../components/admin/ui";
import { TaskForm } from "../TaskForm";
import { updateTask } from "../actions";
import { loadStaffOptions } from "../options";
import { TaskStatusActions } from "./TaskStatusActions";
import type { SalesTaskRow } from "../../../../../../lib/sales/crm";
import { normalizeTaskQueueContext, taskQueueFeedbackMessage, taskQueueHref } from "../../../../../../lib/sales/task-queue";

export const metadata = { title: "Task Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; owner?: string; q?: string; page?: string; feedback?: string }>;
}) {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_tasks");
  const { id } = await params;
  const sp = await searchParams;
  const returnContext = normalizeTaskQueueContext(sp);
  const returnHref = taskQueueHref(returnContext);
  const feedbackMessage = taskQueueFeedbackMessage(sp.feedback);
  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase.from("sales_tasks").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!task) notFound();
  const t = task as SalesTaskRow;

  const canManage = isAdmin(profile.role) || t.assigned_to === profile.id || t.created_by === profile.id;
  const staff = await loadStaffOptions();
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  let relatedLink: { label: string; href: string } | null = null;
  if (t.opportunity_id) {
    const { data: opp } = await supabase.from("sales_opportunities").select("opportunity_no").eq("id", t.opportunity_id).maybeSingle();
    if (opp) relatedLink = { label: `Opportunity ${opp.opportunity_no}`, href: `/admin/sales/opportunities/${t.opportunity_id}` };
  } else if (t.lead_metadata_id) {
    relatedLink = { label: "Source Lead", href: `/admin/sales/leads/${t.lead_metadata_id}` };
  } else if (t.quotation_id) {
    const { data: q } = await supabase.from("sales_quotations").select("quotation_no").eq("id", t.quotation_id).maybeSingle();
    if (q) relatedLink = { label: `Quotation ${q.quotation_no}`, href: `/admin/sales/quotations/${t.quotation_id}` };
  }

  return (
    <>
      <PageHead
        title={t.title}
        subtitle={relatedLink ? relatedLink.label : "Not linked to a Sales record"}
        action={<Link href={returnHref} className="ta-btn ta-btn-outline">← Back to Tasks</Link>}
      />
      {feedbackMessage && (
        <div className={`ta-alert ${sp.feedback === "activity-warning" ? "ta-alert-error" : "ta-alert-success"}`} role={sp.feedback === "activity-warning" ? "alert" : "status"}>
          {feedbackMessage}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Badge status={t.status} />
        <Badge status={t.priority} />
        {relatedLink && <Link href={relatedLink.href} style={{ fontSize: 13 }}>{relatedLink.label} →</Link>}
        <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>
          Owner: {t.assigned_to ? staffNames.get(t.assigned_to) ?? "—" : "Unassigned"}
        </span>
      </div>

      <div className="ta-task-detail-layout">
        <div>
          {canManage ? (
            <Card title="Task Details">
              <div className="ta-card-pad">
                <TaskForm action={updateTask.bind(null, t.id)} task={t} staff={staff} mode="edit" returnContext={returnContext} />
              </div>
            </Card>
          ) : (
            <Card title="Task Details">
              <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <p style={{ margin: 0, color: "var(--ta-muted)" }}>
                  Only the assigned owner, the creator, or an Admin can edit this task.
                </p>
                {t.description && <p style={{ margin: 0 }}>{t.description}</p>}
              </div>
            </Card>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {canManage && <TaskStatusActions taskId={t.id} status={t.status} context={returnContext} />}
        </div>
      </div>
    </>
  );
}
