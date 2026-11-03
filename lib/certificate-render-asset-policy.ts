import { createHash } from "node:crypto";

/**
 * Policy for the private certificate render assets: which objects exist, their
 * pinned SHA-256, which one a certificate needs, and a loader that verifies
 * bytes before anything renders. No Next.js or Supabase imports, so contract
 * tests run it directly; lib/certificate-render-assets.ts supplies the real
 * authorization and Storage download.
 */

export const CERTIFICATE_RENDER_ASSETS_BUCKET = "certificate-render-assets";
// Matches the bucket's file_size_limit (migration 20261103073927).
export const MAX_RENDER_ASSET_BYTES = 1048576;

export type RenderAssetKey =
  | "director-signature-refined-v1"
  | "common-seal-3d-34mm-v1"
  | "director-signature-legacy-v1"
  | "director-signature-legacy-v2";

export interface RenderAssetEntry {
  objectPath: string;
  sha256: string;
}

// Object names are versioned and never overwritten: a new artwork is a new
// key, so a cached verified copy can never go stale.
export const RENDER_ASSETS: Readonly<Record<RenderAssetKey, RenderAssetEntry>> = {
  "director-signature-refined-v1": { objectPath: "signatures/director-signature-refined-v1.png", sha256: "b06af1cbbadb5401c6fb96643e7bc35e35d1d2f3539509b1c9cd8ea450098fbe" },
  "common-seal-3d-34mm-v1": { objectPath: "seals/common-seal-3d-34mm-v1.png", sha256: "8fae509193ecbdf0f58255ce7bef552d2d9ca32b76ae511f16e35abf7cda5208" },
  // Byte-identical private copies of the files the generic and Professional
  // layouts have always drawn, so those certificates do not change.
  "director-signature-legacy-v1": { objectPath: "signatures/director-signature-legacy-v1.png", sha256: "fe4c18bbd3f7473277334d14c7425f5a61cb4917b6744436f0831111e577b6f2" },
  "director-signature-legacy-v2": { objectPath: "signatures/director-signature-legacy-v2.png", sha256: "66bf4a5a2beecb0a0a1fee966bffb780319dc39b9ea0f8015d818f45165fa754" },
};

/**
 * signature_url values found in templates and frozen issuance snapshots
 * (certificate_issuance_snapshots.signature_reference). They are identifiers
 * only; the public files they once named are never fetched. Anything else
 * stops the render rather than becoming an <img> URL.
 */
export const SIGNATURE_REFERENCES: Readonly<Record<string, RenderAssetKey>> = {
  "/signatures/director-signature.png": "director-signature-legacy-v1",
  "/signatures/director-signature-v2.png": "director-signature-legacy-v2",
};

export type RenderAssetErrorCode = "unauthorized" | "unknown_reference" | "unavailable" | "integrity";

// Fixed wording: these messages reach pages, ZIP failure lists and audit
// records, so they never carry object paths, URLs or storage errors.
const ERROR_MESSAGES: Record<RenderAssetErrorCode, string> = {
  unauthorized: "Not authorised to load certificate signature assets",
  unknown_reference: "Certificate signature reference is not recognised",
  unavailable: "Certificate signature or seal could not be loaded",
  integrity: "Certificate signature or seal failed its integrity check",
};

export class CertificateRenderAssetError extends Error {
  readonly code: RenderAssetErrorCode;
  constructor(code: RenderAssetErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "CertificateRenderAssetError";
    this.code = code;
  }
}

export interface RenderAssetNeeds {
  signature: RenderAssetKey | null;
  seal: RenderAssetKey | null;
}

/**
 * Mirrors the renderers' own layout rules (CertificateDocument.tsx,
 * certificate-html.ts and the Professional Scaffold pair): Golden Reference
 * C4 pages always draw the refined signature and the seal; the generic layout
 * draws a signature for single-signatory variants or when one is configured;
 * Professional Scaffold always draws one.
 */
export function requiredRenderAssets(input: {
  goldenReference: boolean;
  designVariant?: string | null;
  signatureLayout?: string | null;
  signatureReference?: string | null;
}): RenderAssetNeeds {
  if (input.goldenReference) return { signature: "director-signature-refined-v1", seal: "common-seal-3d-34mm-v1" };
  const reference = (input.signatureReference ?? "").trim();
  if (reference) {
    if (!Object.hasOwn(SIGNATURE_REFERENCES, reference)) throw new CertificateRenderAssetError("unknown_reference");
    return { signature: SIGNATURE_REFERENCES[reference], seal: null };
  }
  const professional = input.designVariant === "professional_scaffold_erection_skills";
  const singleSignatory = input.signatureLayout === "single"
    || input.designVariant === "standard_scaffold_certificate"
    || input.designVariant === "working_at_height_certificate";
  return { signature: professional || singleSignatory ? "director-signature-legacy-v1" : null, seal: null };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface VerifiedRenderAsset {
  key: RenderAssetKey;
  sha256: string;
  bytes: Uint8Array;
}

export interface RenderAssetLoaderDeps {
  /** Re-checks the current user on every call; never cached. */
  authorize(): Promise<boolean>;
  download(objectPath: string): Promise<Uint8Array>;
  registry?: Readonly<Record<string, RenderAssetEntry>>;
}

export function createRenderAssetLoader(deps: RenderAssetLoaderDeps) {
  const registry = deps.registry ?? RENDER_ASSETS;
  // Only bytes that passed verification are kept, per server instance.
  const verified = new Map<string, Uint8Array>();

  return async function loadRenderAssets(keys: readonly RenderAssetKey[]): Promise<Map<RenderAssetKey, VerifiedRenderAsset>> {
    let allowed = false;
    try { allowed = await deps.authorize(); } catch { allowed = false; }
    if (!allowed) throw new CertificateRenderAssetError("unauthorized");

    const out = new Map<RenderAssetKey, VerifiedRenderAsset>();
    for (const key of new Set(keys)) {
      if (!Object.hasOwn(registry, key)) throw new CertificateRenderAssetError("unknown_reference");
      const entry = registry[key];
      let bytes = verified.get(key);
      if (!bytes) {
        let downloaded: Uint8Array;
        try { downloaded = await deps.download(entry.objectPath); } catch { throw new CertificateRenderAssetError("unavailable"); }
        const isPng = downloaded.length > PNG_MAGIC.length && PNG_MAGIC.every((b, i) => downloaded[i] === b);
        if (!isPng || downloaded.length > MAX_RENDER_ASSET_BYTES || sha256Hex(downloaded) !== entry.sha256) {
          throw new CertificateRenderAssetError("integrity");
        }
        bytes = downloaded;
        verified.set(key, bytes);
      }
      out.set(key, { key, sha256: entry.sha256, bytes });
    }
    return out;
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function pngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Path of a render asset inside the bulk ZIP, relative to the certificate HTML files. */
export function zipRenderAssetPath(sha256: string): string {
  return `assets/${sha256}.png`;
}
