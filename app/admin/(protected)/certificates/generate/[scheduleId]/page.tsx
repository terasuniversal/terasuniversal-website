import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireCertificate } from "../../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../../components/admin/ui";
import { generateCertificate, bulkGenerate } from "../../actions";

export const metadata = { title: "Generate Certificates — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function GenerateForSchedulePage({ params }: { params: Promise<{ scheduleId: string }> }) {
  await requireCertificate(true);
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await supabase.from("course_schedules").select("id, schedule_code, trainer_name, start_date, courses(course_name)").eq("id", scheduleId).single();
  if (!scheduleRow) notFound();
  const s = { ...scheduleRow, course_name: (scheduleRow as any).courses?.course_name ?? "—", trainer: (scheduleRow as any).trainer_name, schedule_id: (scheduleRow as any).schedule_code };

  // v_certificate_eligibility does not exist live -- certificate eligibility
  // logic is an explicit later follow-up, not part of this migration (see
  // SCHEDULES_ARCHITECTURE_DECISION.md §J). This query is left as-is: it
  // will return no rows rather than crash the page.
  const { data: elig } = await supabase.from("v_certificate_eligibility").select("*").eq("schedule_id", scheduleId);
  // Which participants already have a live certificate?
  const { data: existing } = await supabase.from("certificates").select("participant_id").eq("schedule_id", scheduleId).is("deleted_at", null);
  const certified = new Set((existing ?? []).map((c: any) => c.participant_id));

  const rows = elig ?? [];
  const eligibleCount = rows.filter((r: any) => r.eligible && !certified.has(r.participant_id)).length;

  const boundBulk = async () => { await bulkGenerate(scheduleId); };

  return (
    <>
      <PageHead
        title="Generate Certificates"
        subtitle={`${s.course_name} · ${s.schedule_id}`}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/certificates/generate" className="ta-btn ta-btn-outline">← Back</Link>
            <a href={`/admin/certificates/download-zip?scheduleId=${scheduleId}`} className="ta-btn ta-btn-outline">🗜 Download all (ZIP)</a>
            <form action={boundBulk}><button className="ta-btn ta-btn-gold" disabled={eligibleCount === 0}>⚡ Generate all eligible ({eligibleCount})</button></form>
          </div>
        }
      />

      <div className="ta-alert" style={{ background: "rgba(47,111,237,.08)", color: "var(--ta-info)", marginBottom: 16 }}>
        A certificate can only be generated when the participant is <strong>Present</strong>, the assessment <strong>result = Pass</strong>, and competency = <strong>Competent</strong>.
      </div>

      <Card>
        {rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Participant</th><th>Attendance</th><th>Result</th><th>Competency</th><th>Eligible</th><th></th></tr></thead>
              <tbody>
                {rows.map((r: any) => {
                  const already = certified.has(r.participant_id);
                  const canGen = r.eligible && !already;
                  const boundGen = async () => { await generateCertificate(scheduleId, r.participant_id); };
                  return (
                    <tr key={r.participant_id}>
                      <td><strong>{r.holder_name}</strong></td>
                      <td>{r.attendance_status ? <Badge status={r.attendance_status} /> : "—"}</td>
                      <td>{r.result ? <Badge status={r.result} /> : "—"}</td>
                      <td>{r.competency_status ? <Badge status={r.competency_status} /> : "—"}</td>
                      <td>{r.eligible ? "✅" : "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        {already ? (
                          <span style={{ color: "var(--ta-success)", fontSize: 13 }}>✓ Certified</span>
                        ) : (
                          <form action={boundGen} style={{ display: "inline" }}>
                            <button className="ta-btn ta-btn-primary ta-btn-sm" disabled={!canGen}>Generate</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="👥" message="No participants assigned to this schedule." />
        )}
      </Card>
    </>
  );
}
