"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { scheduleSchema, fieldErrors } from "../../../../lib/validation/schemas";

export type ScheduleFormState = { errors?: Record<string, string>; message?: string };

function readForm(formData: FormData) {
  const v = (k: string) => {
    const x = formData.get(k);
    return x === null ? "" : String(x).trim();
  };
  return {
    course_id: v("course_id") || null,
    trainer_id: v("trainer_id") || null,
    course_name: v("course_name"),
    trainer: v("trainer"),
    venue: v("venue"),
    training_mode: v("training_mode"),
    start_date: v("start_date"),
    end_date: v("end_date"),
    start_time: v("start_time"),
    end_time: v("end_time"),
    max_participants: formData.get("max_participants") ?? 0,
    status: (v("status") || "draft") as any,
    remarks: v("remarks"),
  };
}

function clean(data: any) {
  const out: any = { ...data };
  for (const k of ["course_id", "trainer_id", "trainer", "venue", "training_mode", "start_time", "end_time", "remarks"]) {
    if (!out[k]) out[k] = null;
  }
  return out;
}

/**
 * Prevents double-booking a trainer: rejects overlapping date ranges for the
 * same trainer (ignoring cancelled/archived and, on edit, the row itself).
 */
async function trainerConflict(supabase: any, trainerId: string | null, startDate: string, endDate: string, exceptId?: string) {
  if (!trainerId) return false;
  let q = supabase
    .from("training_schedules")
    .select("id", { count: "exact", head: true })
    .eq("trainer_id", trainerId)
    .is("deleted_at", null)
    .not("status", "in", "(cancelled,archived)")
    .lte("start_date", endDate)
    .gte("end_date", startDate);
  if (exceptId) q = q.neq("id", exceptId);
  const { count } = await q;
  return (count ?? 0) > 0;
}

export async function createSchedule(_prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireRole("admin"); // Editors are read-only.
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  if (await trainerConflict(supabase, parsed.data.trainer_id ?? null, parsed.data.start_date, parsed.data.end_date)) {
    return { errors: { trainer_id: "This trainer is already scheduled during these dates." } };
  }
  const { error } = await supabase.from("training_schedules").insert(clean(parsed.data));
  if (error) return { message: error.message };
  revalidatePath("/admin/schedules");
  redirect("/admin/schedules");
}

export async function updateSchedule(id: string, _prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireRole("admin");
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  if (await trainerConflict(supabase, parsed.data.trainer_id ?? null, parsed.data.start_date, parsed.data.end_date, id)) {
    return { errors: { trainer_id: "This trainer is already scheduled during these dates." } };
  }
  const { error } = await supabase.from("training_schedules").update(clean(parsed.data)).eq("id", id);
  if (error) return { message: error.message };
  revalidatePath("/admin/schedules");
  revalidatePath(`/admin/schedules/${id}`);
  redirect(`/admin/schedules/${id}`);
}

/** Duplicate — clone core fields; reset participants + status to draft. */
export async function duplicateSchedule(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { data: src } = await supabase.from("training_schedules").select("*").eq("id", id).single();
  if (!src) return;
  const s: any = src;
  await supabase.from("training_schedules").insert({
    course_id: s.course_id, course_name: s.course_name, trainer: s.trainer, venue: s.venue,
    training_mode: s.training_mode, start_date: s.start_date, end_date: s.end_date,
    start_time: s.start_time, end_time: s.end_time, max_participants: s.max_participants,
    remarks: s.remarks, status: "draft", registered_participants: 0,
  });
  revalidatePath("/admin/schedules");
}

export async function archiveSchedule(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("training_schedules").update({ status: "archived" }).eq("id", id);
  revalidatePath("/admin/schedules");
  revalidatePath(`/admin/schedules/${id}`);
}

export async function softDeleteSchedule(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("training_schedules").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/schedules");
}

export async function restoreSchedule(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("training_schedules").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/schedules");
  revalidatePath(`/admin/schedules/${id}`);
}

// --------------------------------------------------------------------
// Participant assignment
// --------------------------------------------------------------------

/** Assign one or many participants. Duplicates are ignored (unique constraint). */
export async function assignParticipants(scheduleId: string, formData: FormData) {
  await requireRole("admin");
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  if (ids.length === 0) return;
  const supabase = await createSupabaseServerClient();
  // Insert; ignore rows that already exist (duplicate registration).
  const rows = ids.map((participant_id) => ({ schedule_id: scheduleId, participant_id }));
  await supabase.from("schedule_participants").upsert(rows, { onConflict: "schedule_id,participant_id", ignoreDuplicates: true });
  revalidatePath(`/admin/schedules/${scheduleId}`);
}

export async function removeParticipant(scheduleId: string, assignmentId: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("schedule_participants").delete().eq("id", assignmentId);
  revalidatePath(`/admin/schedules/${scheduleId}`);
}
