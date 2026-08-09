"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireAttendance } from "../../../../../../lib/auth/session";
import { isSessionDateInRange } from "../../actions";

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

const VALID = ["present", "absent", "late", "excused"];
function normStatus(s?: string) {
  const v = (s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return VALID.includes(v) ? v : "";
}

/**
 * Validate attendance import rows against THIS schedule's enrolled
 * participants (schedule_participants, by Participant ID) for a specific
 * session date. Rows referencing an unenrolled participant, or an
 * unrecognised status, are flagged invalid.
 */
export async function analyzeImport(scheduleId: string, _sessionDate: string, raw: RawRow[]): Promise<Analysis> {
  await requireAttendance(true);
  const supabase = await createSupabaseServerClient();

  const { data: roster } = await supabase
    .from("schedule_participants")
    .select("participant_id, participants(participant_id)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled");
  const byPid = new Set<string>();
  for (const r of roster ?? []) {
    const pid = (r as any).participants?.participant_id;
    if (pid) byPid.add(pid.toLowerCase());
  }

  const rows: AnalyzedRow[] = raw.map((r, index) => {
    const pid = (r["Participant ID"] ?? r.participant_id ?? "").trim();
    const status = normStatus(r["Status"] ?? r.attendance_status ?? r.status);
    if (!pid) return { index, participant_id: "", status: "invalid", reason: "Missing Participant ID" };
    if (!byPid.has(pid.toLowerCase())) return { index, participant_id: pid, status: "invalid", reason: "Not enrolled in this schedule" };
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

export async function commitImport(scheduleId: string, sessionDate: string, raw: RawRow[]): Promise<{ updated: number; skipped: number; message?: string }> {
  await requireAttendance(true);
  const supabase = await createSupabaseServerClient();
  if (!(await isSessionDateInRange(supabase, scheduleId, sessionDate))) return { updated: 0, skipped: 0, message: "Session date is outside this schedule's date range." };
  const analysis = await analyzeImport(scheduleId, sessionDate, raw);
  const ok = analysis.rows.filter((r) => r.status === "ok");
  if (ok.length === 0) return { updated: 0, skipped: analysis.summary.total };
  const { data: roster } = await supabase
    .from("schedule_participants")
    .select("participant_id, participants(participant_id)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled");
  const byPid = new Map<string, string>();
  for (const r of roster ?? []) {
    const pid = (r as any).participants?.participant_id;
    if (pid) byPid.set(pid.toLowerCase(), (r as any).participant_id);
  }

  const parseDt = (v?: string) => (v ? new Date(v).toISOString() : null);
  const upsertRows = ok
    .map((row) => {
      const participantId = byPid.get(row.participant_id.toLowerCase());
      if (!participantId) return null;
      return {
        schedule_id: scheduleId,
        participant_id: participantId,
        session_date: sessionDate,
        attendance_status: row.data!.attendance_status,
        check_in_time: parseDt(row.data!.check_in),
        check_out_time: parseDt(row.data!.check_out),
        remarks: row.data!.remarks || null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  let updated = 0;
  if (upsertRows.length > 0) {
    const { error } = await supabase.from("attendance").upsert(upsertRows, { onConflict: "schedule_id,participant_id,session_date" });
    if (!error) updated = upsertRows.length;
  }

  await supabase.rpc("log_event" as never, { p_action: "import", p_entity_type: "attendance", p_summary: `Imported attendance for ${sessionDate}: ${updated} updated, ${analysis.summary.invalid} invalid` } as never);
  revalidatePath(`/admin/attendance/${scheduleId}`);
  return { updated, skipped: analysis.summary.invalid };
}
