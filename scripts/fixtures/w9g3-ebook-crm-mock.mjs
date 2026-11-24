// W9-G3 test fixture: an in-memory stand-in for the CRM side of W9-EBOOK-RPC-CONTRACT v1.0 (frozen). Synthetic data
// only; used by scripts/w9g3-ebook-flow.test.mts and by the local QA mock server. It models the contract semantics the
// Website depends on (single-use hashed tokens, supersede on re-request, expiry, quota, dedup, opt-out preservation,
// no overwrite before verification). The real implementation is CRM's (migrations + Docker tests); this is not it.
import { createHash, randomBytes } from "node:crypto";

const V = "v1.0";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const tok = () => randomBytes(32).toString("base64url");

export function makeEbookCrmMock({ now = () => Date.now(), ebookDailyQuota = 25 } = {}) {
  const contacts = [];
  const requests = [];
  const verifyTokens = new Map(); // hash -> { contactId, requestId, expiresAt, consumedAt, supersededAt }
  const downloadTokens = new Map();
  const events = [];
  const counts = { ebook: 0, client: new Map(), email: new Map() };
  let id = 0;
  const nextId = (p) => `${p}-${++id}`;
  const expired = (t) => t.expiresAt <= now();

  function submit(a) {
    const email = String(a.p_email).trim().toLowerCase();
    if (a.p_privacy_ack !== true || a.p_privacy_ack_version !== "ebook-privacy-ack-v2" || a.p_marketing_text_version !== "ebook-marketing-email-v1"
      || !/^[+]60[1-9][0-9]{7,9}$/.test(a.p_phone_e164) || String(a.p_full_name).trim().length < 2) {
      return { error: { code: "P0001", message: "invalid_input" } };
    }
    const c = (counts.client.get(a.p_client_key) ?? 0) + 1; counts.client.set(a.p_client_key, c);
    const e = (counts.email.get(email) ?? 0) + 1; counts.email.set(email, e);
    if (c > 10 || e > 3) return { data: { contract: V, outcome: "rate_limited" } };
    let contact = contacts.find((x) => x.email === email);
    const byPhone = contacts.find((x) => x.phone_e164 === a.p_phone_e164);
    let created = false;
    if (contact && byPhone && byPhone.id !== contact.id) events.push({ type: "ebook_contact_conflict", other: byPhone.id });
    if (!contact) {
      contact = { id: nextId("c"), email, full_name: a.p_full_name, phone_e164: a.p_phone_e164, consent_status: "not_set", email_verification_status: "unverified", phone_ownership_status: "unverified", possible_duplicate_of: byPhone ? byPhone.id : null };
      contacts.push(contact);
      created = true;
    }
    if (contact.consent_status === "opted_out" && a.p_marketing_email_opt_in) events.push({ type: "ebook_opted_out_requested", contact: contact.id });
    const request = { id: nextId("r"), contactId: contact.id, submitted: { full_name: a.p_full_name, phone_e164: a.p_phone_e164, email }, optIn: a.p_marketing_email_opt_in, createdContact: created, status: "pending" };
    requests.push(request);
    events.push({ type: "ebook_requested", request: request.id });
    if (counts.ebook >= ebookDailyQuota) return { data: { contract: V, outcome: "quota_exhausted" } };
    counts.ebook += 1;
    for (const t of verifyTokens.values()) if (t.contactId === contact.id && !t.consumedAt && !t.supersededAt) t.supersededAt = now();
    const raw = tok();
    verifyTokens.set(sha(raw), { contactId: contact.id, requestId: request.id, expiresAt: now() + 60 * 60 * 1000, consumedAt: null, supersededAt: null });
    return { data: { contract: V, outcome: "accepted", verification_token: raw, expires_at: new Date(now() + 3600e3).toISOString() } };
  }

  function verify(a) {
    const t = verifyTokens.get(sha(String(a.p_token)));
    if (!t || t.supersededAt) return { data: { contract: V, outcome: "invalid" } };
    if (t.consumedAt) return { data: { contract: V, outcome: "already_used" } };
    if (expired(t)) return { data: { contract: V, outcome: "expired" } };
    t.consumedAt = now();
    const request = requests.find((r) => r.id === t.requestId);
    const contact = contacts.find((c) => c.id === t.contactId);
    request.status = "verified";
    if (request.createdContact || contact.email === request.submitted.email) {
      contact.email_verification_status = "verified";
      for (const k of ["full_name", "phone_e164"]) if (!contact[k]) contact[k] = request.submitted[k];
      if (request.optIn && contact.consent_status !== "opted_out") contact.consent_status = "opted_in";
    }
    const raw = tok();
    downloadTokens.set(sha(raw), { expiresAt: now() + 15 * 60 * 1000, consumedAt: null });
    events.push({ type: "ebook_email_verified", contact: contact.id });
    return { data: { contract: V, outcome: "verified", download_token: raw, expires_at: new Date(now() + 900e3).toISOString() } };
  }

  function redeem(a) {
    const t = downloadTokens.get(sha(String(a.p_token)));
    if (!t) return { data: { contract: V, outcome: "invalid" } };
    if (t.consumedAt) return { data: { contract: V, outcome: "already_used" } };
    if (expired(t)) return { data: { contract: V, outcome: "expired" } };
    t.consumedAt = now();
    events.push({ type: "ebook_downloaded" });
    return { data: { contract: V, outcome: "ok", bucket: "ebook-private", object_path: "v1.5.1/teras-ebook-v1.5.1.pdf" } };
  }

  return {
    state: { contacts, requests, verifyTokens, downloadTokens, events, counts },
    rpc(name, args) {
      if (name === "submit_ebook_request") return submit(args);
      if (name === "verify_ebook_email") return verify(args);
      if (name === "redeem_ebook_token") return redeem(args);
      return { error: { code: "PGRST202", message: "function not found" } };
    },
    sign(bucket, path, seconds) {
      return { data: { signedUrl: `https://storage.invalid/object/sign/${bucket}/${path}?token=synthetic&expires=${seconds}` }, error: null };
    },
  };
}
