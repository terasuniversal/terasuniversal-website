// W9-G3 email domain check (V-3, owner-approved). A DNS filter only: it never proves that a mailbox exists or belongs to
// the submitter (ownership is proven only by the email verification link). Server-side; the resolver is injected so the
// logic is testable without network access.
//
//   MX records present ................................. accept ("mx")
//   no MX, but A/AAAA present (implicit MX, RFC 5321 5.1) accept ("implicit_mx")
//   single null MX "0 ." (RFC 7505) .................... reject ("null_mx")
//   domain does not exist (NXDOMAIN) ................... reject ("nxdomain")
//   domain exists but has no MX/A/AAAA ................. reject ("no_mail_host")
//   timeout / SERVFAIL / refused / other error ......... accept ("transient"): verification is still mandatory, so a
//                                                         flaky resolver never blocks a genuine visitor
const NXDOMAIN = new Set(["ENOTFOUND", "NXDOMAIN"]);
const NODATA = new Set(["ENODATA"]);
const DOMAIN = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function lookup(resolver, method, domain, ms) {
  try {
    return { records: await withTimeout(resolver[method](domain), ms) };
  } catch (error) {
    const code = error && typeof error.code === "string" ? error.code : "";
    if (NXDOMAIN.has(code)) return { nxdomain: true };
    if (NODATA.has(code)) return { records: [] };
    return { transient: true };
  }
}

export function emailDomain(email) {
  const at = typeof email === "string" ? email.lastIndexOf("@") : -1;
  if (at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return DOMAIN.test(domain) ? domain : null;
}

/** @returns {Promise<{ ok: boolean, kind: string }>} */
export async function checkEmailDomain(email, { resolver, timeoutMs = 1500, cache } = {}) {
  const domain = emailDomain(email);
  if (!domain) return { ok: false, kind: "invalid_domain" };
  const hit = cache?.get(domain);
  if (hit && hit.until > Date.now()) return hit.result;

  let result;
  const mx = await lookup(resolver, "resolveMx", domain, timeoutMs);
  if (mx.transient) result = { ok: true, kind: "transient" };
  else if (mx.nxdomain) result = { ok: false, kind: "nxdomain" };
  else if (mx.records.length === 1 && Number(mx.records[0].priority) === 0 && ["", "."].includes(String(mx.records[0].exchange).trim())) {
    result = { ok: false, kind: "null_mx" };
  } else if (mx.records.some((r) => String(r.exchange).trim() !== "" && String(r.exchange).trim() !== ".")) {
    result = { ok: true, kind: "mx" };
  } else {
    const [a, aaaa] = await Promise.all([lookup(resolver, "resolve4", domain, timeoutMs), lookup(resolver, "resolve6", domain, timeoutMs)]);
    if (a.records?.length || aaaa.records?.length) result = { ok: true, kind: "implicit_mx" };
    else if (a.transient || aaaa.transient) result = { ok: true, kind: "transient" };
    else if (a.nxdomain && aaaa.nxdomain) result = { ok: false, kind: "nxdomain" };
    else result = { ok: false, kind: "no_mail_host" };
  }
  // Transient answers are not cached, so the next request asks DNS again.
  if (cache && result.kind !== "transient") cache.set(domain, { result, until: Date.now() + 10 * 60 * 1000 });
  return result;
}
