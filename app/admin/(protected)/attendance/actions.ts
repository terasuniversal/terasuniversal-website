"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireAttendance } from "../../../../lib/auth/session";

const STATUS = z.enum(["pending", "present", "absent", "late", "medical_leave", "excused"]);

/** Update one attendance record (status / times / remarks). */
export async function updateAttendance(scheduleId: string, formData: FormData) {
  await requireAttendance(true); // trainer or admin
  const id = String(formData.get("id") ?? "");
  const status = STATUS.safeParse(formData.get("status"));
  if (!id || !status.success) return;

  const checkIn = String(formData.get("check_in_time") ?? "").trim();
  const checkOut = String(formData.get("check_out_time") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();

  const supabase = await createSupabaseServerClient();
  await (supabase
    .from("attendance") as any)
    .update({
      attendance_status: status.data,
      check_in_time: checkIn ? new Date(checkIn).toISOString() : null,
      check_out_time: checkOut ? new Date(checkOut).toISOString() : null,
      remarks: remarks || null,
    })
    .eq("id", id);
  revalidatePath(`/admin/attendance/${scheduleId}`);
}

/** Mark every participant in a schedule as Present (stamps check-in now). */
export async function markAllPresent(scheduleId: string) {
  await requireAttendance(true);
  const supabase = await createSupabaseServerClient();
  await (supabase
    .from("attendance") as any)
    .update({ attendance_status: "present", check_in_time: new Date().toISOString() })
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);
  revalidatePath(`/admin/attendance/${scheduleId}`);
}

/** Bulk-set a status for the selected attendance rows. */
export async function bulkUpdateAttendance(scheduleId: string, formData: FormData) {
  await requireAttendance(true);
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const status = STATUS.safeParse(formData.get("status"));
  if (ids.length === 0 || !status.success) return;
  const supabase = await createSupabaseServerClient();
  await (supabase.from("attendance") as any).update({ attendance_status: status.data }).in("id", ids);
  revalidatePath(`/admin/attendance/${scheduleId}`);
}

/** Undo / reset: revert selected rows (or all) back to Pending + clear times. */
export async function resetAttendance(scheduleId: string, formData: FormData) {
  await requireAttendance(true);
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const supabase = await createSupabaseServerClient();
  let q = (supabase
    .from("attendance") as any)
    .update({ attendance_status: "pending", check_in_time: null, check_out_time: null })
    .eq("schedule_id", scheduleId);
  if (ids.length > 0) q = q.in("id", ids);
  await q;
  revalidatePath(`/admin/attendance/${scheduleId}`);
}
