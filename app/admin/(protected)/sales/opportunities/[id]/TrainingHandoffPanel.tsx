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
 * Sales CRM Phase 3 — Won Opportunity -> Training Operations handoff entry
 * point. Pure server component: every value is computed by the parent page
 * (page.tsx) from already-fetched rows, and the "Create Training Schedule"
 * control is a plain link into the EXISTING /admin/schedules/new form
 * (ScheduleForm, via handoff searchParams) rather than a new form/action —
 * per the task's explicit preference not to build a parallel schedule
 * system. The link itself carries only IDs plus display-safe free text;
 * nothing here writes to the database.
 */
export function TrainingHandoffPanel({
  canManage,
  quotationNo,
  programme,
  participants,
  hasAcceptedQuotation,
  existingSchedule,
  createHref,
}: {
  canManage: boolean;
  quotationNo: string | null;
  programme: string | null;
  participants: number | null;
  hasAcceptedQuotation: boolean;
  existingSchedule: { id: string; schedule_code: string | null } | null;
  createHref: string;
}) {
  const status = existingSchedule ? "Schedule created" : hasAcceptedQuotation ? "Ready for handoff" : "Awaiting accepted quotation";

  return (
    <Card title="Training Operations">
      <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <dl style={dl}>
          <Row label="Accepted Quotation" value={quotationNo} />
          <Row label="Programme" value={programme} />
          <Row label="Participants" value={participants} />
          <Row label="Status" value={status} />
        </dl>

        {existingSchedule ? (
          <Link href={`/admin/schedules/${existingSchedule.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
            View Training Schedule
          </Link>
        ) : hasAcceptedQuotation ? (
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
