import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "FAQ — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="FAQ"
      subtitle="Manage frequently asked questions."
      table="faqs"
      bullets={[
            "CRUD questions and answers",
            "Categories and sorting",
            "Publish / draft status",      ]}
    />
  );
}
