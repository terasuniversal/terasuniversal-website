import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "Gallery — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="Gallery"
      subtitle="Upload, categorise and feature images."
      table="gallery_images"
      bullets={[
            "Upload / replace / delete via the media library",
            "Categories, alt text, featured flag",
            "Sort order",      ]}
    />
  );
}
