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

/** Update one assessment (scores / result / competency / remarks). */
export async function updateAssessment(scheduleId: string, formData: FormData) {
  await requireAssessment(true);
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const parsed = z
    .object({
      assessment_type: TYPE,
      theory_score: score,
      practical_score: score,
      result: RESULT,
      competency_status: COMPETENCY,
      remarks: z.string().max(2000).optional(),
    })
    .safeParse({
      assessment_type: formData.get("assessment_type") ?? "combined",
      theory_score: formData.get("theory_score") ?? "",
      practical_score: formData.get("practical_score") ?? "",
      result: formData.get("result") ?? "pending",
      competency_status: formData.get("competency_status") ?? "pending_review",
      remarks: String(formData.get("remarks") ?? ""),
    });
  if (!parsed.success) return;

  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  await (supabase
    .from("assessments") as any)
    .update({
      assessment_type: parsed.data.assessment_type,
      theory_score: parsed.data.theory_score,
      practical_score: parsed.data.practical_score,
      result: parsed.data.result,
      competency_status: parsed.data.competency_status,
      remarks: parsed.data.remarks || null,
      assessment_date: new Date().toISOString().slice(0, 10),
      assessor_id: profile?.id ?? null,
    })
    .eq("id", id);
  revalidatePath(`/admin/assessment/${scheduleId}`);
}

/** Bulk-set result for the selected rows. */
export async function bulkUpdateResult(scheduleId: string, formData: FormData) {
  await requireAssessment(true);
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const result = RESULT.safeParse(formData.get("result"));
  if (ids.length === 0 || !result.success) return;
  const supabase = await createSupabaseServerClient();
  // Derive competency from the pass/fail choice for convenience.
  const competency = result.data === "pass" ? "competent" : result.data === "fail" ? "not_yet_competent" : "pending_review";
  await (supabase.from("assessments") as any).update({ result: result.data, competency_status: competency }).in("id", ids);
  revalidatePath(`/admin/assessment/${scheduleId}`);
}

/** Lock rows (selected or all) — prevents further edits until unlocked. */
export async function lockAssessments(scheduleId: string, formData: FormData) {
  await requireAssessment(true);
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  let q = (supabase.from("assessments") as any).update({ locked: true, locked_at: new Date().toISOString(), locked_by: profile?.id ?? null }).eq("schedule_id", scheduleId);
  if (ids.length > 0) q = q.in("id", ids);
  await q;
  revalidatePath(`/admin/assessment/${scheduleId}`);
}

/** Unlock — Super Admin only (RLS also enforces this). */
export async function unlockAssessments(scheduleId: string, formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuperAdmin(profile.role)) return;
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const supabase = await createSupabaseServerClient();
  let q = (supabase.from("assessments") as any).update({ locked: false, locked_at: null, locked_by: null }).eq("schedule_id", scheduleId);
  if (ids.length > 0) q = q.in("id", ids);
  await q;
  revalidatePath(`/admin/assessment/${scheduleId}`);
}
