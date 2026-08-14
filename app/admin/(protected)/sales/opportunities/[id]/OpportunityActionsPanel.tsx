"use client";

import { useActionState } from "react";
import { Card, Field } from "../../../../../../components/admin/ui";
import {
  updateOpportunityStage,
  assignOpportunity,
  setOpportunityExpectedClose,
  markOpportunityLost,
  addOpportunityNote,
  type SalesActionState,
} from "../actions";
import { OPPORTUNITY_STAGE_ORDER, OPPORTUNITY_STAGE_LABELS, LOST_REASONS, LOST_REASON_LABELS, type SalesOpportunityStage } from "../../../../../../lib/sales/crm";

const INITIAL: SalesActionState = {};
const NON_TERMINAL_STAGES = OPPORTUNITY_STAGE_ORDER.filter((s) => s !== "won" && s !== "lost");

export function OpportunityActionsPanel({
  opportunityId,
  stage,
  assignedTo,
  expectedCloseDate,
  probability,
  staff,
  canManage,
}: {
  opportunityId: string;
  stage: SalesOpportunityStage;
  assignedTo: string | null;
  expectedCloseDate: string | null;
  probability: number | null;
  staff: { id: string; full_name: string }[];
  canManage: boolean;
}) {
  const [stageState, stageAction, stagePending] = useActionState(updateOpportunityStage.bind(null, opportunityId), INITIAL);
  const [assignState, assignAction, assignPending] = useActionState(assignOpportunity.bind(null, opportunityId), INITIAL);
  const [closeState, closeAction, closePending] = useActionState(setOpportunityExpectedClose.bind(null, opportunityId), INITIAL);
  const [lostState, lostAction, lostPending] = useActionState(markOpportunityLost.bind(null, opportunityId), INITIAL);
  const [noteState, noteAction, notePending] = useActionState(addOpportunityNote.bind(null, opportunityId), INITIAL);

  const isResolved = stage === "won" || stage === "lost";

  return (
    <>
      {canManage && !isResolved && (
        <Card title="Stage">
          <form action={stageAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {stageState.message && <div className="ta-alert ta-alert-error">{stageState.message}</div>}
            <Field label="Stage" name="stage" error={stageState.errors?.stage}>
              <select id="stage" name="stage" defaultValue={stage}>
                {NON_TERMINAL_STAGES.map((s) => <option key={s} value={s}>{OPPORTUNITY_STAGE_LABELS[s]}</option>)}
              </select>
            </Field>
            <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={stagePending}>
              {stagePending ? "Saving…" : "Update Stage"}
            </button>
          </form>
        </Card>
      )}

      {canManage && (
        <Card title="Assignment">
          <form action={assignAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {assignState.message && <div className="ta-alert ta-alert-error">{assignState.message}</div>}
            <Field label="Assigned to" name="assigned_to" error={assignState.errors?.assigned_to}>
              <select id="assigned_to" name="assigned_to" defaultValue={assignedTo ?? ""}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </Field>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={assignPending}>
              {assignPending ? "Saving…" : "Save Assignment"}
            </button>
          </form>
        </Card>
      )}

      {canManage && !isResolved && (
        <Card title="Expected Close">
          <form action={closeAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {closeState.message && <div className="ta-alert ta-alert-error">{closeState.message}</div>}
            <Field label="Expected close date" name="expected_close_date" error={closeState.errors?.expected_close_date}>
              <input id="expected_close_date" name="expected_close_date" type="date" defaultValue={expectedCloseDate ?? ""} />
            </Field>
            <Field label="Probability (%)" name="probability" error={closeState.errors?.probability}>
              <input id="probability" name="probability" type="number" min={0} max={100} defaultValue={probability ?? ""} />
            </Field>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={closePending}>
              {closePending ? "Saving…" : "Save"}
            </button>
          </form>
        </Card>
      )}

      {canManage && !isResolved && (
        <Card title="Mark Lost">
          <form action={lostAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lostState.message && <div className="ta-alert ta-alert-error">{lostState.message}</div>}
            <Field label="Reason" name="lost_reason" error={lostState.errors?.lost_reason}>
              <select id="lost_reason" name="lost_reason" defaultValue="">
                <option value="" disabled>Select a reason</option>
                {LOST_REASONS.map((r) => <option key={r} value={r}>{LOST_REASON_LABELS[r]}</option>)}
              </select>
            </Field>
            <button
              type="submit"
              className="ta-btn ta-btn-outline ta-btn-sm"
              disabled={lostPending}
              onClick={(e) => { if (!confirm("Mark this opportunity as lost? The linked lead will also be marked lost.")) e.preventDefault(); }}
            >
              {lostPending ? "Saving…" : "Mark Lost"}
            </button>
          </form>
        </Card>
      )}

      <Card title="Add Note">
        <form action={noteAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {noteState.message && <div className="ta-alert ta-alert-error">{noteState.message}</div>}
          <Field label="Note" name="note" error={noteState.errors?.note}>
            <textarea id="note" name="note" rows={4} placeholder="Log a call, a client response, or any internal context…" />
          </Field>
          <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={notePending}>
            {notePending ? "Saving…" : "Add Note"}
          </button>
        </form>
      </Card>

      {!canManage && (
        <Card title="Manage Opportunity">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>
            Stage, assignment and outcome changes require Admin access. You can still add notes above.
          </div>
        </Card>
      )}

      {isResolved && canManage && (
        <Card title="Outcome">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>
            This opportunity is {stage === "won" ? "won" : "lost"}. {stage === "won" ? "Marked won automatically when a quotation was accepted." : "No further stage changes are possible."}
          </div>
        </Card>
      )}
    </>
  );
}
