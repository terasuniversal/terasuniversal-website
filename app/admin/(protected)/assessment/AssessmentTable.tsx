"use client";

import { Fragment, useActionState, useState } from "react";
import { Badge } from "../../../../components/admin/ui";
import { updateAssessment, bulkUpdateResult, lockAssessments, unlockAssessments, updateParticipantSkillResults, type SkillsFormState } from "./actions";
import { participantSkillResultSchema } from "../../../../lib/validation/schemas";
import { UNGROUPED } from "../../../../lib/scheduleGroupContext";

export interface AsmRow {
  id: string | null; // null = not assessed yet (roster-driven, no auto-create)
  participant_id: string;
  assessment_type: string | null;
  theory_score: number | null;
  practical_score: number | null;
  result: string;
  competency_status: string | null;
  remarks: string | null;
  locked: boolean;
  participant: { participant_id: string; full_name: string; company: string | null } | null;
  /** Participant Skills Record (Phase 2B) -- keyed by area, missing key means "not_recorded". */
  skills: Record<string, string>;
}

const TYPES = ["theory", "practical", "combined"];
const RESULTS = ["pending", "pass", "fail"];
const COMPETENCIES = ["pending_review", "competent", "not_yet_competent"];
const label = (s: string) => s.replace(/_/g, " ");

// Same source of truth as the Server Action's validation (lib/validation/
// schemas.ts's participantSkillResultSchema) -- not a second enum definition.
const SKILL_AREAS = participantSkillResultSchema.shape.area.options;
const SKILL_LABELS: Record<string, string> = {
  theory_session: "Theory Session",
  practical_training: "Practical Training",
  safety_awareness: "Safety Awareness",
  practical_assessment: "Practical Assessment",
};
const STATUS_LABELS: Record<string, string> = {
  not_recorded: "Not Recorded",
  completed: "Completed",
  passed: "Passed",
  failed: "Failed",
};
// Only Practical Assessment is a scored pass/fail; the other three are
// completion-only -- mirrors the Server Action's ALLOWED_STATUS exactly.
const SKILL_STATUS_OPTIONS: Record<string, string[]> = {
  theory_session: ["not_recorded", "completed"],
  practical_training: ["not_recorded", "completed"],
  safety_awareness: ["not_recorded", "completed"],
  practical_assessment: ["not_recorded", "passed", "failed"],
};

/**
 * Compact "Participant Skills Record" strip rendered as a second row under
 * each participant. Reuses the participant's existing assessment `locked`
 * state as the sole edit gate (see actions.ts's updateParticipantSkillResults
 * doc comment) -- no separate lock UI for participant_skill_results.locked
 * in this phase.
 */
function SkillsRow({ scheduleId, row, editable, colSpan }: { scheduleId: string; row: AsmRow; editable: boolean; colSpan: number }) {
  const [state, formAction, pending] = useActionState<SkillsFormState, FormData>(
    updateParticipantSkillResults.bind(null, scheduleId),
    {}
  );

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: "2px 9px 10px", borderBottom: "1px solid #e5e7eb" }}>
        {editable ? (
          <form action={formAction} style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 11 }}>
            <input type="hidden" name="participant_id" value={row.participant_id} />
            <span style={{ color: "var(--ta-muted)", fontWeight: 600 }}>Skills Record</span>
            {SKILL_AREAS.map((area) => (
              <label key={area} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                {SKILL_LABELS[area]}
                <select name={area} defaultValue={row.skills[area] ?? "not_recorded"} style={inp} aria-label={SKILL_LABELS[area]}>
                  {SKILL_STATUS_OPTIONS[area].map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </label>
            ))}
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            {state.message && <span style={{ color: "var(--ta-success)" }}>{state.message}</span>}
            {state.error && <span role="alert" style={{ color: "var(--ta-danger)" }}>{state.error}</span>}
          </form>
        ) : (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 11 }}>
            <span style={{ color: "var(--ta-muted)", fontWeight: 600 }}>Skills Record{row.locked ? " · 🔒 locked" : ""}</span>
            {SKILL_AREAS.map((area) => (
              <span key={area} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                {SKILL_LABELS[area]}
                <Badge status={row.skills[area] ?? "not_recorded"} />
              </span>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Display-only: overall_score is not persisted (no single formula is
 * confirmed across programmes yet -- see SCHEDULES_ARCHITECTURE_DECISION.md
 * §I). Simple average when both scores exist, pass through whichever one
 * does, blank for awareness programmes with no scores at all. */
function overallScore(theory: number | null, practical: number | null): string {
  if (theory != null && practical != null) return ((theory + practical) / 2).toFixed(2);
  if (theory != null) return theory.toFixed(2);
  if (practical != null) return practical.toFixed(2);
  return "—";
}

export function AssessmentTable({
  scheduleId,
  rows,
  canManage,
  isSuperAdmin,
  groupId,
}: {
  scheduleId: string;
  rows: AsmRow[];
  canManage: boolean;
  isSuperAdmin: boolean;
  /** Currently-selected group context (Assessment V3), passed through to
   * bulkUpdateResult so it can re-verify each targeted row still belongs to
   * this group server-side -- never trust that `rows` (already
   * server-filtered for display) is what the mutation should trust. */
  groupId: string | typeof UNGROUPED | null;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState("pass");

  const filtered = q.trim()
    ? rows.filter((r) => (r.participant?.full_name + " " + r.participant?.participant_id + " " + (r.participant?.company ?? "")).toLowerCase().includes(q.toLowerCase()))
    : rows;
  const selectableIds = filtered.map((r) => r.id).filter((id): id is string => id !== null);
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectableIds));

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
          <form action={bulkUpdateResult.bind(null, scheduleId, groupId)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
              const totalCols = 7 + (canManage ? 2 : 0);
              return (
                <Fragment key={r.participant_id}>
                <tr>
                  {canManage && <td>{r.id && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id!)} aria-label="Select" />}</td>}
                  {editable ? (
                    <td colSpan={8}>
                      <form action={updateAssessment.bind(null, scheduleId)} style={{ display: "grid", gridTemplateColumns: "1.4fr .7fr .7fr .6fr .8fr 1fr 1.2fr auto", gap: 8, alignItems: "center" }}>
                        <input type="hidden" name="participant_id" value={r.participant_id} />
                        <div>
                          <strong>{r.participant?.full_name}</strong>
                          <div style={{ color: "var(--ta-muted)", fontSize: 11 }}>{r.participant?.participant_id}{!r.id ? " · not assessed" : ""}</div>
                          <select name="assessment_type" defaultValue={r.assessment_type ?? ""} style={{ ...inp, marginTop: 4, width: "100%" }} aria-label="Type">
                            <option value="">— (awareness / no type)</option>
                            {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                          </select>
                        </div>
                        <input name="theory_score" type="number" min="0" max="100" step="0.01" defaultValue={r.theory_score ?? ""} placeholder="Theory" style={inp} aria-label="Theory score" />
                        <input name="practical_score" type="number" min="0" max="100" step="0.01" defaultValue={r.practical_score ?? ""} placeholder="Practical" style={inp} aria-label="Practical score" />
                        <div style={{ fontWeight: 700, textAlign: "center" }}>{overallScore(r.theory_score, r.practical_score)}</div>
                        <select name="result" defaultValue={r.result} style={inp} aria-label="Result">
                          {RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                        </select>
                        <select name="competency_status" defaultValue={r.competency_status ?? ""} style={inp} aria-label="Competency">
                          <option value="">— (not applicable)</option>
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
                        <div style={{ color: "var(--ta-muted)", fontSize: 11 }}>{r.participant?.participant_id}{r.locked ? " · 🔒 locked" : ""}{!r.id ? " · not assessed" : ""}</div>
                      </td>
                      <td>{r.theory_score ?? "—"}</td>
                      <td>{r.practical_score ?? "—"}</td>
                      <td><strong>{overallScore(r.theory_score, r.practical_score)}</strong></td>
                      <td><Badge status={r.result} /></td>
                      <td>{r.competency_status ? <Badge status={r.competency_status} /> : "—"}</td>
                      <td>{r.remarks ?? "—"}</td>
                      {canManage && <td>{r.locked ? "🔒" : ""}</td>}
                    </>
                  )}
                </tr>
                <SkillsRow scheduleId={scheduleId} row={r} editable={editable} colSpan={totalCols} />
                </Fragment>
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
