import Link from "next/link";
import { Card } from "../../../../../../components/admin/ui";
import { linkCompany, type CompanyCandidate } from "../actions";
import { CompanySearchBox } from "./CompanySearchBox";

/**
 * Sales CRM Phase 4A — Company linking for a Won Opportunity. Pure server
 * component apart from the manual-search fallback (CompanySearchBox); every
 * link action is a plain form posting linkCompany(), which always requires
 * an explicit per-row click — nothing here ever links automatically, even
 * for an exact-match suggestion.
 */
export function ClientOnboardingPanel({
  opportunityId,
  canManage,
  linkedCompany,
  suggested,
  ambiguousCount,
}: {
  opportunityId: string;
  canManage: boolean;
  linkedCompany: { id: string; company_name: string } | null;
  /** Single confident candidate (exact email or exact normalized name match), if any. */
  suggested: CompanyCandidate | null;
  /** >0 when multiple companies matched the opportunity's company name — no single suggestion is safe to show. */
  ambiguousCount: number;
}) {
  return (
    <Card title="Client Onboarding">
      <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {linkedCompany ? (
          <>
            <div style={{ fontSize: 13 }}>
              <strong>{linkedCompany.company_name}</strong>{" "}
              <span style={{ color: "var(--ta-success)", fontWeight: 700 }}>Linked ✓</span>
            </div>
            <Link href={`/admin/companies/${linkedCompany.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
              View Company →
            </Link>
          </>
        ) : !canManage ? (
          <p style={{ margin: 0, fontSize: 12, color: "var(--ta-muted)" }}>Linking or creating a company requires Admin access.</p>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: "var(--ta-muted)" }}>
              Status: {suggested ? "Suggested match — confirmation required" : ambiguousCount > 1 ? "Review required" : "No match"}
            </div>

            {suggested && (
              <div style={{ border: "1px solid var(--ta-line)", borderRadius: 9, padding: "9px 12px" }}>
                <div style={{ fontSize: 13 }}>
                  <strong>{suggested.company_name}</strong>
                  <span style={{ color: "var(--ta-muted)" }}>
                    {" "}
                    · {suggested.company_id}
                    {suggested.industry ? ` · ${suggested.industry}` : ""}
                    {suggested.person_in_charge ? ` · ${suggested.person_in_charge}` : ""}
                  </span>
                </div>
                <form action={linkCompany.bind(null, opportunityId)} style={{ marginTop: 8 }}>
                  <input type="hidden" name="company_id" value={suggested.id} />
                  <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm">
                    Link this company
                  </button>
                </form>
              </div>
            )}

            {ambiguousCount > 1 && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--ta-muted)" }}>
                {ambiguousCount} companies match this name closely enough that none is safe to pre-select. Search below to confirm the
                right one.
              </p>
            )}

            <details>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--ta-info)" }}>
                {suggested ? "Not the right company? Search instead" : "Link Existing Company"}
              </summary>
              <div style={{ marginTop: 8 }}>
                <CompanySearchBox opportunityId={opportunityId} />
              </div>
            </details>

            <Link href={`/admin/companies/new?opportunityId=${opportunityId}`} className="ta-btn ta-btn-outline ta-btn-sm">
              Create Company
            </Link>
          </>
        )}
      </div>
    </Card>
  );
}
