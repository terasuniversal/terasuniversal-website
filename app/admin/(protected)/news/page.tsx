import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "News — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="News"
      subtitle="Draft, publish and schedule posts."
      table="news_posts"
      bullets={[
            "Draft / publish / schedule-publish workflow",
            "Categories and featured image",
            "SEO title and description",      ]}
    />
  );
}
