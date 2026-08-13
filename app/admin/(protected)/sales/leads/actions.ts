"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import {
  salesLeadStatusSchema,
  salesLeadAssignSchema,
  salesLeadNoteSchema,
  salesLeadFollowUpSchema,
  fieldErrors,
} from "../../../../../lib/validation/schemas";
import { LOST_REASON_LABELS, type SalesCrmLostReason } from "../../../../../lib/sales/crm";

export type SalesActionState = { message?: string; errors?: Record<string, string> };

function revalidateLead(id: string) {
  revalidatePath(`/admin/sales/leads/${id}`);
  revalidatePath("/admin/sales/leads");
  revalidatePath("/admin/sales");
}

async function logActivity(
  supabase: any,
  leadMetadataId: string,
  type: string,
  note: string | null,
  actorId: string
) {
  await supabase.from("sales_activity").insert({ lead_metadata_id: leadMetadataId, type, note, actor_id: actorId });
}

/** Status transitions (incl. Mark Won / Mark Lost) — admin+ only, per sales_lead_metadata's RLS. */
export async function updateLeadStatus(
  leadMetadataId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  const parsed = salesLeadStatusSchema.safeParse({
    status: formData.get("status"),
    lost_reason: formData.get("lost_reason") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { status, lost_reason } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    lost_reason: status === "lost" ? lost_reason : null,
    won_at: status === "won" ? new Date().toISOString() : null,
  };
  const { error } = await supabase.from("sales_lead_metadata").update(patch).eq("id", leadMetadataId);
  if (error) return { message: error.message };

  const activityType = status === "won" ? "won" : status === "lost" ? "lost" : "status_changed";
  const note =
    status === "lost" && lost_reason
      ? `Marked lost — reason: ${LOST_REASON_LABELS[lost_reason as SalesCrmLostReason]}`
      : `Status changed to ${status.replace(/_/g, " ")}`;
  await logActivity(supabase, leadMetadataId, activityType, note, profile.id);

  revalidateLead(leadMetadataId);
  return {};
}

/** Assignment — admin+ only, per sales_lead_metadata's RLS. */
export async function assignLead(
  leadMetadataId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  const parsed = salesLeadAssignSchema.safeParse({ assigned_to: formData.get("assigned_to") ?? "" });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const assignedTo = parsed.data.assigned_to || null;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sales_lead_metadata")
    .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
    .eq("id", leadMetadataId);
  if (error) return { message: error.message };

  let assigneeName = "Unassigned";
  if (assignedTo) {
    const { data: assignee } = await supabase.from("profiles").select("full_name").eq("id", assignedTo).maybeSingle();
    assigneeName = assignee?.full_name || "a staff member";
  }
  await logActivity(supabase, leadMetadataId, "assigned", `Assigned to ${assigneeName}`, profile.id);

  revalidateLead(leadMetadataId);
  return {};
}

/** Follow-up date/priority — admin+ only, per sales_lead_metadata's RLS. */
export async function setLeadFollowUp(
  leadMetadataId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  const parsed = salesLeadFollowUpSchema.safeParse({
    follow_up_at: formData.get("follow_up_at") ?? "",
    priority: formData.get("priority") || undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const followUpAt = parsed.data.follow_up_at ? new Date(parsed.data.follow_up_at).toISOString() : null;

  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = { follow_up_at: followUpAt, updated_at: new Date().toISOString() };
  if (parsed.data.priority) patch.priority = parsed.data.priority;
  const { error } = await supabase.from("sales_lead_metadata").update(patch).eq("id", leadMetadataId);
  if (error) return { message: error.message };

  if (followUpAt) {
    await logActivity(
      supabase,
      leadMetadataId,
      "followup_scheduled",
      `Follow-up set for ${new Date(followUpAt).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}`,
      profile.id
    );
  }

  revalidateLead(leadMetadataId);
  return {};
}

/**
 * Notes — editor+ (lower bar than status/assignment, per sales_activity's
 * own RLS: adding a note doesn't change the lead's pipeline disposition).
 * Append-only: this always inserts a new activity row, never edits one.
 */
export async function addLeadNote(
  leadMetadataId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("editor");
  const parsed = salesLeadNoteSchema.safeParse({ note: formData.get("note") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sales_activity")
    .insert({ lead_metadata_id: leadMetadataId, type: "note_added", note: parsed.data.note, actor_id: profile.id });
  if (error) return { message: error.message };

  revalidateLead(leadMetadataId);
  return {};
}
