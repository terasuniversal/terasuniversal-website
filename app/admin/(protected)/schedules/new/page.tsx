import { requireModuleAccess, requireRole } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { PageHead } from "../../../../../components/admin/ui";
import { ScheduleForm } from "../ScheduleForm";
import { createSchedule } from "../actions";
import { loadCourseOptions } from "../options";
import { getAutomationSettings } from "../../automation/actions";

export const metadata = { title: "New Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Sales CRM Phase 3 handoff — when opened from a Won Opportunity's "Create
 * Training Schedule" action (opportunities/[id]/TrainingHandoffPanel.tsx),
 * `opportunityId` carries every other handoff param. All prefill values are
 * read straight from the URL rather than re-queried here, so this page
 * doesn't need to re-derive company/quotation/participant data — it only
 * needs the opportunity/quotation *numbers* for the banner text, which are
 * cheap single-row lookups.
 */
export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    opportunityId?: string;
    quotationId?: string;
    courseId?: string;
    capacity?: string;
    venue?: string;
    notes?: string;
  }>;
}) {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const sp = await searchParams;
  const [courses, settings] = await Promise.all([loadCourseOptions(), getAutomationSettings()]);

  let handoff: { opportunityId: string; quotationId?: string; opportunityNo?: string; quotationNo?: string } | undefined;
  let prefill: any = undefined;

  if (sp.opportunityId) {
    const supabase = await createSupabaseServerClient();
    const [{ data: opp }, quotation] = await Promise.all([
      supabase.from("sales_opportunities").select("opportunity_no").eq("id", sp.opportunityId).maybeSingle(),
      sp.quotationId
        ? supabase.from("sales_quotations").select("quotation_no").eq("id", sp.quotationId).maybeSingle().then((r: any) => r.data)
        : Promise.resolve(null),
    ]);
    if (opp) {
      handoff = {
        opportunityId: sp.opportunityId,
        quotationId: sp.quotationId || undefined,
        opportunityNo: opp.opportunity_no,
        quotationNo: quotation?.quotation_no,
      };
      prefill = {
        course_id: sp.courseId || "",
        capacity: sp.capacity || undefined,
        venue: sp.venue || "",
        notes: sp.notes || "",
        is_published: false,
      };
    }
  }

  return (
    <>
      <PageHead title="New Schedule" subtitle="A schedule code is generated automatically." />
      <ScheduleForm
        action={createSchedule}
        courses={courses}
        mode="create"
        defaultTrainingMode={settings.default_training_mode}
        schedule={prefill}
        handoff={handoff}
      />
    </>
  );
}
