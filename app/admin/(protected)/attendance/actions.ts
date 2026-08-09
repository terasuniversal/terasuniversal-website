"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireAttendance } from "../../../../lib/auth/session";

const STATUS = z.enum(["present", "absent", "late", "excused"]);

/** Server-side guard: the UI's day-navigation strip only lets staff pick an
 * in-range date, but nothing stopped a bound action from being invoked with
 * an out-of-range session_date directly. Reject rather than trust the UI. */
async function isSessionDateInRange(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, scheduleId: string, sessionDate: string): Promise<boolean> {
  const { data } = await supabase.from("course_schedules").select("start_date, end_date").eq("id", scheduleId).single();
  if (!data) return false;
  return sessionDate >= data.start_date && sessionDate <= data.end_date;
}

/**
 * Attendance is now per (schedule, participant, session_date) -- rows are
 * no longer auto-created on enrollment (the numbered-track's "auto-create on
 * assign" trigger doesn't make sense once attendance is per-day rather than
 * per-schedule, see SCHEDULES_ARCHITECTURE_DECISION.md §H). Every write here
 * upserts against the real (not partial) unique constraint
 * attendance_schedule_participant_session_key, so a participant with no
 * attendance row yet for a given date is simply "not recorded" in the UI
 * until the trainer marks one.
 */
export async function markAttendance(scheduleId: string, sessionDate: string, formData: FormData) {
  await requireAttendance(true); // trainer or admin
  const participantId = String(formData.get("participant_id") ?? "");
  const status = STATUS.safeParse(formData.get("attendance_status"));
  if (!participantId || !status.success) return;

  const checkIn = String(formData.get("check_in_time") ?? "").trim();
  const checkOut = String(formData.get("check_out_time") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();

  const supabase = await createSupabaseServerClient();
  if (!(await isSessionDateInRange(supabase, scheduleId, sessionDate))) return;

  await supabase.from("attendance").upsert(
    {
      schedule_id: scheduleId,
      participant_id: participantId,
      session_date: sessionDate,
      attendance_status: status.data,
      check_in_time: checkIn ? new Date(checkIn).toISOString() : null,
      check_out_time: checkOut ? new Date(checkOut).toISOString() : null,
      remarks: remarks || null,
    },
    { onConflict: "schedule_id,participant_id,session_date" }
  );
  revalidatePath(`/admin/attendance/${scheduleId}`);
}

/** Mark every selected (enrolled) participant Present for a session date. */
export async function markAllPresent(scheduleId: string, sessionDate: string, formData: FormData) {
  await requireAttendance(true);
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  if (ids.length === 0) return;
  const supabase = await createSupabaseServerClient();
  if (!(await isSessionDateInRange(supabase, scheduleId, sessionDate))) return;

  const rows = ids.map((participant_id) => ({
    schedule_id: scheduleId,
    participant_id,
    session_date: sessionDate,
    attendance_status: "present" as const,
    check_in_time: new Date().toISOString(),
  }));
  await supabase.from("attendance").upsert(rows, { onConflict: "schedule_id,participant_id,session_date" });
  revalidatePath(`/admin/attendance/${scheduleId}`);
}

/** Bulk-set a status for the selected participants on a session date. */
export async function bulkUpdateAttendance(scheduleId: string, sessionDate: string, formData: FormData) {
  await requireAttendance(true);
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  const status = STATUS.safeParse(formData.get("status"));
  if (ids.length === 0 || !status.success) return;
  const supabase = await createSupabaseServerClient();
  if (!(await isSessionDateInRange(supabase, scheduleId, sessionDate))) return;

  const rows = ids.map((participant_id) => ({ schedule_id: scheduleId, participant_id, session_date: sessionDate, attendance_status: status.data }));
  await supabase.from("attendance").upsert(rows, { onConflict: "schedule_id,participant_id,session_date" });
  revalidatePath(`/admin/attendance/${scheduleId}`);
}

/** Undo: delete the attendance row for the selected participants on this
 * session date, reverting them to "not recorded" (there is no "pending"
 * status value in the live enum -- see SCHEDULES_ARCHITECTURE_DECISION.md §G). */
export async function resetAttendance(scheduleId: string, sessionDate: string, formData: FormData) {
  await requireAttendance(true);
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  if (ids.length === 0) return;
  const supabase = await createSupabaseServerClient();
  if (!(await isSessionDateInRange(supabase, scheduleId, sessionDate))) return;

  await supabase
    .from("attendance")
    .delete()
    .eq("schedule_id", scheduleId)
    .eq("session_date", sessionDate)
    .in("participant_id", ids);
  revalidatePath(`/admin/attendance/${scheduleId}`);
}
