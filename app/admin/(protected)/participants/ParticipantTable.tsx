"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "../../../../components/admin/ui";
import { bulkDeleteParticipants, bulkRestoreParticipants } from "./actions";
import { formatMalaysiaDate } from "../../../../lib/date-time";

export interface Row {
  id: string;
  participant_id: string;
  full_name: string;
  ic_passport_no: string | null;
  company: string | null;
  position: string | null;
  phone: string | null;
  status: string;
  created_at: string;
}

/**
 * Interactive participant table: row selection, select-all, and a bulk-action
 * bar. "Export selected" builds a CSV in the browser from the current
 * selection. Delete/restore are admin-only server actions.
 */
export function ParticipantTable({
  rows,
  canWrite,
  deletedView,
}: {
  rows: Row[];
  canWrite: boolean;
  deletedView: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allChecked = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function exportSelected() {
    const chosen = rows.filter((r) => selected.has(r.id));
    const headers = ["Participant ID", "Name", "IC/Passport", "Company", "Position", "Phone", "Status", "Created"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(","),
      ...chosen.map((r) => [r.participant_id, r.full_name, r.ic_passport_no, r.company, r.position, r.phone, r.status, r.created_at].map(esc).join(",")),
    ].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "participants-selected.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="ta-card ta-card-pad" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, position: "sticky", top: 66, zIndex: 5 }}>
          <strong>{selected.size} selected</strong>
          <div style={{ flex: 1 }} />
          <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={exportSelected}>⬇ Export selected (CSV)</button>
          {canWrite && !deletedView && (
            <form action={bulkDeleteParticipants}>
              {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" className="ta-btn ta-btn-danger ta-btn-sm">Delete selected</button>
            </form>
          )}
          {canWrite && deletedView && (
            <form action={bulkRestoreParticipants}>
              {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" className="ta-btn ta-btn-gold ta-btn-sm">Restore selected</button>
            </form>
          )}
        </div>
      )}

      <div className="ta-table-wrap">
        <table className="ta-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th>Participant ID</th>
              <th>Name</th>
              <th>IC / Passport</th>
              <th>Company</th>
              <th>Position</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.full_name}`} />
                </td>
                <td><code style={{ fontSize: 12 }}>{r.participant_id}</code></td>
                <td><strong>{r.full_name}</strong></td>
                <td>{r.ic_passport_no ?? "—"}</td>
                <td>{r.company ?? "—"}</td>
                <td>{r.position ?? "—"}</td>
                <td>{r.phone ?? "—"}</td>
                <td><Badge status={r.status} /></td>
                <td style={{ color: "var(--ta-muted)", whiteSpace: "nowrap" }}>
                  {formatMalaysiaDate(r.created_at)}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Link href={`/admin/participants/${r.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
