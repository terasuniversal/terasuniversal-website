import type { createSupabaseServerClient } from "../supabase/server";
import { isWahCourse } from "./wah-failed-hold";

export const WAH_SKILLS_HOLD_LABEL = "Held — Skills Record incomplete";
export const WAH_SKILLS_HOLD_REASON = "Certificate not issued because the Skills Record is incomplete.";
export const WAH_SKILLS_CHECK_ERROR = "The Skills Record check could not be completed, so no certificate was issued.";
export const WAH_SKILLS_GATE_CODE = "WAH_SKILLS_RECORD_INCOMPLETE";

const REQUIRED_STATUS: Record<string, string> = {
  theory_session: "completed",
  practical_training: "completed",
  safety_awareness: "completed",
  practical_assessment: "passed",
};

/**
 * Participants on a WAH schedule without all four required results, from the given
 * list so someone with no rows at all still counts. This only improves staff
 * feedback and avoids spending a certificate number; the database trigger remains
 * the enforcement point. Throws on a read failure so callers cannot treat an
 * unknown result as "nobody is held".
 */
export async function loadWahIncompleteSkillsParticipantIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scheduleId: string,
  courseId: string | null | undefined,
  participantIds: string[],
): Promise<Set<string>> {
  if (!isWahCourse(courseId) || participantIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("participant_skill_results")
    .select("participant_id, area, status")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);
  if (error) throw new Error(WAH_SKILLS_CHECK_ERROR);

  const complete = new Map<string, number>();
  for (const row of (data ?? []) as { participant_id: string; area: string; status: string }[]) {
    if (REQUIRED_STATUS[row.area] === row.status) complete.set(row.participant_id, (complete.get(row.participant_id) ?? 0) + 1);
  }
  return new Set(participantIds.filter((id) => complete.get(id) !== Object.keys(REQUIRED_STATUS).length));
}
