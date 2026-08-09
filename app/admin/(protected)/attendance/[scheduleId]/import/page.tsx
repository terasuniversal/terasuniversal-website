import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireAttendance } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { ImportClient } from "./ImportClient";

export const metadata = { title: "Import Attendance — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function ImportAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ scheduleId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAttendance(true); // trainer or admin
  const { scheduleId } = await params;
  const { date } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: schedule } = await supabase.from("course_schedules").select("start_date, end_date").eq("id", scheduleId).single();
  const sessionDate = date && schedule && date >= schedule.start_date && date <= schedule.end_date ? date : (schedule?.start_date ?? new Date().toISOString().slice(0, 10));
  return (
    <>
      <PageHead
        title="Import Attendance"
        subtitle={`Upload a CSV to update attendance for ${sessionDate}.`}
        action={<Link href={`/admin/attendance/${scheduleId}`} className="ta-btn ta-btn-outline">← Back</Link>}
      />
      <ImportClient scheduleId={scheduleId} sessionDate={sessionDate} />
    </>
  );
}
