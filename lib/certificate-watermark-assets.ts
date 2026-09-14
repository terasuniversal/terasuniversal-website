/**
 * Canonical C4 watermark asset mapping.
 *
 * Both the React and standalone HTML certificate renderers consume this exact
 * resolver. Mapping is configuration-driven only; course-name conditionals are
 * deliberately not allowed here.
 */

export type WatermarkFamily =
  | "erector"
  | "inspector"
  | "working-at-height"
  | "professional";
export type WatermarkLevel = "basic" | "intermediate" | "advanced";

export interface WatermarkAssetConfig {
  design_variant?: string;
  watermark_level?: string;
  inspector_watermark_level?: string;
  wah_watermark?: boolean;
}

export interface CertificateWatermarkAsset {
  family: WatermarkFamily;
  level?: WatermarkLevel;
  src: string;
  /** Full front-page illustration opacity. */
  primaryOpacity: number;
  /** Back-page architectural placement opacity. */
  page2Opacity: number;
  /** Internal detail guidance retained as part of the shared contract. */
  secondaryOpacity: number;
}

const ASSET_ROOT = "/certificates/watermarks";

const LEVELS = new Set<WatermarkLevel>(["basic", "intermediate", "advanced"]);

function levelOf(value: unknown): WatermarkLevel | null {
  return typeof value === "string" && LEVELS.has(value as WatermarkLevel)
    ? value as WatermarkLevel
    : null;
}

function asset(
  family: WatermarkFamily,
  filename: string,
  level?: WatermarkLevel,
): CertificateWatermarkAsset {
  return {
    family,
    level,
    src: `${ASSET_ROOT}/${filename}`,
    primaryOpacity: 0.052,
    page2Opacity: 0.040,
    secondaryOpacity: 0.024,
  };
}

/**
 * Resolve the approved technical illustration for a certificate template.
 * Precedence is explicit and stable: Professional, WAH, Inspector, Erector.
 * When no approved mapping exists, return null rather than substituting a
 * visually incorrect family.
 */
export function resolveCertificateWatermarkAsset(
  config: WatermarkAssetConfig,
): CertificateWatermarkAsset | null {
  if (config.design_variant === "professional_scaffold_erection_skills") {
    return asset("professional", "professional-scaffold-programme.svg");
  }

  if (config.wah_watermark || config.design_variant === "working_at_height_certificate") {
    return asset("working-at-height", "working-at-height.svg");
  }

  const inspectorLevel = levelOf(config.inspector_watermark_level);
  if (inspectorLevel) {
    return asset("inspector", `inspector-${inspectorLevel}.svg`, inspectorLevel);
  }

  const erectorLevel = levelOf(config.watermark_level);
  if (erectorLevel) {
    return asset("erector", `erector-${erectorLevel}.svg`, erectorLevel);
  }

  return null;
}
