// W9-G3: the ONLY place the eBook flow uses the Supabase service role (D-5, W9-EBOOK-RPC-CONTRACT v1.0 §0). Server-only:
// it refuses to run in a browser, and route handlers import it, never client components (checked by
// scripts/w9g3-ebook-contract.mts and by a client-bundle scan in QA). Two capabilities, nothing else:
//   callEbookRpc(name, args)   one of the three contract RPCs (explicit allowlist), EXECUTE granted to service_role only
//   signEbookDownload(pub)     a 60-second signed URL for the single allowlisted publication object
// Before any privileged client is created, the Preview isolation guard must pass (validatePrivilegedSupabaseConfig):
// Production is allowed; Preview/Development only with the approved non-Production project; local only against a
// loopback Supabase URL. Any other state fails closed. Dependencies are injected so the logic is testable without
// Next.js, credentials or network.
import { EBOOK_PUBLICATION, EBOOK_RPC_ALLOWLIST, EBOOK_SIGNED_URL_SECONDS } from "./ebook-contract.js";

export class EbookPrivilegedUnavailable extends Error {
  constructor(code) {
    super("ebook privileged backend unavailable");
    this.name = "EbookPrivilegedUnavailable";
    this.code = code;
  }
}

/**
 * @param {{ validate: () => { ok: boolean, code?: string }, createClient: () => any }} deps
 */
export function makeEbookBackend({ validate, createClient }) {
  if (typeof window !== "undefined") throw new EbookPrivilegedUnavailable("browser");
  let client = null;
  const privileged = () => {
    const guard = validate();
    if (!guard || guard.ok !== true) throw new EbookPrivilegedUnavailable(guard?.code ?? "guard_failed");
    if (!client) client = createClient();
    return client;
  };

  return {
    async callEbookRpc(name, args) {
      if (!EBOOK_RPC_ALLOWLIST.includes(name)) throw new EbookPrivilegedUnavailable("rpc_not_allowlisted");
      const { data, error } = await privileged().rpc(name, args);
      if (error) return { data: null, error: { code: typeof error.code === "string" ? error.code : "unknown", message: String(error.message ?? "") } };
      return { data, error: null };
    },
    async signEbookDownload({ bucket, objectPath }) {
      if (bucket !== EBOOK_PUBLICATION.bucket || objectPath !== EBOOK_PUBLICATION.objectPath) {
        throw new EbookPrivilegedUnavailable("path_not_allowlisted");
      }
      const { data, error } = await privileged().storage.from(bucket).createSignedUrl(objectPath, EBOOK_SIGNED_URL_SECONDS);
      if (error || !data || typeof data.signedUrl !== "string") return { url: null };
      return { url: data.signedUrl };
    },
  };
}
