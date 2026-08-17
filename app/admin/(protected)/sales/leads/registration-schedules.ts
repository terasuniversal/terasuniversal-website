import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

/**
 * Registration eligibility gate (business rule, not module access): a lead
 * may only be operationally registered while it is REAL and not archived.
 * Archived Won/Lost history stays fully intact and reportable — this only
 * blocks NEW registration writes, mirrored by identical checks in the
 * register_personal_lead / register_company_enrollment RPCs (the actual
 * enforcement boundary; this copy exists so the UI and the action layer
 * fail with the same message before ever reaching the database).
 */
export function checkLeadRegistrationEligibility(lead: { status: string; is_test: boolean }): { eligible: boolean; reason?: string } {
  if (lead.is_test) {
    return { eligible: false, reason: "Mark this lead as Real before registering participants." };
  }
  if (lead.status === "archived") {
    return { eligible: false, reason: "Restore this lead before registering participants." };
  }
  return { eligible: true };
}

/** Fresh, minimal read of the two eligibility fields — used by Server
 *  Actions to revalidate lead state immediately before calling a
 *  registration RPC. Never trust the eligibility already rendered in the
 *  form the request came from. */
export async function loadLeadEligibilityState(leadMetadataId: string): Promise<{ status: string; is_test: boolean } | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sales_lead_metadata")
    .select("status, is_test")
    .eq("id", leadMetadataId)
    .maybeSingle();
  return data as { status: string; is_test: boolean } | null;
}

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
