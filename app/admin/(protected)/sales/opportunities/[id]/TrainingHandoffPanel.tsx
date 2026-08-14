import Link from "next/link";
import { Card } from "../../../../../../components/admin/ui";

const dl = { display: "grid", gridTemplateColumns: "120px 1fr", gap: 2, margin: 0 } as const;

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: "contents" }}>
      <dt style={{ color: "var(--ta-muted)", padding: "5px 0", fontSize: 12.5 }}>{label}</dt>
      <dd style={{ margin: 0, padding: "5px 0", fontSize: 13, fontWeight: 500 }}>{value || "—"}</dd>
    </div>
  );
}

/**
 * Sales CRM Phase 3/4A — Won Opportunity -> Training Operations handoff
 * entry point. Pure server component: every value is computed by the
 * parent page (page.tsx) from already-fetched rows. All actions are plain
 * links into EXISTING pages/forms (ScheduleForm via handoff searchParams,
 * the schedule detail page's own enrollment UI, the Participants import
 * flow) — nothing here writes to the database or duplicates those modules'
 * own UI.
 */
export function TrainingHandoffPanel({
  canManage,
  quotationNo,
  programme,
  expectedParticipants,
  hasAcceptedQuotation,
  existingSchedule,
  createHref,
}: {
  canManage: boolean;
  quotationNo: string | null;
  programme: string | null;
  /** Sales proposal/quotation participant count — an expected quantity only, never a target to fabricate. */
  expectedParticipants: number | null;
  hasAcceptedQuotation: boolean;
  existingSchedule: {
    id: string;
    schedule_code: string | null;
    capacity: number;
    enrolledCount: number;
    trainerName: string | null;
    isPublished: boolean;
  } | null;
  createHref: string;
}) {
  if (existingSchedule) {
    return (
      <Card title="Training Operations">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <dl style={dl}>
            <Row label="Schedule" value={existingSchedule.schedule_code} />
            <Row label="Participants" value={`${existingSchedule.enrolledCount} / ${existingSchedule.capacity} enrolled`} />
            <Row label="Trainer" value={existingSchedule.trainerName ? "Assigned" : "Not yet assigned"} />
            <Row label="Publication" value={existingSchedule.isPublished ? "Published" : "Draft"} />
          </dl>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href={`/admin/schedules/${existingSchedule.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
              View Schedule
            </Link>
            {canManage && (
              <>
                <Link href={`/admin/schedules/${existingSchedule.id}`} className="ta-btn ta-btn-primary ta-btn-sm">
                  Manage Participants
                </Link>
                <Link
                  href={`/admin/participants/import?scheduleId=${existingSchedule.id}${existingSchedule.schedule_code ? `&scheduleCode=${encodeURIComponent(existingSchedule.schedule_code)}` : ""}`}
                  className="ta-btn ta-btn-outline ta-btn-sm"
                >
                  Import Participants
                </Link>
              </>
            )}
          </div>
        </div>
      </Card>
    );
  }

  const status = hasAcceptedQuotation ? "Ready for handoff" : "Awaiting accepted quotation";

  return (
    <Card title="Training Operations">
      <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <dl style={dl}>
          <Row label="Accepted Quotation" value={quotationNo} />
          <Row label="Programme" value={programme} />
          <Row label="Participants" value={expectedParticipants != null ? `${expectedParticipants} expected` : null} />
          <Row label="Status" value={status} />
        </dl>

        {hasAcceptedQuotation ? (
          canManage ? (
            <>
              <Link href={createHref} className="ta-btn ta-btn-primary ta-btn-sm">
                Create Training Schedule
              </Link>
              <p style={{ margin: 0, fontSize: 12, color: "var(--ta-muted)" }}>
                Opens the standard New Schedule form pre-filled with known details. Dates, venue, trainer and capacity still need
                staff review before publishing.
              </p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: "var(--ta-muted)" }}>Creating a training schedule requires Admin access.</p>
          )
        ) : null}
      </div>
    </Card>
  );
}
