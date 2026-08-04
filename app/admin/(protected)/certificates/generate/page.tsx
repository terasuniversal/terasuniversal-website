import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireCertificate } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";

export const metadata = { title: "Generate Certificates — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function GeneratePickerPage() {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  const { data: schedules } = await supabase
    .from("training_schedules")
    .select("id, schedule_id, course_name, trainer, start_date, status, registered_participants")
    .is("deleted_at", null)
    .not("status", "in", "(draft,cancelled)")
    .order("start_date", { ascending: false })
    .limit(60);

  return (
    <>
      <PageHead title="Generate Certificates" subtitle="Pick a schedule. Only eligible participants (present + pass + competent) can be certified." action={<Link href="/admin/certificates" className="ta-btn ta-btn-outline">← Back</Link>} />
      <Card>
        {schedules && schedules.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Schedule</th><th>Trainer</th><th>Date</th><th>Participants</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {schedules.map((s: any) => (
                  <tr key={s.id}>
                    <td><strong>{s.course_name}</strong><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{s.schedule_id}</div></td>
                    <td>{s.trainer ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td>{s.registered_participants}</td>
                    <td><Badge status={s.status} /></td>
                    <td style={{ textAlign: "right" }}><Link href={`/admin/certificates/generate/${s.id}`} className="ta-btn ta-btn-primary ta-btn-sm">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🗓" message="No schedules available." />
        )}
      </Card>
    </>
  );
}
