import { ebookLeadSchema, fieldErrors } from "./validation/schemas.ts";
import { EBOOK_MARKETING_TEXT_VERSION, EBOOK_PRIVACY_ACK_VERSION } from "./ebook-lead.js";
import { EBOOK_RPC, EBOOK_TOKEN_PATTERN, parseRedeemResult, parseSubmitResult, parseVerifyResult } from "./ebook-contract.js";

// W9-G3 eBook request, verification and download logic (W9-EBOOK-RPC-CONTRACT v1.0), free of Next.js and Supabase
// imports so it can be tested with plain node:test. The route handlers check the launch switch first and inject:
//   checkDomain(email)            DNS filter (lib/email-dns.js); never proof of ownership
//   backend.callEbookRpc / backend.signEbookDownload   the server-only privileged module (lib/ebook-privileged.server.js)
//   mailer.sendVerification       Resend adapter (or a local mock); the CRM RPC has already reserved the shared quota
//   verifyUrlFor(token)           absolute link /ebook/verify#t=… (fragment, erratum v1.0.2: never sent to a server)
// Public responses never reveal whether an address or contact exists; logs carry short codes only (no name, phone,
// email, token or signed URL).
const MIN_FILL_TIME_MS = 2500;
const fail = (status, body) => ({ status, body });
const CHECK_EMAIL = { status: 202, body: { ok: true, status: "check_email" } };
const TRY_LATER = { status: 202, body: { ok: false, status: "try_later" } };
const UNAVAILABLE = { status: 503, body: { error: "temporarily_unavailable" } };
const UNUSABLE = { status: 200, body: { status: "link_unusable" } };

export async function processEbookRequest({ payload, origin, siteOrigin, clientKey, now = Date.now() }, { checkDomain, backend, mailer, verifyUrlFor, log = console.error }) {
  if (origin && origin !== siteOrigin) return fail(403, { error: "Invalid request origin." });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail(400, { error: "Invalid request." });
  // Honeypot: real visitors never fill it. Answer exactly like an accepted request so bots learn nothing.
  if (String(payload.website ?? "").trim()) return CHECK_EMAIL;
  if (payload.formStartedAt && now - Number(payload.formStartedAt) < MIN_FILL_TIME_MS) {
    return fail(400, { error: "Please take a moment to review the form before submitting." });
  }

  const parsed = ebookLeadSchema.safeParse({
    fullName: payload.fullName,
    phone: payload.phone,
    email: payload.email,
    privacyAck: payload.privacyAck,
    marketingEmailOptIn: payload.marketingEmailOptIn ?? false,
  });
  if (!parsed.success) return fail(400, { error: "Please check the highlighted fields.", errors: fieldErrors(parsed.error) });
  const data = parsed.data;

  const domain = await checkDomain(data.email);
  if (!domain.ok) return fail(400, { error: "Please check the highlighted fields.", errors: { email: "Please check your email address. We could not find a mail server for it." } });

  let rpc;
  try {
    rpc = await backend.callEbookRpc(EBOOK_RPC.submit, {
      p_full_name: data.fullName,
      p_phone_e164: data.phone,
      p_email: data.email,
      p_privacy_ack: true,
      p_privacy_ack_version: EBOOK_PRIVACY_ACK_VERSION,
      p_marketing_email_opt_in: data.marketingEmailOptIn,
      p_marketing_text_version: EBOOK_MARKETING_TEXT_VERSION,
      p_client_key: clientKey,
    });
  } catch (error) {
    log("ebook submit unavailable", { code: error?.code ?? "exception" });
    return UNAVAILABLE;
  }
  if (rpc.error) {
    if (rpc.error.message.includes("invalid_input")) return fail(400, { error: "Please check the highlighted fields." });
    log("ebook submit failed", { code: rpc.error.code });
    return UNAVAILABLE;
  }
  const result = parseSubmitResult(rpc.data);
  if (result.outcome === "contract_error") {
    log("ebook submit contract mismatch", { reason: result.reason });
    return UNAVAILABLE;
  }
  if (result.outcome === "rate_limited") return CHECK_EMAIL;
  if (result.outcome === "quota_exhausted") return TRY_LATER;

  const mail = await mailer.sendVerification({ to: data.email, verifyUrl: verifyUrlFor(result.verificationToken) });
  if (!mail.sent) {
    log("ebook verification email not sent", { code: mail.code });
    return TRY_LATER;
  }
  return CHECK_EMAIL;
}

export async function processEbookVerify({ token }, { backend, log = console.error }) {
  if (typeof token !== "string" || !EBOOK_TOKEN_PATTERN.test(token)) return UNUSABLE;
  let rpc;
  try {
    rpc = await backend.callEbookRpc(EBOOK_RPC.verify, { p_token: token });
  } catch (error) {
    log("ebook verify unavailable", { code: error?.code ?? "exception" });
    return UNAVAILABLE;
  }
  if (rpc.error) {
    log("ebook verify failed", { code: rpc.error.code });
    return UNAVAILABLE;
  }
  const result = parseVerifyResult(rpc.data);
  if (result.outcome === "contract_error") {
    log("ebook verify contract mismatch", { reason: result.reason });
    return UNAVAILABLE;
  }
  if (result.outcome !== "verified") return UNUSABLE;
  return { status: 200, body: { status: "verified", downloadToken: result.downloadToken } };
}

export async function processEbookDownload({ token }, { backend, log = console.error }) {
  if (typeof token !== "string" || !EBOOK_TOKEN_PATTERN.test(token)) return { kind: "unusable" };
  let rpc;
  try {
    rpc = await backend.callEbookRpc(EBOOK_RPC.redeem, { p_token: token });
  } catch (error) {
    log("ebook download unavailable", { code: error?.code ?? "exception" });
    return { kind: "unavailable" };
  }
  if (rpc.error) {
    log("ebook download failed", { code: rpc.error.code });
    return { kind: "unavailable" };
  }
  const result = parseRedeemResult(rpc.data);
  if (result.outcome === "contract_error") {
    log("ebook download contract mismatch", { reason: result.reason });
    return { kind: "unavailable" };
  }
  if (result.outcome !== "ok") return { kind: "unusable" };
  let signed;
  try {
    signed = await backend.signEbookDownload({ bucket: result.bucket, objectPath: result.objectPath });
  } catch (error) {
    log("ebook signing unavailable", { code: error?.code ?? "exception" });
    return { kind: "unavailable" };
  }
  if (!signed.url) {
    log("ebook signing failed", { code: "signing_empty" });
    return { kind: "unavailable" };
  }
  return { kind: "redirect", url: signed.url };
}
