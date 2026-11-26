/**
 * C4 Premium Hybrid design tokens shared by the React and standalone HTML
 * certificate renderers. These values describe presentation only; they do not
 * alter certificate data, provenance, or issuance contracts.
 */
export const CERTIFICATE_DESIGN = {
  page: { widthPx: 794, heightPx: 1123, safeMarginPx: 57, borderInsetPx: 13 },
  colors: { navy: "#0B3A63", gold: "#D4AF37", ink: "#333333", white: "#FFFFFF", muted: "#667085", line: "#D9E0E8" },
  typography: {
    sans: "'Poppins','Inter','Helvetica Neue',Arial,sans-serif",
    heading: "'Montserrat','Poppins','Inter','Helvetica Neue',Arial,sans-serif",
    participantNamePx: 40,
    certificateTitlePx: 25,
    courseNamePx: 20,
    bodyPx: 13,
    tablePx: 11,
    footerPx: 10,
  },
  watermark: { primaryOpacity: 0.052, secondaryOpacity: 0.024, backOpacity: 0.040 },
  qr: { sizePx: 106, minPrintMm: 28, maxPrintMm: 30 },
  signature: { widthPx: 190, wellHeightPx: 58, stampSizePx: 112, clearancePx: 30 },
} as const;

/**
 * Canonical certificate_title text for each Golden Reference family.
 * scaffoldingErector's string is already frozen, byte-for-byte, into real
 * issued certificates' render_payload.certificate_title by the live
 * app.capture_c4_wave1_erector_snapshot() trigger (re-verified read-only
 * against the canonical staging project, eokiaehnvzbggmacifcf, 2026-10-31)
 * -- never change that one value. The other three are this design's titles
 * for families that do not have a freeze trigger yet (see
 * GoldenReferenceFamily below).
 */
export const GOLDEN_REFERENCE_OWNER_TITLES = {
  scaffoldingErector: "SCAFFOLDING TRAINING CERTIFICATE",
  scaffoldingInspector: "SCAFFOLDING INSPECTION CERTIFICATE",
  workingAtHeight: "WORKING AT HEIGHT TRAINING CERTIFICATE",
  professionalScaffold: "PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME",
} as const;

/**
 * Family discriminator values read from a certificate's own frozen
 * issuance snapshot (certData.ts sets config.golden_reference_family from
 * render_payload.certificate_family verbatim, never recomputed). IMPORTANT:
 * "scaffold_erector" here is deliberately NOT spelled "scaffolding_erector"
 * the way an earlier, never-deployed draft of this file spelled it -- it is
 * written to match the exact string the live
 * app.capture_c4_wave1_erector_snapshot() trigger actually freezes on the
 * canonical staging project, confirmed by direct read-only inspection of
 * that function's source. Do not rename this value to match any other
 * convention; the frozen database fact is authoritative.
 * "scaffold_inspector" and "working_at_height" are now written by the same
 * trigger for Inspector and WAH issuances (live since 2026-11-01 and
 * 2026-11-02, re-verified read-only on Production 2026-11-03).
 * "professional_scaffold_erection_skills" is still this app's own proposed
 * value: no trigger writes it, so it stays inert until a real snapshot
 * carries it.
 */
export type GoldenReferenceFamily =
  | "scaffold_erector"
  | "scaffold_inspector"
  | "working_at_height"
  | "professional_scaffold_erection_skills";

/**
 * True only when the certificate's own frozen family+title (set by
 * certData.ts from an immutable issuance snapshot) matches the approved
 * Golden Reference contract for that family -- never computed from the
 * certificate's current, possibly-since-edited template/programme data.
 */
export function isGoldenReferenceFamily(config: {
  design_variant?: string;
  golden_reference_family?: GoldenReferenceFamily;
  certificate_title?: string;
}): boolean {
  const { design_variant: variant, golden_reference_family: family, certificate_title: title } = config;
  switch (family) {
    case "scaffold_erector":
      return variant === "standard_scaffold_certificate" && title === GOLDEN_REFERENCE_OWNER_TITLES.scaffoldingErector;
    case "scaffold_inspector":
      return variant === "standard_scaffold_certificate" && title === GOLDEN_REFERENCE_OWNER_TITLES.scaffoldingInspector;
    case "working_at_height":
      return variant === "working_at_height_certificate" && title === GOLDEN_REFERENCE_OWNER_TITLES.workingAtHeight;
    case "professional_scaffold_erection_skills":
      return variant === "professional_scaffold_erection_skills" && title === GOLDEN_REFERENCE_OWNER_TITLES.professionalScaffold;
    default:
      return false;
  }
}

export function certificateFamilyLabel(config: { design_variant?: string; inspector_watermark_level?: string; wah_watermark?: boolean; watermark_level?: string }): string {
  if (config.design_variant === "professional_scaffold_erection_skills") return GOLDEN_REFERENCE_OWNER_TITLES.professionalScaffold;
  if (config.wah_watermark || config.design_variant === "working_at_height_certificate") return "WORKING AT HEIGHT";
  if (config.inspector_watermark_level) return `SCAFFOLDING INSPECTOR — ${String(config.inspector_watermark_level).toUpperCase()}`;
  if (config.watermark_level) return `SCAFFOLDING ERECTOR — ${String(config.watermark_level).toUpperCase()}`;
  return "TERAS UNIVERSAL TRAINING CERTIFICATE";
}
