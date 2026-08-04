import Link from "next/link";
import { requireAttendance } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { ImportClient } from "./ImportClient";

export const metadata = { title: "Import Attendance — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function ImportAttendancePage({ params }: { params: Promise<{ scheduleId: string }> }) {
  await requireAttendance(true); // trainer or admin
  const { scheduleId } = await params;
  return (
    <>
      <PageHead
        title="Import Attendance"
        subtitle="Upload a CSV to update attendance for assigned participants."
        action={<Link href={`/admin/attendance/${scheduleId}`} className="ta-btn ta-btn-outline">← Back</Link>}
      />
      <ImportClient scheduleId={scheduleId} />
    </>
  );
}
