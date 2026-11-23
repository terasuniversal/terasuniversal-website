import Link from "next/link";
import { requireStaff } from "../../../../lib/auth/session";
import { emailLinkSessionIsRecent } from "../../../../lib/auth/email-link-session";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Set Password — TERAS UNIVERSAL Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Reached only from /admin/auth/confirm. Inactive accounts are turned away by requireStaff(). */
export default async function SetPasswordPage() {
  await requireStaff();
  const recent = await emailLinkSessionIsRecent();

  return (
    <div className="ta-login">
      <div className="ta-login-card">
        <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
        <h1>Tetapkan kata laluan</h1>
        {recent ? (
          <>
            <p className="sub">Pilih kata laluan baharu untuk akaun TERAS CRM anda (sekurang-kurangnya 10 aksara).</p>
            <SetPasswordForm />
          </>
        ) : (
          <>
            <div className="ta-alert ta-alert-error" role="alert" style={{ marginBottom: 14 }}>
              Halaman ini hanya boleh digunakan sejurus selepas membuka pautan jemputan atau set semula kata laluan. Untuk menukar kata laluan, gunakan halaman Tukar Kata Laluan.
            </div>
            <Link href="/admin/account/change-password" className="ta-btn ta-btn-outline ta-btn-sm">Tukar kata laluan</Link>
          </>
        )}
      </div>
    </div>
  );
}
