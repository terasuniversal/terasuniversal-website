"use client";

import { useState } from "react";
import { Badge } from "../../../../components/admin/ui";
import { markAttendance, bulkUpdateAttendance, resetAttendance } from "./actions";
import { formatMalaysiaDateTime } from "../../../../lib/date-time";
import { utcIsoToMalaysiaDateTimeLocal } from "../../../../lib/malaysia-date-time";
import { MutationForm, MutationSubmitButton } from "../../../../components/admin/MutationForm";

export interface AttRow {
  participant_id: string;
  attendance_status: string | null; // null = not recorded for this session date
  check_in_time: string | null;
  check_out_time: string | null;
  remarks: string | null;
  participant: { id: string; participant_id: string; full_name: string; company: string | null } | null;
}

const STATUSES = ["present", "absent", "late", "excused"];
const label = (s: string) => s.replace(/_/g, " ");
/** timestamptz → value for <input type="datetime-local"> */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  return utcIsoToMalaysiaDateTimeLocal(iso);
}

export function AttendanceTable({
  scheduleId,
  sessionDate,
  rows,
  canManage,
}: {
  scheduleId: string;
  sessionDate: string;
  rows: AttRow[];
  canManage: boolean;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("present");

  const filtered = q.trim()
    ? rows.filter((r) => (r.participant?.full_name + " " + r.participant?.participant_id + " " + (r.participant?.company ?? "")).toLowerCase().includes(q.toLowerCase()))
    : rows;
  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.participant_id));

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(filtered.map((r) => r.participant_id)));

  const markForDate = markAttendance.bind(null, scheduleId, sessionDate);
  const bulkForDate = bulkUpdateAttendance.bind(null, scheduleId, sessionDate);
  const resetForDate = resetAttendance.bind(null, scheduleId, sessionDate);

  return (
    <>
      <div className="ta-toolbar">
        <div className="ta-search" style={{ maxWidth: 300 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search participant, ID, company…" />
        </div>
      </div>

      {canManage && selected.size > 0 && (
        <div className="ta-card ta-card-pad" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <strong>{selected.size} selected</strong>
          <div style={{ flex: 1 }} />
          <MutationForm action={bulkForDate} pendingLabel="Applying…" idleLabel="Apply to selected" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {[...selected].map((id) => <input key={id} type="hidden" name="participant_ids" value={id} />)}
            <select name="status" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid var(--ta-line)" }}>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
            <MutationSubmitButton>Apply to selected</MutationSubmitButton>
          </MutationForm>
          <MutationForm action={resetForDate} pendingLabel="Reverting…" idleLabel="Undo selected">
            {[...selected].map((id) => <input key={id} type="hidden" name="participant_ids" value={id} />)}
            <MutationSubmitButton className="ta-btn ta-btn-outline ta-btn-sm">↩ Undo selected</MutationSubmitButton>
          </MutationForm>
        </div>
      )}

      <div className="ta-table-wrap">
        <table className="ta-table ta-attendance-desktop">
          <thead>
            <tr>
              {canManage && <th style={{ width: 34 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" /></th>}
              <th>Participant ID</th>
              <th>Name</th>
              <th>Company</th>
              <th>Status</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Remarks</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.participant_id}>
                {canManage && <td><input type="checkbox" checked={selected.has(r.participant_id)} onChange={() => toggle(r.participant_id)} aria-label={`Select ${r.participant?.full_name}`} /></td>}
                <td><code style={{ fontSize: 12 }}>{r.participant?.participant_id}</code></td>
                <td><strong>{r.participant?.full_name}</strong></td>
                <td>{r.participant?.company ?? "—"}</td>
                {canManage ? (
                  <td colSpan={5}>
                    <MutationForm action={markForDate} pendingLabel="Saving…" idleLabel="Save" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="hidden" name="participant_id" value={r.participant_id} />
                      <select name="attendance_status" defaultValue={r.attendance_status ?? "present"} style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid var(--ta-line)" }} aria-label={`Status for ${r.participant?.full_name ?? "participant"}`}>
                        {!r.attendance_status && <option value="" disabled>Not recorded</option>}
                        {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                      </select>
                      <input type="datetime-local" name="check_in_time" defaultValue={toLocalInput(r.check_in_time)} style={inp} aria-label={`Check-in for ${r.participant?.full_name ?? "participant"}`} />
                      <input type="datetime-local" name="check_out_time" defaultValue={toLocalInput(r.check_out_time)} style={inp} aria-label={`Check-out for ${r.participant?.full_name ?? "participant"}`} />
                      <input name="remarks" defaultValue={r.remarks ?? ""} placeholder="Remarks" style={{ ...inp, width: 140 }} aria-label={`Remarks for ${r.participant?.full_name ?? "participant"}`} />
                      <MutationSubmitButton>Save</MutationSubmitButton>
                    </MutationForm>
                  </td>
                ) : (
                  <>
                    <td>{r.attendance_status ? <Badge status={r.attendance_status} /> : <span style={{ color: "var(--ta-muted)" }}>Not recorded</span>}</td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ta-muted)" }}>{r.check_in_time ? formatMalaysiaDateTime(r.check_in_time) : "—"}</td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ta-muted)" }}>{r.check_out_time ? formatMalaysiaDateTime(r.check_out_time) : "—"}</td>
                    <td>{r.remarks ?? "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ta-attendance-mobile" aria-label="Mobile attendance participant editing">
        {filtered.map((r) => {
          const participantName = r.participant?.full_name ?? "Participant";
          return (
            <article key={r.participant_id} className="ta-card ta-attendance-mobile-row">
              <div className="ta-attendance-mobile-identity">
                {canManage && (
                  <input
                    type="checkbox"
                    checked={selected.has(r.participant_id)}
                    onChange={() => toggle(r.participant_id)}
                    aria-label={`Select ${participantName}`}
                  />
                )}
                <div>
                  <strong>{participantName}</strong>
                  <div className="ta-cell-sub">
                    <code>{r.participant?.participant_id}</code>
                    {r.participant?.company ? ` · ${r.participant.company}` : ""}
                  </div>
                </div>
              </div>
              {canManage ? (
                <MutationForm action={markForDate} pendingLabel="Saving…" idleLabel="Save" className="ta-attendance-mobile-form">
                  <input type="hidden" name="participant_id" value={r.participant_id} />
                  <label>
                    <span>Status</span>
                    <select name="attendance_status" defaultValue={r.attendance_status ?? "present"} aria-label={`Status for ${participantName}`}>
                      {!r.attendance_status && <option value="" disabled>Not recorded</option>}
                      {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Check-in</span>
                    <input type="datetime-local" name="check_in_time" defaultValue={toLocalInput(r.check_in_time)} aria-label={`Check-in for ${participantName}`} />
                  </label>
                  <label>
                    <span>Check-out</span>
                    <input type="datetime-local" name="check_out_time" defaultValue={toLocalInput(r.check_out_time)} aria-label={`Check-out for ${participantName}`} />
                  </label>
                  <label className="ta-attendance-mobile-remarks">
                    <span>Remarks</span>
                    <input name="remarks" defaultValue={r.remarks ?? ""} placeholder="Remarks" aria-label={`Remarks for ${participantName}`} />
                  </label>
                  <MutationSubmitButton>Save</MutationSubmitButton>
                </MutationForm>
              ) : (
                <dl className="ta-attendance-mobile-readonly">
                  <div><dt>Status</dt><dd>{r.attendance_status ? <Badge status={r.attendance_status} /> : "Not recorded"}</dd></div>
                  <div><dt>Check-in</dt><dd>{r.check_in_time ? formatMalaysiaDateTime(r.check_in_time) : "—"}</dd></div>
                  <div><dt>Check-out</dt><dd>{r.check_out_time ? formatMalaysiaDateTime(r.check_out_time) : "—"}</dd></div>
                  <div><dt>Remarks</dt><dd>{r.remarks ?? "—"}</dd></div>
                </dl>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

const inp = { padding: "6px 8px", borderRadius: 7, border: "1px solid var(--ta-line)", fontSize: 12 } as const;
