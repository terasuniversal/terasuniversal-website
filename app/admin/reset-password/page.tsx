"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CONFIRM_PATH } from "../../../lib/auth/email-link";

/**
 * Older invitation and recovery emails point here with the session in the URL
 * hash. This page used to read it with the PKCE browser client, which rejects
 * hash links (AUTH-1). It now only forwards the link -- hash included, which
 * never reaches the server -- to /admin/auth/confirm, where the person
 * confirms it with a button press.
 */
export default function ResetPasswordPage() {
  useEffect(() => {
    const { hash, search } = window.location;
    if (hash || search) window.location.replace(`${CONFIRM_PATH}${search}${hash}`);
  }, []);

  return (
    <div className="ta-login">
      <div className="ta-login-card">
        <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
        <h1>Tetapkan kata laluan</h1>
        <p className="sub">Jika halaman tidak beralih secara automatik, minta pautan baharu melalui &quot;Forgot password?&quot; di halaman log masuk.</p>
        <Link href="/admin/login" className="ta-btn ta-btn-outline ta-btn-sm">Kembali ke log masuk</Link>
      </div>
    </div>
  );
}
