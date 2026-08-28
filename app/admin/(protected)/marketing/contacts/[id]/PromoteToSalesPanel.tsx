"use client";

import { useActionState, useState } from "react";
import { Card } from "../../../../../../components/admin/ui";
import { SalesModal } from "../../../../../../components/admin/sales/SalesModal";
import { promoteMarketingContactToSales, type ContactFormState } from "../actions";

const INITIAL: ContactFormState = {};

/**
 * Reuses the existing hardened SalesModal (focus trap, Escape, focus
 * return, backdrop click, aria-modal/aria-labelledby — all already
 * verified) rather than building a new dialog system, per instruction.
 * Cross-module import (Marketing importing a Sales-namespaced component)
 * is deliberate: SalesModal is a pure, business-logic-free UI primitive,
 * not Sales domain code.
 */
export function PromoteToSalesPanel({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState(promoteMarketingContactToSales.bind(null, contactId), INITIAL);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card title="Promote to Sales">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, color: "var(--ta-muted)", fontSize: 13.5 }}>
            This contact is ready for Sales. Promoting creates a new Sales Lead and hands off ownership to the Sales pipeline.
          </p>
          <button
            type="button"
            className="ta-btn ta-btn-primary ta-btn-sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setOpen(true)}
          >
            Promote to Sales
          </button>
        </div>
      </Card>

      <SalesModal
        open={open}
        title="Promote to Sales"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="ta-btn ta-btn-outline" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="promote-to-sales-form" className="ta-btn ta-btn-primary" disabled={pending}>
              {pending ? "Promoting…" : "Promote to Sales"}
            </button>
          </>
        }
      >
        {state.message && (
          <div className="ta-alert ta-alert-error" style={{ marginBottom: 12 }}>
            {state.message}
          </div>
        )}
        <p style={{ marginTop: 0 }}>This will create a new Sales Lead and mark this Marketing Contact as promoted.</p>
        <form id="promote-to-sales-form" action={formAction} />
      </SalesModal>
    </>
  );
}
