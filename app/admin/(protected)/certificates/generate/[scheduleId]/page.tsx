import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireModuleAccess, requireCertificate } from "../../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../../components/admin/ui";
import { generateCertificate, bulkGenerate } from "../../actions";
import { loadWahFailedHoldParticipantIds, WAH_FAILED_HOLD_CHECK_ERROR, WAH_FAILED_HOLD_LABEL } from "../../../../../../lib/certificates/wah-failed-hold";

export const metadata = { title: "Generate Certificates — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

interface EligibilityRow {
  participant_id: string;
  holder_name: string;
  attendance_percentage: number;
  attendance_min_percent: number;
  result: string | null;
  competency_status: string | null;
  eligible: boolean;
  ineligibility_reason: string | null;
  existing_certificate_id: string | null;
}

const REASON_LABEL: Record<string, string> = {
  certificate_generation_disabled: "Certificate generation not enabled for this course",
  certificate_template_not_configured: "No certificate template configured for this course",
  enrollment_cancelled: "Enrollment cancelled",
  schedule_not_completed: "Schedule not completed",
  attendance_not_met: "Attendance below required minimum",
  assessment_missing: "Assessment pending",
  assessment_not_passed: "Assessment not passed",
  competency_not_met: "Competency not achieved",
  certificate_already_exists: "Certificate already issued",
};

function reasonText(r: EligibilityRow): string {
  if (r.ineligibility_reason === "attendance_not_met") {
    return `Attendance ${r.attendance_percentage}% / Required ${r.attendance_min_percent}%`;
  }
  return REASON_LABEL[r.ineligibility_reason ?? ""] ?? r.ineligibility_reason ?? "Not eligible";
}

export default async function GenerateForSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ scheduleId: string }>;
  searchParams: Promise<{ generated?: string; skipped?: string; held?: string; reason?: string }>;
}) {
await requireModuleAccess("certificates");
  await requireCertificate(true);
  const { scheduleId } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await supabase.from("course_schedules").select("id, course_id, schedule_code, trainer_name, start_date, courses(course_name)").eq("id", scheduleId).single();
  if (!scheduleRow) notFound();
  const s = { ...scheduleRow, course_name: (scheduleRow as any).courses?.course_name ?? "—", trainer: (scheduleRow as any).trainer_name, schedule_id: (scheduleRow as any).schedule_code };

  const { data: eligRaw } = await supabase.from("v_certificate_eligibility").select("*").eq("schedule_id", scheduleId);
  const rows = (eligRaw ?? []) as EligibilityRow[];
  let heldIds = new Set<string>();
  let holdCheckFailed = false;
  try {
    heldIds = await loadWahFailedHoldParticipantIds(supabase, scheduleId, (scheduleRow as any).course_id);
  } catch {
    holdCheckFailed = true;
  }
  const isHeld = (r: EligibilityRow) => r.eligible && heldIds.has(r.participant_id);
  const heldRows = rows.filter(isHeld);
  const eligibleCount = holdCheckFailed ? 0 : rows.filter((r) => r.eligible && !isHeld(r)).length;

  const boundBulk = async () => {
    "use server";
    const result = await bulkGenerate(scheduleId);
    const reason = result.failureReasons[0] ? `&reason=${encodeURIComponent(result.failureReasons[0])}` : "";
    redirect(`/admin/certificates/generate/${scheduleId}?generated=${result.generated}&skipped=${result.skipped}&held=${result.held}${reason}`);
  };

  const generated = Number.parseInt(query.generated ?? "", 10);
  const skipped = Number.parseInt(query.skipped ?? "", 10);
  const hasGenerationResult = Number.isFinite(generated) && Number.isFinite(skipped);
  const heldInRun = Number.parseInt(query.held ?? "", 10);

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
        A certificate can only be generated once the schedule is <strong>Completed</strong> and the participant meets the course&apos;s configured attendance minimum and assessment/competency requirements.
      </div>

      {hasGenerationResult ? (
        <div
          className="ta-alert"
          role="status"
          style={{
            background: generated > 0 ? "rgba(27, 148, 90, .10)" : "rgba(218, 158, 20, .12)",
            color: generated > 0 ? "var(--ta-success)" : "var(--ta-warning)",
            marginBottom: 16,
          }}
        >
          {generated > 0 ? <><strong>{generated} certificate{generated === 1 ? "" : "s"} generated successfully.</strong> </> : <strong>No certificates were generated. </strong>}
          {skipped > 0 ? `${skipped} participant${skipped === 1 ? " was" : "s were"} skipped because their eligibility changed, a certificate already exists, or the system rejected the request.` : "All eligible participants have been processed."}
          {heldInRun > 0 ? <><br />{heldInRun} held participant{heldInRun === 1 ? " was" : "s were"} excluded from this run.</> : null}
          {query.reason ? <><br />System reason: <strong>{query.reason}</strong></> : null}
        </div>
      ) : null}

      {holdCheckFailed ? <div className="ta-alert ta-alert-error" role="alert">{WAH_FAILED_HOLD_CHECK_ERROR} Generation is disabled until this page loads the check.</div> : null}

      {heldRows.length > 0 ? (
        <div className="ta-alert" role="status" style={{ background: "rgba(218, 158, 20, .12)", color: "var(--ta-warning)", marginBottom: 16 }}>
          <strong>{WAH_FAILED_HOLD_LABEL}:</strong> {heldRows.map((r) => r.holder_name).join(", ")}. An authorized Admin may correct a result on the Assessment page, using genuine evidence.
        </div>
      ) : null}

      <Card>
        {rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Participant</th><th>Attendance</th><th>Result</th><th>Competency</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const already = !!r.existing_certificate_id;
                  const canGen = r.eligible && !holdCheckFailed && !isHeld(r);
                  const boundGen = async () => {
                    "use server";
                    const result = await generateCertificate(scheduleId, r.participant_id);
                    const generatedCount = result === "ok" ? 1 : 0;
                    const skippedCount = result === "ok" ? 0 : 1;
                    const reason = result === "ok" ? "" : `&reason=${encodeURIComponent(result)}`;
                    redirect(`/admin/certificates/generate/${scheduleId}?generated=${generatedCount}&skipped=${skippedCount}${reason}`);
                  };
                  return (
                    <tr key={r.participant_id}>
                      <td><strong>{r.holder_name}</strong></td>
                      <td>{r.attendance_percentage}%</td>
                      <td>{r.result ? <Badge status={r.result} /> : "—"}</td>
                      <td>{r.competency_status ? <Badge status={r.competency_status} /> : "—"}</td>
                      <td>{isHeld(r) ? <strong style={{ color: "var(--ta-warning)", fontSize: 12.5 }}>{WAH_FAILED_HOLD_LABEL}</strong> : r.eligible ? "✅ Eligible" : <span style={{ color: "var(--ta-muted)", fontSize: 12.5 }}>{reasonText(r)}</span>}</td>
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
