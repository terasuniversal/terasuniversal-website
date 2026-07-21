import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "Media Library — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="Media Library"
      subtitle="Single manager for images, PDFs and documents."
      table="media"
      bullets={[
            "Upload to Supabase Storage (media / downloads / private buckets)",
            "Folders, search, alt text",
            "Referenced by every content module",      ]}
    />
  );
}
