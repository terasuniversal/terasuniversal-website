import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { TrainerForm } from "../../TrainerForm";
import { updateTrainer } from "../../actions";

export const metadata = { title: "Edit Trainer — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditTrainerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  await requireModuleAccess("trainers");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: trainer } = await supabase.from("trainers").select("*").eq("id", id).single();
  if (!trainer) notFound();
  const boundUpdate = updateTrainer.bind(null, id);
  return (
    <>
      <PageHead title="Edit Trainer" subtitle={`${trainer.trainer_id} · ${trainer.full_name}`} />
      <TrainerForm action={boundUpdate} trainer={trainer} mode="edit" />
    </>
  );
}
