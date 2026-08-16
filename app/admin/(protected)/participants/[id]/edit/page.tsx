import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { ParticipantForm } from "../../ParticipantForm";
import { updateParticipant } from "../../actions";
import { loadScheduleOptions, loadCompanyOptions } from "../../loadSchedules";

export const metadata = { title: "Edit Participant — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditParticipantPage({ params }: { params: Promise<{ id: string }> }) {
await requireModuleAccess("participants");
  await requireRole("admin"); // Editors are read-only.
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: participant } = await supabase.from("participants").select("*").eq("id", id).single();
  if (!participant) notFound();
  const [schedules, companies] = await Promise.all([loadScheduleOptions(), loadCompanyOptions()]);
  const boundUpdate = updateParticipant.bind(null, id);
  return (
    <>
      <PageHead title="Edit Participant" subtitle={`${participant.participant_id} · ${participant.full_name}`} />
      <ParticipantForm action={boundUpdate} participant={participant} schedules={schedules} companies={companies} mode="edit" />
    </>
  );
}
