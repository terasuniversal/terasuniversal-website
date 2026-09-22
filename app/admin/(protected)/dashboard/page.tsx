import { redirect } from "next/navigation";
import { hasModuleAccess, requireModuleAccess, requireStaff } from "../../../../lib/auth/session";
import { loadTrainingOperationsDashboard } from "../../../../lib/dashboard/trainingOperations";
import { TrainingOperationsDashboard } from "./TrainingOperationsDashboard";

export const metadata = { title: "Training Operations — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    timeframe?: string;
    courseId?: string;
    status?: string;
    trainer?: string;
    assessor?: string;
  }>;
}) {
  const profile = await requireStaff();
  if (profile.role === "trainer") redirect("/admin/attendance");
  await requireModuleAccess("dashboard");
  const sp = await searchParams;
  const [canSchedules, canAttendance, canAssessment, canAssessors] = await Promise.all([
    hasModuleAccess("schedules"),
    hasModuleAccess("attendance"),
    hasModuleAccess("assessment"),
    hasModuleAccess("assessors"),
  ]);
  const data = await loadTrainingOperationsDashboard(sp, {
    schedules: canSchedules,
    attendance: canAttendance,
    assessment: canAssessment,
    assessors: canAssessors,
  });
  return <TrainingOperationsDashboard data={data} />;
}