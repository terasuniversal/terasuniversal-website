"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { createSupabaseServerClient, createSupabaseServiceClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { writeAuditEvent } from "../../../../lib/audit/server";
import {
  feedbackGenerateLinksSchema,
  feedbackReopenSchema,
  feedbackIssueSchema,
  feedbackActionSchema,
  feedbackActionTransitionSchema,
  feedbackActionAssignSchema,
  fieldErrors,
} from "../../../../lib/validation/schemas";

export interface FeedbackActionState {
  errors?: Record<string, string>;
  message?: string;
}

export interface FeedbackLinkActionState {
  ok: boolean;
  message?: string;
  createdCount?: number;
}

export interface ClassFeedbackLinkActionState {
  ok: boolean;
  message?: string;
  publicToken?: string;
}

/** Allowed improvement-action transitions — mirrored by the DB trigger. */
const ACTION_TRANSITIONS: Record<string, string[]> = {
  open: ["assigned"],
  assigned: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["verified"],
  verified: ["closed"],
};

const ISSUE_TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["closed"],
};

function readString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Create pending feedback links for every eligible participant in a schedule. */
export async function generateFeedbackLinks(
  scheduleId: string,
  _prev: FeedbackLinkActionState,
  _formData: FormData
): Promise<FeedbackLinkActionState> {
  await requireRole("editor");
  await requireModuleAccess("feedback");
  const parsed = feedbackGenerateLinksSchema.safeParse({ schedule_id: scheduleId });
  if (!parsed.success) {
    return { ok: false, message: "Invalid schedule." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("feedback_generate_links", { p_schedule_id: parsed.data.schedule_id });
  if (error) {
    console.error("generateFeedbackLinks: feedback_generate_links RPC failed", { scheduleId, code: error.code, message: error.message });
    return { ok: false, message: "Unable to generate feedback links. Please try again or contact an administrator." };
  }

  const created = Number(data?.[0]?.created_count ?? 0);
  await writeAuditEvent({
    action: "create",
    entityType: "participant_feedback",
    entityId: scheduleId,
    summary: `Generated ${created} participant feedback link(s)`,
  });

  revalidatePath(`/admin/feedback/${scheduleId}`);
  revalidatePath(`/admin/schedules/${scheduleId}`);

  const message = created > 0
    ? `${created} feedback link${created === 1 ? "" : "s"} generated successfully.`
    : "All eligible participants already have a feedback link.";
  return { ok: true, createdCount: created, message };
}

/** Create a single opaque, revocable class-feedback entry link. The row is
 * only ever read/written by this editor-guarded server action via service
 * role; it is never exposed to the public browser as a database record. */
export async function getOrCreateClassFeedbackLink(
  scheduleId: string
): Promise<ClassFeedbackLinkActionState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("feedback");
  const parsed = feedbackGenerateLinksSchema.safeParse({ schedule_id: scheduleId });
  if (!parsed.success) return { ok: false, message: "Invalid schedule." };

  const service = createSupabaseServiceClient();
  const { data: existing, error: existingError } = await service
    .from("feedback_schedule_links")
    .select("public_token, is_active")
    .eq("schedule_id", parsed.data.schedule_id)
    .maybeSingle();

  if (existingError) {
    console.error("getOrCreateClassFeedbackLink: existing-link lookup failed", { scheduleId, code: existingError.code });
    return { ok: false, message: "Unable to prepare the class feedback link." };
  }
  if (existing?.is_active) return { ok: true, publicToken: existing.public_token };
  if (existing && !existing.is_active) {
    return { ok: false, message: "This class feedback link is disabled. Contact an administrator to re-enable it." };
  }

  const publicToken = randomBytes(32).toString("base64url");
  const { data: created, error: createError } = await service
    .from("feedback_schedule_links")
    .insert({ schedule_id: parsed.data.schedule_id, public_token: publicToken, created_by: profile.id })
    .select("public_token")
    .single();

  if (createError) {
    // The unique schedule constraint is the concurrency backstop. A parallel
    // trusted request may have created the row first, in which case return it.
    if (createError.code === "23505") {
      const { data: concurrent } = await service
        .from("feedback_schedule_links")
        .select("public_token, is_active")
        .eq("schedule_id", parsed.data.schedule_id)
        .maybeSingle();
      if (concurrent?.is_active) return { ok: true, publicToken: concurrent.public_token };
    }
    console.error("getOrCreateClassFeedbackLink: link creation failed", { scheduleId, code: createError.code });
    return { ok: false, message: "Unable to create the class feedback link." };
  }

  revalidatePath(`/admin/feedback/${scheduleId}`);
  return { ok: true, publicToken: created.public_token };
}

/** Reopen a submitted feedback so the participant may resubmit (audited). */
export async function reopenFeedback(feedbackId: string): Promise<void> {
  await requireRole("editor");
  await requireModuleAccess("feedback_responses");
  const parsed = feedbackReopenSchema.safeParse({ feedback_id: feedbackId });
  if (!parsed.success) return;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("feedback_reopen", { p_feedback_id: parsed.data.feedback_id });
  if (error || data !== true) return;

  revalidatePath("/admin/feedback/responses");
  revalidatePath("/admin/feedback");
}

/** Create a feedback issue from actionable feedback (manual, admin-initiated). */
export async function createIssue(_prev: FeedbackActionState, formData: FormData): Promise<FeedbackActionState> {
  await requireRole("editor");
  await requireModuleAccess("feedback_issues");
  const parsed = feedbackIssueSchema.safeParse({
    source_feedback_id: readString(formData, "source_feedback_id") || null,
    schedule_id: readString(formData, "schedule_id") || null,
    category: readString(formData, "category"),
    department: readString(formData, "department"),
    title: readString(formData, "title"),
    description: readString(formData, "description"),
    priority: readString(formData, "priority"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("feedback_issues")
    .insert({
      source_feedback_id: parsed.data.source_feedback_id,
      schedule_id: parsed.data.schedule_id,
      category: parsed.data.category || null,
      department: parsed.data.department || null,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
    })
    .select("id")
    .single();
  if (error) return { message: "Could not create the issue." };

  await writeAuditEvent({
    action: "create",
    entityType: "feedback_issues",
    entityId: data?.id,
    summary: `Created feedback issue: ${parsed.data.title}`,
  });

  revalidatePath("/admin/feedback/issues");
  revalidatePath("/admin/feedback");
  return { message: "Issue created." };
}

/** Update an issue's status. */
export async function updateIssueStatus(issueId: string, formData: FormData): Promise<void> {
  await requireRole("editor");
  await requireModuleAccess("feedback_issues");
  const status = readString(formData, "status");
  if (!["open", "in_progress", "resolved", "closed"].includes(status)) return;

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase.from("feedback_issues").select("status").eq("id", issueId).single();
  if (!current || !ISSUE_TRANSITIONS[current.status as string]?.includes(status)) return;

  const { error } = await supabase.from("feedback_issues").update({ status }).eq("id", issueId);
  if (error) return;

  await writeAuditEvent({
    action: "update",
    entityType: "feedback_issues",
    entityId: issueId,
    summary: `Feedback issue transitioned from ${current.status} to ${status}`,
    metadata: { previous_status: current.status, new_status: status },
  });

  revalidatePath("/admin/feedback/issues");
}

/** Create an improvement action linked to an issue. */
export async function createAction(_prev: FeedbackActionState, formData: FormData): Promise<FeedbackActionState> {
  await requireRole("editor");
  await requireModuleAccess("feedback_actions");
  const parsed = feedbackActionSchema.safeParse({
    issue_id: readString(formData, "issue_id"),
    schedule_id: readString(formData, "schedule_id") || null,
    category: readString(formData, "category"),
    department: readString(formData, "department"),
    title: readString(formData, "title"),
    description: readString(formData, "description"),
    priority: readString(formData, "priority"),
    assigned_to: readString(formData, "assigned_to") || null,
    due_date: readString(formData, "due_date"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("feedback_improvement_actions")
    .insert({
      issue_id: parsed.data.issue_id,
      schedule_id: parsed.data.schedule_id,
      category: parsed.data.category || null,
      department: parsed.data.department || null,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      assigned_to: parsed.data.assigned_to,
      due_date: parsed.data.due_date || null,
    })
    .select("id")
    .single();
  if (error) return { message: "Could not create the improvement action." };

  await writeAuditEvent({
    action: "create",
    entityType: "feedback_improvement_actions",
    entityId: data?.id,
    summary: `Created improvement action: ${parsed.data.title}`,
  });

  if (parsed.data.assigned_to) {
    await writeAuditEvent({
      action: "assign",
      entityType: "feedback_improvement_actions",
      entityId: data?.id,
      summary: "Assigned improvement action on creation",
      metadata: { assigned_to: parsed.data.assigned_to },
    });
  }

  revalidatePath("/admin/feedback/actions");
  revalidatePath("/admin/feedback");
  return { message: "Improvement action created." };
}

/** Transition an improvement action, enforcing the workflow in the app layer
 *  (the DB trigger is the backstop). RESOLVED -> CLOSED is blocked. */
export async function transitionAction(
  actionId: string,
  _prev: FeedbackActionState,
  formData: FormData
): Promise<FeedbackActionState> {
  await requireRole("editor");
  await requireModuleAccess("feedback_actions");
  const parsed = feedbackActionTransitionSchema.safeParse({
    action_id: actionId,
    status: readString(formData, "status"),
    corrective_action: readString(formData, "corrective_action"),
    verification_note: readString(formData, "verification_note"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("feedback_improvement_actions")
    .select("status")
    .eq("id", parsed.data.action_id)
    .single();
  if (!current) return { message: "Improvement action not found." };

  const allowed = ACTION_TRANSITIONS[current.status as string];
  if (!allowed?.includes(parsed.data.status)) {
    return {
      message: `Cannot move from ${current.status.replace(/_/g, " ")} to ${parsed.data.status.replace(/_/g, " ")}. Resolved actions must be verified before they can be closed.`,
    };
  }

  const patch: Record<string, string | null> = { status: parsed.data.status };
  if (parsed.data.status === "resolved") patch.corrective_action = parsed.data.corrective_action || null;
  if (parsed.data.status === "verified") patch.verification_note = parsed.data.verification_note || null;

  const { error } = await supabase.from("feedback_improvement_actions").update(patch).eq("id", parsed.data.action_id);
  if (error) return { message: error.message ?? "Could not update the improvement action." };

  await writeAuditEvent({
    action: "update",
    entityType: "feedback_improvement_actions",
    entityId: parsed.data.action_id,
    summary: `Improvement action transitioned to ${parsed.data.status}`,
    metadata: { previous_status: current.status, new_status: parsed.data.status },
  });

  revalidatePath("/admin/feedback/actions");
  return { message: `Action moved to ${parsed.data.status.replace(/_/g, " ")}.` };
}

/** Assign an improvement action to a staff member. */
export async function assignAction(actionId: string, _prev: FeedbackActionState, formData: FormData): Promise<FeedbackActionState> {
  await requireRole("editor");
  await requireModuleAccess("feedback_actions");
  const parsed = feedbackActionAssignSchema.safeParse({
    action_id: actionId,
    assigned_to: readString(formData, "assigned_to") || null,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("feedback_improvement_actions")
    .update({ assigned_to: parsed.data.assigned_to })
    .eq("id", parsed.data.action_id);
  if (error) return { message: "Could not assign the improvement action." };

  await writeAuditEvent({
    action: "assign",
    entityType: "feedback_improvement_actions",
    entityId: parsed.data.action_id,
    summary: parsed.data.assigned_to ? "Assigned improvement action" : "Cleared improvement action assignment",
  });

  revalidatePath("/admin/feedback/actions");
  return {};
}
