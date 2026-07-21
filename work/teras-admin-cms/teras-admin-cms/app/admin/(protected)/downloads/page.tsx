import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "Downloads — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="Downloads"
      subtitle="Manage downloadable documents."
      table="downloads"
      bullets={[
            "Company profile, brochures, forms, calendars, safety guides",
            "Linked to the media library",
            "Download counter",      ]}
    />
  );
}
