"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { establishLegacySession } from "./actions";
import {
  CONFIRM_ERROR_MESSAGES,
  RETRYABLE_CONFIRM_ERRORS,
  SET_PASSWORD_PATH,
  legacyHashErrorCode,
  parseLegacyHashTokens,
  type ConfirmErrorCode,
  type LegacyHashTokens,
} from "../../../../lib/auth/email-link";

/**
 * Handles links in the GoTrue default format, which put the session in the URL
 * hash (implicit flow). The hash is captured once and removed from the address
 * bar straight away. Only when the person presses the button are the tokens
 * posted (same-origin) to establishLegacySession, which sets the session on
 * the server with the SSR client. The browser Supabase client is not used here
 * (AUTH-1 Gate B: its setSession failed without reaching Supabase).
 */
export function LegacyHashConfirm() {
  const router = useRouter();
  const tokensRef = useRef<LegacyHashTokens | null>(null);
  const inFlight = useRef(false);
  const [hasTokens, setHasTokens] = useState(false);
  const [error, setError] = useState<ConfirmErrorCode | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) window.history.replaceState(null, "", window.location.pathname);
    const parsed = parseLegacyHashTokens(hash);
    tokensRef.current = parsed;
    setHasTokens(parsed !== null);
    setError(parsed ? null : legacyHashErrorCode(hash) ?? "link_invalid");
    setReady(true);
  }, []);

  async function continueWithLink() {
    const tokens = tokensRef.current;
    if (!tokens || inFlight.current) return; // one request at a time; double clicks are ignored
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("access_token", tokens.accessToken);
      form.set("refresh_token", tokens.refreshToken);
      const result = await establishLegacySession(form);
      if (result.ok) {
        tokensRef.current = null;
        router.replace(SET_PASSWORD_PATH);
        return; // keep the button disabled while navigating
      }
      if (!RETRYABLE_CONFIRM_ERRORS.includes(result.error)) {
        tokensRef.current = null; // the link cannot succeed; do not offer another attempt
        setHasTokens(false);
      }
      setError(result.error);
    } catch (thrown) {
      // The request never completed (offline, blocked, server action unreachable).
      console.warn("AUTH-1 legacy link: request failed", { name: (thrown as { name?: string })?.name });
      setError("network_failed");
    }
    inFlight.current = false;
    setPending(false);
  }

  if (!ready) return <p className="sub">Menyemak pautan…</p>;
  return (
    <div className="ta-form">
      {error && <div className="ta-alert ta-alert-error" role="alert" style={{ marginBottom: 14 }}>{CONFIRM_ERROR_MESSAGES[error]}</div>}
      {hasTokens ? (
        <>
          {!error && <p className="sub">Tekan butang di bawah untuk meneruskan dan menetapkan kata laluan akaun TERAS CRM anda.</p>}
          <button className="ta-btn ta-btn-primary" type="button" onClick={continueWithLink} disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
            {pending ? "Sedang mengesahkan…" : error ? "Cuba lagi" : "Teruskan"}
          </button>
        </>
      ) : (
        <Link href="/admin/login" className="ta-btn ta-btn-outline ta-btn-sm">Kembali ke log masuk</Link>
      )}
    </div>
  );
}
