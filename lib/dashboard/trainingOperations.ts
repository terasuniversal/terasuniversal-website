import { createSupabaseServerClient } from "../supabase/server";

export const LIVE_SCHEDULE_STATUSES = ["open", "full", "in_progress", "completed", "cancelled"] as const;
export type LiveScheduleStatus = (typeof LIVE_SCHEDULE_STATUSES)[number];
export type DashboardTimeframe = "today" | "this-week" | "upcoming";

const MY_TIME_ZONE = "Asia/Kuala_Lumpur";

type DateParts = { year: number; month: number; day: number };

export type DashboardFilterOptions = {
  timeframe: DashboardTimeframe;
  courseId: string;
  status: string;
  trainer: string;
  assessor: string;
};

export type TrainingOperationsAccess = {
  schedules: boolean;
  attendance: boolean;
  assessment: boolean;
  assessors: boolean;
};

export type AttentionItem = {
  key: string;
  scheduleId: string;
  scheduleCode: string;
  courseName: string;
  severity: "high" | "attention";
  label: string;
  href: string;
};

export type ScheduleOperationsRow = {
  id: string;
  scheduleCode: string;
  courseId: string;
  courseName: string;
  startDate: string;
  endDate: string;
  status: LiveScheduleStatus;
  capacity: number;
  seatsTaken: number;
  trainerName: string | null;
  venue: string | null;
  assessmentRequired: boolean;
  competencyRequired: boolean;
  rosterCount: number;
  attendance: {
    recordedSessions: number;
    fullyPresent: number;
    incomplete: number;
    state: "not_started" | "recorded" | "incomplete";
  } | null;
  assessment: {
    notStarted: number;
    started: number;
    resultPending: number;
    pass: number;
    fail: number;
    competencyPending: number;
    competent: number;
    notYetCompetent: number;
    locked: number;
  } | null;
  assignments: {
    missingTrainer: boolean;
    missingPrimaryAssessor: boolean;
    inactivePrimaryAssessor: boolean;
    missingGroupTrainer: number;
    missingEffectiveGroupAssessor: number;
    inactiveGroupAssessor: number;
    ungroupedParticipants: number;
    groupCount: number;
    primaryAssessorName: string | null;
  } | null;
};

export type TrainingOperationsDashboardData = {
  filters: DashboardFilterOptions;
  filterOptions: {
    courses: { id: string; name: string }[];
    trainers: string[];
    assessors: string[];
  };
  summary: {
    activeNow: number;
    upcoming7Days: number;
    needsAttention: number;
    completedThisMonth: number;
  };
  active: ScheduleOperationsRow[];
  upcoming: ScheduleOperationsRow[];
  attention: AttentionItem[];
  access: TrainingOperationsAccess;
  hasOperationalSchedules: boolean;
};

type ScheduleRecord = {
  id: string;
  schedule_code: string | null;
  course_id: string;
  start_date: string;
  end_date: string;
  status: LiveScheduleStatus;
  capacity: number | null;
  seats_taken: number | null;
  trainer_name: string | null;
  venue: string | null;
  courses: {
    title: string | null;
    assessment_required: boolean;
    competency_required: boolean;
  } | null;
};

type RosterRecord = {
  schedule_id: string;
  participant_id: string;
  registration_status: string;
  schedule_group_id: string | null;
};

type AttendanceRecord = {
  schedule_id: string;
  participant_id: string;
  session_date: string;
  attendance_status: string | null;
};

type AssessmentRecord = {
  schedule_id: string;
  participant_id: string;
  result: string | null;
  competency_status: string | null;
  locked: boolean | null;
};

type GroupRecord = {
  id: string;
  schedule_id: string;
  trainer_id: string | null;
  assessor_id: string | null;
  deleted_at: string | null;
  trainers: { full_name: string | null; status: string | null; deleted_at: string | null } | null;
  assessors: { full_name: string | null; is_active: boolean | null } | null;
};

type PrimaryAssessorRecord = {
  schedule_id: string;
  assessor_id: string;
  is_primary: boolean;
  assessors: { full_name: string | null; is_active: boolean | null } | null;
};

function datePartsInMalaysia(value: Date): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function isoFromParts(parts: DateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function malaysiaDateIso(now: Date = new Date()): string {
  return isoFromParts(datePartsInMalaysia(now));
}

export function addMalaysiaCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function malaysiaOperationalWindow(now: Date = new Date()) {
  const today = malaysiaDateIso(now);
  const parts = datePartsInMalaysia(now);
  const monthStart = `${parts.year}-${String(parts.month).padStart(2, "0")}-01`;
  const nextMonth = parts.month === 12 ? { year: parts.year + 1, month: 1 } : { year: parts.year, month: parts.month + 1 };
  const monthEnd = addMalaysiaCalendarDays(`${nextMonth.year}-${String(nextMonth.month).padStart(2, "0")}-01`, -1);
  return {
    today,
    weekEnd: addMalaysiaCalendarDays(today, 6),
    upcoming7End: addMalaysiaCalendarDays(today, 7),
    monthStart,
    monthEnd,
  };
}

function cleanFilter(value: string | undefined): string {
  return value?.trim().slice(0, 120) ?? "";
}

export function normalizeDashboardFilters(input: Partial<Record<keyof DashboardFilterOptions, string | undefined>>): DashboardFilterOptions {
  const timeframe = input.timeframe === "today" || input.timeframe === "upcoming" ? input.timeframe : "this-week";
  return {
    timeframe,
    courseId: cleanFilter(input.courseId),
    status: cleanFilter(input.status),
    trainer: cleanFilter(input.trainer),
    assessor: cleanFilter(input.assessor),
  };
}

function queryError(operation: string, error: { message?: string } | null): never {
  console.error(`training-operations: ${operation} query failed`, { message: error?.message ?? "unknown" });
  throw new Error("Training Operations data could not be loaded.");
}

function scheduleCourseName(schedule: ScheduleRecord): string {
  return schedule.courses?.title ?? "Unnamed course";
}

function isInSelectedTimeframe(row: ScheduleRecord, filters: DashboardFilterOptions, dates: ReturnType<typeof malaysiaOperationalWindow>): boolean {
  if (row.status === "in_progress") return filters.timeframe !== "upcoming" || row.start_date <= dates.upcoming7End;
  if (row.status !== "open" && row.status !== "full") return false;
  if (filters.timeframe === "today") return row.start_date === dates.today;
  if (filters.timeframe === "upcoming") return row.start_date >= dates.today && row.start_date <= dates.upcoming7End;
  return row.start_date >= dates.today && row.start_date <= dates.weekEnd;
}

function matchesFilters(row: ScheduleRecord, filters: DashboardFilterOptions, primaryAssessorName: string | null): boolean {
  if (filters.courseId && row.course_id !== filters.courseId) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.trainer && (row.trainer_name ?? "") !== filters.trainer) return false;
  if (filters.assessor && primaryAssessorName !== filters.assessor) return false;
  return true;
}

export async function loadTrainingOperationsDashboard(
  rawFilters: Partial<Record<keyof DashboardFilterOptions, string | undefined>> = {},
  access: TrainingOperationsAccess = { schedules: true, attendance: true, assessment: true, assessors: true },
  now: Date = new Date(),
): Promise<TrainingOperationsDashboardData> {
  const filters = normalizeDashboardFilters(rawFilters);
  const dates = malaysiaOperationalWindow(now);
  const supabase = await createSupabaseServerClient();

  if (!access.schedules) {
    return {
      filters,
      filterOptions: { courses: [], trainers: [], assessors: [] },
      summary: { activeNow: 0, upcoming7Days: 0, needsAttention: 0, completedThisMonth: 0 },
      active: [],
      upcoming: [],
      attention: [],
      access,
      hasOperationalSchedules: false,
    };
  }

  const scheduleSelect = "id, schedule_code, course_id, start_date, end_date, status, capacity, seats_taken, trainer_name, venue, courses(title, assessment_required, competency_required)";
  const scheduleBase = () => supabase.from("course_schedules").select(scheduleSelect).is("deleted_at", null);
  const [activeResult, upcomingResult, completedResult] = await Promise.all([
    scheduleBase().eq("status", "in_progress"),
    scheduleBase().in("status", ["open", "full"]).gte("start_date", dates.today).lte("start_date", dates.upcoming7End),
    scheduleBase().eq("status", "completed").gte("end_date", dates.monthStart).lte("end_date", dates.monthEnd),
  ]);
  if (activeResult.error) queryError("active schedules", activeResult.error);
  if (upcomingResult.error) queryError("upcoming schedules", upcomingResult.error);
  if (completedResult.error) queryError("completed schedules", completedResult.error);

  const scheduleMap = new Map<string, ScheduleRecord>();
  for (const row of [...(activeResult.data ?? []), ...(upcomingResult.data ?? []), ...(completedResult.data ?? [])] as unknown as ScheduleRecord[]) {
    if (LIVE_SCHEDULE_STATUSES.includes(row.status)) scheduleMap.set(row.id, row);
  }
  const allSchedules = [...scheduleMap.values()];
  const ids = allSchedules.map((row) => row.id);

  const [{ data: roster, error: rosterError }, { data: attendance, error: attendanceError }, { data: assessments, error: assessmentError }, { data: groups, error: groupsError }, { data: primaryAssessors, error: assessorError }] = await Promise.all([
    ids.length
      ? supabase.from("schedule_participants").select("schedule_id, participant_id, registration_status, schedule_group_id").in("schedule_id", ids).is("deleted_at", null).neq("registration_status", "cancelled")
      : Promise.resolve({ data: [], error: null }),
    ids.length && access.attendance
      ? (supabase.from("attendance") as any).select("schedule_id, participant_id, session_date, attendance_status").in("schedule_id", ids).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    ids.length && access.assessment
      ? (supabase.from("assessments") as any).select("schedule_id, participant_id, result, competency_status, locked").in("schedule_id", ids).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? (supabase.from("schedule_groups") as any).select("id, schedule_id, trainer_id, assessor_id, deleted_at, trainers(full_name, status, deleted_at), assessors(full_name, is_active)").in("schedule_id", ids).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    ids.length && access.assessors
      ? (supabase.from("schedule_assessors") as any).select("schedule_id, assessor_id, is_primary, assessors(full_name, is_active)").in("schedule_id", ids).eq("is_primary", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (rosterError) queryError("active enrollment", rosterError);
  if (attendanceError) queryError("attendance", attendanceError);
  if (assessmentError) queryError("assessment", assessmentError);
  if (groupsError) queryError("groups", groupsError);
  if (assessorError) queryError("primary assessor", assessorError);

  const activeRoster = (roster ?? []) as unknown as RosterRecord[];
  const attendanceRows = (attendance ?? []) as unknown as AttendanceRecord[];
  const assessmentRows = (assessments ?? []) as unknown as AssessmentRecord[];
  const groupRows = (groups ?? []) as unknown as GroupRecord[];
  const primaryRows = (primaryAssessors ?? []) as unknown as PrimaryAssessorRecord[];
  const rosterBySchedule = new Map<string, RosterRecord[]>();
  for (const row of activeRoster) (rosterBySchedule.get(row.schedule_id) ?? (rosterBySchedule.set(row.schedule_id, []), rosterBySchedule.get(row.schedule_id)!)).push(row);
  const attendanceBySchedule = new Map<string, AttendanceRecord[]>();
  for (const row of attendanceRows) (attendanceBySchedule.get(row.schedule_id) ?? (attendanceBySchedule.set(row.schedule_id, []), attendanceBySchedule.get(row.schedule_id)!)).push(row);
  const assessmentBySchedule = new Map<string, AssessmentRecord[]>();
  for (const row of assessmentRows) (assessmentBySchedule.get(row.schedule_id) ?? (assessmentBySchedule.set(row.schedule_id, []), assessmentBySchedule.get(row.schedule_id)!)).push(row);
  const groupsBySchedule = new Map<string, GroupRecord[]>();
  for (const row of groupRows) (groupsBySchedule.get(row.schedule_id) ?? (groupsBySchedule.set(row.schedule_id, []), groupsBySchedule.get(row.schedule_id)!)).push(row);
  const primaryBySchedule = new Map<string, PrimaryAssessorRecord>();
  for (const row of primaryRows) primaryBySchedule.set(row.schedule_id, row);

  const rows = new Map<string, ScheduleOperationsRow>();
  for (const schedule of allSchedules) {
    const rosterRows = rosterBySchedule.get(schedule.id) ?? [];
    const rosterIds = new Set(rosterRows.map((row) => row.participant_id));
    const scheduleAttendance = attendanceBySchedule.get(schedule.id) ?? [];
    const sessionDates = new Set(scheduleAttendance.map((row) => row.session_date));
    const presentByParticipant = new Map<string, { dates: Set<string>; allPresent: boolean }>();
    for (const row of scheduleAttendance) {
      if (!rosterIds.has(row.participant_id)) continue;
      const entry = presentByParticipant.get(row.participant_id) ?? { dates: new Set<string>(), allPresent: true };
      entry.dates.add(row.session_date);
      if (row.attendance_status !== "present") entry.allPresent = false;
      presentByParticipant.set(row.participant_id, entry);
    }
    let fullyPresent = 0;
    if (sessionDates.size > 0) {
      for (const entry of presentByParticipant.values()) if (entry.dates.size === sessionDates.size && entry.allPresent) fullyPresent++;
    }
    const attendanceInfo = access.attendance ? {
      recordedSessions: sessionDates.size,
      fullyPresent,
      incomplete: sessionDates.size > 0 ? Math.max(rosterRows.length - fullyPresent, 0) : 0,
      state: sessionDates.size === 0 ? "not_started" as const : fullyPresent < rosterRows.length ? "incomplete" as const : "recorded" as const,
    } : null;

    const scheduleAssessments = assessmentBySchedule.get(schedule.id) ?? [];
    const assessmentByParticipant = new Map(scheduleAssessments.filter((row) => rosterIds.has(row.participant_id)).map((row) => [row.participant_id, row]));
    const assessmentInfo = access.assessment ? {
      notStarted: schedule.courses?.assessment_required ? Math.max(rosterRows.length - assessmentByParticipant.size, 0) : 0,
      started: assessmentByParticipant.size,
      resultPending: [...assessmentByParticipant.values()].filter((row) => row.result === "pending").length,
      pass: [...assessmentByParticipant.values()].filter((row) => row.result === "pass").length,
      fail: [...assessmentByParticipant.values()].filter((row) => row.result === "fail").length,
      competencyPending: schedule.courses?.competency_required ? [...assessmentByParticipant.values()].filter((row) => row.competency_status === "pending_review").length : 0,
      competent: schedule.courses?.competency_required ? [...assessmentByParticipant.values()].filter((row) => row.competency_status === "competent").length : 0,
      notYetCompetent: schedule.courses?.competency_required ? [...assessmentByParticipant.values()].filter((row) => row.competency_status === "not_yet_competent").length : 0,
      locked: [...assessmentByParticipant.values()].filter((row) => row.locked === true).length,
    } : null;

    const scheduleGroups = groupsBySchedule.get(schedule.id) ?? [];
    const primary = primaryBySchedule.get(schedule.id);
    const primaryName = primary?.assessors?.full_name ?? null;
    const assignments = {
      missingTrainer: !schedule.trainer_name?.trim(),
      missingPrimaryAssessor: !!schedule.courses?.assessment_required && access.assessors && !primary,
      inactivePrimaryAssessor: !!schedule.courses?.assessment_required && access.assessors && !!primary && primary.assessors?.is_active === false,
      missingGroupTrainer: scheduleGroups.filter((group) => !group.trainer_id || group.trainers?.status !== "active" || !!group.trainers?.deleted_at).length,
      missingEffectiveGroupAssessor: access.assessors ? scheduleGroups.filter((group) => !group.assessor_id && !primary).length : 0,
      inactiveGroupAssessor: access.assessors ? scheduleGroups.filter((group) => !!group.assessor_id && group.assessors?.is_active === false).length : 0,
      ungroupedParticipants: scheduleGroups.length > 0 ? rosterRows.filter((row) => !row.schedule_group_id).length : 0,
      groupCount: scheduleGroups.length,
      primaryAssessorName: primaryName,
    };
    rows.set(schedule.id, {
      id: schedule.id,
      scheduleCode: schedule.schedule_code ?? schedule.id.slice(0, 8),
      courseId: schedule.course_id,
      courseName: scheduleCourseName(schedule),
      startDate: schedule.start_date,
      endDate: schedule.end_date,
      status: schedule.status,
      capacity: Number(schedule.capacity ?? 0),
      seatsTaken: Number(schedule.seats_taken ?? rosterRows.length),
      trainerName: schedule.trainer_name,
      venue: schedule.venue,
      assessmentRequired: !!schedule.courses?.assessment_required,
      competencyRequired: !!schedule.courses?.competency_required,
      rosterCount: rosterRows.length,
      attendance: attendanceInfo,
      assessment: assessmentInfo,
      assignments,
    });
  }

  const allRows = [...rows.values()];
  const rowForSchedule = (id: string) => rows.get(id)!;
  const activeScheduleRecords = (activeResult.data ?? []) as unknown as ScheduleRecord[];
  const upcomingScheduleRecords = (upcomingResult.data ?? []) as unknown as ScheduleRecord[];
  const activeSchedules = activeScheduleRecords.map((row: ScheduleRecord) => rowForSchedule(row.id)).filter(Boolean);
  const upcomingSchedules = upcomingScheduleRecords.map((row: ScheduleRecord) => rowForSchedule(row.id)).filter(Boolean);
  const filteredUpcoming = upcomingSchedules.filter((row) => isInSelectedTimeframe(allSchedules.find((item) => item.id === row.id)!, filters, dates) && matchesFilters(allSchedules.find((item) => item.id === row.id)!, filters, row.assignments?.primaryAssessorName ?? null));
  const filteredActive = activeSchedules.filter((row) => matchesFilters(allSchedules.find((item) => item.id === row.id)!, filters, row.assignments?.primaryAssessorName ?? null));
  const attention: AttentionItem[] = [];
  for (const row of [...activeSchedules, ...upcomingSchedules]) {
    const href = `/admin/schedules/${row.id}`;
    const add = (key: string, label: string, severity: AttentionItem["severity"] = "attention", target = href) => attention.push({ key: `${row.id}:${key}`, scheduleId: row.id, scheduleCode: row.scheduleCode, courseName: row.courseName, severity, label, href: target });
    if (row.attendance?.state === "not_started" && row.rosterCount > 0) add("attendance-not-started", "Attendance not started", "high", `/admin/attendance/${row.id}`);
    if (row.attendance?.state === "incomplete") add("attendance-incomplete", `${row.attendance.incomplete} incomplete across recorded sessions`, "attention", `/admin/attendance/${row.id}`);
    if (row.assessment?.notStarted && row.assessment.notStarted > 0) add("assessment-not-started", `${row.assessment.notStarted} assessment${row.assessment.notStarted === 1 ? "" : "s"} not started`, "high", `/admin/assessment/${row.id}`);
    if (row.assessment?.resultPending) add("result-pending", `${row.assessment.resultPending} result${row.assessment.resultPending === 1 ? "" : "s"} pending`, "high", `/admin/assessment/${row.id}`);
    if (row.assessment?.competencyPending) add("competency-pending", `${row.assessment.competencyPending} competency review${row.assessment.competencyPending === 1 ? "" : "s"} pending`, "high", `/admin/assessment/${row.id}`);
    if (row.assignments?.missingTrainer) add("missing-trainer", "Trainer not assigned");
    if (row.assignments?.missingPrimaryAssessor) add("missing-assessor", "Primary assessor not assigned", "high", `/admin/schedules/${row.id}`);
    if (row.assignments?.inactivePrimaryAssessor) add("inactive-assessor", "Primary assessor is inactive", "high", `/admin/schedules/${row.id}`);
    if (row.assignments?.missingGroupTrainer) add("missing-group-trainer", `${row.assignments.missingGroupTrainer} group trainer assignment${row.assignments.missingGroupTrainer === 1 ? "" : "s"} missing`);
    if (row.assignments?.missingEffectiveGroupAssessor) add("missing-group-assessor", `${row.assignments.missingEffectiveGroupAssessor} group assessor assignment${row.assignments.missingEffectiveGroupAssessor === 1 ? "" : "s"} missing`, "high");
    if (row.assignments?.inactiveGroupAssessor) add("inactive-group-assessor", `${row.assignments.inactiveGroupAssessor} group assessor assignment${row.assignments.inactiveGroupAssessor === 1 ? "" : "s"} inactive`, "high");
    if (row.assignments?.ungroupedParticipants) add("ungrouped-participant", `${row.assignments.ungroupedParticipants} participant${row.assignments.ungroupedParticipants === 1 ? "" : "s"} ungrouped`, "attention", `/admin/schedules/${row.id}`);
  }

  const courseOptions = [...new Map(allRows.map((row) => [row.courseId, { id: row.courseId, name: row.courseName }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const trainers = [...new Set(allRows.map((row) => row.trainerName).filter((value): value is string => !!value?.trim()))].sort();
  const assessors = [...new Set(allRows.map((row) => row.assignments?.primaryAssessorName).filter((value): value is string => !!value?.trim()))].sort();
  const filteredAttention = attention.filter((item) => {
    const row = rows.get(item.scheduleId);
    if (!row) return false;
    const schedule = allSchedules.find((candidate) => candidate.id === item.scheduleId)!;
    return matchesFilters(schedule, filters, row.assignments?.primaryAssessorName ?? null);
  });
  return {
    filters,
    filterOptions: { courses: courseOptions, trainers, assessors },
    summary: {
      activeNow: activeSchedules.length,
      upcoming7Days: upcomingSchedules.length,
      needsAttention: filteredAttention.length,
      completedThisMonth: (completedResult.data ?? []).length,
    },
    active: filteredActive,
    upcoming: filteredUpcoming,
    attention: filteredAttention,
    access,
    hasOperationalSchedules: allRows.length > 0,
  };
}
