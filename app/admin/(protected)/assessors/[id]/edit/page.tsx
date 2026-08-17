import { notFound } from "next/navigation";
import { requireModuleAccess, requireRole } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { AssessorForm } from "../../AssessorForm";
import { updateAssessor } from "../../actions";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";

export const metadata = { title: "Edit Assessor — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditAssessorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  await requireModuleAccess("assessors");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: assessor } = await supabase.from("assessors").select("*").eq("id", id).single();
  if (!assessor) notFound();
  return (
    <>
      <PageHead title="Edit Assessor" subtitle={assessor.full_name} />
      <AssessorForm action={updateAssessor.bind(null, id)} assessor={assessor} mode="edit" />
    </>
  );
}
