import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole } from "../../../../../../lib/auth/session";
import { PageHead, Card } from "../../../../../../components/admin/ui";
import { QuotationItemsEditor } from "../QuotationItemsEditor";
import { createQuotation } from "../actions";
import type { SalesOpportunityRow } from "../../../../../../lib/sales/crm";

export const metadata = { title: "New Quotation — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Task 8: quotations are always created FROM an opportunity — there is no
 * standalone "blank" quotation flow, matching the business flow (Lead →
 * Opportunity → Quotation). Pre-fills company/contact/programme from the
 * opportunity; participant count (if the opportunity came from a proposal
 * request with a real headcount) is shown as context but never silently
 * turned into a priced line item — staff enters real pricing manually
 * (Task 8: "Do not silently fabricate pricing").
 */
export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<{ opportunityId?: string }> }) {
  await requireRole("admin");
  const sp = await searchParams;
  if (!sp.opportunityId) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: opportunity } = await supabase.from("sales_opportunities").select("*").eq("id", sp.opportunityId).maybeSingle();
  if (!opportunity) notFound();
  const opp = opportunity as SalesOpportunityRow;

  return (
    <>
      <PageHead
        title="New Quotation"
        subtitle={`For ${opp.opportunity_no} — ${opp.company_name ?? "No company on file"}`}
        action={<Link href={`/admin/sales/opportunities/${opp.id}`} className="ta-btn ta-btn-outline">← Back to Opportunity</Link>}
      />

      <Card title="Quoting For">
        <div className="ta-card-pad" style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13.5 }}>
          <div><strong>Company:</strong> {opp.company_name ?? "—"}</div>
          <div><strong>Contact:</strong> {opp.contact_person ?? "—"}</div>
          <div><strong>Programme:</strong> {opp.programme ?? "—"}</div>
        </div>
      </Card>

      <QuotationItemsEditor action={createQuotation.bind(null, opp.id)} submitLabel="Create Quotation" />
    </>
  );
}
