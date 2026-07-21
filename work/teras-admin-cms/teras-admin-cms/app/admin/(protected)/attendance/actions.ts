"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";

const attendanceSchema = z.object({
  schedule_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  session_date: z.string().date(),
  present: z.coerce.boolean(),
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

const assessmentSchema = z.object({
  schedule_id: z.string().uuid().optional().nullable(),
  participant_id: z.string().uuid(),
  assessment_type: z.string().trim().max(80).optional().or(z.literal("")),
  score: z.coerce.number().min(0).max(100).optional().nullable(),
  max_score: z.coerce.number().min(1).max(100).default(100),
  result: z.enum(["pending", "competent", "not_yet_competent", "pass", "fail"]).default("pending"),
  assessed_at: z.string().date().optional().or(z.literal("")),
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Upsert one attendance record (present/absent) for a participant + date. */
export async function markAttendance(formData: FormData) {
  await requireRole("editor");
  const parsed = attendanceSchema.safeParse({
    schedule_id: formData.get("schedule_id"),
    participant_id: formData.get("participant_id"),
    session_date: formData.get("session_date"),
    present: formData.get("present") === "on" || formData.get("present") === "true",
    remarks: formData.get("remarks") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Invalid attendance input." };

  const supabase = await createSupabaseServerClient();
  // Upsert on (participant_id, session_date) unique constraint.
  const { error } = await supabase
    .from("attendance")
    .upsert(parsed.data, { onConflict: "participant_id,session_date" });
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/admin/attendance`);
  return { ok: true };
}

/** Record an assessment result for a participant. */
export async function recordAssessment(formData: FormData) {
  await requireRole("editor");
  const parsed = assessmentSchema.safeParse({
    schedule_id: formData.get("schedule_id") || null,
    participant_id: formData.get("participant_id"),
    assessment_type: formData.get("assessment_type") ?? "",
    score: formData.get("score") || null,
    max_score: formData.get("max_score") || 100,
    result: formData.get("result") ?? "pending",
    assessed_at: formData.get("assessed_at") || "",
  });
  if (!parsed.success) return { ok: false, message: "Invalid assessment input." };

  const supabase = await createSupabaseServerClient();
  const payload: any = { ...parsed.data };
  if (!payload.assessed_at) delete payload.assessed_at;
  const { error } = await supabase.from("assessments").insert(payload);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/admin/attendance`);
  return { ok: true };
}
