import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../../lib/auth/session";
import { canViewAssessment } from "../../../../../../lib/auth/rbac";

/**
 * Export a schedule's assessment results (every enrolled participant, not
 * just ones with an existing assessment row -- roster-driven, see
 * SCHEDULES_ARCHITECTURE_DECISION.md §I).
 *   ?format=csv | excel | report
 * "report" returns a printable HTML page (the PDF placeholder — print to PDF).
 * View access = editor+ or trainer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active || !canViewAssessment(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!(await hasModuleAccess("assessment"))) return new NextResponse("Forbidden", { status: 403 });
  const { scheduleId } = await params;
  const format = request.nextUrl.searchParams.get("format") ?? "csv";
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await supabase.from("course_schedules").select("schedule_code, trainer_name, venue, start_date, courses(course_name)").eq("id", scheduleId).single();
  const s = scheduleRow as any;

  // Assigned PRIMARY assessor (Assessor Management Phase 1, display-only).
  // assessments.assessor_id is per-participant attribution and is deliberately
  // not used here. No primary assessor => blank manual handwriting line.
  const { data: assessorAssignment } = await supabase
    .from("schedule_assessors")
    .select("assessor_id, assessors(full_name)")
    .eq("schedule_id", scheduleId)
    .eq("is_primary", true)
    .maybeSingle();
  const assessorName = (assessorAssignment as any)?.assessors?.full_name ?? "";

  const { data: roster } = await supabase
    .from("schedule_participants")
    .select("participant_id, participants(participant_id, full_name, company)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled");
  const { data: asm } = await supabase
    .from("assessments")
    .select("participant_id, assessment_type, theory_score, practical_score, result, competency_status, remarks")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);
  const byParticipant = new Map<string, any>((asm ?? []).map((a: any): [string, any] => [a.participant_id, a]));

  type AssessmentExportRow = {
    participant_id: string; full_name: string; company: string; assessment_type: string;
    theory_score: string | number; practical_score: string | number; overall_score: string | number;
    result: string; competency_status: string; remarks: string;
  };
  const flat: AssessmentExportRow[] = (roster ?? []).map((r: any): AssessmentExportRow => {
    const a = byParticipant.get(r.participant_id);
    const theory = a?.theory_score ?? null;
    const practical = a?.practical_score ?? null;
    const overall = theory != null && practical != null ? ((theory + practical) / 2).toFixed(2) : theory ?? practical ?? "";
    return {
      participant_id: r.participants?.participant_id ?? "",
      full_name: r.participants?.full_name ?? "",
      company: r.participants?.company ?? "",
      assessment_type: a?.assessment_type ?? "",
      theory_score: theory ?? "",
      practical_score: practical ?? "",
      overall_score: overall,
      result: a?.result ?? "pending",
      competency_status: a?.competency_status ?? "",
      remarks: a?.remarks ?? "",
    };
  });
  const H: [keyof (typeof flat)[number], string][] = [
    ["participant_id", "Participant ID"], ["full_name", "Name"], ["company", "Company"],
    ["assessment_type", "Type"], ["theory_score", "Theory"], ["practical_score", "Practical"],
    ["overall_score", "Overall"], ["result", "Result"], ["competency_status", "Competency"], ["remarks", "Remarks"],
  ];

  await supabase.rpc("log_event" as never, { p_action: "export", p_entity_type: "assessments", p_summary: `Exported assessments for ${s?.schedule_code ?? scheduleId} (${format})` } as never);

  const stamp = new Date().toISOString().slice(0, 10);
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (format === "excel" || format === "report") {
    const head = H.map(([, l]) => `<th>${esc(l)}</th>`).join("");
    const body = flat.map((r) => `<tr>${H.map(([k]) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("");
    if (format === "report") {
      const title = `${s?.courses?.course_name ?? "Training"} — Assessment Report`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,sans-serif;color:#0B2C56;padding:26px}h1{font-size:19px;margin:0 0 4px}p{margin:2px 0;color:#555;font-size:13px}table{border-collapse:collapse;width:100%;font-size:12px;margin-top:16px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#0B2C56;color:#fff}tfoot td{border:0;padding-top:22px;color:#555;font-size:11px}</style>
</head><body onload="window.print()">
<h1>TERAS UNIVERSAL — ${esc(title)}</h1>
<p>Schedule: ${esc(s?.schedule_code ?? "")} · Trainer: ${esc(s?.trainer_name ?? "-")} · Venue: ${esc(s?.venue ?? "-")} · Date: ${esc(s?.start_date ?? "")}</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<div style="margin-top:26px;border-top:1px solid #ccc;padding-top:12px">
  <strong style="font-size:12px">ASSESSOR VERIFICATION</strong>
  <p style="margin:10px 0 2px;color:#0B2C56;font-size:12px"><strong>Assessor Name:</strong> ${esc(assessorName)}</p>
  <p style="margin:2px 0;color:#0B2C56;font-size:12px"><strong>Signature:</strong> ____________________________</p>
  <p style="margin:2px 0;color:#0B2C56;font-size:12px"><strong>Date:</strong> ____________________________</p>
</div>
</body></html>`;
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="assessment-${s?.schedule_code ?? "sheet"}-${stamp}.xls"` } });
  }

  const escCsv = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = [H.map(([, l]) => l).join(","), ...flat.map((r) => H.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="assessment-${s?.schedule_code ?? "sheet"}-${stamp}.csv"` } });
}
