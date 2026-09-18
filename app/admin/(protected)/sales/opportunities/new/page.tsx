import Link from "next/link";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { Card, EmptyState, PageHead } from "../../../../../../components/admin/ui";

/**
 * Production rule: opportunities originate exclusively from Lead → Convert
 * to Opportunity (see app/admin/(protected)/sales/leads/actions.ts's
 * convertLeadToOpportunity, wired into Lead Detail's LeadActionsPanel).
 * This route used to be the Phase 1C demo's manual "New Opportunity" form
 * (components/admin/sales/OpportunityForm.tsx, backed by
 * lib/sales/demo-data.ts's mock companies/lead IDs, writing nothing to
 * Supabase) — left as an alternative production entry point, it would let
 * staff create an opportunity with no real source lead, bypassing the
 * qualification/duplicate-prevention rules the real flow enforces.
 *
 * This route remains intentionally non-creating. It explains the real entry
 * point instead of silently redirecting staff away from the requested action.
 */
export default async function SalesNewOpportunityPage() {
  await requireRole("editor");
  await requireModuleAccess("sales_opportunities");
  return (
    <>
      <PageHead title="Create Opportunity" subtitle="Opportunities are created from a qualified Lead." />
      <Card>
        <EmptyState
          icon="🎯"
          title="Start with a qualified Lead"
          message="Convert a qualified Lead from Lead Detail to create the linked Opportunity and preserve the enquiry history."
          action={<Link href="/admin/sales/leads" className="ta-btn ta-btn-primary">Go to Leads</Link>}
        />
      </Card>
    </>
  );
}
