// W9-G3 transactional email for eBook verification (V-1). Resend is the existing provider (already used by Contact and
// Request Proposal); it is used only when configured, and the shared email quota is reserved by the CRM RPC before a
// token is issued (W9-EBOOK-RPC-CONTRACT v1.0 §2.1). The message carries only the one-time link: no name, phone or
// marketing content. Nothing here logs the address, the link or the token.
export const EBOOK_VERIFY_SUBJECT = "Confirm your email to download the TERAS UNIVERSAL eBook";

export function buildVerificationEmail(verifyUrl) {
  const text = [
    "Thank you for requesting the free eBook \"Dari Zero ke Dunia Industri\" from TERAS UNIVERSAL.",
    "",
    "Confirm your email address to download it:",
    verifyUrl,
    "",
    "This link works once and expires in 60 minutes. If it has expired, you can request a new one on our website.",
    "If you did not request this eBook, you can ignore this email. No marketing emails are sent unless you chose to receive them.",
    "",
    "TERAS UNIVERSAL SDN. BHD.",
  ].join("\n");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const html = `<div style="font-family:Arial,sans-serif;color:#172b45;max-width:560px">
<p>Thank you for requesting the free eBook <strong>Dari Zero ke Dunia Industri</strong> from TERAS UNIVERSAL.</p>
<p><a href="${esc(verifyUrl)}" style="display:inline-block;padding:12px 20px;background:#0b3a63;color:#ffffff;text-decoration:none;border-radius:2px">Confirm my email</a></p>
<p style="font-size:14px;color:#4a5a6e">This link works once and expires in 60 minutes. If it has expired, you can request a new one on our website. If you did not request this eBook, you can ignore this email. No marketing emails are sent unless you chose to receive them.</p>
<p style="font-size:14px">TERAS UNIVERSAL SDN. BHD.</p></div>`;
  return { subject: EBOOK_VERIFY_SUBJECT, text, html };
}

/** Real adapter. ResendCtor is the `Resend` class (injected so tests never construct a client). */
export function makeResendMailer({ apiKey, from, ResendCtor }) {
  return {
    async sendVerification({ to, verifyUrl }) {
      if (!apiKey || !from) return { sent: false, code: "not_configured" };
      try {
        const message = buildVerificationEmail(verifyUrl);
        const result = await new ResendCtor(apiKey).emails.send({ from, to: [to], ...message });
        if (result?.error) return { sent: false, code: result.error.name === "daily_quota_exceeded" || result.error.name === "monthly_quota_exceeded" ? "provider_quota" : "provider_error" };
        return { sent: true, code: "sent" };
      } catch {
        return { sent: false, code: "provider_exception" };
      }
    },
  };
}

/** Local development / tests only: records nothing that leaves the process and never sends. */
export function makeMockMailer(outbox = []) {
  return {
    outbox,
    async sendVerification({ to, verifyUrl }) {
      outbox.push({ to, verifyUrl });
      return { sent: true, code: "mock" };
    },
  };
}
