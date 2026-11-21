"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card, Badge, EmptyState } from "../../../../../../components/admin/ui";
import PendingSubmitButton from "../../../../../../components/admin/PendingSubmitButton";
import { searchCertificatesAction } from "../actions";
import type { SearchState } from "../../../../../../lib/identity-correction/api";

// Search runs as a Server Action (POST), so what is typed never lands in the URL, browser history or access logs.
export default function CertificateSearch() {
  const [state, formAction] = useActionState<SearchState, FormData>(searchCertificatesAction, {});
  return (
    <>
      <form action={formAction} className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-field">
          <label htmlFor="q">Certificate number</label>
          <input id="q" name="q" minLength={3} maxLength={60} placeholder="e.g. CERT-2026-000123" autoComplete="off" required />
          <small style={{ color: "var(--ta-muted)" }}>Search by certificate number only — never type an IC/Passport number here.</small>
        </div>
        <PendingSubmitButton className="ta-btn ta-btn-primary ta-btn-sm" pendingLabel="Searching…">Search</PendingSubmitButton>
      </form>
      {state.error && <p className="ta-error" role="alert">{state.error}</p>}
      {state.hits && (
        <Card>
          {state.hits.length === 0 ? (
            <EmptyState kind="no-results" message="No certificate matches that number." />
          ) : (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Certificate</th><th>Holder</th><th>IC / Passport</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {state.hits.map((h) => (
                    <tr key={h.certificate_id}>
                      <td>{h.certificate_number}<br /><small>{h.course_name}</small></td>
                      <td>{h.holder_name ?? "—"}</td>
                      <td>{h.identity_masked ?? "—"}</td>
                      <td><Badge status={h.status} /></td>
                      <td>
                        {h.open_request_id ? (
                          <Link className="ta-btn ta-btn-outline ta-btn-sm" href={`/admin/certificates/identity-correction/${h.open_request_id}`}>Open request</Link>
                        ) : (
                          <Link className="ta-btn ta-btn-primary ta-btn-sm" href={`/admin/certificates/identity-correction/new?participant=${h.participant_id}&cert=${encodeURIComponent(h.certificate_number)}`}>Select</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
