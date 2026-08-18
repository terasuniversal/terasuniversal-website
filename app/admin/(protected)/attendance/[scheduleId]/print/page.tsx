import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireAttendance } from "../../../../../../lib/auth/session";
import { PrintButton } from "./PrintButton";
import { loadAttendanceGroups, resolveRequestedGroup, computeAssessorDisplay, UNGROUPED } from "../../groupFilter";

export const metadata = {
  title: "Print Attendance Sheet — TERAS UNIVERSAL Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/** Compact per-session status codes for print display only. The live
 *  attendance_status values are present/absent/late/excused (20260809100200);
 *  mc/replacement are mapped too so any value that reaches the sheet renders
 *  as its short code. Unknown/absent-row values stay blank — the source-of-
 *  truth rule (an unrecorded day is never silently Absent) is preserved. */
const STATUS_CODE: Record<string, string> = {
  present: "P",
  absent: "A",
  late: "L",
  excused: "E",
  mc: "MC",
  replacement: "R",
};

/**
 * Printable TRAINING ATTENDANCE SHEET — one landscape A4 roster for the
 * entire schedule. One column per real recorded session date (D1…Dn), built
 * from the distinct `attendance.session_date` values; a participant's cell on
 * day Di shows the short status code for that (participant, session) row, and
 * stays blank when no row exists.
 *
 * Read-only. Reads the same live rows as the Take Attendance page
 * (course_schedules → courses, schedule_participants → participants,
 * attendance incl. per-session remarks) plus participants.ic_passport_no.
 * Three queries total — schedule, roster, whole-schedule attendance —
 * aggregated per participant in memory; no N+1, no attendance-writing logic,
 * no eligibility/classification (no 80% rule is introduced or applied here).
 */
export default async function AttendancePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ scheduleId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  await requireAttendance(false); // editor+ or trainer — same gate as Take Attendance
  const { scheduleId } = await params;
  const { group: requestedGroup } = await searchParams;
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

  // Schedule Groups V1 — same server-validated selection as the Take
  // Attendance page (groupFilter.ts); an invalid/cross-schedule ?group=
  // value falls back to "All Groups" rather than leaking another
  // schedule's roster onto this printout.
  const groups = await loadAttendanceGroups(supabase, scheduleId);
  const selection = resolveRequestedGroup(groups, requestedGroup);
  const selectedGroup = selection && selection !== UNGROUPED ? selection : null;

  // Assigned primary assessor (Assessor Management Phase 1) — the schedule's
  // shared/default assessor. The print sheet only pre-fills the ASSESSOR
  // VERIFICATION name line(s) — Signature and Date stay manual.
  const { data: assessorAssignment } = await supabase
    .from("schedule_assessors")
    .select("assessor_id, assessors(full_name)")
    .eq("schedule_id", scheduleId)
    .eq("is_primary", true)
    .maybeSingle();
  const schedulePrimaryAssessorName = (assessorAssignment as any)?.assessors?.full_name ?? "";

  // Enrolled roster, identical to the take-attendance page (incl. ordering),
  // filtered to the selected group exactly like the Take Attendance page.
  const { data: rosterRaw } = await supabase
    .from("schedule_participants")
    .select("participant_id, schedule_group_id, participants(participant_id, full_name, ic_passport_no)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .order("enrolled_at", { ascending: true });
  const rosterFilteredRaw = (rosterRaw ?? []).filter((r: any) => {
    if (selection === null) return true;
    if (selection === UNGROUPED) return !r.schedule_group_id;
    return r.schedule_group_id === selection.id;
  });
  const hasUngrouped = groups.length > 0 && (rosterRaw ?? []).some((r: any) => !r.schedule_group_id);
  const assessorDisplay = computeAssessorDisplay(groups, schedulePrimaryAssessorName, selection, hasUngrouped);
  const roster: { participant_id: string; name: string; ic: string }[] = rosterFilteredRaw.map((r: any) => ({
    participant_id: r.participant_id,
    name: String(r.participants?.full_name ?? "").trim() || "—",
    ic: String(r.participants?.ic_passport_no ?? "").trim() || "—",
  }));

  // Trainer verification: group-specific print uses that group's own
  // trainer; "All Groups" on a legacy/single-trainer schedule keeps today's
  // single line; "All Groups" with genuinely different group trainers lists
  // each one with its own signature line instead of misattributing the
  // whole class to one name (STOP GATE #1 rule).
  const distinctGroupTrainers = new Set(groups.map((g) => g.trainer_name).filter(Boolean));
  const trainerLines: { label: string; trainer: string }[] =
    selectedGroup
      ? [{ label: "Trainer Name", trainer: selectedGroup.trainer_name ?? "— none —" }]
      : selection === UNGROUPED
        ? [{ label: "Trainer Name", trainer: s.trainer_name ?? "" }]
        : groups.length === 0 || distinctGroupTrainers.size <= 1
          ? [{ label: "Trainer Name", trainer: (groups[0]?.trainer_name ?? s.trainer_name) ?? "" }]
          : [
              ...groups.map((g) => ({ label: g.name, trainer: g.trainer_name ?? "— none —" })),
              ...(hasUngrouped ? [{ label: "Ungrouped", trainer: s.trainer_name ?? "" }] : []),
            ];

  // ALL attendance rows for the schedule, once. Per (participant, session).
  const { data: attAll } = await supabase
    .from("attendance")
    .select("participant_id, session_date, attendance_status, remarks")
    .eq("schedule_id", scheduleId);

  // D1…Dn columns come only from REAL distinct session_date values, ascending.
  const sessionDates = Array.from(new Set((attAll ?? []).map((a: any) => a.session_date))).sort() as string[];

  const byParticipant = new Map<string, Map<string, { status: string | null; remarks: string | null }>>();
  for (const a of attAll ?? []) {
    let m = byParticipant.get(a.participant_id);
    if (!m) {
      m = new Map();
      byParticipant.set(a.participant_id, m);
    }
    m.set(a.session_date, { status: a.attendance_status ?? null, remarks: a.remarks ?? null });
  }

  const rows = roster.map((p, i) => {
    const m = byParticipant.get(p.participant_id);
    const remarkSet = new Set<string>();
    for (const r of m?.values() ?? []) {
      const t = String(r.remarks ?? "").trim();
      if (t) remarkSet.add(t);
    }
    return {
      no: i + 1,
      name: p.name,
      ic: p.ic,
      cells: sessionDates.map((d) => m?.get(d)?.status ?? null),
      remarks: Array.from(remarkSet).join("; "),
    };
  });

  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" });
  const trainingPeriod =
    s.start_date === s.end_date ? fmt(s.start_date) : `${fmt(s.start_date)} – ${fmt(s.end_date)}`;
  // dd/MM/yyyy, parsed from the ISO parts so no timezone shift can alter the day.
  const fmtDay = (d: string) => {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  };

  return (
    <div className="att-print-sheet">
      <style>{PRINT_STYLE}</style>

      <div className="att-print-bar">
        <PrintButton label="Print Attendance Sheet" />
        <a href={`/admin/attendance/${scheduleId}${requestedGroup ? `?group=${requestedGroup}` : ""}`} className="ta-btn ta-btn-outline">
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
          <div className="att-meta-wide">
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
          {selectedGroup || selection === UNGROUPED ? (
            <div>
              <dt>Group</dt>
              <dd>{selectedGroup ? selectedGroup.name : "Ungrouped"}</dd>
            </div>
          ) : null}
          <div>
            <dt>Training Period</dt>
            <dd>{trainingPeriod}</dd>
          </div>
          <div>
            <dt>Venue</dt>
            <dd>{s.venue || "—"}</dd>
          </div>
          {trainerLines.length === 1 && (
            <div>
              <dt>Trainer</dt>
              <dd>{trainerLines[0].trainer || "—"}</dd>
            </div>
          )}
          <div>
            <dt>Total Participants</dt>
            <dd>{roster.length}</dd>
          </div>
        </dl>

        {rows.length > 0 && sessionDates.length > 0 ? (
          <>
            <p className="att-legend">
              {sessionDates.map((d, i) => (
                <span key={d} className="att-legend-item">
                  D{i + 1} — {fmtDay(d)}
                </span>
              ))}
            </p>

            <table className="att-table">
              <thead>
                <tr>
                  <th className="att-col-no">No.</th>
                  <th className="att-col-name">Participant Name</th>
                  <th className="att-col-ic">IC / Passport No.</th>
                  {sessionDates.map((d, i) => (
                    <th key={d} className="att-col-day">
                      D{i + 1}
                    </th>
                  ))}
                  <th className="att-col-sig">Participant Signature</th>
                  <th className="att-col-rem">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.no}>
                    <td className="att-col-no">{r.no}</td>
                    <td className="att-col-name">{r.name}</td>
                    <td className="att-col-ic">{r.ic}</td>
                    {r.cells.map((st, j) => (
                      <td key={sessionDates[j]} className="att-day-cell">
                        {st ? (STATUS_CODE[st] ?? "") : ""}
                      </td>
                    ))}
                    <td className="att-sig-cell" />
                    <td className="att-col-rem">{r.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <section className="att-confirm">
              <div className="att-confirm-grid">
                <div className="att-confirm-col">
                  <h2>TRAINER VERIFICATION</h2>
                  {trainerLines.length === 1 ? (
                    <>
                      <div className="att-confirm-line">
                        <span>Trainer Name:</span>
                        <span className="att-line">{trainerLines[0].trainer}</span>
                      </div>
                      <div className="att-confirm-line">
                        <span>Signature:</span>
                        <span className="att-line" />
                      </div>
                    </>
                  ) : (
                    // Multiple group trainers on an "All Groups" printout: one
                    // name + signature line per trainer instead of one blank
                    // line misattributed to a single name (STOP GATE #1 rule) --
                    // kept inside this same column so the tuned one-page print
                    // budget (see PRINT_STYLE comments) only grows by the few
                    // extra lines a genuinely multi-trainer class needs, not a
                    // whole second confirmation block.
                    trainerLines.map((t) => (
                      <div className="att-confirm-line" key={t.label}>
                        <span>{t.label} — {t.trainer}:</span>
                        <span className="att-line" />
                      </div>
                    ))
                  )}
                  <div className="att-confirm-line">
                    <span>Date:</span>
                    <span className="att-line" />
                  </div>
                </div>
                <div className="att-confirm-col">
                  <h2>ASSESSOR VERIFICATION</h2>
                  {assessorDisplay.mode === "single" ? (
                    <>
                      <div className="att-confirm-line">
                        <span>Assessor Name:</span>
                        <span className="att-line">
                          {assessorDisplay.assessor}
                          {assessorDisplay.showLabel ? ` (${assessorDisplay.isOverride ? "Override" : "Class Assessor"})` : ""}
                        </span>
                      </div>
                      <div className="att-confirm-line">
                        <span>Signature:</span>
                        <span className="att-line" />
                      </div>
                    </>
                  ) : (
                    // Effective assessors genuinely differ across groups on
                    // this "All Groups" printout: one name + signature line
                    // per group instead of one line that would hide an
                    // override (same treatment as multi-trainer, above).
                    assessorDisplay.entries.map((e) => (
                      <div className="att-confirm-line" key={e.label}>
                        <span>{e.label} — {e.assessor} ({e.isOverride ? "Override" : "Class Assessor"}):</span>
                        <span className="att-line" />
                      </div>
                    ))
                  )}
                  <div className="att-confirm-line">
                    <span>Date:</span>
                    <span className="att-line" />
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : (
          <p className="att-empty">
            {rows.length === 0 && (selectedGroup || selection === UNGROUPED)
              ? "No participants assigned to this group."
              : rows.length === 0
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
  padding: 18px 22px; max-width: 1100px; margin: 0 auto;
  font-family: var(--font-poppins), Arial, Helvetica, sans-serif;
  font-size: 12.5px; line-height: 1.4;
}
.att-head {
  display: flex; align-items: center; gap: 12px;
  background: var(--att-navy); color: #fff;
  padding: 6px 16px;
  border-bottom: 3px solid var(--att-gold);
  border-radius: 6px 6px 0 0;
}
.att-head-logo {
  height: 40px; width: auto; max-width: 120px;
  object-fit: contain; flex-shrink: 0;
  background: #fff; border-radius: 6px; padding: 4px;
}
.att-head-text { flex: 1; text-align: center; min-width: 0; }
.att-head-brand {
  display: block; font-size: 10.5px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: var(--att-gold);
}
/* Higher specificity than admin.css's .teras-admin h1 so the title stays
   white on the navy band (a bare class loses that rule's color). */
.att-print-sheet .att-head-title {
  font-family: var(--font-montserrat), var(--font-poppins), Arial, sans-serif;
  color: #fff; font-size: 19px; font-weight: 800; letter-spacing: .05em;
  margin: 2px 0 0; line-height: 1.1;
}
/* Landscape identity block: 4 compact columns so the course/schedule
   metadata takes two short rows instead of the portrait block's height. */
.att-meta {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 18px;
  margin: 5px 0 7px; font-size: 11.5px;
}
.att-meta-wide { grid-column: span 2; }
.att-meta > div {
  display: flex; flex-direction: column; gap: 1px; min-width: 0;
  padding: 0 0 3px; border-bottom: 1px solid #e1e6ee;
}
.att-meta dt { color: var(--att-navy); font-weight: 700; font-size: 10.5px; }
.att-meta dd { margin: 0; color: #1a1a1a; font-weight: 600; overflow-wrap: anywhere; }
.att-empty { color: var(--att-navy); font-weight: 600; margin: 8px 0; }

.att-legend {
  display: flex; flex-wrap: wrap; gap: 2px 16px;
  margin: 0 0 4px; font-size: 10px; font-weight: 600; color: var(--att-navy);
}
.att-legend-item { white-space: nowrap; }

.att-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
/* Repeat the navy header row when the roster continues onto a second page. */
.att-table thead { display: table-header-group; }
.att-table th { background: var(--att-navy); color: #fff; text-align: left; padding: 4px 5px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
.att-table td { border: 1px solid #c9cfd9; padding: 2px 4px; vertical-align: middle; }
.att-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
/* Column proportions (100% total): No 3 · Name 15 · IC 12 · D* 4 each ·
   Signature 14 · Remarks 16. */
.att-col-no { width: 3%; text-align: center; }
.att-col-name { width: 15%; }
.att-col-ic { width: 12%; }
.att-col-day { width: 4%; text-align: center; padding: 5px 2px; }
.att-col-sig { width: 14%; }
.att-col-rem { width: 16%; font-size: 10px; overflow-wrap: anywhere; }
.att-table th.att-col-no, .att-table td.att-col-no,
.att-table th.att-col-day, .att-table td.att-day-cell { text-align: center; }
.att-day-cell { font-weight: 700; font-size: 10.5px; }
/* 26px keeps a practical signature band while fitting 11 rows + legend +
   confirmation + footer on one A4 landscape page (see one-page budget below). */
.att-sig-cell { height: 26px; }

.att-confirm {
  margin-top: 8px; border-top: 2px solid var(--att-navy); padding-top: 6px; padding-bottom: 0;
}
/* globals.css:6755 scopes section{padding-block:86px} to body:has(.teras-admin)
   — specificity (0,2,2) — which outranks the bare .att-confirm (0,1,0) and
   adds 172px to this verification <section>, inflating it off page 1 (the
   whole block then gets pushed to page 2, leaving a blank page-1 gap). The
   padding override below is re-scoped to (0,3,0) so it wins. */
.att-print-sheet .att-print-doc .att-confirm { padding-top: 6px; padding-bottom: 0; }
.att-confirm-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 28px;
}
/* Columns stay intact if a genuinely large roster forces a page break; the
   container itself is allowed to flow so it is never yanked wholesale to the
   next page over a small remaining gap. */
.att-confirm-col { min-width: 0; break-inside: avoid; page-break-inside: avoid; }
@media (max-width: 640px) {
  /* Screen preview only — print A4 landscape keeps the side-by-side columns. */
  .att-confirm-grid { grid-template-columns: 1fr; gap: 16px; }
}
.att-print-sheet .att-confirm h2 {
  font-family: var(--font-montserrat), var(--font-poppins), Arial, sans-serif;
  font-size: 11px; color: var(--att-navy); letter-spacing: .08em; margin: 0 0 4px;
}
.att-confirm-line { display: flex; gap: 10px; align-items: flex-end; margin-bottom: 5px; font-size: 11.5px; }
.att-confirm-line > span:first-child { min-width: 105px; font-weight: 700; color: var(--att-navy); }
/* Filled when text is present (e.g. trainer name from course_schedules),
   otherwise just the blank handwriting rule. */
.att-line {
  flex: 1; border-bottom: 1.2px solid #1a1a1a; min-height: 13px; line-height: 13px;
  font-weight: 600; color: #1a1a1a; padding: 0 2px;
}
/* globals.css ships a bare footer{background:var(--navy);padding:56px 0 22px}
   that paints every <footer> navy — kill it here and use a clean gold rule. */
.att-foot {
  margin-top: 8px; border-top: 2px solid var(--att-gold); padding-top: 4px;
  background: transparent; padding-bottom: 0; margin-bottom: 0; border-bottom: 0;
  text-align: center; font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--att-navy);
}
.att-foot strong { font-weight: 800; }

/* One-page budget @100% scale, Headers/Footers OFF (A4 landscape =
   297mm wide ≈ 1122px, 210mm tall ≈ 794px; @page margins 12mm LR + 10mm TB
   leave ≈ 1032px × 718px printable). Measured in real page context
   (globals.css + admin.css + Montserrat/Poppins + admin shell) via
   headless-Chrome print media for an 11-participant, 10-session sheet:
   header 52 · metadata 60 (two rows) · legend 18 · thead 20 · 11 rows ≈ 374
   (26–40px each, names wrapping to two lines) · confirmation 85 · footer 24
   ≈ 633px, ~85px spare — fits a single A4 landscape page. (Before the
   padding override above, globals' body:has(.teras-admin) section rule
   silently added 172px and pushed the sheet to two pages.) A roster whose
   names all wrap to three lines can still legitimately roll to a second
   page, with the header row repeating — correct behaviour, not a regression. */
@page { size: A4 landscape; margin: 10mm 12mm; }

@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  /* Scoped to this page via body:has() so nothing else under /admin is touched.
     Root layout (app/layout.js) wraps every route incl. /admin: the skip link
     is the visible "Skip to main content" text above the doc, and
     .teras-admin's/.ta-shell's min-height:100vh (admin.css) pushes the sheet
     past the page box — both must be killed here. Verified load-bearing:
     removing this block alone puts the sheet back onto two pages, even though
     the sheet's own height fits. */
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
