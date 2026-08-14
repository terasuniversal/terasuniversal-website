"use client";

import { useActionState } from "react";
import { searchCompaniesForLink, linkCompany, type CompanyCandidate } from "../actions";

/**
 * Manual "Link Existing Company" search — a small, compact list (not the
 * full Companies module UI, per instruction). Each result is its own
 * single-button confirm form; linking always requires that explicit click,
 * never happens from the search alone.
 */
export function CompanySearchBox({ opportunityId }: { opportunityId: string }) {
  const [results, searchAction, pending] = useActionState<CompanyCandidate[], FormData>(searchCompaniesForLink, []);

  return (
    <div>
      <form action={searchAction} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input name="q" placeholder="Search company name…" style={{ flex: 1 }} />
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={pending}>
          {pending ? "Searching…" : "Search"}
        </button>
      </form>

      {results.length > 0 && (
        <div style={{ border: "1px solid var(--ta-line)", borderRadius: 9, overflow: "hidden" }}>
          {results.map((c) => (
            <div
              key={c.id}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--ta-line)" }}
            >
              <span style={{ fontSize: 13 }}>
                <strong>{c.company_name}</strong>
                <span style={{ color: "var(--ta-muted)" }}>
                  {" "}
                  · {c.company_id}
                  {c.industry ? ` · ${c.industry}` : ""}
                  {c.person_in_charge ? ` · ${c.person_in_charge}` : ""}
                </span>
              </span>
              <form action={linkCompany.bind(null, opportunityId)}>
                <input type="hidden" name="company_id" value={c.id} />
                <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm">
                  Link this company
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
