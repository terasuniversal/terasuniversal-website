import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../../lib/auth/session";
import { canViewAssessment } from "../../../../../../lib/auth/rbac";
import { loadScheduleGroups, resolveRequestedGroup, computeAssessorDisplay, UNGROUPED } from "../../../../../../lib/scheduleGroupContext";

/**
 * Export a schedule's assessment results (every enrolled participant, not
 * just ones with an existing assessment row -- roster-driven, see
 * SCHEDULES_ARCHITECTURE_DECISION.md §I).
 *   ?format=csv | excel | report   ?group=<schedule_group_id> | ungrouped
 * "report" returns a printable HTML page (the PDF placeholder — print to PDF).
 * View access = editor+ or trainer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active || !canViewAssessment(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!(await hasModuleAccess("assessment"))) return new NextResponse("Forbidden", { status: 403 });
  const { scheduleId } = await params;
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") ?? "csv";
  const requestedGroup = sp.get("group");
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await supabase
    .from("course_schedules")
    .select("schedule_code, trainer_name, venue, start_date, exam_date, courses(course_name, course_code)")
    .eq("id", scheduleId)
    .single();
  const s = scheduleRow as any;

  // Schedule Groups V1 — same server-validated selection as the Assessment
  // page (lib/scheduleGroupContext.ts); an invalid/cross-schedule ?group=
  // value falls back to "All Groups" rather than leaking another schedule's
  // roster into this export.
  const groups = await loadScheduleGroups(supabase, scheduleId);
  const selection = resolveRequestedGroup(groups, requestedGroup);
  const selectedGroup = selection && selection !== UNGROUPED ? selection : null;

  // Assigned PRIMARY assessor (Assessor Management Phase 1, display-only).
  // assessments.assessor_id is per-participant attribution and is deliberately
  // not used here. No primary assessor => blank manual handwriting line.
  const { data: assessorAssignment } = await supabase
    .from("schedule_assessors")
    .select("assessor_id, assessors(full_name)")
    .eq("schedule_id", scheduleId)
    .eq("is_primary", true)
    .maybeSingle();
  const schedulePrimaryAssessorName = (assessorAssignment as any)?.assessors?.full_name ?? "";

  const { data: rosterRaw } = await supabase
    .from("schedule_participants")
    .select("participant_id, schedule_group_id, participants(participant_id, full_name, company, ic_passport_no)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled");
  const roster = (rosterRaw ?? []).filter((r: any) => {
    if (selection === null) return true;
    if (selection === UNGROUPED) return !r.schedule_group_id;
    return r.schedule_group_id === selection.id;
  });
  const hasUngrouped = groups.length > 0 && (rosterRaw ?? []).some((r: any) => !r.schedule_group_id);
  const assessorDisplay = computeAssessorDisplay(groups, schedulePrimaryAssessorName, selection, hasUngrouped);
  const groupNameByParticipant = new Map<string, string>(
    (rosterRaw ?? []).map((r: any) => [r.participant_id, groups.find((g) => g.id === r.schedule_group_id)?.name ?? "Ungrouped"])
  );

  const { data: asm } = await supabase
    .from("assessments")
    .select("participant_id, assessment_type, theory_score, practical_score, result, competency_status, remarks")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);
  const byParticipant = new Map<string, any>((asm ?? []).map((a: any): [string, any] => [a.participant_id, a]));

  type AssessmentExportRow = {
    participant_id: string; full_name: string; company: string; group: string; assessment_type: string;
    theory_score: string | number; practical_score: string | number; overall_score: string | number;
    result: string; competency_status: string; remarks: string;
  };
  const flat: AssessmentExportRow[] = roster.map((r: any): AssessmentExportRow => {
    const a = byParticipant.get(r.participant_id);
    const theory = a?.theory_score ?? null;
    const practical = a?.practical_score ?? null;
    const overall = theory != null && practical != null ? ((theory + practical) / 2).toFixed(2) : theory ?? practical ?? "";
    return {
      participant_id: r.participants?.participant_id ?? "",
      full_name: r.participants?.full_name ?? "",
      company: r.participants?.company ?? "",
      group: groupNameByParticipant.get(r.participant_id) ?? "Ungrouped",
      assessment_type: a?.assessment_type ?? "",
      theory_score: theory ?? "",
      practical_score: practical ?? "",
      overall_score: overall,
      result: a?.result ?? "pending",
      competency_status: a?.competency_status ?? "",
      remarks: a?.remarks ?? "",
    };
  });
  // Group column only added when the schedule actually has active groups --
  // a legacy zero-group schedule's export stays byte-identical to today's.
  const H: [keyof (typeof flat)[number], string][] = [
    ["participant_id", "Participant ID"], ["full_name", "Name"], ["company", "Company"],
    ...(groups.length > 0 ? ([["group", "Group"]] as [keyof (typeof flat)[number], string][]) : []),
    ["assessment_type", "Type"], ["theory_score", "Theory"], ["practical_score", "Practical"],
    ["overall_score", "Overall"], ["result", "Result"], ["competency_status", "Competency"], ["remarks", "Remarks"],
  ];

  const groupSuffix = selectedGroup ? ` — ${selectedGroup.name}` : selection === UNGROUPED ? " — Ungrouped" : "";
  await supabase.rpc("log_event" as never, { p_action: "export", p_entity_type: "assessments", p_summary: `Exported assessments for ${s?.schedule_code ?? scheduleId}${groupSuffix} (${format})` } as never);

  const stamp = new Date().toISOString().slice(0, 10);
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (format === "report") {
    // Print-specific columns per the approved Assessment Sign-off Sheet
    // design -- deliberately NOT the same shape as the CSV/Excel row above
    // (Participant ID/Company/Type/Overall are export-interchange fields;
    // this is a formal signed document, matching Attendance Print's
    // No./Name/IC convention instead). Blank-value convention ("—") matches
    // AssessmentTable.tsx's own on-screen rendering for missing scores.
    type PrintRow = {
      no: number; name: string; ic: string;
      theory: string | number; practical: string | number;
      result: string; competency: string; remarks: string;
    };
    const printRows: PrintRow[] = roster.map((r: any, i: number) => {
      const a = byParticipant.get(r.participant_id);
      return {
        no: i + 1,
        name: r.participants?.full_name ?? "",
        ic: String(r.participants?.ic_passport_no ?? "").trim() || "—",
        theory: a?.theory_score ?? "—",
        practical: a?.practical_score ?? "—",
        result: a?.result ?? "pending",
        competency: a?.competency_status ?? "—",
        remarks: a?.remarks ?? "",
      };
    });
    const printHead = `<th class="no">No.</th><th>Participant Name</th><th>IC / Passport</th><th>Theory</th><th>Practical</th><th>Result</th><th>Competency</th><th>Remarks</th>`;
    const printBody = printRows
      .map(
        (r: PrintRow) =>
          `<tr><td class="no">${r.no}</td><td>${esc(r.name)}</td><td>${esc(r.ic)}</td><td class="no">${esc(r.theory)}</td><td class="no">${esc(r.practical)}</td><td>${esc(r.result)}</td><td>${esc(r.competency)}</td><td>${esc(r.remarks)}</td></tr>`
      )
      .join("");

    const title = `${s?.courses?.course_name ?? "Training"} — Assessment Sheet`;
    const fmtDate = (d: string | null | undefined) =>
      d ? new Date(d + "T00:00:00").toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" }) : "Not Recorded";
    const groupHeaderValue = selectedGroup ? selectedGroup.name : selection === UNGROUPED ? "Ungrouped" : null;

    // Effective assessor per approved decision 7: never assessments.assessor_id
    // (that stays per-participant data-entry attribution) -- always the group
    // override or schedule primary assessor, same rule as Attendance V2's
    // print sheet. Used both for the quick-reference header line and the
    // formal sign-off block below.
    const effectiveAssessorHeaderValue =
      assessorDisplay.mode === "single"
        ? assessorDisplay.assessor || "Not assigned"
        : assessorDisplay.entries.map((e) => `${e.label} — ${e.assessor}`).join("; ");

    const signOffBlock = (assessor: string, label?: string) => `
  <div class="asm-signoff-block">
    ${label ? `<p class="asm-signoff-label">${esc(label)}</p>` : ""}
    <p><strong>Assessor Name:</strong> ${esc(assessor) || "Not assigned"}</p>
    <p><strong>Signature:</strong> <span class="asm-line"></span></p>
    <p><strong>Date:</strong> <span class="asm-line"></span></p>
  </div>`;
    const signOff =
      assessorDisplay.mode === "single"
        ? signOffBlock(assessorDisplay.assessor)
        : assessorDisplay.entries.map((e) => signOffBlock(e.assessor, `${e.label} (${e.isOverride ? "Override" : "Class Assessor"})`)).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; }
  .asm-head { background: #0B3A63; color: #fff; padding: 10px 16px; border-bottom: 3px solid #D4AF37; }
  .asm-head strong { display: block; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: #D4AF37; }
  .asm-head h1 { margin: 2px 0 0; font-size: 17px; font-weight: 800; letter-spacing: .04em; }
  .asm-body { padding: 14px 16px 0; }
  .asm-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px 24px; margin: 0 0 10px; font-size: 12px; }
  .asm-meta div { padding: 3px 0; border-bottom: 1px solid #e1e6ee; }
  .asm-meta dt { display: inline; color: #0B3A63; font-weight: 700; }
  .asm-meta dd { display: inline; margin: 0 0 0 5px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; table-layout: fixed; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #c9cfd9; padding: 5px 6px; text-align: left; vertical-align: middle; word-wrap: break-word; }
  th { background: #0B3A63; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: .02em; }
  th.no, td.no { width: 8%; text-align: center; }
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .asm-signoff { margin-top: 18px; border-top: 2px solid #0B3A63; padding-top: 10px; break-inside: avoid; page-break-inside: avoid; }
  .asm-signoff > strong { display: block; font-size: 11px; color: #0B3A63; letter-spacing: .06em; margin-bottom: 6px; }
  .asm-signoff-block { break-inside: avoid; page-break-inside: avoid; margin-bottom: 10px; font-size: 12px; }
  .asm-signoff-block p { margin: 3px 0; }
  .asm-signoff-label { font-weight: 700; color: #0B3A63; }
  .asm-line { display: inline-block; min-width: 260px; border-bottom: 1px solid #1a1a1a; }
  .asm-empty { padding: 0 16px 16px; color: #0B3A63; font-weight: 600; }
</style>
</head><body onload="window.print()">
<header class="asm-head">
  <strong>TERAS UNIVERSAL SDN. BHD.</strong>
  <h1>ASSESSMENT SHEET</h1>
</header>
<div class="asm-body">
  <dl class="asm-meta">
    <div><dt>Programme / Course:</dt><dd>${esc(s?.courses?.course_name ?? "—")}</dd></div>
    ${s?.courses?.course_code ? `<div><dt>Course Code:</dt><dd>${esc(s.courses.course_code)}</dd></div>` : ""}
    <div><dt>Schedule / Batch:</dt><dd>${esc(s?.schedule_code ?? "—")}</dd></div>
    ${groupHeaderValue ? `<div><dt>Group:</dt><dd>${esc(groupHeaderValue)}</dd></div>` : ""}
    <div><dt>Assessment Date:</dt><dd>${esc(fmtDate(s?.exam_date))}</dd></div>
    <div><dt>Venue:</dt><dd>${esc(s?.venue || "—")}</dd></div>
    <div><dt>Trainer:</dt><dd>${esc(s?.trainer_name || "—")}</dd></div>
    <div><dt>Effective Assessor:</dt><dd>${esc(effectiveAssessorHeaderValue)}</dd></div>
  </dl>
  ${
    printRows.length > 0
      ? `<table><thead><tr>${printHead}</tr></thead><tbody>${printBody}</tbody></table>
  <section class="asm-signoff">
    <strong>ASSESSOR VERIFICATION</strong>
    ${signOff}
  </section>`
      : `<p class="asm-empty">${groupHeaderValue ? "No participants assigned to this group." : "No participants enrolled in this schedule yet."}</p>`
  }
</div>
</body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (format === "excel") {
    const head = H.map(([, l]) => `<th>${esc(l)}</th>`).join("");
    const body = flat.map((r) => `<tr>${H.map(([k]) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("");
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="assessment-${s?.schedule_code ?? "sheet"}-${stamp}.xls"` } });
  }

  const escCsv = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = [H.map(([, l]) => l).join(","), ...flat.map((r) => H.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="assessment-${s?.schedule_code ?? "sheet"}-${stamp}.csv"` } });
}
