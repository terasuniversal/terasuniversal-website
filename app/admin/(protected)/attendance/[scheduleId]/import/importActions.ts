"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireAttendance } from "../../../../../../lib/auth/session";

export interface RawRow { [key: string]: string }
export interface AnalyzedRow {
  index: number;
  participant_id: string;
  status: "ok" | "invalid";
  reason?: string;
  data?: { attendance_status: string; check_in?: string; check_out?: string; remarks?: string };
}
export interface Analysis {
  rows: AnalyzedRow[];
  summary: { total: number; ok: number; invalid: number };
}

const VALID = ["pending", "present", "absent", "late", "medical_leave", "excused"];
function normStatus(s?: string) {
  const v = (s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return VALID.includes(v) ? v : "";
}

/**
 * Validate attendance import rows against THIS schedule's assigned
 * participants (by Participant ID). Rows referencing an unknown / unassigned
 * participant, or an unrecognised status, are flagged invalid.
 */
export async function analyzeImport(scheduleId: string, raw: RawRow[]): Promise<Analysis> {
  await requireAttendance(true);
  const supabase = await createSupabaseServerClient();

  // Map participant_id (TU-...) → attendance row id for this schedule.
  const { data: att } = await supabase
    .from("attendance")
    .select("id, participants(participant_id)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);
  const byPid = new Map<string, string>();
  for (const a of att ?? []) {
    const pid = (a as any).participants?.participant_id;
    if (pid) byPid.set(pid.toLowerCase(), (a as any).id);
  }

  const rows: AnalyzedRow[] = raw.map((r, index) => {
    const pid = (r["Participant ID"] ?? r.participant_id ?? "").trim();
    const status = normStatus(r["Status"] ?? r.attendance_status ?? r.status);
    if (!pid) return { index, participant_id: "", status: "invalid", reason: "Missing Participant ID" };
    if (!byPid.has(pid.toLowerCase())) return { index, participant_id: pid, status: "invalid", reason: "Not assigned to this schedule" };
    if (!status) return { index, participant_id: pid, status: "invalid", reason: "Unrecognised status" };
    return {
      index, participant_id: pid, status: "ok",
      data: {
        attendance_status: status,
        check_in: (r["Check-in"] ?? r.check_in ?? "").trim(),
        check_out: (r["Check-out"] ?? r.check_out ?? "").trim(),
        remarks: (r["Remarks"] ?? r.remarks ?? "").trim(),
      },
    };
  });

  return { rows, summary: { total: rows.length, ok: rows.filter((r) => r.status === "ok").length, invalid: rows.filter((r) => r.status === "invalid").length } };
}

export async function commitImport(scheduleId: string, raw: RawRow[]): Promise<{ updated: number; skipped: number; message?: string }> {
  await requireAttendance(true);
  const analysis = await analyzeImport(scheduleId, raw);
  const ok = analysis.rows.filter((r) => r.status === "ok");
  if (ok.length === 0) return { updated: 0, skipped: analysis.summary.total };

  const supabase = await createSupabaseServerClient();
  // Re-map pid → attendance id.
  const { data: att } = await supabase.from("attendance").select("id, participants(participant_id)").eq("schedule_id", scheduleId).is("deleted_at", null);
  const byPid = new Map<string, string>();
  for (const a of att ?? []) { const pid = (a as any).participants?.participant_id; if (pid) byPid.set(pid.toLowerCase(), (a as any).id); }

  let updated = 0;
  for (const row of ok) {
    const attId = byPid.get(row.participant_id.toLowerCase());
    if (!attId) continue;
    const parseDt = (v?: string) => (v ? new Date(v).toISOString() : null);
    // The attendance schema was introduced after the checked-in generated
    // Supabase types. Keep this cast local until the live schema types are
    // regenerated, rather than weakening the client type globally.
    const { error } = await (supabase.from("attendance") as any).update({
      attendance_status: row.data!.attendance_status,
      check_in_time: parseDt(row.data!.check_in),
      check_out_time: parseDt(row.data!.check_out),
      remarks: row.data!.remarks || null,
    }).eq("id", attId);
    if (!error) updated++;
  }

  await supabase.rpc("log_event" as never, { p_action: "import", p_entity_type: "attendance", p_summary: `Imported attendance: ${updated} updated, ${analysis.summary.invalid} invalid` } as never);
  revalidatePath(`/admin/attendance/${scheduleId}`);
  return { updated, skipped: analysis.summary.invalid };
}
