import { requireStaff } from "../../../../lib/auth/session";
import { PageHead, Card } from "../../../../components/admin/ui";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata = { title: "Change Password — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const profile = await requireStaff();

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 16px" }}>
      <PageHead
        title="Change Password"
        subtitle={
          profile.must_change_password
            ? "For your security, you must set a new password before continuing. Your temporary password can only be used once."
            : "Update the password for your account."
        }
      />
      <Card title="Account password">
        <div className="ta-card-pad">
          <ChangePasswordForm forced={profile.must_change_password} />
        </div>
      </Card>
    </div>
  );
}
