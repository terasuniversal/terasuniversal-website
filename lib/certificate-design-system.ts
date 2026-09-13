/**
 * C4 Premium Hybrid design tokens shared by the React and standalone HTML
 * certificate renderers. These values describe presentation only; they do not
 * alter certificate data, provenance, or issuance contracts.
 */
export const CERTIFICATE_DESIGN = {
  page: { widthPx: 794, heightPx: 1123, safeMarginPx: 57, borderInsetPx: 38 },
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
  watermark: { primaryOpacity: 0.034, secondaryOpacity: 0.018, backOpacity: 0.028 },
  qr: { sizePx: 106, minPrintMm: 28, maxPrintMm: 30 },
  signature: { widthPx: 190, wellHeightPx: 58, stampSizePx: 112, clearancePx: 30 },
} as const;

export function certificateFamilyLabel(config: { design_variant?: string; inspector_watermark_level?: string; wah_watermark?: boolean; watermark_level?: string }): string {
  if (config.design_variant === "professional_scaffold_erection_skills") return "PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME";
  if (config.wah_watermark || config.design_variant === "working_at_height_certificate") return "WORKING AT HEIGHT";
  if (config.inspector_watermark_level) return `SCAFFOLDING INSPECTOR — ${String(config.inspector_watermark_level).toUpperCase()}`;
  if (config.watermark_level) return `SCAFFOLDING ERECTOR — ${String(config.watermark_level).toUpperCase()}`;
  return "TERAS UNIVERSAL TRAINING CERTIFICATE";
}
