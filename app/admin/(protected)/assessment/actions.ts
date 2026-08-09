"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireAssessment } from "../../../../lib/auth/session";
import { getCurrentProfile } from "../../../../lib/auth/session";
import { isSuperAdmin } from "../../../../lib/auth/rbac";

const RESULT = z.enum(["pending", "pass", "fail"]);
const COMPETENCY = z.enum(["pending_review", "competent", "not_yet_competent"]);
const TYPE = z.enum(["theory", "practical", "combined"]);
const score = z
  .union([z.literal(""), z.coerce.number().min(0).max(100)])
  .transform((v) => (v === "" ? null : v));

/**
 * Assessment is roster-driven, not auto-created on enrollment: an enrolled
 * participant with no assessment row yet is shown as "not assessed" and this
 * upserts one on first save (onConflict targets the real, non-partial
 * assessments_schedule_participant_key unique constraint -- see
 * SCHEDULES_ARCHITECTURE_DECISION.md §I). Awareness programmes can leave
 * theory_score/practical_score/competency_status all null.
 */
export async function updateAssessment(scheduleId: string, formData: FormData) {
  const profile = await requireAssessment(true);
  const participantId = String(formData.get("participant_id") ?? "");
  if (!participantId) return;

  const parsed = z
    .object({
      assessment_type: TYPE.optional().or(z.literal("")),
      theory_score: score,
      practical_score: score,
      result: RESULT,
      competency_status: COMPETENCY.optional().or(z.literal("")),
      remarks: z.string().max(2000).optional(),
    })
    .safeParse({
      assessment_type: formData.get("assessment_type") ?? "",
      theory_score: formData.get("theory_score") ?? "",
      practical_score: formData.get("practical_score") ?? "",
      result: formData.get("result") ?? "pending",
      competency_status: formData.get("competency_status") ?? "",
      remarks: String(formData.get("remarks") ?? ""),
    });
  if (!parsed.success) return;

  const supabase = await createSupabaseServerClient();

  // The client hides the edit form when locked, but nothing previously
  // stopped a direct call to this action from writing over a locked row.
  // No unlock/override flow exists here besides unlockAssessments (Super
  // Admin only, a separate explicit action) -- reject rather than trust
  // the disabled UI.
  const { data: existing } = await supabase
    .from("assessments")
    .select("locked")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .maybeSingle();
  if (existing?.locked) return;

  await supabase.from("assessments").upsert(
    {
      schedule_id: scheduleId,
      participant_id: participantId,
      assessment_type: parsed.data.assessment_type || null,
      theory_score: parsed.data.theory_score,
      practical_score: parsed.data.practical_score,
      result: parsed.data.result,
      competency_status: parsed.data.competency_status || null,
      remarks: parsed.data.remarks || null,
      assessed_at: new Date().toISOString().slice(0, 10),
      assessor_id: profile.id,
    },
    { onConflict: "schedule_id,participant_id" }
  );
  revalidatePath(`/admin/assessment/${scheduleId}`);
}

/** Bulk-set result for the selected EXISTING assessment rows (a participant
 * with no assessment row yet has nothing to bulk-update). Locked rows are
 * excluded from the update -- a bulk action must not be able to bypass the
 * Super-Admin-only unlock flow just because updateAssessment's per-row
 * check doesn't run on this path. */
export async function bulkUpdateResult(scheduleId: string, formData: FormData) {
  await requireAssessment(true);
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const result = RESULT.safeParse(formData.get("result"));
  if (ids.length === 0 || !result.success) return;
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase.from("assessments").select("id, locked").in("id", ids);
  const unlockedIds = (rows ?? []).filter((r: any) => !r.locked).map((r: any) => r.id as string);
  if (unlockedIds.length === 0) return;

  // Derive competency from the pass/fail choice for convenience.
  const competency = result.data === "pass" ? "competent" : result.data === "fail" ? "not_yet_competent" : "pending_review";
  await supabase.from("assessments").update({ result: result.data, competency_status: competency }).in("id", unlockedIds);
  revalidatePath(`/admin/assessment/${scheduleId}`);
}

/** Lock rows (selected or all) — prevents further edits until unlocked. */
export async function lockAssessments(scheduleId: string, formData: FormData) {
  await requireAssessment(true);
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  let q = supabase.from("assessments").update({ locked: true, locked_at: new Date().toISOString(), locked_by: profile?.id ?? null }).eq("schedule_id", scheduleId);
  if (ids.length > 0) q = q.in("id", ids);
  await q;
  revalidatePath(`/admin/assessment/${scheduleId}`);
}

/** Unlock — Super Admin only. RLS only requires trainer+ on assessments
 * UPDATE (see SCHEDULES_ARCHITECTURE_DECISION.md §N); this app-layer check
 * is the actual enforcement for the super-admin-only unlock rule. */
export async function unlockAssessments(scheduleId: string, formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuperAdmin(profile.role)) return;
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const supabase = await createSupabaseServerClient();
  let q = supabase.from("assessments").update({ locked: false, locked_at: null, locked_by: null }).eq("schedule_id", scheduleId);
  if (ids.length > 0) q = q.in("id", ids);
  await q;
  revalidatePath(`/admin/assessment/${scheduleId}`);
}
