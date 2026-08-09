import { createSupabaseServerClient } from "../../../../lib/supabase/server";

/** Course options for the schedule form. */
export async function loadCourseOptions() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("courses").select("id, title").is("deleted_at", null).order("title");
  return (data ?? []).map((c: any) => ({ id: c.id, label: c.title }));
}

// Trainer options deferred: no live `trainers` table (see
// SCHEDULES_ARCHITECTURE_DECISION.md §F / this migration's Phase 9/3).
// course_schedules.trainer_name is a plain text field until Trainers exists.
