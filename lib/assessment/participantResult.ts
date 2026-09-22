import { notFound } from "next/navigation";
import { requireAssessment } from "../auth/session";
import { createSupabaseServerClient } from "../supabase/server";

export type StaffParticipantAssessmentResult = {
  participant: {
    id: string;
    participantCode: string;
    fullName: string;
  };
  programme: string;
  scheduleCode: string;
  assessmentDate: string | null;
  theoryResult: "PASS" | "FAIL" | "PENDING";
  practicalAssessment: "COMPETENT" | "NOT YET COMPETENT" | "PENDING";
  overallResult: "PASS" | "FAIL" | "PENDING";
};

type ParticipantRow = {
  id: string;
  participant_id: string;
  full_name: string;
};

type EnrollmentRow = {
  participant_id: string;
  registration_status: string;
  course_schedules: {
    schedule_code: string | null;
    exam_date: string | null;
    courses: { title: string | null; course_name: string | null } | null;
  } | null;
};

type AssessmentRow = {
  theory_result: string | null;
  competency_status: string | null;
  result: string | null;
};

function displayTheoryResult(value: string | null): StaffParticipantAssessmentResult["theoryResult"] {
  if (value === "pass") return "PASS";
  if (value === "fail") return "FAIL";
  return "PENDING";
}

function displayPracticalAssessment(value: string | null): StaffParticipantAssessmentResult["practicalAssessment"] {
  if (value === "competent") return "COMPETENT";
  if (value === "not_yet_competent") return "NOT YET COMPETENT";
  return "PENDING";
}

function displayOverallResult(value: string | null): StaffParticipantAssessmentResult["overallResult"] {
  if (value === "pass") return "PASS";
  if (value === "fail") return "FAIL";
  return "PENDING";
}

/**
 * Staff-authorized participant result read path. The selection boundary
 * contains only identity/context and categorical outcomes; scores, evidence,
 * attribution, locks, and remarks are not queried or serialized.
 */
export async function getStaffParticipantAssessmentResult(
  scheduleId: string,
  participantId: string
): Promise<StaffParticipantAssessmentResult> {
  await requireAssessment(false);
  const supabase = await createSupabaseServerClient();

  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .select("id, participant_id, full_name")
    .eq("id", participantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (participantError || !participant) notFound();

  const { data: enrollment, error: enrollmentError } = await supabase
    .from("schedule_participants")
    .select("participant_id, registration_status, course_schedules(schedule_code, exam_date, courses(title, course_name))")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .maybeSingle();
  if (enrollmentError || !enrollment) notFound();

  const { data: assessment, error: assessmentError } = await supabase
    .from("assessments")
    .select("theory_result, competency_status, result")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (assessmentError || !assessment) notFound();

  const participantRow = participant as ParticipantRow;
  const enrollmentRow = enrollment as EnrollmentRow;
  const assessmentRow = assessment as AssessmentRow;
  const schedule = enrollmentRow.course_schedules;
  const course = schedule?.courses;

  return {
    participant: {
      id: participantRow.id,
      participantCode: participantRow.participant_id,
      fullName: participantRow.full_name,
    },
    programme: course?.title ?? course?.course_name ?? "Training Programme",
    scheduleCode: schedule?.schedule_code ?? "—",
    assessmentDate: schedule?.exam_date ?? null,
    theoryResult: displayTheoryResult(assessmentRow.theory_result),
    practicalAssessment: displayPracticalAssessment(assessmentRow.competency_status),
    overallResult: displayOverallResult(assessmentRow.result),
  };
}
