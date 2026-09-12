import Link from "next/link";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { PageHead, Card, Badge, EmptyState } from "../../../../components/admin/ui";
import { HRDF_CLAIM_STATUS_FILTERS, HRDF_CLAIM_STATUS_LABELS } from "../../../../lib/sales/hrdf-claims";

export const dynamic = "force-dynamic";

export default async function HrdfClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("hrdf_claims");
  const sp = await searchParams;
  const status = HRDF_CLAIM_STATUS_FILTERS.includes(sp.status as never) ? sp.status : undefined;
  const supabase = await createSupabaseServerClient();
  let query = (supabase.from("hrdf_claims") as any).select("id, invoice_id, status, grant_reference, claim_reference, approved_amount, payment_received_amount, updated_at").order("updated_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data: claims, error } = await query;
  const invoiceIds = (claims ?? []).map((claim: { invoice_id: string }) => claim.invoice_id);
  const { data: invoices } = invoiceIds.length ? await supabase.from("invoices").select("id, invoice_no, grand_total, status").in("id", invoiceIds) : { data: [] as Array<{ id: string; invoice_no: string; grand_total: number; status: string }> };
  const invoiceRows = (invoices ?? []) as Array<{ id: string; invoice_no: string; grand_total: number; status: string }>;
  const invoiceMap = new Map<string, { id: string; invoice_no: string; grand_total: number; status: string }>(invoiceRows.map((invoice) => [invoice.id, invoice]));
  return <>
    <PageHead title="HRDF Claims" subtitle="Operational grant and claim tracking." />
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/hrdf-claims">All</Link>
      {HRDF_CLAIM_STATUS_FILTERS.map((item) => <Link key={item} className="ta-btn ta-btn-outline ta-btn-sm" href={`/admin/hrdf-claims?status=${item}`}>{HRDF_CLAIM_STATUS_LABELS[item]}</Link>)}
    </div>
    <Card title={status ? HRDF_CLAIM_STATUS_LABELS[status as keyof typeof HRDF_CLAIM_STATUS_LABELS] : "All Claims"}>
      {error ? <EmptyState message="HRDF claims are currently unavailable." /> : (claims ?? []).length === 0 ? <EmptyState message="No HRDF claims found." /> : <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Invoice</th><th>Status</th><th>Grant</th><th>Claim</th><th>Approved</th><th>Received</th><th /></tr></thead><tbody>{(claims ?? []).map((claim: any) => { const invoice = invoiceMap.get(claim.invoice_id); return <tr key={claim.id}><td>{invoice ? invoice.invoice_no : claim.invoice_id}</td><td><Badge status={HRDF_CLAIM_STATUS_LABELS[claim.status as keyof typeof HRDF_CLAIM_STATUS_LABELS] ?? claim.status} /></td><td>{claim.grant_reference ?? "—"}</td><td>{claim.claim_reference ?? "—"}</td><td>{claim.approved_amount == null ? "—" : `RM ${Number(claim.approved_amount).toFixed(2)}`}</td><td>RM {Number(claim.payment_received_amount ?? 0).toFixed(2)}</td><td><Link className="ta-btn ta-btn-outline ta-btn-sm" href={`/admin/invoices/${claim.invoice_id}`}>Open invoice</Link></td></tr>; })}</tbody></table></div>}
    </Card>
  </>;
}
