import "server-only";
import { createSupabaseServiceClient } from "./supabase/server";
import { getCurrentProfile, hasModuleAccess } from "./auth/session";
import { canViewCertificate } from "./auth/rbac";
import { isGoldenReferenceFamily } from "./certificate-design-system";
import type { CertificateRenderAssets } from "./certificate-approval-assets";
import type { TemplateConfig } from "../components/admin/CertificateDocument";
import {
  CERTIFICATE_RENDER_ASSETS_BUCKET,
  CertificateRenderAssetError,
  createRenderAssetLoader,
  pngDataUri,
  requiredRenderAssets,
  zipRenderAssetPath,
  type RenderAssetKey,
} from "./certificate-render-asset-policy";

export { CertificateRenderAssetError };

/**
 * The only service-role read of the private certificate-render-assets bucket.
 * The bucket has no Storage policies, so anon/authenticated clients cannot
 * reach it at all; this path reads fixed allowlisted object keys only, re-checks
 * the signed-in user itself (on top of each page's or route's own guard), and
 * never creates signed or public URLs.
 */
const loadVerifiedRenderAssets = createRenderAssetLoader({
  authorize: async () => {
    const profile = await getCurrentProfile();
    if (!profile || !profile.is_active || !canViewCertificate(profile.role)) return false;
    return hasModuleAccess("certificates");
  },
  download: async (objectPath) => {
    const { data, error } = await createSupabaseServiceClient().storage.from(CERTIFICATE_RENDER_ASSETS_BUCKET).download(objectPath);
    if (error || !data) throw new Error("render asset download failed");
    return new Uint8Array(await data.arrayBuffer());
  },
});

function needsFor(config: TemplateConfig) {
  return requiredRenderAssets({
    goldenReference: isGoldenReferenceFamily(config),
    designVariant: config.design_variant,
    signatureLayout: config.signature_layout,
    signatureReference: config.signature_url,
  });
}

async function load(config: TemplateConfig) {
  const needs = needsFor(config);
  const keys = [needs.signature, needs.seal].filter((k): k is RenderAssetKey => k !== null);
  return { needs, loaded: await loadVerifiedRenderAssets(keys) };
}

/** Admin PDF and preview pages: images embedded as data: URIs, no asset URL reaches the browser. */
export async function inlineCertificateRenderAssets(config: TemplateConfig): Promise<CertificateRenderAssets> {
  const { needs, loaded } = await load(config);
  return {
    mode: "resolved",
    signature: needs.signature ? pngDataUri(loaded.get(needs.signature)!.bytes) : null,
    seal: needs.seal ? pngDataUri(loaded.get(needs.seal)!.bytes) : null,
  };
}

/**
 * Bulk ZIP: each image is written once into `files` (ZIP-relative path ->
 * bytes) and every certificate references it, instead of repeating the bytes
 * inside each HTML document.
 */
export async function zipCertificateRenderAssets(config: TemplateConfig, files: Map<string, Uint8Array>): Promise<CertificateRenderAssets> {
  const { needs, loaded } = await load(config);
  const place = (key: RenderAssetKey | null) => {
    if (!key) return null;
    const asset = loaded.get(key)!;
    const path = zipRenderAssetPath(asset.sha256);
    files.set(path, asset.bytes);
    return path;
  };
  return { mode: "resolved", signature: place(needs.signature), seal: place(needs.seal) };
}
