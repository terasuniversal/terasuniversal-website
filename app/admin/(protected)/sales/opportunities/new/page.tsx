import { redirect } from "next/navigation";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";

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
 * Smallest safe fix: redirect to the real entry point instead. The demo
 * form/component/mock-data files are untouched on disk, per instruction not
 * to delete demo source modules unnecessarily — only this route no longer
 * serves them.
 */
export default async function SalesNewOpportunityPage() {
  await requireRole("editor");
  await requireModuleAccess("sales_opportunities");
  redirect("/admin/sales/leads");
}
