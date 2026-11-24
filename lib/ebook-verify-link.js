import { EBOOK_TOKEN_PATTERN } from "./ebook-contract.js";

// W9-G3.1 verification-link transport (W9-EBOOK-RPC-CONTRACT v1.0 erratum v1.0.2, CRM ACK 24 Nov 2026). The token
// travels in the URL FRAGMENT (#t=…): browsers never send a fragment in an HTTP request or a Referer header, so the
// token never reaches server, proxy or Vercel request logs. A legacy query-string token (?t=…) is refused outright and
// never forwarded to verification: such a request has already been logged by the infrastructure, so the link is
// treated as unusable and the visitor is asked for a new one. Pure module: used by the server (link building) and the
// verify page (parsing); no storage, no logging.
export const EBOOK_VERIFY_PATH = "/ebook/verify";
export const EBOOK_RETURN_STATES = Object.freeze(["download_unusable", "download_unavailable"]);

export function ebookVerifyUrl(siteOrigin, token) {
  if (!EBOOK_TOKEN_PATTERN.test(String(token))) throw new Error("ebook verify link: token has the wrong shape");
  return `${siteOrigin}${EBOOK_VERIFY_PATH}#t=${token}`;
}

// Returns { token, state, legacy }: token only when the fragment carries a well-formed token AND no query token exists.
export function parseVerifyLink({ hash, search }) {
  const query = new URLSearchParams(search || "");
  const fragment = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const legacy = query.has("t");
  const state = query.get("state");
  const t = fragment.get("t");
  return {
    token: !legacy && t && EBOOK_TOKEN_PATTERN.test(t) ? t : null,
    state: state && EBOOK_RETURN_STATES.includes(state) ? state : null,
    legacy,
  };
}
