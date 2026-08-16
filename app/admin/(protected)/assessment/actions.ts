"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireAssessment } from "../../../../lib/auth/session";
import { getCurrentProfile } from "../../../../lib/auth/session";
import { isSuperAdmin } from "../../../../lib/auth/rbac";
import { participantSkillResultSchema } from "../../../../lib/validation/schemas";

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
  await requireModuleAccess("assessment");
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
  await requireModuleAccess("assessment");
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
  await requireModuleAccess("assessment");
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

export type SkillsFormState = { message?: string; error?: string };

// A "use server" file may only export async functions at runtime, so this
// stays local (the client's <select> options are instead derived straight
// from participantSkillResultSchema's area enum in AssessmentTable.tsx --
// same source of truth, not a second implementation).
type SkillArea = "theory_session" | "practical_training" | "safety_awareness" | "practical_assessment";
const SKILL_AREAS: readonly SkillArea[] = ["theory_session", "practical_training", "safety_awareness", "practical_assessment"];

/**
 * Business rule, not a DB constraint: participant_skill_results' CHECK
 * allows all four statuses on any area (see 20260811090000_create_
 * participant_skill_results.sql) -- Theory Session / Practical Training /
 * Safety Awareness are completion-only on the certificate, only Practical
 * Assessment is a scored pass/fail. The <select> options already constrain
 * this in the UI, but per-area allowed values are re-checked here too --
 * never trust raw form values for a business rule the DB doesn't encode.
 */
const ALLOWED_STATUS: Record<SkillArea, readonly string[]> = {
  theory_session: ["not_recorded", "completed"],
  practical_training: ["not_recorded", "completed"],
  safety_awareness: ["not_recorded", "completed"],
  practical_assessment: ["not_recorded", "passed", "failed"],
};

/**
 * Saves all four Participant Skills Record areas for one participant on one
 * schedule in a single upsert. Reuses the existing assessment row's `locked`
 * flag as the sole edit gate for this phase, rather than introducing a
 * second, independent lock workflow on participant_skill_results.locked
 * (see Phase 2B report §H) -- that column stays in the table, unused by the
 * UI, for a possible later phase.
 */
export async function updateParticipantSkillResults(
  scheduleId: string,
  _prev: SkillsFormState,
  formData: FormData
): Promise<SkillsFormState> {
  const profile = await requireAssessment(true); // same guard as updateAssessment: admin+trainer
  await requireModuleAccess("assessment");
  const participantId = String(formData.get("participant_id") ?? "");
  if (!participantId) return { error: "Missing participant." };

  const supabase = await createSupabaseServerClient();

  // Same lock check as updateAssessment: the UI hides the form when locked,
  // but a direct call must not be able to write over a locked assessment.
  const { data: existing } = await supabase
    .from("assessments")
    .select("locked")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .maybeSingle();
  if (existing?.locked) return { error: "This participant's assessment is locked." };

  const nowIso = new Date().toISOString();
  const rows: { schedule_id: string; participant_id: string; area: SkillArea; status: string; assessed_by: string; assessed_at: string }[] = [];
  for (const area of SKILL_AREAS) {
    const raw = formData.get(area);
    if (raw === null) continue;
    const status = String(raw);
    if (!ALLOWED_STATUS[area].includes(status)) return { error: `Invalid status for ${area.replace(/_/g, " ")}.` };
    const parsed = participantSkillResultSchema.safeParse({ schedule_id: scheduleId, participant_id: participantId, area, status });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid skills record." };
    rows.push({ schedule_id: scheduleId, participant_id: participantId, area, status, assessed_by: profile.id, assessed_at: nowIso });
  }
  if (rows.length === 0) return { error: "Nothing to save." };

  const { error } = await supabase
    .from("participant_skill_results")
    .upsert(rows, { onConflict: "schedule_id,participant_id,area" });
  if (error) return { error: error.message };

  revalidatePath(`/admin/assessment/${scheduleId}`);
  return { message: "Skills record saved." };
}
