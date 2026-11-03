/** Shared C5 approval assets and the non-legal printed emboss guide. */

/**
 * Image sources for the Director signature and Common Seal, resolved on the
 * server by lib/certificate-render-assets.ts after its authorization and
 * SHA-256 checks: data: URIs for admin pages, ZIP-relative paths for the bulk
 * download. Never a public URL. "preview" is the template editor's live
 * preview, which runs in the browser and so must not receive either image.
 */
export type CertificateRenderAssets =
  | { mode: "resolved"; signature: string | null; seal: string | null }
  | { mode: "preview" };

export const RENDER_ASSET_PREVIEW_LABEL = "Signature on issued certificate";

/**
 * Renderers call this instead of reading data.render_assets directly, so a
 * caller that forgot to resolve assets, or resolved fewer than the layout
 * needs, fails loudly rather than printing an unsigned certificate.
 */
export function renderAssetSources(
  assets: CertificateRenderAssets | undefined,
  need: { signature: boolean; seal: boolean },
): { preview: boolean; signature: string | null; seal: string | null } {
  if (!assets) throw new Error("Certificate render assets were not resolved");
  if (assets.mode === "preview") return { preview: true, signature: null, seal: null };
  if ((need.signature && !assets.signature) || (need.seal && !assets.seal)) throw new Error("Certificate render assets are incomplete");
  return { preview: false, signature: assets.signature, seal: assets.seal };
}

// C4 Director signature: fills the existing 68px signature well (was capped at
// 62px), about 10% larger, as in the owner-approved premium preview. The well,
// its rule and everything below keep their positions.
export const C4_SIGNATURE_MAX_HEIGHT_PX = 68;

// Approved 34mm premium Common Seal. The PNG canvas includes its drop shadow,
// so the image box is wider than the seal disc by this ratio (2356px canvas
// over a 2212.8px disc in the approved artwork).
export const COMMON_SEAL_DIAMETER_MM = 34;
export const COMMON_SEAL_CANVAS_RATIO = 2356 / 2212.8;
// 34mm on the 96dpi A4 CSS canvas, times the shadow ratio ≈ 136.8px. Centred
// on the 108px reserved stamp box, which keeps its size so nothing moves.
export const COMMON_SEAL_IMAGE_PX = Math.round((COMMON_SEAL_DIAMETER_MM / 25.4) * 96 * COMMON_SEAL_CANVAS_RATIO * 100) / 100;

// 42mm on the existing 794px A4 CSS canvas (794 / 210 * 42 ≈ 159px).
// This is only a decorative/alignment guide for the manually applied 38mm
// blind emboss; it is not legal seal artwork.
export const EMBOSS_MEDALLION_SIZE_PX = 159;
export const EMBOSS_MEDALLION_PHYSICAL_MM = 42;
// Approximately 3.4mm upward on the same A4 CSS canvas.
export const EMBOSS_MEDALLION_LIFT_PX = 13;
