"use client";

import Link from "next/link";
import { Fragment, useActionState, useState } from "react";
import { Badge } from "../../../../components/admin/ui";
import { updateAssessment, bulkUpdateResult, lockAssessments, unlockAssessments, updateParticipantSkillResults, type SkillsFormState } from "./actions";
import { participantSkillResultSchema } from "../../../../lib/validation/schemas";
import { UNGROUPED } from "../../../../lib/scheduleGroupContext";
import { MutationForm, MutationSubmitButton } from "../../../../components/admin/MutationForm";

export interface AsmRow {
  id: string | null; // null = not assessed yet (roster-driven, no auto-create)
  participant_id: string;
  assessment_type: string | null;
  theory_score: number | null;
  practical_score: number | null;
  theory_result: string;
  practical_result: string;
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
  canViewParticipants,
  groupId,
}: {
  scheduleId: string;
  rows: AsmRow[];
  canManage: boolean;
  isSuperAdmin: boolean;
  /** Gates the per-row link to /admin/participants/[id] -- that route itself
   * requires requireRole("editor"), so the link is hidden below that rather
   * than leading a lower-privilege viewer to /admin/no-access. */
  canViewParticipants: boolean;
  /** Currently-selected group context (Assessment V3), passed through to
   * bulkUpdateResult so it can re-verify each targeted row still belongs to
   * this group server-side -- never trust that `rows` (already
   * server-filtered for display) is what the mutation should trust. */
  groupId: string | typeof UNGROUPED | null;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState("pass");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = q.trim()
    ? rows.filter((r) => (r.participant?.full_name + " " + r.participant?.participant_id + " " + (r.participant?.company ?? "")).toLowerCase().includes(q.toLowerCase()))
    : rows;
  const selectableIds = filtered.map((r) => r.id).filter((id): id is string => id !== null);
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectableIds));
  const toggleExpanded = (participantId: string) => setExpanded((previous) => {
    const next = new Set(previous);
    next.has(participantId) ? next.delete(participantId) : next.add(participantId);
    return next;
  });

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
          <MutationForm action={bulkUpdateResult.bind(null, scheduleId, groupId)} pendingLabel="Applying…" idleLabel="Set result" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <select name="result" value={bulkResult} onChange={(e) => setBulkResult(e.target.value)} style={selStyle}>
              {RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
            <MutationSubmitButton>Set result</MutationSubmitButton>
          </MutationForm>
          <MutationForm action={lockAssessments.bind(null, scheduleId)} pendingLabel="Locking…" idleLabel="Lock">
            {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <MutationSubmitButton className="ta-btn ta-btn-outline ta-btn-sm">🔒 Lock</MutationSubmitButton>
          </MutationForm>
          {isSuperAdmin && (
            <MutationForm action={unlockAssessments.bind(null, scheduleId)} pendingLabel="Unlocking…" idleLabel="Unlock">
              {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
              <MutationSubmitButton className="ta-btn ta-btn-outline ta-btn-sm">🔓 Unlock</MutationSubmitButton>
            </MutationForm>
          )}
        </div>
      )}

      <div className="ta-table-wrap">
        <table className="ta-table ta-assessment-desktop">
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
                  {canManage && <td>{r.id && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id!)} aria-label={`Select ${r.participant?.full_name ?? "participant"}`} />}</td>}
                  {editable ? (
                    <td colSpan={8}>
                      <MutationForm action={updateAssessment.bind(null, scheduleId)} pendingLabel="Saving…" idleLabel="Save" style={{ display: "grid", gridTemplateColumns: "1.4fr .7fr .7fr .6fr .8fr 1fr 1.2fr auto", gap: 8, alignItems: "center" }}>
                        <input type="hidden" name="participant_id" value={r.participant_id} />
                        <div>
                          <strong>{r.participant?.full_name}</strong>
                          <div style={{ color: "var(--ta-muted)", fontSize: 11 }}>
                            {r.participant?.participant_id}{!r.id ? " · not assessed" : ""}
                            {canViewParticipants && (
                              <>
                                {" · "}
                                <Link href={`/admin/participants/${r.participant_id}`} style={{ color: "var(--ta-navy)", textDecoration: "underline" }}>View profile</Link>
                              </>
                            )}
                          </div>
                          <select name="assessment_type" defaultValue={r.assessment_type ?? ""} style={{ ...inp, marginTop: 4, width: "100%" }} aria-label="Type">
                            <option value="">— (awareness / no type)</option>
                            {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                          </select>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <input name="theory_score" type="number" min="0" max="100" step="0.01" defaultValue={r.theory_score ?? ""} placeholder="Theory" style={inp} aria-label="Theory score" />
                          <select name="theory_result" defaultValue={r.theory_result} style={inp} aria-label="Theory result">
                            {RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                          </select>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <input name="practical_score" type="number" min="0" max="100" step="0.01" defaultValue={r.practical_score ?? ""} placeholder="Practical" style={inp} aria-label="Practical score" />
                          <select name="practical_result" defaultValue={r.practical_result} style={inp} aria-label="Practical result">
                            {RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                          </select>
                        </div>
                        <div style={{ fontWeight: 700, textAlign: "center" }}>{overallScore(r.theory_score, r.practical_score)}</div>
                        <select name="result" defaultValue={r.result} style={inp} aria-label="Result">
                          {RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                        </select>
                        <select name="competency_status" defaultValue={r.competency_status ?? ""} style={inp} aria-label="Competency">
                          <option value="">— (not applicable)</option>
                          {COMPETENCIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                        </select>
                        <input name="remarks" defaultValue={r.remarks ?? ""} placeholder="Remarks" style={inp} aria-label="Remarks" />
                        <MutationSubmitButton>Save</MutationSubmitButton>
                      </MutationForm>
                    </td>
                  ) : (
                    <>
                      <td>
                        <strong>{r.participant?.full_name}</strong>
                        <div style={{ color: "var(--ta-muted)", fontSize: 11 }}>
                          {r.participant?.participant_id}{r.locked ? " · 🔒 locked" : ""}{!r.id ? " · not assessed" : ""}
                          {canViewParticipants && (
                            <>
                              {" · "}
                              <Link href={`/admin/participants/${r.participant_id}`} style={{ color: "var(--ta-navy)", textDecoration: "underline" }}>View profile</Link>
                            </>
                          )}
                        </div>
                      </td>
                      <td>{r.theory_score ?? "—"}<div style={{ marginTop: 4 }}><Badge status={r.theory_result} /></div></td>
                      <td>{r.practical_score ?? "—"}<div style={{ marginTop: 4 }}><Badge status={r.practical_result} /></div></td>
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

      <div className="ta-assessment-mobile" aria-label="Mobile assessment participant rows">
        {filtered.map((r) => {
          const participantName = r.participant?.full_name ?? "Participant";
          const isExpanded = expanded.has(r.participant_id);
          const editable = canManage && !r.locked;
          return (
            <article key={r.participant_id} className="ta-card ta-assessment-mobile-row">
              <div className="ta-assessment-mobile-summary">
                {canManage && r.id && (
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id!)}
                    aria-label={`Select ${participantName}`}
                  />
                )}
                <div className="ta-assessment-mobile-summary-main">
                  <strong>{participantName}</strong>
                  <span className="ta-cell-sub">
                    {r.participant?.participant_id}
                    {r.locked ? " · 🔒 locked" : ""}
                    {!r.id ? " · not assessed" : ""}
                  </span>
                </div>
                <span className="ta-assessment-mobile-summary-value"><small>Theory</small>{r.theory_score ?? "—"}</span>
                <span className="ta-assessment-mobile-summary-value"><small>Practical</small>{r.practical_score ?? "—"}</span>
                <span className="ta-assessment-mobile-summary-value"><small>Overall</small>{overallScore(r.theory_score, r.practical_score)}</span>
                <span className="ta-assessment-mobile-summary-value"><small>Result</small><Badge status={r.result} /></span>
                <span className="ta-assessment-mobile-summary-value"><small>Competency</small>{r.competency_status ? <Badge status={r.competency_status} /> : "—"}</span>
                <button type="button" className="ta-btn ta-btn-outline ta-btn-sm ta-assessment-mobile-toggle" onClick={() => toggleExpanded(r.participant_id)} aria-expanded={isExpanded} aria-controls={`assessment-details-${r.participant_id}`}>
                  {r.locked ? (isExpanded ? "Hide details" : "View details") : (isExpanded ? "Collapse" : "Edit / Expand")}
                </button>
              </div>
              {isExpanded && (
                <div id={`assessment-details-${r.participant_id}`} className="ta-assessment-mobile-details">
                  {editable ? (
                    <MutationForm action={updateAssessment.bind(null, scheduleId)} pendingLabel="Saving…" idleLabel="Save" className="ta-assessment-mobile-form">
                      <input type="hidden" name="participant_id" value={r.participant_id} />
                      <label><span>Type</span><select name="assessment_type" defaultValue={r.assessment_type ?? ""} aria-label={`Assessment type for ${participantName}`}><option value="">— (awareness / no type)</option>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></label>
                      <label><span>Theory Score</span><input name="theory_score" type="number" min="0" max="100" step="0.01" defaultValue={r.theory_score ?? ""} aria-label={`Theory score for ${participantName}`} /></label>
                      <label><span>Theory Result</span><select name="theory_result" defaultValue={r.theory_result} aria-label={`Theory result for ${participantName}`}>{RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
                      <label><span>Practical Score</span><input name="practical_score" type="number" min="0" max="100" step="0.01" defaultValue={r.practical_score ?? ""} aria-label={`Practical score for ${participantName}`} /></label>
                      <label><span>Practical Result</span><select name="practical_result" defaultValue={r.practical_result} aria-label={`Practical result for ${participantName}`}>{RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
                      <label><span>Overall Result</span><select name="result" defaultValue={r.result} aria-label={`Overall result for ${participantName}`}>{RESULTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
                      <label><span>Competency</span><select name="competency_status" defaultValue={r.competency_status ?? ""} aria-label={`Competency for ${participantName}`}><option value="">— (not applicable)</option>{COMPETENCIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
                      <label className="ta-assessment-mobile-remarks"><span>Remarks</span><input name="remarks" defaultValue={r.remarks ?? ""} placeholder="Remarks" aria-label={`Remarks for ${participantName}`} /></label>
                      <MutationSubmitButton>Save</MutationSubmitButton>
                    </MutationForm>
                  ) : (
                    <dl className="ta-assessment-mobile-readonly">
                      <div><dt>Theory Score</dt><dd>{r.theory_score ?? "—"}</dd></div>
                      <div><dt>Theory Result</dt><dd><Badge status={r.theory_result} /></dd></div>
                      <div><dt>Practical Score</dt><dd>{r.practical_score ?? "—"}</dd></div>
                      <div><dt>Practical Result</dt><dd><Badge status={r.practical_result} /></dd></div>
                      <div><dt>Overall Result</dt><dd><Badge status={r.result} /></dd></div>
                      <div><dt>Competency</dt><dd>{r.competency_status ? <Badge status={r.competency_status} /> : "—"}</dd></div>
                      <div className="ta-assessment-mobile-remarks"><dt>Remarks</dt><dd>{r.remarks ?? "—"}</dd></div>
                      {r.locked && <div className="ta-assessment-mobile-locked" role="status">🔒 This assessment is locked and read-only.</div>}
                    </dl>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

const inp = { padding: "6px 8px", borderRadius: 7, border: "1px solid var(--ta-line)", fontSize: 12, width: "100%" } as const;
const selStyle = { padding: "7px 9px", borderRadius: 8, border: "1px solid var(--ta-line)" } as const;
