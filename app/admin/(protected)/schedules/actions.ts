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
    course_id: v("course_id"),
    trainer_name: v("trainer_name"),
    venue: v("venue"),
    training_mode: v("training_mode"),
    start_date: v("start_date"),
    end_date: v("end_date"),
    start_time: v("start_time"),
    end_time: v("end_time"),
    capacity: formData.get("capacity") ?? 0,
    status: (v("status") || "open") as any,
    is_published: formData.get("is_published") === "on",
    notes: v("notes"),
  };
}

function clean(data: any) {
  const out: any = { ...data };
  for (const k of ["trainer_name", "venue", "training_mode", "start_time", "end_time", "notes"]) {
    if (!out[k]) out[k] = null;
  }
  return out;
}

// TRAINER CONFLICT CHECK DEFERRED UNTIL TRAINERS ARE NORMALIZED.
//
// course_schedules only has a free-text trainer_name column today (no
// trainers table, no trainer_id FK -- see SCHEDULES_ARCHITECTURE_DECISION.md
// §F). A reliable double-booking check requires a stable trainer identity to
// key on; matching on free-text names would silently misbehave on typos/name
// variants and give staff false confidence in a check that isn't reliable.
// createSchedule/updateSchedule below intentionally do NOT attempt a
// trainer-conflict check -- do not add a free-text-matching version as a
// stopgap; wait for a real trainers table.

export async function createSchedule(_prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireRole("admin"); // Editors are read-only.
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("course_schedules").insert(clean(parsed.data));
  if (error) return { message: error.message };
  revalidatePath("/admin/schedules");
  redirect("/admin/schedules");
}

export async function updateSchedule(id: string, _prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireRole("admin");
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("course_schedules").update(clean(parsed.data)).eq("id", id);
  if (error) return { message: error.message };
  revalidatePath("/admin/schedules");
  revalidatePath(`/admin/schedules/${id}`);
  redirect(`/admin/schedules/${id}`);
}

/** Duplicate — clone core fields; reset status to open, no enrollments. */
export async function duplicateSchedule(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { data: src } = await supabase.from("course_schedules").select("*").eq("id", id).single();
  if (!src) return;
  const s: any = src;
  await supabase.from("course_schedules").insert({
    course_id: s.course_id, trainer_name: s.trainer_name, venue: s.venue,
    training_mode: s.training_mode, start_date: s.start_date, end_date: s.end_date,
    start_time: s.start_time, end_time: s.end_time, capacity: s.capacity,
    notes: s.notes, status: "open", is_published: false,
  });
  revalidatePath("/admin/schedules");
}

// "Archive" as a distinct status was removed: cancelled already represents a
// cancelled event, and deleted_at (softDeleteSchedule below) already handles
// removing a schedule from active views -- a third state would overlap both
// (see SCHEDULES_ARCHITECTURE_DECISION.md / this migration's Phase 6 brief).

export async function softDeleteSchedule(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("course_schedules").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/schedules");
}

export async function restoreSchedule(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("course_schedules").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/schedules");
  revalidatePath(`/admin/schedules/${id}`);
}

// --------------------------------------------------------------------
// Participant enrollment (schedule_participants)
// --------------------------------------------------------------------

/**
 * Enroll one or many participants. The active-enrollment uniqueness is a
 * PARTIAL unique index (schedule_id, participant_id) WHERE deleted_at IS
 * NULL AND registration_status <> 'cancelled' -- PostgREST upsert/onConflict
 * cannot target a partial index, so duplicates are pre-filtered with a
 * single batched lookup query instead of a per-row loop; the index remains
 * the race-condition safety net if two requests race past the pre-check.
 */
export async function assignParticipants(scheduleId: string, _prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireRole("admin");
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  if (ids.length === 0) return {};
  const supabase = await createSupabaseServerClient();

  // Active-enrollment lookup first so the capacity check counts NET-NEW
  // participants only: someone already actively enrolled consumes zero
  // additional seats, so the raw selection size would otherwise reject a
  // valid batch that re-picks an enrolled participant.
  const { data: existing } = await supabase
    .from("schedule_participants")
    .select("participant_id")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .in("participant_id", ids);
  const already = new Set((existing ?? []).map((r: any) => r.participant_id as string));
  const rows = ids.filter((id) => !already.has(id)).map((participant_id) => ({ schedule_id: scheduleId, participant_id }));

  // Capacity is enforced here too, not just by the client's disable-the-button
  // check: seats can be taken between page load and submit, and the DB check
  // constraint (seats_taken <= capacity) would then reject the insert silently.
  // Reject with a message instead of trusting the UI or swallowing the error.
  const { data: sched } = await supabase
    .from("course_schedules")
    .select("capacity, seats_taken")
    .eq("id", scheduleId)
    .single();
  if (!sched) return { message: "Schedule not found." };
  const remaining = Math.max((Number(sched.capacity) || 0) - (Number(sched.seats_taken) || 0), 0);
  if (rows.length > remaining) {
    return { message: `Only ${remaining} seat(s) remaining, but ${rows.length} selected. Increase capacity or select fewer participants.` };
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("schedule_participants").insert(rows);
    if (error) return { message: error.message };
  }
  revalidatePath(`/admin/schedules/${scheduleId}`);
  return {};
}

/** "Remove" cancels the enrollment rather than deleting it, so registration
 * history survives and the participant can be re-enrolled later. */
export async function removeParticipant(scheduleId: string, assignmentId: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("schedule_participants").update({ registration_status: "cancelled" }).eq("id", assignmentId);
  revalidatePath(`/admin/schedules/${scheduleId}`);
}
