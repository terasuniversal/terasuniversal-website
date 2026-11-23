import Link from "next/link";
import type { Metadata } from "next";
import { confirmEmailLink } from "./actions";
import { LegacyHashConfirm } from "./LegacyHashConfirm";
import { CONFIRM_ERROR_MESSAGES, confirmErrorCode, parseEmailLinkParams } from "../../../../lib/auth/email-link";

export const dynamic = "force-dynamic";
// The page URL carries a one-time token: never send it to another site as a referrer, never index it.
export const metadata: Metadata = {
  title: "Confirm your account — TERAS UNIVERSAL Admin",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Landing page for staff invitation and password-recovery emails.
 * Opening it (GET) never verifies anything; the token is spent only when the
 * person presses the button, which posts to confirmEmailLink.
 */
export default async function ConfirmEmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const errorCode = confirmErrorCode(sp.error);
  const link = parseEmailLinkParams(sp.token_hash, sp.type);
  const heading = link.ok && link.type === "invite" ? "Terima jemputan" : "Tetapkan kata laluan";

  return (
    <div className="ta-login">
      <div className="ta-login-card">
        <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
        <h1>{heading}</h1>
        {errorCode ? (
          <>
            <div className="ta-alert ta-alert-error" role="alert" style={{ marginBottom: 14 }}>{CONFIRM_ERROR_MESSAGES[errorCode]}</div>
            <Link href="/admin/login" className="ta-btn ta-btn-outline ta-btn-sm">Kembali ke log masuk</Link>
          </>
        ) : link.ok ? (
          <form action={confirmEmailLink} className="ta-form">
            <p className="sub">Tekan butang di bawah untuk mengesahkan pautan ini dan menetapkan kata laluan akaun TERAS CRM anda.</p>
            <input type="hidden" name="token_hash" value={link.tokenHash} />
            <input type="hidden" name="type" value={link.type} />
            <button className="ta-btn ta-btn-primary" type="submit" style={{ width: "100%", justifyContent: "center" }}>Teruskan</button>
          </form>
        ) : (
          <LegacyHashConfirm />
        )}
      </div>
    </div>
  );
}
