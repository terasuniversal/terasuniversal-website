import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { ParticipantForm } from "../ParticipantForm";
import { createParticipant } from "../actions";
import { loadScheduleOptions, loadCompanyOptions } from "../loadSchedules";

export const metadata = { title: "Add Participant — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewParticipantPage() {
  await requireRole("admin"); // Editors are read-only.
  const [schedules, companies] = await Promise.all([loadScheduleOptions(), loadCompanyOptions()]);
  return (
    <>
      <PageHead title="Add Participant" subtitle="Register a new participant. A Participant ID is generated automatically." />
      <ParticipantForm action={createParticipant} schedules={schedules} companies={companies} mode="create" />
    </>
  );
}
