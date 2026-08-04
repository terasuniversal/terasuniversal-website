"use client";

import { useState } from "react";
import { Badge } from "../../../../components/admin/ui";
import { updateAssessment, bulkUpdateResult, lockAssessments, unlockAssessments } from "./actions";

export interface AsmRow {
  id: string;
  assessment_type: string;
  theory_score: number | null;
  practical_score: number | null;
  overall_score: number | null;
  result: string;
  competency_status: string;
  remarks: string | null;
  locked: boolean;
  participant: { participant_id: string; full_name: string; company: string | null } | null;
}

const TYPES = ["theory", "practical", "combined"];
const RESULTS = ["pending", "pass", "fail"];
const COMPETENCIES = ["pending_review", "competent", "not_yet_competent"];
const label = (s: string) => s.replace(/_/g, " ");

export function AssessmentTable({
  scheduleId,
  rows,
  canManage,
  isSuperAdmin,
}: {
  scheduleId: string;
  rows: AsmRow[];
  canManage: boolean;
  isSuperAdmin: boolean;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState("pass");

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
          <form action={bulkUpdateResult.bind(null, scheduleId)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <select name="result" value={bulkResult} onChange={(e) => setBulkResult(e.target.value)} style={selStyle}>
              {RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
            <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm">Set result</button>
          </form>
          <form action={lockAssessments.bind(null, scheduleId)}>
            {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">🔒 Lock</button>
          </form>
          {isSuperAdmin && (
            <form action={unlockAssessments.bind(null, scheduleId)}>
              {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">🔓 Unlock</button>
            </form>
          )}
        </div>
      )}

      <div className="ta-table-wrap">
        <table className="ta-table">
          <thead>
            <tr>
              {canManage && <th style={{ width: 34 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" /></th>}
              <th>Participant</th>
              <th>Theory</th>
              <th>Practical</th>
              <th>Overall</th>
              <th>Result</th>
              <th>Competency</th>
              <th>Remarks</th>
              {canManage && <th>Save</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const editable = canManage && !r.locked;
              return (
                <tr key={r.id}>
                  {canManage && <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select" /></td>}
                  {editable ? (
                    <td colSpan={8}>
                      <form action={updateAssessment.bind(null, scheduleId)} style={{ display: "grid", gridTemplateColumns: "1.4fr .7fr .7fr .6fr .8fr 1fr 1.2fr auto", gap: 8, alignItems: "center" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <div>
                          <strong>{r.participant?.full_name}</strong>
                          <div style={{ color: "var(--ta-muted)", fontSize: 11 }}>{r.participant?.participant_id}</div>
                          <select name="assessment_type" defaultValue={r.assessment_type} style={{ ...inp, marginTop: 4, width: "100%" }} aria-label="Type">
                            {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                          </select>
                        </div>
                        <input name="theory_score" type="number" min="0" max="100" step="0.01" defaultValue={r.theory_score ?? ""} placeholder="Theory" style={inp} aria-label="Theory score" />
                        <input name="practical_score" type="number" min="0" max="100" step="0.01" defaultValue={r.practical_score ?? ""} placeholder="Practical" style={inp} aria-label="Practical score" />
                        <div style={{ fontWeight: 700, textAlign: "center" }}>{r.overall_score ?? "—"}</div>
                        <select name="result" defaultValue={r.result} style={inp} aria-label="Result">
                          {RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                        </select>
                        <select name="competency_status" defaultValue={r.competency_status} style={inp} aria-label="Competency">
                          {COMPETENCIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                        </select>
                        <input name="remarks" defaultValue={r.remarks ?? ""} placeholder="Remarks" style={inp} aria-label="Remarks" />
                        <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm">Save</button>
                      </form>
                    </td>
                  ) : (
                    <>
                      <td>
                        <strong>{r.participant?.full_name}</strong>
                        <div style={{ color: "var(--ta-muted)", fontSize: 11 }}>{r.participant?.participant_id}{r.locked ? " · 🔒 locked" : ""}</div>
                      </td>
                      <td>{r.theory_score ?? "—"}</td>
                      <td>{r.practical_score ?? "—"}</td>
                      <td><strong>{r.overall_score ?? "—"}</strong></td>
                      <td><Badge status={r.result} /></td>
                      <td><Badge status={r.competency_status} /></td>
                      <td>{r.remarks ?? "—"}</td>
                      {canManage && <td>{r.locked ? "🔒" : ""}</td>}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const inp = { padding: "6px 8px", borderRadius: 7, border: "1px solid var(--ta-line)", fontSize: 12, width: "100%" } as const;
const selStyle = { padding: "7px 9px", borderRadius: 8, border: "1px solid var(--ta-line)" } as const;
