import Link from "next/link";
import { requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { StaffUserForm } from "../StaffUserForm";

export const metadata = { title: "Add Staff — TERAS UNIVERSAL Admin" };

export default async function AddStaffPage() {
  await requireModuleAccess("users");
  return (
    <>
      <PageHead title="Add Staff" subtitle="Invite a staff member to the existing TERAS Admin login." action={<Link href="/admin/users" className="ta-btn ta-btn-outline">Back to Staff Users</Link>} />
      <div className="ta-card ta-card-pad">
        <StaffUserForm />
      </div>
    </>
  );
}
