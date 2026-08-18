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
    // Group column: only for "All Groups" on a schedule that actually has
    // active groups -- a specific group (or Ungrouped) already names itself
    // in the header, so repeating it per row would be redundant; a legacy
    // zero-group schedule has no group column at all, unchanged.
    const showGroupColumn = groups.length > 0 && selection === null;
    type PrintRow = {
      no: number; name: string; ic: string; group: string;
      theory: string | number; practical: string | number;
      result: string; competency: string; remarks: string;
    };
    const printRows: PrintRow[] = roster.map((r: any, i: number) => {
      const a = byParticipant.get(r.participant_id);
      return {
        no: i + 1,
        name: r.participants?.full_name ?? "",
        ic: String(r.participants?.ic_passport_no ?? "").trim() || "—",
        group: groupNameByParticipant.get(r.participant_id) ?? "Ungrouped",
        theory: a?.theory_score ?? "—",
        practical: a?.practical_score ?? "—",
        result: a?.result ?? "pending",
        competency: a?.competency_status ?? "—",
        remarks: a?.remarks ?? "",
      };
    });
    // Explicit <colgroup> widths (not left to the browser's fixed-layout
    // auto-distribution) so Participant Name and IC/Passport get real room
    // in landscape instead of wrapping mid-word. Two width sets because the
    // column count itself differs with/without the Group column.
    const colgroup = showGroupColumn
      ? `<colgroup><col style="width:4%"><col style="width:20%"><col style="width:13%"><col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:8%"><col style="width:11%"><col style="width:22%"></colgroup>`
      : `<colgroup><col style="width:5%"><col style="width:24%"><col style="width:15%"><col style="width:8%"><col style="width:8%"><col style="width:9%"><col style="width:12%"><col style="width:19%"></colgroup>`;
    const printHead = `<th class="no">No.</th><th>Participant Name</th><th class="ic">IC / Passport</th>${showGroupColumn ? "<th>Group</th>" : ""}<th>Theory</th><th>Practical</th><th>Result</th><th>Competency</th><th>Remarks</th>`;
    const rowHtml = (r: PrintRow) =>
      `<tr><td class="no">${r.no}</td><td>${esc(r.name)}</td><td class="ic">${esc(r.ic)}</td>${showGroupColumn ? `<td>${esc(r.group)}</td>` : ""}<td class="no">${esc(r.theory)}</td><td class="no">${esc(r.practical)}</td><td>${esc(r.result)}</td><td>${esc(r.competency)}</td><td>${esc(r.remarks)}</td></tr>`;
    const tableHtml = (rows: PrintRow[]) => `<table>${colgroup}<thead><tr>${printHead}</tr></thead><tbody>${rows.map(rowHtml).join("")}</tbody></table>`;

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

    // Real handwritten-signature room (~13mm blank, within the approved
    // 12-15mm range), not a line immediately after the label -- the
    // underline sits below the blank space, and Date follows separately
    // underneath.
    const signOffBlock = (assessor: string, label?: string) => `
  <div class="asm-signoff-block">
    ${label ? `<p class="asm-signoff-label">${esc(label)}</p>` : ""}
    <p><strong>Assessor Name:</strong> ${esc(assessor) || "Not assigned"}</p>
    <p class="asm-sig-label"><strong>Signature:</strong></p>
    <div class="asm-sig-space"></div>
    <div class="asm-sig-underline"></div>
    <p><strong>Date:</strong> <span class="asm-line"></span></p>
  </div>`;
    const signOff =
      assessorDisplay.mode === "single"
        ? signOffBlock(assessorDisplay.assessor)
        : assessorDisplay.entries.map((e) => signOffBlock(e.assessor, `${e.label} (${e.isOverride ? "Override" : "Class Assessor"})`)).join("");
    const signOffSection = `
  <section class="asm-signoff">
    <strong>ASSESSOR VERIFICATION</strong>
    ${signOff}
  </section>`;

    // Deterministic print pagination.
    //
    // Every earlier attempt at this print sheet (see this file's git history)
    // relied on Chromium's own automatic fragmentation of ONE long <table>
    // followed by a sign-off block, controlled via break-inside/break-before
    // CSS. That combination proved unreliable across many rounds: reordered
    // rows, a phantom page with nothing but a repeated <thead>, and the
    // sign-off block itself splitting mid-block -- each fix traded one
    // failure mode for another. The actual trigger in all of them was the
    // SAME thing: a table (or a block adjacent to one) that itself needs to
    // fragment across pages.
    //
    // The fix here removes that trigger entirely: row chunks are computed
    // server-side and each physical printed page gets its OWN short,
    // self-contained <table> that never needs to span more than one page.
    // Pages are separated with an explicit break-after:page container
    // (.asm-print-page) instead of asking the browser to decide where a
    // single long table should split.
    //
    // Height constants below are derived directly from this file's own CSS
    // (padding, font-size, line-height, borders, converted to mm at 96dpi)
    // and rounded for a safety margin against occasional 2-line wraps in
    // Remarks -- an estimate, not a live browser measurement. If a real
    // render falls outside this budget, these are the first values to
    // revisit; the row/section markup itself does not need to change.
    const PAGE_HEIGHT_MM = 186; // A4 landscape 210mm - 12mm top/bottom @page margin
    const ROW_HEIGHT_MM = 7; // td: 5px*2 padding + 11px font * 1.35 line-height + border, @96dpi
    const FULL_HEADER_MM = 38; // brand bar + body padding + 2-row meta grid + thead
    const CONTINUATION_HEADER_MM = 15; // compact "(continued)" line + body padding + thead
    const SIGNOFF_BASE_MM = 7; // .asm-signoff section margin/border/padding/heading chrome (tightened alongside the CSS below)
    const SIGNOFF_BLOCK_MM = 27; // per assessor block: name + sig label + 13mm space + underline + date + margin (tightened alongside the CSS below)
    const numAssessorBlocks = assessorDisplay.mode === "single" ? 1 : assessorDisplay.entries.length;
    const signOffHeightMm = SIGNOFF_BASE_MM + numAssessorBlocks * SIGNOFF_BLOCK_MM;

    type PrintPage = { rows: PrintRow[]; header: "full" | "compact"; includeSignOff: boolean };
    function paginate(rows: PrintRow[]): PrintPage[] {
      if (rows.length === 0) return [];
      const fitsOnePage = rows.length * ROW_HEIGHT_MM + FULL_HEADER_MM + signOffHeightMm <= PAGE_HEIGHT_MM;
      if (fitsOnePage) return [{ rows, header: "full", includeSignOff: true }];

      // Reserve the LAST page for as many trailing rows as fit alongside the
      // sign-off (using the smaller continuation header, since a genuine
      // multi-page report's last page is never the first). At least one row
      // is held back for earlier pages so the first page -- which needs the
      // full header, not the continuation one -- is never miscomputed as if
      // it were the last.
      const lastPageCapacity = Math.max(1, Math.floor((PAGE_HEIGHT_MM - CONTINUATION_HEADER_MM - signOffHeightMm) / ROW_HEIGHT_MM));
      const rowsForLastPage = Math.min(lastPageCapacity, Math.max(0, rows.length - 1));
      const leadRows = rows.slice(0, rows.length - rowsForLastPage);
      const lastRows = rows.slice(rows.length - rowsForLastPage);

      const firstPageCapacity = Math.max(1, Math.floor((PAGE_HEIGHT_MM - FULL_HEADER_MM) / ROW_HEIGHT_MM));
      const middlePageCapacity = Math.max(1, Math.floor((PAGE_HEIGHT_MM - CONTINUATION_HEADER_MM) / ROW_HEIGHT_MM));
      const pages: PrintPage[] = [];
      let cursor = 0;
      while (cursor < leadRows.length) {
        const capacity = pages.length === 0 ? firstPageCapacity : middlePageCapacity;
        const chunk = leadRows.slice(cursor, cursor + capacity);
        pages.push({ rows: chunk, header: pages.length === 0 ? "full" : "compact", includeSignOff: false });
        cursor += chunk.length;
      }
      pages.push({ rows: lastRows, header: pages.length === 0 ? "full" : "compact", includeSignOff: true });
      return pages;
    }
    const printPages = paginate(printRows);
    const pageHtml = (page: PrintPage) => `
<div class="asm-print-page">
  ${
    page.header === "full"
      ? `<header class="asm-head"><strong>TERAS UNIVERSAL SDN. BHD.</strong><h1>ASSESSMENT SHEET</h1></header>
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
    </dl>`
      : `<div class="asm-body asm-body-compact">
    <p class="asm-continued">TERAS UNIVERSAL — ${esc(title)} (continued)</p>`
  }
    ${tableHtml(page.rows)}
    ${page.includeSignOff ? signOffSection : ""}
  </div>
</div>`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; }
  /* Each .asm-print-page is a fully self-contained, deterministically-sized
     printed page (see the route handler's paginate() comment) -- every one
     except the last gets an explicit page break, instead of letting the
     browser decide where a single long table should fragment. The last page
     is explicit too (break-after: auto is the default, but stated here so
     nothing relies on that default silently): there is no page after it, so
     nothing should ever force one. */
  .asm-print-page:not(:last-of-type) { break-after: page; page-break-after: always; }
  .asm-print-page:last-of-type { break-after: auto; page-break-after: auto; }
  .asm-head { background: #0B3A63; color: #fff; padding: 10px 16px; border-bottom: 3px solid #D4AF37; }
  .asm-head strong { display: block; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: #D4AF37; }
  .asm-head h1 { margin: 2px 0 0; font-size: 17px; font-weight: 800; letter-spacing: .04em; }
  .asm-body { padding: 10px 16px 0; }
  .asm-body-compact { padding-top: 8px; }
  .asm-continued { margin: 0 0 6px; font-size: 11px; font-weight: 700; color: #0B3A63; }
  .asm-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 24px; margin: 0 0 6px; font-size: 12px; }
  .asm-meta div { padding: 3px 0; border-bottom: 1px solid #e1e6ee; }
  .asm-meta dt { display: inline; color: #0B3A63; font-weight: 700; }
  .asm-meta dd { display: inline; margin: 0 0 0 5px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; table-layout: fixed; }
  thead { display: table-header-group; }
  /* Only wrap at real word boundaries (the browser default) -- explicitly
     NOT word-break: break-word/anywhere, which is what was producing
     mid-word breaks like "PARTICIPAN / T NAME" in the previous portrait
     layout. Generous <colgroup> widths (below) mean this rarely triggers
     for Name; Remarks is the column expected to actually wrap sometimes. */
  th, td { border: 1px solid #c9cfd9; padding: 5px 7px; text-align: left; vertical-align: middle; white-space: normal; word-break: normal; overflow-wrap: normal; line-height: 1.35; }
  th { background: #0B3A63; color: #fff; font-size: 9.5px; text-transform: uppercase; letter-spacing: .02em; }
  th.no, td.no { text-align: center; }
  /* IC/passport numbers are short, fixed-format strings (e.g.
     980605-04-5321) -- always safe to keep on one line given the column's
     dedicated width, unlike a person's name which has no such bound. */
  th.ic, td.ic { white-space: nowrap; }
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  /* Plain block flow, NOT display:grid/flex, and deliberately NO
     break-inside/page-break-inside here. paginate() in the route handler
     already groups this section's row chunk + sign-off into a single
     .asm-print-page sized (by estimate, not a live measurement) to fit one
     physical page -- but break-inside:avoid is a binary "fits entirely or
     relocate the WHOLE block to a fresh page" rule, independent of that
     grouping. Whenever the real rendered height came in even slightly over
     the estimate, Chrome relocated this entire section to its own page
     rather than just the small overflow -- exactly the "sign-off alone on
     the next page" symptom, now on a single-page container instead of
     across a fragmenting table. The only explicit page break in this
     document is .asm-print-page's break-after, between pages the server
     already decided on; nothing here should introduce another one. */
  /* Chrome QA showed the tail of this section (underline + Date) spilling
     onto a following page even after the previous round's break-inside
     removal -- confirming the estimate this section's own footprint was
     based on was a little optimistic, not that avoid was still in play.
     Tightened the section/paragraph/block spacing here (never row height,
     font size, columns, or page margins) to close that gap; SIGNOFF_BASE_MM/
     SIGNOFF_BLOCK_MM in the route handler are kept in sync with these exact
     values. */
  .asm-signoff { margin-top: 4px; border-top: 2px solid #0B3A63; padding-top: 4px; }
  .asm-signoff > strong { display: block; font-size: 11px; color: #0B3A63; letter-spacing: .06em; margin-bottom: 2px; }
  .asm-signoff-block { margin-bottom: 4px; font-size: 12px; }
  .asm-signoff-block p { margin: 1px 0; }
  .asm-signoff-label { font-weight: 700; color: #0B3A63; }
  .asm-sig-label { margin-bottom: 0; }
  /* Practical handwriting room, ~13mm (within the approved 12-15mm range,
     tightened from 15mm) -- matches SIGNOFF_BLOCK_MM in the route handler's
     pagination math; change both together if this value changes. */
  .asm-sig-space { height: 13mm; }
  .asm-sig-underline { border-bottom: 1px solid #1a1a1a; width: 100%; max-width: 280px; margin: 0 0 2px; }
  .asm-line { display: inline-block; min-width: 220px; border-bottom: 1px solid #1a1a1a; }
  .asm-empty { padding: 0 16px 16px; color: #0B3A63; font-weight: 600; }
</style>
</head><body onload="window.print()">
${
  printRows.length > 0
    ? printPages.map(pageHtml).join("")
    : `<div class="asm-print-page">
  <header class="asm-head"><strong>TERAS UNIVERSAL SDN. BHD.</strong><h1>ASSESSMENT SHEET</h1></header>
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
    <p class="asm-empty">${groupHeaderValue ? "No participants assigned to this group." : "No participants enrolled in this schedule yet."}</p>
  </div>
</div>`
}
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
