import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export interface AttendanceGroup {
  id: string;
  name: string;
  trainer_id: string | null;
  trainer_name: string | null;
  assessor_id: string | null;
  assessor_name: string | null;
}

/**
 * Active (non-deleted) Schedule Groups V1 groups for one schedule, with
 * trainer/assessor names resolved for display. Shared by the attendance
 * detail page and print page so "which group belongs to this schedule" is
 * checked in exactly one place (see resolveRequestedGroup below).
 */
export async function loadAttendanceGroups(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scheduleId: string
): Promise<AttendanceGroup[]> {
  const { data, error } = await supabase
    .from("schedule_groups")
    .select("id, name, trainer_id, assessor_id, trainers(full_name), assessors(full_name)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .order("name");
  if (error) {
    console.error("attendance: schedule_groups query failed", { scheduleId, error: error.message });
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
export type GroupSelection = AttendanceGroup | typeof UNGROUPED | null;

/**
 * Resolves a raw `?group=` value against THIS schedule's own groups only —
 * never trusts the query string directly. A value that doesn't match any of
 * `groups` (wrong id, another schedule's group, deleted group, garbage
 * input) safely falls back to null ("All Groups") rather than leaking
 * another schedule's roster or erroring. `UNGROUPED` is a reserved literal
 * (not a valid uuid, so it can never collide with a real group id) selecting
 * enrolled participants with no group assignment.
 */
export function resolveRequestedGroup(groups: AttendanceGroup[], requested: string | undefined | null): GroupSelection {
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
 * Effective assessor = group.assessor_id ?? schedule primary assessor,
 * applied consistently everywhere Attendance V2 shows assessor identity
 * (detail page + print). Shared here (not duplicated per page, unlike the
 * simpler trainer-display computation) because the dedupe rule below is
 * easy to get subtly wrong twice: two entries only ever collapse into one
 * "single" line when they share BOTH the same resolved name AND the same
 * override-vs-class-assessor status — matching by name alone would hide a
 * real override that happens to name the same person the class assessor
 * already is (an edge case, but "do not hide a group override" is explicit).
 *
 *   - A specific selected group, or the Ungrouped filter: always a single
 *     line WITH the "(Class Assessor)"/"(Override)" suffix (there is only
 *     ever one fact to state).
 *   - "All Groups" with zero groups (legacy schedule): single line, no
 *     suffix — identical to today's schedule-level-only behavior.
 *   - "All Groups" where every group (+ Ungrouped, if present) resolves to
 *     the exact same (name, override-status) pair: single line, no suffix
 *     — e.g. every group defaults to the same class assessor.
 *   - "All Groups" where they genuinely differ: a labelled line per group
 *     (+ Ungrouped, if present), each with its own suffix.
 */
export function computeAssessorDisplay(
  groups: AttendanceGroup[],
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
