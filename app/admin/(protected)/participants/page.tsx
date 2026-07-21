import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "Participants — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="Participants"
      subtitle="Manage training participants."
      table="participants"
      bullets={[
            "Register participants against a schedule",
            "Attendance status",
            "Feeds the certificate workflow",      ]}
    />
  );
}
