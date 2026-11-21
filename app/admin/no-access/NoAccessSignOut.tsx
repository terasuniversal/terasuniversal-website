"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../../lib/supabase/client";

/** Same client-side sign-out as the Topbar (CLAUDE.md §7), so the No Access page is never a dead end. */
export function NoAccessSignOut() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
      router.push("/admin/login");
      router.refresh();
    } catch (error) {
      setSigningOut(false);
      throw error;
    }
  }

  return (
    <button type="button" className="ta-btn ta-btn-outline" style={{ minHeight: 44 }} onClick={signOut} disabled={signingOut}>
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
