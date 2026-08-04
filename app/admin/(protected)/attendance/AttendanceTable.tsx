"use client";

import { useState } from "react";
import { Badge } from "../../../../components/admin/ui";
import { updateAttendance, bulkUpdateAttendance, resetAttendance } from "./actions";

export interface AttRow {
  id: string;
  attendance_status: string;
  check_in_time: string | null;
  check_out_time: string | null;
  remarks: string | null;
  participant: { id: string; participant_id: string; full_name: string; company: string | null } | null;
}

const STATUSES = ["pending", "present", "absent", "late", "medical_leave", "excused"];
const label = (s: string) => s.replace(/_/g, " ");
/** timestamptz → value for <input type="datetime-local"> */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AttendanceTable({
  scheduleId,
  rows,
  canManage,
}: {
  scheduleId: string;
  rows: AttRow[];
  canManage: boolean;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("present");

  const filtered = q.trim()
    ? rows.filter((r) => (r.participant?.full_name + " " + r.participant?.participant_id + " " + (r.participant?.company ?? "")).toLowerCase().includes(q.toLowerCase()))
    : rows;
  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(filtered.map((r) => r.id)));

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
          <form action={bulkUpdateAttendance.bind(null, scheduleId)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <select name="status" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid var(--ta-line)" }}>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
            <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm">Apply to selected</button>
          </form>
          <form action={resetAttendance.bind(null, scheduleId)}>
            {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" title="Undo / reset to pending">↩ Undo selected</button>
          </form>
        </div>
      )}

      <div className="ta-table-wrap">
        <table className="ta-table">
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
              <tr key={r.id}>
                {canManage && <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.participant?.full_name}`} /></td>}
                <td><code style={{ fontSize: 12 }}>{r.participant?.participant_id}</code></td>
                <td><strong>{r.participant?.full_name}</strong></td>
                <td>{r.participant?.company ?? "—"}</td>
                {canManage ? (
                  <td colSpan={5}>
                    <form action={updateAttendance.bind(null, scheduleId)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="hidden" name="id" value={r.id} />
                      <select name="status" defaultValue={r.attendance_status} style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid var(--ta-line)" }} aria-label="Status">
                        {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                      </select>
                      <input type="datetime-local" name="check_in_time" defaultValue={toLocalInput(r.check_in_time)} style={inp} aria-label="Check-in" />
                      <input type="datetime-local" name="check_out_time" defaultValue={toLocalInput(r.check_out_time)} style={inp} aria-label="Check-out" />
                      <input name="remarks" defaultValue={r.remarks ?? ""} placeholder="Remarks" style={{ ...inp, width: 140 }} aria-label="Remarks" />
                      <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm">Save</button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td><Badge status={r.attendance_status} /></td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ta-muted)" }}>{r.check_in_time ? new Date(r.check_in_time).toLocaleString("en-MY") : "—"}</td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ta-muted)" }}>{r.check_out_time ? new Date(r.check_out_time).toLocaleString("en-MY") : "—"}</td>
                    <td>{r.remarks ?? "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const inp = { padding: "6px 8px", borderRadius: 7, border: "1px solid var(--ta-line)", fontSize: 12 } as const;
