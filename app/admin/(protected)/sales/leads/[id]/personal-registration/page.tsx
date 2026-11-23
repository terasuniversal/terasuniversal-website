import Link from "next/link";
import { requireRegistrationAccess } from "./actions";
import { PageHead, Card } from "../../../../../../../components/admin/ui";

export const metadata = { title: "Personal Registration — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

// S1 (Owner 2026-11-22): personal registration directly from a lead is unavailable because its database function
// (register_personal_lead) is not deployed. The supported path is Training Operations.
export default async function PersonalRegistrationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRegistrationAccess();
  const { id } = await params;
  return (
    <>
      <PageHead
        title="Personal Registration"
        subtitle="Registration from a lead is not available."
        action={<Link href={`/admin/sales/leads/${id}`} className="ta-btn ta-btn-outline">← Back to Lead</Link>}
      />
      <div style={{ maxWidth: 820 }}>
        <Card title="Use Training Operations">
          <div className="ta-card-pad ta-stack">
            <p style={{ margin: 0 }}>Create the participant, then assign them to the training schedule.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/admin/participants/new" className="ta-btn ta-btn-outline ta-btn-sm">New Participant</Link>
              <Link href="/admin/schedules" className="ta-btn ta-btn-outline ta-btn-sm">Training Schedules</Link>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
