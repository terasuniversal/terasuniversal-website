"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../../../lib/supabase/client";
import {
  CONFIRM_ERROR_MESSAGES,
  SET_PASSWORD_PATH,
  legacyHashErrorCode,
  parseLegacyHashTokens,
  type ConfirmErrorCode,
  type LegacyHashTokens,
} from "../../../../lib/auth/email-link";

/**
 * Handles links in the GoTrue default format, which put the session in the URL
 * hash (implicit flow). The PKCE browser client refuses to read those, so the
 * tokens are taken from the hash here and stored with setSession -- only after
 * the person presses the button. The hash is removed from the address bar
 * straight away so the tokens do not stay in history.
 */
export function LegacyHashConfirm() {
  const router = useRouter();
  const [tokens, setTokens] = useState<LegacyHashTokens | null>(null);
  const [error, setError] = useState<ConfirmErrorCode | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) window.history.replaceState(null, "", window.location.pathname);
    const parsed = parseLegacyHashTokens(hash);
    setTokens(parsed);
    setError(parsed ? null : legacyHashErrorCode(hash) ?? "link_invalid");
    setReady(true);
  }, []);

  async function continueWithLink() {
    if (!tokens) return;
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error: sessionError } = await supabase.auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
    if (sessionError) {
      setPending(false);
      setTokens(null);
      setError("link_expired");
      return;
    }
    router.replace(SET_PASSWORD_PATH);
  }

  if (!ready) return <p className="sub">Menyemak pautan…</p>;
  if (error || !tokens) {
    return (
      <>
        <div className="ta-alert ta-alert-error" role="alert" style={{ marginBottom: 14 }}>{CONFIRM_ERROR_MESSAGES[error ?? "link_invalid"]}</div>
        <Link href="/admin/login" className="ta-btn ta-btn-outline ta-btn-sm">Kembali ke log masuk</Link>
      </>
    );
  }
  return (
    <div className="ta-form">
      <p className="sub">Tekan butang di bawah untuk meneruskan dan menetapkan kata laluan akaun TERAS CRM anda.</p>
      <button className="ta-btn ta-btn-primary" type="button" onClick={continueWithLink} disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
        {pending ? "Sedang mengesahkan…" : "Teruskan"}
      </button>
    </div>
  );
}
