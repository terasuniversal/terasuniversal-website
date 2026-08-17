import { createSupabaseServerClient } from "../../../../lib/supabase/server";

/** Course options for the schedule form. */
export async function loadCourseOptions() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("courses").select("id, title").is("deleted_at", null).order("title");
  return (data ?? []).map((c: any) => ({ id: c.id, label: c.title }));
}

/** Active assessor options for the schedule form / assignment control. Only
 *  active assessors are selectable (a deactivated assessor keeps historical
 *  assignments but can no longer be assigned to a new schedule). */
export async function loadAssessorOptions() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("assessors")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name");
  return (data ?? []).map((a: any) => ({ id: a.id, label: a.full_name }));
}

/**
 * Sales CRM Phase 3 handoff — course matching for a Won Opportunity's
 * `programme` free-text field. Case-insensitive EXACT match only (ilike
 * with no wildcards): a confident single match is safe to pre-select, but
 * a substring/fuzzy match risks silently picking the wrong course, which
 * the task explicitly forbids ("do not fabricate... course ID if programme
 * matching is ambiguous"). Returns the matched course id only when exactly
 * one row matches; null for zero or multiple matches (staff must choose).
 */
export async function matchCourseByProgramme(programme: string | null | undefined): Promise<string | null> {
  const term = programme?.trim();
  if (!term) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("courses").select("id").is("deleted_at", null).ilike("title", term);
  if (!data || data.length !== 1) return null;
  return data[0].id as string;
}

// Trainer options deferred: no live `trainers` table (see
// SCHEDULES_ARCHITECTURE_DECISION.md §F / this migration's Phase 9/3).
// course_schedules.trainer_name is a plain text field until Trainers exists.
