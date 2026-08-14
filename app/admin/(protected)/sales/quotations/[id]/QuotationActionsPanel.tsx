"use client";

import { useActionState } from "react";
import { Card, Field } from "../../../../../../components/admin/ui";
import { markQuotationSent, acceptQuotationAction, rejectQuotationAction, createRevision, type SalesActionState } from "../actions";
import type { SalesQuotationStatus } from "../../../../../../lib/sales/crm";

const INITIAL: SalesActionState = {};

export function QuotationActionsPanel({ quotationId, status, canManage }: { quotationId: string; status: SalesQuotationStatus; canManage: boolean }) {
  const [sentState, sentAction, sentPending] = useActionState(markQuotationSent.bind(null, quotationId), INITIAL);
  const [acceptState, acceptAction, acceptPending] = useActionState(acceptQuotationAction.bind(null, quotationId), INITIAL);
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectQuotationAction.bind(null, quotationId), INITIAL);
  const [revisionState, revisionAction, revisionPending] = useActionState(createRevision.bind(null, quotationId), INITIAL);

  if (!canManage) {
    return (
      <Card title="Manage Quotation">
        <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>Status changes require Admin access.</div>
      </Card>
    );
  }

  return (
    <>
      {status === "draft" && (
        <Card title="Send">
          <form action={sentAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sentState.message && <div className="ta-alert ta-alert-error">{sentState.message}</div>}
            <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
              Marks this quotation as sent to the client. Email delivery is not automated yet — send the document to the client through your usual channel, then record it here.
            </p>
            <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={sentPending}>
              {sentPending ? "Saving…" : "Mark as Sent"}
            </button>
          </form>
        </Card>
      )}

      {status === "sent" && (
        <>
          <Card title="Accept">
            <form action={acceptAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {acceptState.message && <div className="ta-alert ta-alert-error">{acceptState.message}</div>}
              <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>Marks this quotation accepted, the opportunity won, and the source lead won.</p>
              <button
                type="submit"
                className="ta-btn ta-btn-primary ta-btn-sm"
                disabled={acceptPending}
                onClick={(e) => { if (!confirm("Accept this quotation? The opportunity and lead will both be marked Won.")) e.preventDefault(); }}
              >
                {acceptPending ? "Saving…" : "✅ Accept Quotation"}
              </button>
            </form>
          </Card>

          <Card title="Reject">
            <form action={rejectAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rejectState.message && <div className="ta-alert ta-alert-error">{rejectState.message}</div>}
              <Field label="Rejection reason" name="reason" error={rejectState.errors?.reason}>
                <textarea name="reason" rows={3} placeholder="Why did the client reject this quotation?" />
              </Field>
              <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={rejectPending}>
                {rejectPending ? "Saving…" : "Reject Quotation"}
              </button>
            </form>
          </Card>
        </>
      )}

      {(status === "sent" || status === "rejected" || status === "expired") && (
        <Card title="Revision">
          <form action={revisionAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {revisionState.message && <div className="ta-alert ta-alert-error">{revisionState.message}</div>}
            <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
              Creates a new editable revision (same quotation number, next revision letter) and supersedes this version — this version's data is preserved, never overwritten.
            </p>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={revisionPending}>
              {revisionPending ? "Creating…" : "Create Revision"}
            </button>
          </form>
        </Card>
      )}

      {(status === "accepted" || status === "superseded") && (
        <Card title="Status">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>
            {status === "accepted" ? "This quotation was accepted — no further changes possible." : "This quotation has been superseded by a later revision."}
          </div>
        </Card>
      )}
    </>
  );
}
