import { requireModuleAccess, requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { AssessorForm } from "../AssessorForm";
import { createAssessor } from "../actions";

export const metadata = { title: "New Assessor — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewAssessorPage() {
  await requireRole("admin");
  await requireModuleAccess("assessors");
  return (
    <>
      <PageHead title="New Assessor" subtitle="Add a new assessor to the pool." />
      <AssessorForm action={createAssessor} mode="create" />
    </>
  );
}
