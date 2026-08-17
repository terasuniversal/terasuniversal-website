"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { salesTaskSchema, fieldErrors } from "../../../../../lib/validation/schemas";

export type TaskFormState = { errors?: Record<string, string>; message?: string };

function revalidateTasks(taskId?: string) {
  revalidatePath("/admin/sales/tasks");
  revalidatePath("/admin/sales");
  if (taskId) revalidatePath(`/admin/sales/tasks/${taskId}`);
}

function readForm(formData: FormData) {
  const v = (k: string) => {
    const x = formData.get(k);
    return x === null ? "" : String(x).trim();
  };
  return {
    title: v("title"),
    description: v("description"),
    priority: (v("priority") || "medium") as any,
    due_at: v("due_at"),
    assigned_to: v("assigned_to"),
    lead_metadata_id: v("lead_metadata_id"),
    opportunity_id: v("opportunity_id"),
    quotation_id: v("quotation_id"),
  };
}

/**
 * A task may be linked to none, one, or several of lead/opportunity/
 * quotation (Task 9) — but sales_activity.lead_metadata_id is NOT NULL, so
 * logging a task event requires resolving one via whichever relation is
 * actually set, following the existing FK chain
 * (quotation -> opportunity -> lead) rather than assuming it's on the task
 * directly.
 */
async function resolveLeadMetadataId(
  supabase: any,
  refs: { lead_metadata_id: string | null; opportunity_id: string | null; quotation_id: string | null }
): Promise<string | null> {
  if (refs.lead_metadata_id) return refs.lead_metadata_id;
  if (refs.opportunity_id) {
    const { data } = await supabase.from("sales_opportunities").select("lead_metadata_id").eq("id", refs.opportunity_id).maybeSingle();
    if (data?.lead_metadata_id) return data.lead_metadata_id;
  }
  if (refs.quotation_id) {
    const { data } = await supabase
      .from("sales_quotations")
      .select("sales_opportunities(lead_metadata_id)")
      .eq("id", refs.quotation_id)
      .maybeSingle();
    const leadId = (data as any)?.sales_opportunities?.lead_metadata_id;
    if (leadId) return leadId;
  }
  return null;
}

async function logTaskActivity(supabase: any, taskId: string, leadMetadataId: string | null, type: string, note: string, actorId: string, refs: { opportunity_id: string | null; quotation_id: string | null }) {
  if (!leadMetadataId) return; // No Sales entity relation — the table's own audit trigger is the record of this event.
  await supabase.from("sales_activity").insert({
    lead_metadata_id: leadMetadataId,
    opportunity_id: refs.opportunity_id,
    quotation_id: refs.quotation_id,
    type,
    note,
    actor_id: actorId,
  });
}

export async function createTask(_prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_tasks");
  const raw = readForm(formData);
  const parsed = salesTaskSchema.safeParse(raw);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const assignedTo = parsed.data.assigned_to || null;
  if (assignedTo && assignedTo !== profile.id && !isAdmin(profile.role)) {
    return { message: "Assigning a task to another staff member requires Admin access. You can still create it assigned to yourself." };
  }

  const supabase = await createSupabaseServerClient();
  const refs = {
    lead_metadata_id: parsed.data.lead_metadata_id || null,
    opportunity_id: parsed.data.opportunity_id || null,
    quotation_id: parsed.data.quotation_id || null,
  };
  const { data: created, error } = await supabase
    .from("sales_tasks")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      due_at: parsed.data.due_at ? new Date(parsed.data.due_at).toISOString() : null,
      assigned_to: assignedTo ?? profile.id,
      ...refs,
    })
    .select("id")
    .single();
  if (error) return { message: error.message };

  const leadMetadataId = await resolveLeadMetadataId(supabase, refs);
  await logTaskActivity(supabase, created.id, leadMetadataId, "task_created", `Task created: ${parsed.data.title}`, profile.id, refs);

  revalidateTasks(created.id);
  redirect("/admin/sales/tasks");
}

export async function updateTask(taskId: string, _prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_tasks");
  const parsed = salesTaskSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const assignedTo = parsed.data.assigned_to || null;
  if (assignedTo && !isAdmin(profile.role)) {
    const { data: existing } = await (await createSupabaseServerClient()).from("sales_tasks").select("assigned_to").eq("id", taskId).maybeSingle();
    if (assignedTo !== profile.id && assignedTo !== existing?.assigned_to) {
      return { message: "Reassigning a task to another staff member requires Admin access." };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("sales_tasks")
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      due_at: parsed.data.due_at ? new Date(parsed.data.due_at).toISOString() : null,
      assigned_to: assignedTo,
      lead_metadata_id: parsed.data.lead_metadata_id || null,
      opportunity_id: parsed.data.opportunity_id || null,
      quotation_id: parsed.data.quotation_id || null,
    })
    .eq("id", taskId)
    .select("id")
    .maybeSingle();
  if (error) return { message: error.message };
  if (!updated) return { message: "Task not found, or you don't have permission to edit it (only the owner or an Admin can)." };

  revalidateTasks(taskId);
  redirect(`/admin/sales/tasks`);
}

/**
 * Status transitions — a single action covering in_progress/completed/
 * cancelled/reopened (back to open). Only the three terminal-adjacent
 * transitions log sales_activity (Task 12); in_progress does not, since
 * it's not one of the four listed meaningful event types.
 */
export async function setTaskStatus(taskId: string, newStatus: "in_progress" | "completed" | "cancelled" | "open"): Promise<void> {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_tasks");
  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase
    .from("sales_tasks")
    .select("title, status, lead_metadata_id, opportunity_id, quotation_id, assigned_to, created_by")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return;
  if (!isAdmin(profile.role) && task.assigned_to !== profile.id && task.created_by !== profile.id) return; // RLS would also block this; fail closed here for a clean no-op.

  const patch: Record<string, unknown> = { status: newStatus };
  patch.completed_at = newStatus === "completed" ? new Date().toISOString() : null;

  const { error } = await supabase.from("sales_tasks").update(patch).eq("id", taskId);
  if (error) return;

  const refs = { opportunity_id: task.opportunity_id, quotation_id: task.quotation_id };
  const eventByStatus: Record<string, string | null> = {
    completed: "task_completed",
    cancelled: "task_cancelled",
    open: task.status === "completed" || task.status === "cancelled" ? "task_reopened" : null,
    in_progress: null,
  };
  const eventType = eventByStatus[newStatus];
  if (eventType) {
    await logTaskActivity(supabase, taskId, task.lead_metadata_id, eventType, `${task.title} — ${newStatus.replace("_", " ")}`, profile.id, refs);
  }

  revalidateTasks(taskId);
}

/** Soft-delete — admin+ only, matches sales_tasks_delete RLS. Prefer cancelling a task over deleting it; this exists for genuine mistakes. */
export async function deleteTask(taskId: string): Promise<void> {
  await requireRole("admin");
  await requireModuleAccess("sales_tasks");
  const supabase = await createSupabaseServerClient();
  await supabase.from("sales_tasks").update({ deleted_at: new Date().toISOString() }).eq("id", taskId);
  revalidateTasks();
}
