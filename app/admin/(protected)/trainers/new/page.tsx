import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { TrainerForm } from "../TrainerForm";
import { createTrainer } from "../actions";

export const metadata = { title: "Add Trainer — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewTrainerPage() {
  await requireRole("admin");
  await requireModuleAccess("trainers");
  return (
    <>
      <PageHead title="Add Trainer" subtitle="A Trainer ID is generated automatically." />
      <TrainerForm action={createTrainer} mode="create" />
    </>
  );
}
