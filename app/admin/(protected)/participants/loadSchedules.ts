import { createSupabaseServerClient } from "../../../../lib/supabase/server";

/** Company options for linking a participant to the company master record. */
export async function loadCompanyOptions() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("companies").select("id, company_name").is("deleted_at", null).order("company_name").limit(500);
  return (data ?? []).map((c: any) => ({ id: c.id, label: c.company_name }));
}

/**
 * Legacy schedule options for participants.schedule_id (references the older
 * `schedules` table). Participant↔session assignment now happens through the
 * Training Schedule module's junction; this remains for backward compatibility.
 */
export async function loadScheduleOptions() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("schedules")
    .select("id, start_date, courses(title)")
    .is("deleted_at", null)
    .order("start_date", { ascending: false })
    .limit(100);
  return (data ?? []).map((s: any) => ({
    id: s.id,
    label: `${s.courses?.title ?? "Course"} · ${new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}`,
  }));
}
