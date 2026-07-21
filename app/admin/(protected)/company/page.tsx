import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "Company Profile — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="Company Profile"
      subtitle="Edit the singleton company profile."
      table="company_profile"
      bullets={[
            "Vision, mission, about, services",
            "Contact info and Google Map",
            "Social media links",      ]}
    />
  );
}
