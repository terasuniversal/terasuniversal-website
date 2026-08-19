"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireAssessment } from "../../../../lib/auth/session";
import { getCurrentProfile } from "../../../../lib/auth/session";
import { isSuperAdmin } from "../../../../lib/auth/rbac";
import { participantSkillResultSchema } from "../../../../lib/validation/schemas";
import { UNGROUPED } from "../../../../lib/scheduleGroupContext";

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
      theory_result: RESULT,
      practical_result: RESULT,
      result: RESULT,
      competency_status: COMPETENCY.optional().or(z.literal("")),
      remarks: z.string().max(2000).optional(),
    })
    .safeParse({
      assessment_type: formData.get("assessment_type") ?? "",
      theory_score: formData.get("theory_score") ?? "",
      practical_score: formData.get("practical_score") ?? "",
      theory_result: formData.get("theory_result") ?? "pending",
      practical_result: formData.get("practical_result") ?? "pending",
      result: formData.get("result") ?? "pending",
      competency_status: formData.get("competency_status") ?? "",
      remarks: String(formData.get("remarks") ?? ""),
    });
  if (!parsed.success) return;

  const supabase = await createSupabaseServerClient();

  // Enrollment-integrity hardening: never trust participant_id from the form
  // alone. A participant must have an ACTIVE enrollment in THIS schedule
  // (not soft-deleted, not cancelled) before an assessment row can be
  // created or updated for them -- otherwise a crafted participant_id could
  // create an assessments row for someone never enrolled here, or one whose
  // enrollment was later cancelled. Blocked the same way a locked row is
  // below: a silent no-op, matching this action's existing convention (it's
  // a plain form action, not wired to useActionState, so there is no
  // client-visible error channel to populate here).
  const { data: enrollment } = await supabase
    .from("schedule_participants")
    .select("participant_id")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .maybeSingle();
  if (!enrollment) return;

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
      theory_result: parsed.data.theory_result,
      practical_result: parsed.data.practical_result,
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

/**
 * Bulk-set result for the selected EXISTING assessment rows (a participant
 * with no assessment row yet has nothing to bulk-update). Locked rows are
 * excluded from the update -- a bulk action must not be able to bypass the
 * Super-Admin-only unlock flow just because updateAssessment's per-row
 * check doesn't run on this path.
 *
 * Security fix (Assessment V3 audit): this previously fetched/updated rows
 * by `.in("id", ids)` alone, with no `schedule_id` check -- a crafted POST
 * naming another schedule's assessment ids would have updated them, because
 * RLS only requires admin-or-trainer, not ownership of THIS schedule.
 *
 * Enrollment-integrity hardening (follow-up): every submitted id must now
 * resolve to (a) a real assessment row belonging to THIS schedule, and (b) a
 * participant with an ACTIVE enrollment in THIS schedule (not soft-deleted,
 * not cancelled) -- checked for every context, including "All Groups", not
 * only when a group is selected. When a group context is supplied, the
 * participant's CURRENT `schedule_participants.schedule_group_id` must also
 * match it (Ungrouped means IS NULL) -- no historical snapshot, see
 * lib/scheduleGroupContext.ts.
 *
 * Unlike the read-side page (which safely falls back to "All Groups" on an
 * invalid selection), a write rejects the WHOLE operation the moment any
 * submitted id fails any of these checks, rather than silently updating just
 * the valid subset -- a partial "succeeds for the legitimate ones" response
 * would hide a crafted request that mixes real ids with foreign-schedule,
 * cancelled, or wrong-group ones. Never rely on the UI's "select all in
 * view" -- the DB round-trip re-derives every fact this action needs.
 */
export async function bulkUpdateResult(scheduleId: string, groupId: string | typeof UNGROUPED | null, formData: FormData) {
  await requireAssessment(true);
  await requireModuleAccess("assessment");
  const ids = Array.from(new Set(formData.getAll("ids").map(String).filter(Boolean)));
  const result = RESULT.safeParse(formData.get("result"));
  if (ids.length === 0 || !result.success) return;
  const supabase = await createSupabaseServerClient();

  // Validate the requested group actually belongs to this schedule before
  // using it to scope a write -- an invalid/foreign group id here must
  // reject, not silently widen back to "all participants" the way the
  // read-side page falls back for display.
  if (groupId !== null && groupId !== UNGROUPED) {
    const { data: groupRow } = await supabase
      .from("schedule_groups")
      .select("id")
      .eq("id", groupId)
      .eq("schedule_id", scheduleId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!groupRow) return;
  }

  const { data: rows } = await supabase
    .from("assessments")
    .select("id, participant_id, locked")
    .eq("schedule_id", scheduleId)
    .in("id", ids);
  const candidates = (rows ?? []) as { id: string; participant_id: string; locked: boolean }[];
  // Every submitted id must have resolved to a real, same-schedule row --
  // a foreign-schedule or bogus id fails the whole operation.
  if (candidates.length !== ids.length) return;

  const participantIds = candidates.map((c) => c.participant_id);
  const { data: membership } = await supabase
    .from("schedule_participants")
    .select("participant_id, schedule_group_id, deleted_at, registration_status")
    .eq("schedule_id", scheduleId)
    .in("participant_id", participantIds);
  const membershipByParticipant = new Map<string, { schedule_group_id: string | null; deleted_at: string | null; registration_status: string }>(
    (membership ?? []).map((m: any) => [m.participant_id, m])
  );

  const allValid = candidates.every((c) => {
    const m = membershipByParticipant.get(c.participant_id);
    const activelyEnrolled = !!m && m.deleted_at === null && m.registration_status !== "cancelled";
    if (!activelyEnrolled) return false;
    if (groupId === null) return true; // All Groups: active same-schedule enrollment is sufficient.
    if (groupId === UNGROUPED) return m!.schedule_group_id === null;
    return m!.schedule_group_id === groupId;
  });
  if (!allValid) return;

  const unlockedIds = candidates.filter((r) => !r.locked).map((r) => r.id);
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

  // Same enrollment-integrity check as updateAssessment: never trust
  // participant_id from the form alone. Reachable from the same Assessment
  // UI (the per-row Skills Record form), so it shares the same mutation
  // integrity boundary -- a participant with no active enrollment in this
  // schedule must be blocked before any participant_skill_results write.
  const { data: enrollment } = await supabase
    .from("schedule_participants")
    .select("participant_id")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .maybeSingle();
  if (!enrollment) return { error: "This participant is not actively enrolled in this schedule." };

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
