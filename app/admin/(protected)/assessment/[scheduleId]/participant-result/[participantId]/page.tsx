import { getStaffParticipantAssessmentResult } from "../../../../../../../lib/assessment/participantResult";
import { ParticipantResultActions } from "./ParticipantResultActions";

export const metadata = { title: "Assessment Result — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

function ResultBadge({ value }: { value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 34,
        padding: "6px 12px",
        border: "1px solid #d4af37",
        borderRadius: 999,
        color: "#0b3a63",
        fontWeight: 700,
        letterSpacing: ".04em",
      }}
    >
      {value}
    </span>
  );
}

export default async function StaffParticipantResultPage({
  params,
}: {
  params: Promise<{ scheduleId: string; participantId: string }>;
}) {
  const { scheduleId, participantId } = await params;
  const result = await getStaffParticipantAssessmentResult(scheduleId, participantId);

  return (
    <main className="ta-participant-result" style={{ minHeight: "auto", background: "#f7f9fc", padding: "48px 20px" }}>
      <article className="ta-participant-result-paper" style={{ maxWidth: 760, margin: "0 auto", background: "#fff", borderTop: "4px solid #0b3a63", boxShadow: "0 8px 30px rgba(11,58,99,.08)", page: "participant-result-page" }}>
        <header className="ta-participant-result-header" style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-start", padding: "28px 32px 22px", borderBottom: "1px solid #dfe5ec" }}>
          <div className="ta-participant-result-brand">
            <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
            <div>
              <p style={{ margin: 0, color: "#667085", fontSize: 12, letterSpacing: ".08em" }}>TERAS UNIVERSAL SDN. BHD.</p>
              <h1 style={{ margin: "8px 0 0", color: "#0b3a63", fontSize: 25 }}>ASSESSMENT RESULT</h1>
            </div>
          </div>
          <div className="ta-participant-result-header-side">
            <p style={{ margin: 0, color: "#667085", fontSize: 13, textAlign: "right" }}>Participant Result</p>
            <ParticipantResultActions assessmentHref={`/admin/assessment/${scheduleId}`} />
          </div>
        </header>

        <section style={{ padding: "24px 32px" }}>
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(150px, 220px) 1fr", gap: "10px 18px", margin: 0, color: "#1f2937" }}>
            <dt style={{ color: "#667085" }}>Participant</dt>
            <dd style={{ margin: 0, fontWeight: 700 }}>{result.participant.fullName}</dd>
            <dt style={{ color: "#667085" }}>Participant ID</dt>
            <dd style={{ margin: 0 }}>{result.participant.participantCode}</dd>
            <dt style={{ color: "#667085" }}>Programme / Course</dt>
            <dd style={{ margin: 0 }}>{result.programme}</dd>
            <dt style={{ color: "#667085" }}>Assessment Date</dt>
            <dd style={{ margin: 0 }}>{result.assessmentDate ?? "Not Recorded"}</dd>
            <dt style={{ color: "#667085" }}>Schedule / Batch</dt>
            <dd style={{ margin: 0 }}>{result.scheduleCode}</dd>
          </dl>
        </section>

        <section style={{ display: "grid", gap: 14, padding: "0 32px 32px" }} aria-label="Assessment outcomes">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center", padding: 18, border: "1px solid #e1e6ee" }}>
            <strong style={{ color: "#0b3a63" }}>Theory Assessment</strong>
            <ResultBadge value={result.theoryResult} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center", padding: 18, border: "1px solid #e1e6ee" }}>
            <strong style={{ color: "#0b3a63" }}>Practical Assessment</strong>
            <ResultBadge value={result.practicalAssessment} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center", padding: 18, border: "2px solid #0b3a63" }}>
            <strong style={{ color: "#0b3a63" }}>Overall Result</strong>
            <ResultBadge value={result.overallResult} />
          </div>
        </section>

        <footer style={{ padding: "16px 32px", borderTop: "1px solid #dfe5ec", color: "#667085", fontSize: 12 }}>
          This participant result displays official categorical outcomes only.
        </footer>
      </article>
    </main>
  );
}
