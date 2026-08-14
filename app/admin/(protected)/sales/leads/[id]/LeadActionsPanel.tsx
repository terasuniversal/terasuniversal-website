"use client";

import { useActionState, useRef, useState } from "react";
import { Card, Field } from "../../../../../../components/admin/ui";
import { updateLeadStatus, assignLead, setLeadFollowUp, addLeadNote, type SalesActionState } from "../actions";
import { CRM_STATUS_ORDER, CRM_STATUS_LABELS, LOST_REASONS, LOST_REASON_LABELS, type SalesCrmStatus, type SalesCrmPriority } from "../../../../../../lib/sales/crm";

const INITIAL: SalesActionState = {};

export function LeadActionsPanel({
  leadMetadataId,
  status,
  assignedTo,
  followUpAt,
  priority,
  staff,
  canManage,
}: {
  leadMetadataId: string;
  status: SalesCrmStatus;
  assignedTo: string | null;
  followUpAt: string | null;
  priority: SalesCrmPriority;
  staff: { id: string; full_name: string }[];
  canManage: boolean;
}) {
  const [statusState, statusAction, statusPending] = useActionState(updateLeadStatus.bind(null, leadMetadataId), INITIAL);
  const [assignState, assignAction, assignPending] = useActionState(assignLead.bind(null, leadMetadataId), INITIAL);
  const [followUpState, followUpAction, followUpPending] = useActionState(setLeadFollowUp.bind(null, leadMetadataId), INITIAL);
  const [noteState, noteAction, notePending] = useActionState(addLeadNote.bind(null, leadMetadataId), INITIAL);

  const [pendingStatus, setPendingStatus] = useState<SalesCrmStatus>(status);
  const statusFormRef = useRef<HTMLFormElement>(null);

  const localDateTimeValue = followUpAt ? new Date(followUpAt).toISOString().slice(0, 16) : "";

  function quickSetStatus(next: SalesCrmStatus) {
    if (next === "lost" && !confirm("Mark this lead as lost? Select a reason below, then submit.")) return;
    setPendingStatus(next);
    if (next === "won") {
      // Won needs no extra field — submit immediately on the next tick so the
      // state update above is reflected in the form before it's read.
      requestAnimationFrame(() => statusFormRef.current?.requestSubmit());
    }
    // For "lost" we just switch the select and reveal the reason field —
    // the user still clicks Update Status once a reason is chosen.
  }

  return (
    <>
      {canManage && (
        <Card title="Pipeline Status">
          <form ref={statusFormRef} action={statusAction} className="ta-card-pad ta-stack">
            {statusState.message && <div className="ta-alert ta-alert-error">{statusState.message}</div>}
            <Field label="Status" name="status" error={statusState.errors?.status}>
              <select
                id="status"
                name="status"
                value={pendingStatus}
                onChange={(e) => setPendingStatus(e.target.value as SalesCrmStatus)}
              >
                {CRM_STATUS_ORDER.map((s) => <option key={s} value={s}>{CRM_STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
            {pendingStatus === "lost" && (
              <Field label="Lost reason" name="lost_reason" error={statusState.errors?.lost_reason}>
                <select id="lost_reason" name="lost_reason" defaultValue="">
                  <option value="" disabled>Select a reason</option>
                  {LOST_REASONS.map((r) => <option key={r} value={r}>{LOST_REASON_LABELS[r]}</option>)}
                </select>
              </Field>
            )}
            <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={statusPending}>
              {statusPending ? "Saving…" : "Update Status"}
            </button>
            <div className="ta-status-action-row">
              <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" disabled={statusPending} onClick={() => quickSetStatus("won")}>
                Mark Won
              </button>
              <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" disabled={statusPending} onClick={() => quickSetStatus("lost")}>
                Mark Lost
              </button>
            </div>
          </form>
        </Card>
      )}

      {canManage && (
        <Card title="Assignment">
          <form action={assignAction} className="ta-card-pad ta-stack">
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

      {canManage && (
        <Card title="Follow-up">
          <form action={followUpAction} className="ta-card-pad ta-stack">
            {followUpState.message && <div className="ta-alert ta-alert-error">{followUpState.message}</div>}
            <Field label="Follow-up date & time" name="follow_up_at" error={followUpState.errors?.follow_up_at}>
              <input id="follow_up_at" name="follow_up_at" type="datetime-local" defaultValue={localDateTimeValue} />
            </Field>
            <Field label="Priority" name="priority">
              <select id="priority" name="priority" defaultValue={priority}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={followUpPending}>
              {followUpPending ? "Saving…" : "Save Follow-up"}
            </button>
          </form>
        </Card>
      )}

      <Card title="Add Note">
        <form action={noteAction} className="ta-card-pad ta-stack">
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
        <Card title="Manage Lead">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>
            Status, assignment and follow-up changes require Admin access. You can still add notes above.
          </div>
        </Card>
      )}
    </>
  );
}
