import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess, hasModuleAccess, hasModuleCapability } from "../../../../../../lib/auth/session";
import { isAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge } from "../../../../../../components/admin/ui";
import { TaskForm } from "../TaskForm";
import { updateTask } from "../actions";
import { loadStaffOptions } from "../options";
import { TaskStatusActions } from "./TaskStatusActions";
import type { SalesTaskRow } from "../../../../../../lib/sales/crm";
import { isTaskQueueWarning, normalizeTaskQueueContext, taskQueueFeedbackMessage, taskQueueHref } from "../../../../../../lib/sales/task-queue";

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
  const canEdit = await hasModuleAccess("sales_tasks", "edit");
  // Managing others' tasks: admin role (as before) or sales_tasks at Admin level; Editors manage their own.
  const canManageOthers = (isAdmin(profile.role) || (await hasModuleCapability("sales_tasks", "admin", profile)));
  const { id } = await params;
  const sp = await searchParams;
  const returnContext = normalizeTaskQueueContext(sp);
  const returnHref = taskQueueHref(returnContext);
  const feedbackMessage = taskQueueFeedbackMessage(sp.feedback);
  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase.from("sales_tasks").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!task) notFound();
  const t = task as SalesTaskRow;

  const canManage = canEdit && (canManageOthers || t.assigned_to === profile.id || t.created_by === profile.id);
  const staff = await loadStaffOptions();
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  // A related-record link is only rendered as a link when the user can open that module; otherwise the
  // label is shown as plain text, so the page never sends the user to No Access (UAT F-U6).
  let relatedLink: { label: string; href: string | null } | null = null;
  if (t.opportunity_id) {
    const { data: opp } = await supabase.from("sales_opportunities").select("opportunity_no").eq("id", t.opportunity_id).maybeSingle();
    if (opp) relatedLink = { label: `Opportunity ${opp.opportunity_no}`, href: (await hasModuleAccess("sales_opportunities")) ? `/admin/sales/opportunities/${t.opportunity_id}` : null };
  } else if (t.lead_metadata_id) {
    relatedLink = { label: "Source Lead", href: (await hasModuleAccess("sales_leads")) ? `/admin/sales/leads/${t.lead_metadata_id}` : null };
  } else if (t.quotation_id) {
    const { data: q } = await supabase.from("sales_quotations").select("quotation_no").eq("id", t.quotation_id).maybeSingle();
    if (q) relatedLink = { label: `Quotation ${q.quotation_no}`, href: (await hasModuleAccess("sales_quotations")) ? `/admin/sales/quotations/${t.quotation_id}` : null };
  }
  // Name the exact reason edits are unavailable (UAT F-U9): View access is not the same as not being the owner.
  // Completed/cancelled tasks are read-only until reopened via the status actions (UAT F-UAT-3); updateTask enforces it too.
  const isClosed = t.status === "completed" || t.status === "cancelled";
  const readOnlyReason = !canEdit
    ? "You have view-only access to Tasks. Changes require Edit access."
    : "Only the assigned owner, the creator, or an Admin can edit this task.";

  return (
    <>
      <PageHead
        title={t.title}
        subtitle={relatedLink ? relatedLink.label : "Not linked to a Sales record"}
        action={<Link href={returnHref} className="ta-btn ta-btn-outline">← Back to Tasks</Link>}
      />
      {feedbackMessage && (
        <div className={`ta-alert ${isTaskQueueWarning(sp.feedback) ? "ta-alert-error" : "ta-alert-success"}`} role={isTaskQueueWarning(sp.feedback) ? "alert" : "status"}>
          {feedbackMessage}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Badge status={t.status} />
        <Badge status={t.priority} />
        {relatedLink && (relatedLink.href
          ? <Link href={relatedLink.href} style={{ fontSize: 13 }}>{relatedLink.label} →</Link>
          : <span style={{ fontSize: 13, color: "var(--ta-muted)" }}>{relatedLink.label}</span>)}
        <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>
          Owner: {t.assigned_to ? staffNames.get(t.assigned_to) ?? "Another staff member" : "Unassigned"}
        </span>
      </div>

      <div className="ta-task-detail-layout">
        <div>
          {canManage && isClosed ? (
            <Card title="Task Details">
              <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <p style={{ margin: 0, color: "var(--ta-muted)" }}>
                  This task is {t.status === "completed" ? "completed" : "cancelled"} and read-only. Reopen it to make changes.
                </p>
                {t.description && <p style={{ margin: 0 }}>{t.description}</p>}
              </div>
            </Card>
          ) : canManage ? (
            <Card title="Task Details">
              <div className="ta-card-pad">
                <TaskForm action={updateTask.bind(null, t.id)} task={t} staff={staff} mode="edit" returnContext={returnContext} />
              </div>
            </Card>
          ) : (
            <Card title="Task Details">
              <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <p style={{ margin: 0, color: "var(--ta-muted)" }}>
                  {readOnlyReason}
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
