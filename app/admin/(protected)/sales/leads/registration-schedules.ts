import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

export interface EligibleScheduleOption {
  id: string;
  label: string;
  course_name: string;
  schedule_code: string;
  start_date: string;
  end_date: string;
  venue: string;
  status: string;
  capacity: number;
  used: number;
  remaining: number;
}

/**
 * Eligible schedules for registration (Personal + Company). Schedule Reuse
 * Policy: a schedule represents a training batch/session, so multiple
 * registrants/companies enroll into the SAME existing Open schedule. Only
 * schedules that exist, are not soft-deleted, and are not completed/cancelled
 * are offered. Capacity is displayed (used/capacity/remaining) and enforced
 * server-side by the registration RPCs; no seat availability is fabricated.
 */
export async function loadEligibleRegistrationSchedules(): Promise<EligibleScheduleOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("course_schedules")
    .select("id, schedule_code, start_date, end_date, venue, status, capacity, seats_taken, courses(course_name)")
    .is("deleted_at", null)
    .not("status", "in", "(completed,cancelled)")
    .order("start_date", { ascending: true });
  return (data ?? []).map((s: any) => {
    const capacity = Number(s.capacity) || 0;
    const used = Number(s.seats_taken) || 0;
    return {
      id: s.id,
      label: `${s.courses?.course_name ?? "Course"} · ${s.schedule_code ?? ""}`,
      course_name: s.courses?.course_name ?? "Course",
      schedule_code: s.schedule_code ?? "",
      start_date: s.start_date ?? "",
      end_date: s.end_date ?? "",
      venue: s.venue ?? "",
      status: s.status ?? "",
      capacity,
      used,
      remaining: Math.max(capacity - used, 0),
    };
  });
}
