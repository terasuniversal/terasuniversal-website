import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireModuleAccess, requireAttendance } from "../../../../../../lib/auth/session";
import { PrintButton } from "./PrintButton";

export const metadata = {
  title: "Print Attendance Sheet — TERAS UNIVERSAL Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/** Exact live values of `attendance.attendance_status` (20260809100200). */
const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
};
/** Statuses in this fixed order; display order for the summary string. */
const STATUS_ORDER = ["present", "absent", "late", "excused"] as const;

/**
 * Printable OVERALL TRAINING ATTENDANCE SHEET — ONE roster for the entire
 * schedule, with each participant's attendance summarized across the whole
 * training period. Not one section per date.
 *
 * Read-only. Reads the same live rows as the Take Attendance page
 * (course_schedules → courses, schedule_participants → participants,
 * attendance) plus participants.ic_passport_no (RLS is row-level, so the
 * roster read already grants the columns). Three queries total — schedule,
 * roster, whole-schedule attendance — aggregated per participant in memory;
 * no N+1, no attendance-writing logic.
 *
 * The status cell is a factual count over the schedule's real recorded
 * session dates (the distinct `attendance.session_date` values). No
 * eligibility/classification is invented. Missing rows follow the existing
 * business rule: an unrecorded day is "Not recorded", never silently Absent.
 */
export default async function AttendancePrintPage({
  params,
}: {
  params: Promise<{ scheduleId: string }>;
}) {
  await requireModuleAccess("attendance");
  await requireAttendance(false); // editor+ or trainer — same gate as Take Attendance
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await supabase
    .from("course_schedules")
    .select("id, schedule_code, trainer_name, venue, start_date, end_date, courses(course_name, course_code)")
    .eq("id", scheduleId)
    .single();
  if (!scheduleRow) notFound();
  const s = scheduleRow as any;
  const courseName = s.courses?.course_name ?? null;
  const courseCode = s.courses?.course_code ?? null;

  // Enrolled roster, identical to the take-attendance page (incl. ordering).
  const { data: rosterRaw } = await supabase
    .from("schedule_participants")
    .select("participant_id, participants(participant_id, full_name, ic_passport_no)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .order("enrolled_at", { ascending: true });
  const roster: { participant_id: string; name: string; ic: string }[] = (rosterRaw ?? []).map((r: any) => ({
    participant_id: r.participant_id,
    name: String(r.participants?.full_name ?? "").trim() || "—",
    ic: String(r.participants?.ic_passport_no ?? "").trim() || "—",
  }));

  // ALL attendance rows for the schedule, once. Aggregate per participant.
  const { data: attAll } = await supabase
    .from("attendance")
    .select("participant_id, session_date, attendance_status")
    .eq("schedule_id", scheduleId);
  const sessionDates = new Set<string>();
  const countsByParticipant = new Map<string, Record<string, number>>();
  for (const a of attAll ?? []) {
    sessionDates.add(a.session_date);
    const m = (countsByParticipant.get(a.participant_id) ?? {}) as Record<string, number>;
    m[a.attendance_status] = (m[a.attendance_status] ?? 0) + 1;
    countsByParticipant.set(a.participant_id, m);
  }
  const totalDays = sessionDates.size;

  const summary = (counts: Record<string, number> | undefined): string => {
    if (!counts || totalDays === 0) return "Not recorded";
    const parts: string[] = [];
    for (const st of STATUS_ORDER) {
      const c = counts[st] ?? 0;
      if (c > 0) parts.push(`${STATUS_LABEL[st]} ${c}/${totalDays}`);
    }
    const recorded = STATUS_ORDER.reduce((n, st) => n + (counts[st] ?? 0), 0);
    const notRecorded = totalDays - recorded;
    if (notRecorded > 0) parts.push(`Not recorded ${notRecorded}/${totalDays}`);
    return parts.length > 0 ? parts.join(" · ") : "Not recorded";
  };

  const rows = roster.map((p, i) => ({
    no: i + 1,
    name: p.name,
    ic: p.ic,
    status: summary(countsByParticipant.get(p.participant_id)),
  }));

  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" });
  const trainingPeriod =
    s.start_date === s.end_date ? fmt(s.start_date) : `${fmt(s.start_date)} – ${fmt(s.end_date)}`;

  return (
    <div className="att-print-sheet">
      <style>{PRINT_STYLE}</style>

      <div className="att-print-bar">
        <PrintButton label="Print Attendance Sheet" />
        <a href={`/admin/attendance/${scheduleId}`} className="ta-btn ta-btn-outline">
          ← Back to attendance
        </a>
      </div>

      <div className="att-print-doc">
        <header className="att-head">
          <img className="att-head-logo" src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
          <div className="att-head-text">
            <span className="att-head-brand">TERAS UNIVERSAL SDN. BHD.</span>
            <h1 className="att-head-title">TRAINING ATTENDANCE SHEET</h1>
          </div>
        </header>

        <dl className="att-meta">
          <div>
            <dt>Programme / Course Name</dt>
            <dd>{courseName || "—"}</dd>
          </div>
          {courseCode ? (
            <div>
              <dt>Course Code</dt>
              <dd>{courseCode}</dd>
            </div>
          ) : null}
          <div>
            <dt>Schedule / Batch</dt>
            <dd>{s.schedule_code || "—"}</dd>
          </div>
          <div>
            <dt>Training Period</dt>
            <dd>{trainingPeriod}</dd>
          </div>
          <div>
            <dt>Venue</dt>
            <dd>{s.venue || "—"}</dd>
          </div>
          <div>
            <dt>Trainer</dt>
            <dd>{s.trainer_name || "—"}</dd>
          </div>
          <div>
            <dt>Total Participants</dt>
            <dd>{roster.length}</dd>
          </div>
        </dl>

        {rows.length > 0 && totalDays > 0 ? (
          <>
            <table className="att-table">
              <thead>
                <tr>
                  <th className="att-col-no">No.</th>
                  <th className="att-col-name">Participant Name</th>
                  <th className="att-col-ic">IC / Passport No.</th>
                  <th className="att-col-status">Attendance Status</th>
                  <th className="att-col-sig">Participant Signature</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.no}>
                    <td className="att-col-no">{r.no}</td>
                    <td>{r.name}</td>
                    <td>{r.ic}</td>
                    <td>{r.status}</td>
                    <td className="att-sig-cell" />
                  </tr>
                ))}
              </tbody>
            </table>

            <section className="att-confirm">
              <h2>TRAINER CONFIRMATION</h2>
              <div className="att-confirm-line">
                <span>Trainer Name:</span>
                <span className="att-line" />
              </div>
              <div className="att-confirm-line">
                <span>Signature:</span>
                <span className="att-line" />
              </div>
              <div className="att-confirm-line">
                <span>Date:</span>
                <span className="att-line" />
              </div>
            </section>
          </>
        ) : (
          <p className="att-empty">
            {rows.length === 0
              ? "No participants enrolled in this schedule."
              : "No attendance has been recorded for this schedule yet."}
          </p>
        )}

        <footer className="att-foot">
          <strong>TERAS UNIVERSAL SDN. BHD.</strong> · TRAINING ATTENDANCE SHEET
        </footer>
      </div>
    </div>
  );
}

const PRINT_STYLE = `
.att-print-sheet { --att-navy: #0B3A63; --att-gold: #D4AF37; }
.att-print-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 18px; flex-wrap: wrap; }
.att-print-doc {
  background: #fff; color: #1a1a1a;
  border: 1px solid #d8dde5; border-radius: 8px;
  padding: 24px 28px; max-width: 820px; margin: 0 auto;
  font-family: var(--font-poppins), Arial, Helvetica, sans-serif;
  font-size: 13.5px; line-height: 1.45;
}
.att-head {
  display: flex; align-items: center; gap: 12px;
  background: var(--att-navy); color: #fff;
  padding: 10px 18px;
  border-bottom: 3px solid var(--att-gold);
  border-radius: 6px 6px 0 0;
}
.att-head-logo {
  height: 44px; width: auto; max-width: 120px;
  object-fit: contain; flex-shrink: 0;
  background: #fff; border-radius: 6px; padding: 4px;
}
.att-head-text { flex: 1; text-align: center; min-width: 0; }
.att-head-brand {
  display: block; font-size: 11px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: var(--att-gold);
}
/* Higher specificity than admin.css's .teras-admin h1 so the title stays
   white on the navy band (a bare class loses that rule's color). */
.att-print-sheet .att-head-title {
  font-family: var(--font-montserrat), var(--font-poppins), Arial, sans-serif;
  color: #fff; font-size: 20px; font-weight: 800; letter-spacing: .05em;
  margin: 2px 0 0; line-height: 1.1;
}
.att-meta {
  display: grid; grid-template-columns: 1fr 1fr; gap: 5px 22px;
  margin: 10px 0 14px; font-size: 12.5px;
}
/* globals.css styles the public site's contact-detail lists with
   dl div{padding:12px 0;border-bottom:1px solid var(--line)}, which bleeds in
   here and costs 25px per metadata row — ~100px over the four rows, and the
   single largest reason this sheet used to spill onto a second page. Keep the
   hairline rule (it is part of the approved look) but state it explicitly and
   drop the 24px of inherited padding it was carrying. */
.att-meta > div {
  display: flex; gap: 8px; min-width: 0;
  padding: 0 0 3px; border-bottom: 1px solid #e1e6ee;
}
.att-meta dt { color: var(--att-navy); font-weight: 700; font-size: 11.5px; min-width: 112px; flex-shrink: 0; }
.att-meta dd { margin: 0; color: #1a1a1a; font-weight: 600; overflow-wrap: anywhere; }
.att-empty { color: var(--att-navy); font-weight: 600; margin: 8px 0; }

.att-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; }
.att-table thead { display: table-header-group; }
.att-table th { background: var(--att-navy); color: #fff; text-align: left; padding: 7px 10px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; }
.att-table td { border: 1px solid #c9cfd9; padding: 6px 8px; vertical-align: top; }
.att-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
/* Column proportions: No 5% · Name 24% · IC 19% · Status 22% · Signature 30%. */
.att-col-no { width: 5%; text-align: center; }
.att-col-name { width: 24%; }
.att-col-ic { width: 19%; }
.att-col-status { width: 22%; }
.att-col-sig { width: 30%; }
.att-table th.att-col-no, .att-table td.att-col-no { text-align: center; }
/* 40px keeps a practical signature band while fitting 11 rows + confirmation
   + footer on one A4 portrait page at 100% scale (see one-page budget below). */
.att-sig-cell { height: 40px; }
/* padding-bottom kills globals.css's section{padding:86px 0}, which otherwise
   leaves a ~76px dead band under the signature lines. */
.att-confirm {
  margin-top: 18px; border-top: 2px solid var(--att-navy); padding-top: 10px; padding-bottom: 0;
  break-inside: avoid; page-break-inside: avoid;
}
.att-print-sheet .att-confirm h2 {
  font-family: var(--font-montserrat), var(--font-poppins), Arial, sans-serif;
  font-size: 12px; color: var(--att-navy); letter-spacing: .08em; margin: 0 0 9px;
}
.att-confirm-line { display: flex; gap: 10px; align-items: flex-end; margin-bottom: 8px; font-size: 12.5px; }
.att-confirm-line > span:first-child { min-width: 105px; font-weight: 700; color: var(--att-navy); }
.att-line { flex: 1; border-bottom: 1.2px solid #1a1a1a; height: 14px; }
/* globals.css ships a bare footer{background:var(--navy);padding:56px 0 22px}
   that paints every <footer> navy — kill it here and use a clean gold rule. */
.att-foot {
  margin-top: 16px; border-top: 2px solid var(--att-gold); padding-top: 6px;
  background: transparent; padding-bottom: 0; margin-bottom: 0; border-bottom: 0;
  text-align: center; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--att-navy);
}
.att-foot strong { font-weight: 800; }

/* One-page budget @100% scale, Headers/Footers OFF (A4 = 297mm ≈ 1122.5px):
   @page margins 12mm each = 273mm ≈ 1031.8px printable height. Measured in
   Chrome print media for an 11-participant sheet: header 67 · metadata 178
   (incl. margins) · table 546 (thead 31 + 11 rows, most names wrapping to two
   lines) · confirmation 127 · footer 40 = 982px, ~50px spare. The spare is
   thin: a roster whose names all wrap to three lines will legitimately roll to
   a second page, which is correct behaviour, not a regression. */
@page { size: A4 portrait; margin: 12mm 12mm; }

@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  /* Scoped to this page via body:has() so nothing else under /admin is touched.
     Root layout (app/layout.js) wraps every route incl. /admin: the skip link
     is the visible "Skip to main content" text above the doc, and
     .teras-admin's/.ta-shell's min-height:100vh (admin.css) pushes the sheet
     past the page box — both must be killed here. Verified load-bearing:
     removing this block alone puts the 11-participant sheet back onto two
     pages, even though the sheet's own height fits. */
  body:has(.att-print-sheet) .skip-link,
  body:has(.att-print-sheet) .sticky-cta { display: none !important; }
  body:has(.att-print-sheet) .teras-admin { background: #fff !important; min-height: 0 !important; height: auto !important; }
  body:has(.att-print-sheet) .ta-sidebar,
  body:has(.att-print-sheet) .ta-topbar,
  body:has(.att-print-sheet) .ta-scrim { display: none !important; }
  body:has(.att-print-sheet) .ta-main { margin-left: 0 !important; }
  body:has(.att-print-sheet) .ta-content { max-width: none !important; padding: 0 !important; }
  body:has(.att-print-sheet) .ta-shell { display: block !important; min-height: 0 !important; }
  .att-print-bar { display: none !important; }
  .att-print-doc {
    max-width: none !important; border: none !important; border-radius: 0 !important;
    padding: 0 !important; margin: 0 !important; box-shadow: none !important;
  }
}
`;
