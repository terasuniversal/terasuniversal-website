"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireAttendance } from "../../../../lib/auth/session";
import { malaysiaDateTimeLocalToUtcIso } from "../../../../lib/malaysia-date-time";

const STATUS = z.enum(["present", "absent", "late", "excused"]);
type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type AttendanceOperation = "mark" | "mark_all_present" | "bulk_update" | "reset";
type FailureReason = "invalid_enrollment" | "invalid_date" | "invalid_input" | "database_error";
export type AttendanceMutationState = { message?: string; error?: string };

/** Server-side guard: the UI's day-navigation strip only lets staff pick an
 * in-range date, but nothing stopped a bound action from being invoked with
 * an out-of-range session_date directly. Reject rather than trust the UI. */
export async function isSessionDateInRange(supabase: SupabaseServerClient, scheduleId: string, sessionDate: string): Promise<boolean> {
  const { data, error } = await supabase.from("course_schedules").select("start_date, end_date").eq("id", scheduleId).single();
  if (error) throw error;
  if (!data) return false;
  return sessionDate >= data.start_date && sessionDate <= data.end_date;
}

function mutationFailure(operation: AttendanceOperation, scheduleId: string, sessionDate: string, reason: FailureReason): never {
  console.error("Attendance mutation failed", { operation, scheduleId, sessionDate, reason });
  redirect(`/admin/attendance/${scheduleId}?${new URLSearchParams({ date: sessionDate, attendance_error: reason }).toString()}`);
}

async function requireActiveEnrollment(
  supabase: SupabaseServerClient,
  scheduleId: string,
  participantIds: string[],
  operation: AttendanceOperation,
  sessionDate: string,
) {
  const uniqueIds = [...new Set(participantIds)];
  const { data, error } = await supabase
    .from("schedule_participants")
    .select("participant_id")
    .eq("schedule_id", scheduleId)
    .in("participant_id", uniqueIds)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled");
  if (error) mutationFailure(operation, scheduleId, sessionDate, "database_error");
  const enrolled = new Set((data ?? []).map((row: { participant_id: string }) => row.participant_id));
  if (uniqueIds.some((participantId) => !enrolled.has(participantId))) {
    mutationFailure(operation, scheduleId, sessionDate, "invalid_enrollment");
  }
}

async function requireValidSessionDate(supabase: SupabaseServerClient, scheduleId: string, sessionDate: string, operation: AttendanceOperation) {
  let inRange = false;
  try {
    inRange = await isSessionDateInRange(supabase, scheduleId, sessionDate);
  } catch {
    mutationFailure(operation, scheduleId, sessionDate, "database_error");
  }
  if (!inRange) mutationFailure(operation, scheduleId, sessionDate, "invalid_date");
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
export async function markAttendance(scheduleId: string, sessionDate: string, _prev: AttendanceMutationState, formData: FormData): Promise<AttendanceMutationState> {
  await requireAttendance(true);
  await requireModuleAccess("attendance");
  const participantId = String(formData.get("participant_id") ?? "");
  const status = STATUS.safeParse(formData.get("attendance_status"));
  if (!participantId || !status.success) mutationFailure("mark", scheduleId, sessionDate, "invalid_input");

  const checkIn = String(formData.get("check_in_time") ?? "").trim();
  const checkOut = String(formData.get("check_out_time") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();

  let checkInIso: string | null = null;
  let checkOutIso: string | null = null;
  try {
    checkInIso = checkIn ? malaysiaDateTimeLocalToUtcIso(checkIn) : null;
    checkOutIso = checkOut ? malaysiaDateTimeLocalToUtcIso(checkOut) : null;
  } catch {
    mutationFailure("mark", scheduleId, sessionDate, "invalid_input");
  }

  const supabase = await createSupabaseServerClient();
  await requireValidSessionDate(supabase, scheduleId, sessionDate, "mark");
  await requireActiveEnrollment(supabase, scheduleId, [participantId], "mark", sessionDate);

  const { error } = await supabase.from("attendance").upsert(
    {
      schedule_id: scheduleId,
      participant_id: participantId,
      session_date: sessionDate,
      attendance_status: status.data,
      check_in_time: checkInIso,
      check_out_time: checkOutIso,
      remarks: remarks || null,
    },
    { onConflict: "schedule_id,participant_id,session_date" },
  );
  if (error) mutationFailure("mark", scheduleId, sessionDate, "database_error");
  revalidatePath(`/admin/attendance/${scheduleId}`);
  return { message: "Attendance saved." };
}

/** Mark every selected (enrolled) participant Present for a session date. */
export async function markAllPresent(scheduleId: string, sessionDate: string, _prev: AttendanceMutationState, formData: FormData): Promise<AttendanceMutationState> {
  await requireAttendance(true);
  await requireModuleAccess("attendance");
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  if (ids.length === 0) mutationFailure("mark_all_present", scheduleId, sessionDate, "invalid_input");
  const supabase = await createSupabaseServerClient();
  await requireValidSessionDate(supabase, scheduleId, sessionDate, "mark_all_present");
  await requireActiveEnrollment(supabase, scheduleId, ids, "mark_all_present", sessionDate);

  const rows = ids.map((participant_id) => ({
    schedule_id: scheduleId,
    participant_id,
    session_date: sessionDate,
    attendance_status: "present" as const,
    check_in_time: new Date().toISOString(),
  }));
  const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "schedule_id,participant_id,session_date" });
  if (error) mutationFailure("mark_all_present", scheduleId, sessionDate, "database_error");
  revalidatePath(`/admin/attendance/${scheduleId}`);
  return { message: "Attendance updated." };
}

/** Bulk-set a status for the selected participants on a session date. */
export async function bulkUpdateAttendance(scheduleId: string, sessionDate: string, _prev: AttendanceMutationState, formData: FormData): Promise<AttendanceMutationState> {
  await requireAttendance(true);
  await requireModuleAccess("attendance");
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  const status = STATUS.safeParse(formData.get("status"));
  if (ids.length === 0 || !status.success) mutationFailure("bulk_update", scheduleId, sessionDate, "invalid_input");
  const supabase = await createSupabaseServerClient();
  await requireValidSessionDate(supabase, scheduleId, sessionDate, "bulk_update");
  await requireActiveEnrollment(supabase, scheduleId, ids, "bulk_update", sessionDate);

  const rows = ids.map((participant_id) => ({ schedule_id: scheduleId, participant_id, session_date: sessionDate, attendance_status: status.data }));
  const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "schedule_id,participant_id,session_date" });
  if (error) mutationFailure("bulk_update", scheduleId, sessionDate, "database_error");
  revalidatePath(`/admin/attendance/${scheduleId}`);
  return { message: "Attendance updated." };
}

/** Undo: delete the attendance row for the selected participants on this
 * session date, reverting them to "not recorded" (there is no "pending"
 * status value in the live enum -- see SCHEDULES_ARCHITECTURE_DECISION.md §G). */
export async function resetAttendance(scheduleId: string, sessionDate: string, _prev: AttendanceMutationState, formData: FormData): Promise<AttendanceMutationState> {
  await requireAttendance(true);
  await requireModuleAccess("attendance");
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  if (ids.length === 0) mutationFailure("reset", scheduleId, sessionDate, "invalid_input");
  const supabase = await createSupabaseServerClient();
  await requireValidSessionDate(supabase, scheduleId, sessionDate, "reset");
  await requireActiveEnrollment(supabase, scheduleId, ids, "reset", sessionDate);

  const { error } = await supabase
    .from("attendance")
    .delete()
    .eq("schedule_id", scheduleId)
    .eq("session_date", sessionDate)
    .in("participant_id", ids);
  if (error) mutationFailure("reset", scheduleId, sessionDate, "database_error");
  revalidatePath(`/admin/attendance/${scheduleId}`);
  return { message: "Attendance reset." };
}
