"use client";

import { useActionState, useState } from "react";
import { assignParticipants, type ScheduleFormState } from "./actions";

interface Available { id: string; participant_id: string; full_name: string; company: string | null }

/**
 * Search + multi-select panel to bulk-assign participants to a schedule.
 * Duplicate registration is prevented server-side (unique constraint) and by
 * excluding already-assigned participants from this list.
 */
export function AssignParticipants({
  scheduleId,
  available,
  seatsRemaining,
}: {
  scheduleId: string;
  available: Available[];
  seatsRemaining: number;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, formAction, pending] = useActionState<ScheduleFormState, FormData>(assignParticipants.bind(null, scheduleId), {});
  const filtered = q.trim()
    ? available.filter((p) =>
        (p.full_name + " " + p.participant_id + " " + (p.company ?? "")).toLowerCase().includes(q.toLowerCase())
      )
    : available;

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const overCapacity = seatsRemaining >= 0 && selected.size > seatsRemaining;

  return (
    <form action={formAction}>
      {state.message && <div className="ta-alert ta-alert-error" style={{ marginBottom: 10 }}>{state.message}</div>}
      <div className="ta-search" style={{ maxWidth: "100%", marginBottom: 10 }}>
        <span className="ta-search-ico" aria-hidden="true">⌕</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search participants to assign…" />
      </div>

      {overCapacity && (
        <div className="ta-alert ta-alert-error" style={{ marginBottom: 10 }}>
          You selected {selected.size} but only {seatsRemaining} seat(s) remain. Increase capacity or select fewer.
        </div>
      )}

      <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--ta-line)", borderRadius: 9 }}>
        {filtered.length === 0 ? (
          <p style={{ padding: 16, color: "var(--ta-muted)", margin: 0 }}>No matching participants.</p>
        ) : (
          filtered.slice(0, 100).map((p) => (
            <label key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px", borderBottom: "1px solid var(--ta-line)", cursor: "pointer" }}>
              <input type="checkbox" name="participant_ids" value={p.id} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              <span style={{ flex: 1 }}>
                <strong>{p.full_name}</strong>
                <span style={{ color: "var(--ta-muted)", fontSize: 12 }}> · {p.participant_id}{p.company ? ` · ${p.company}` : ""}</span>
              </span>
            </label>
          ))
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>{selected.size} selected · {seatsRemaining} seat(s) left</span>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={selected.size === 0 || overCapacity || pending}>
          {pending ? "Assigning…" : "Assign selected"}
        </button>
      </div>
    </form>
  );
}
