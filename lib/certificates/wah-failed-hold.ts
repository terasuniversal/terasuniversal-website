import type { createSupabaseServerClient } from "../supabase/server";
import { findWorkingAtHeightProgrammeByCourseId } from "../working-at-height-programme";

export const WAH_FAILED_HOLD_LABEL = "Held — Failed Practical Assessment";
export const WAH_FAILED_HOLD_REASON = "Certificate not issued because Practical Assessment is recorded as Failed.";
export const WAH_FAILED_HOLD_CHECK_ERROR = "The Failed Practical Assessment check could not be completed, so no certificate was issued.";

export function isWahCourse(courseId: string | null | undefined): boolean {
  return Boolean(findWorkingAtHeightProgrammeByCourseId(courseId));
}

/**
 * Participants on a WAH schedule whose active Practical Assessment is Failed.
 * This only improves staff feedback and avoids spending a certificate number;
 * the capture trigger remains the enforcement point. Throws on a read failure
 * so callers cannot treat an unknown result as "nobody is held".
 */
export async function loadWahFailedHoldParticipantIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scheduleId: string,
  courseId: string | null | undefined,
): Promise<Set<string>> {
  if (!isWahCourse(courseId)) return new Set();
  const { data, error } = await supabase
    .from("participant_skill_results")
    .select("participant_id")
    .eq("schedule_id", scheduleId)
    .eq("area", "practical_assessment")
    .eq("status", "failed")
    .is("deleted_at", null);
  if (error) throw new Error(WAH_FAILED_HOLD_CHECK_ERROR);
  return new Set(((data ?? []) as { participant_id: string }[]).map((row) => row.participant_id));
}
