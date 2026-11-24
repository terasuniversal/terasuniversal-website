// W9-EBOOK-RPC-CONTRACT v1.0 (frozen 24 Nov 2026; CRM + Website ACK). The Website side of the shared contract: RPC
// names, result codes, token shape and the exact publication allowlist. Every response must carry contract "v1.0";
// anything else (unknown outcome, missing field, wrong version) is a contract error and the Website fails closed.
// Changing any value here needs a new contract version agreed with CRM; do not edit it unilaterally.
export const EBOOK_CONTRACT_VERSION = "v1.0";

export const EBOOK_RPC = Object.freeze({
  submit: "submit_ebook_request",
  verify: "verify_ebook_email",
  redeem: "redeem_ebook_token",
});
export const EBOOK_RPC_ALLOWLIST = Object.freeze(Object.values(EBOOK_RPC));

// 32 random bytes, base64url without padding.
export const EBOOK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// The only object the Website will ever sign (ebook_publications, v1.0). Anything else returned is rejected.
export const EBOOK_PUBLICATION = Object.freeze({ bucket: "ebook-private", objectPath: "v1.5.1/teras-ebook-v1.5.1.pdf" });
export const EBOOK_SIGNED_URL_SECONDS = 60;

const OUTCOMES = {
  submit: ["accepted", "rate_limited", "quota_exhausted"],
  verify: ["verified", "invalid", "expired", "already_used"],
  redeem: ["ok", "invalid", "expired", "already_used"],
};

const contractError = (reason) => ({ outcome: "contract_error", reason });

function base(kind, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return contractError("not_object");
  if (data.contract !== EBOOK_CONTRACT_VERSION) return contractError("version");
  if (!OUTCOMES[kind].includes(data.outcome)) return contractError("outcome");
  return null;
}

export function parseSubmitResult(data) {
  const bad = base("submit", data);
  if (bad) return bad;
  if (data.outcome !== "accepted") return { outcome: data.outcome };
  if (typeof data.verification_token !== "string" || !EBOOK_TOKEN_PATTERN.test(data.verification_token)) return contractError("token");
  return { outcome: "accepted", verificationToken: data.verification_token, expiresAt: typeof data.expires_at === "string" ? data.expires_at : null };
}

export function parseVerifyResult(data) {
  const bad = base("verify", data);
  if (bad) return bad;
  if (data.outcome !== "verified") return { outcome: data.outcome };
  if (typeof data.download_token !== "string" || !EBOOK_TOKEN_PATTERN.test(data.download_token)) return contractError("token");
  return { outcome: "verified", downloadToken: data.download_token };
}

export function parseRedeemResult(data) {
  const bad = base("redeem", data);
  if (bad) return bad;
  if (data.outcome !== "ok") return { outcome: data.outcome };
  if (data.bucket !== EBOOK_PUBLICATION.bucket || data.object_path !== EBOOK_PUBLICATION.objectPath) return contractError("publication");
  return { outcome: "ok", bucket: data.bucket, objectPath: data.object_path };
}
