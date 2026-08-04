import Link from "next/link";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { ImportClient } from "./ImportClient";

export const metadata = { title: "Import Participants — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function ImportParticipantsPage() {
  await requireRole("admin"); // Editors are read-only.
  return (
    <>
      <PageHead
        title="Import Participants"
        subtitle="Upload the TERAS participant CSV template. Preview before importing."
        action={<Link href="/admin/participants" className="ta-btn ta-btn-outline">← Back</Link>}
      />
      <ImportClient />
    </>
  );
}
