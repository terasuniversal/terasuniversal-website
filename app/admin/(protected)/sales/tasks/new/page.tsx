import { requireRole } from "../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { PageHead } from "../../../../../../components/admin/ui";
import { TaskForm } from "../TaskForm";
import { createTask } from "../actions";
import { loadStaffOptions } from "../options";

export const metadata = { title: "New Task — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Accepts optional leadId/opportunityId/quotationId — the same handoff-link
 * pattern as Phase 3/4A (searchParams carrying the source record, a hidden
 * field on submit). No search-and-pick UI for relations, per Task 9/11's
 * "keep it small" instruction; a task not opened from a specific record is
 * simply unlinked.
 */
export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string; opportunityId?: string; quotationId?: string }>;
}) {
  await requireRole("editor");
  const sp = await searchParams;
  const staff = await loadStaffOptions();

  let linkContext: { label: string; leadId?: string; opportunityId?: string; quotationId?: string } | undefined;
  if (sp.opportunityId) {
    const supabase = await createSupabaseServerClient();
    const { data: opp } = await supabase.from("sales_opportunities").select("opportunity_no").eq("id", sp.opportunityId).maybeSingle();
    if (opp) linkContext = { label: `Opportunity ${opp.opportunity_no}`, opportunityId: sp.opportunityId };
  } else if (sp.leadId) {
    linkContext = { label: "the source lead", leadId: sp.leadId };
  } else if (sp.quotationId) {
    const supabase = await createSupabaseServerClient();
    const { data: q } = await supabase.from("sales_quotations").select("quotation_no").eq("id", sp.quotationId).maybeSingle();
    if (q) linkContext = { label: `Quotation ${q.quotation_no}`, quotationId: sp.quotationId };
  }

  return (
    <>
      <PageHead title="New Task" subtitle="Create a Sales task." />
      <TaskForm action={createTask} staff={staff} mode="create" linkContext={linkContext} />
    </>
  );
}
