import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "Certificates — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="Certificates"
      subtitle="Issue and track certificates."
      table="certificates"
      bullets={[
            "Issue / revoke / expire",
            "Certificate number and holder",
            "Statistics on the dashboard",      ]}
    />
  );
}
