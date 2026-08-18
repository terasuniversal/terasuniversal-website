import { createSupabaseServerClient } from "./supabase/server";

export interface ScheduleGroup {
  id: string;
  name: string;
  trainer_id: string | null;
  trainer_name: string | null;
  assessor_id: string | null;
  assessor_name: string | null;
}

/**
 * Active (non-deleted) Schedule Groups V1 groups for one schedule, with
 * trainer/assessor names resolved for display. Deliberately not shared with
 * app/admin/(protected)/attendance/groupFilter.ts (same shape, independent
 * copy) so Assessment V3 has zero coupling to the Attendance module.
 */
export async function loadScheduleGroups(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scheduleId: string
): Promise<ScheduleGroup[]> {
  const { data, error } = await supabase
    .from("schedule_groups")
    .select("id, name, trainer_id, assessor_id, trainers(full_name), assessors(full_name)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .order("name");
  if (error) {
    console.error("assessment: schedule_groups query failed", { scheduleId, error: error.message });
    return [];
  }
  return (data ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
    trainer_id: g.trainer_id,
    trainer_name: g.trainers?.full_name ?? null,
    assessor_id: g.assessor_id,
    assessor_name: g.assessors?.full_name ?? null,
  }));
}

export const UNGROUPED = "ungrouped" as const;
export type GroupSelection = ScheduleGroup | typeof UNGROUPED | null;

/**
 * Resolves a raw `?group=` value against THIS schedule's own groups only —
 * never trusts the query string directly. A value that doesn't match any of
 * `groups` (wrong id, another schedule's group, deleted group, garbage
 * input) safely falls back to null ("All Groups") rather than leaking
 * another schedule's roster or erroring. `UNGROUPED` is a reserved literal
 * (not a valid uuid, so it can never collide with a real group id) selecting
 * enrolled participants with no group assignment.
 */
export function resolveRequestedGroup(groups: ScheduleGroup[], requested: string | undefined | null): GroupSelection {
  if (!requested) return null;
  if (requested === UNGROUPED) return UNGROUPED;
  return groups.find((g) => g.id === requested) ?? null;
}

export interface AssessorLine {
  label: string;
  assessor: string;
  isOverride: boolean;
}
export type AssessorDisplay =
  | { mode: "single"; assessor: string; isOverride: boolean; showLabel: boolean }
  | { mode: "list"; entries: AssessorLine[] };

/**
 * Effective assessor = group.assessor_id ?? schedule primary assessor
 * (sourced from the `assessors` table via `schedule_assessors` — never
 * `assessments.assessor_id`, which is a separate per-participant
 * data-entry-attribution field keyed to `profiles`, untouched by V3).
 *
 *   - A specific selected group, or the Ungrouped filter: always a single
 *     line WITH the "(Class Assessor)"/"(Override)" suffix (there is only
 *     ever one fact to state).
 *   - "All Groups" with zero groups (legacy schedule): single line, no
 *     suffix — identical to today's schedule-level-only behavior.
 *   - "All Groups" where every group (+ Ungrouped, if present) resolves to
 *     the exact same (name, override-status) pair: single line, no suffix.
 *   - "All Groups" where they genuinely differ: a labelled line per group
 *     (+ Ungrouped, if present), each with its own suffix. Dedupe matches on
 *     (isOverride, name) together, never name alone, so a real override that
 *     happens to name the same person as the class assessor is never hidden.
 */
export function computeAssessorDisplay(
  groups: ScheduleGroup[],
  schedulePrimaryAssessorName: string,
  selection: GroupSelection,
  hasUngrouped: boolean
): AssessorDisplay {
  if (selection && selection !== UNGROUPED) {
    const isOverride = !!selection.assessor_id;
    return { mode: "single", assessor: selection.assessor_name ?? schedulePrimaryAssessorName, isOverride, showLabel: true };
  }
  if (selection === UNGROUPED) {
    return { mode: "single", assessor: schedulePrimaryAssessorName, isOverride: false, showLabel: true };
  }

  // All Groups.
  if (groups.length === 0) {
    return { mode: "single", assessor: schedulePrimaryAssessorName, isOverride: false, showLabel: false };
  }
  const entries: AssessorLine[] = [
    ...groups.map((g) => ({ label: g.name, assessor: g.assessor_name ?? schedulePrimaryAssessorName, isOverride: !!g.assessor_id })),
    ...(hasUngrouped ? [{ label: "Ungrouped", assessor: schedulePrimaryAssessorName, isOverride: false }] : []),
  ];
  const signature = (e: AssessorLine) => `${e.isOverride}:${e.assessor}`;
  const allSame = entries.every((e) => signature(e) === signature(entries[0]));
  if (allSame) {
    return { mode: "single", assessor: entries[0].assessor, isOverride: entries[0].isOverride, showLabel: false };
  }
  return { mode: "list", entries };
}
