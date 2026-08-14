import Link from "next/link";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { ImportClient } from "./ImportClient";

export const metadata = { title: "Import Participants — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Sales CRM Phase 4A — minimal contextual handoff (Task 9): the import
 * flow itself is untouched (validation, IC/passport duplicate handling,
 * participant-code generation, audit logging all stay exactly as-is). This
 * only adds a banner pointing back to the schedule when opened from a Won
 * Opportunity's "Import Participants" action, since the import path does
 * not (and per this task, should not gain a new business rule to) enroll
 * participants into a schedule directly — that stays the existing
 * AssignParticipants flow on the schedule detail page.
 */
export default async function ImportParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ scheduleId?: string; scheduleCode?: string }>;
}) {
  await requireRole("admin"); // Editors are read-only.
  const sp = await searchParams;
  return (
    <>
      <PageHead
        title="Import Participants"
        subtitle="Upload the TERAS participant CSV template. Preview before importing."
        action={<Link href="/admin/participants" className="ta-btn ta-btn-outline">← Back</Link>}
      />
      {sp.scheduleId && (
        <div className="ta-alert ta-alert-info" style={{ marginBottom: 16 }}>
          Importing for Training Schedule {sp.scheduleCode ?? sp.scheduleId}. This import adds participants to the master
          Participants list only — after it finishes,{" "}
          <Link href={`/admin/schedules/${sp.scheduleId}`}>go to the schedule</Link> to assign them there.
        </div>
      )}
      <ImportClient />
    </>
  );
}
