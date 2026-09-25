/**
 * Canonical C4 watermark asset mapping.
 *
 * Both React and standalone HTML certificate renderers consume this exact
 * resolver. Mapping is configuration-driven only; course-name conditionals are
 * deliberately not allowed here. Legacy level fields remain family selectors
 * for compatibility and do not select level-specific C4 artwork.
 */

export type WatermarkFamily =
  | "scaffolding"
  | "erector"
  | "inspector"
  | "working-at-height"
  | "confined-space"
  | "lifting-rigging"
  | "boiler"
  | "mechanical"
  | "electrical"
  | "fire-safety"
  | "general-safety";
export type WatermarkLevel = "basic" | "intermediate" | "advanced";

export interface WatermarkAssetConfig {
  design_variant?: string;
  watermark_level?: string;
  inspector_watermark_level?: string;
  wah_watermark?: boolean;
}

export interface CertificateWatermarkAsset {
  family: WatermarkFamily;
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
  page2Opacity = 0.040,
): CertificateWatermarkAsset {
  return {
    family,
    src: `${ASSET_ROOT}/${filename}`,
    primaryOpacity: 0.052,
    page2Opacity,
    secondaryOpacity: 0.024,
  };
}

/**
 * Resolve technical line-art from the existing template variant contract.
 * No participant/course row is changed: existing design_variant plus the
 * established legacy watermark selectors are the only inputs. Unmapped
 * variants intentionally receive the neutral TERAS industrial drawing.
 */
export function resolveCertificateWatermarkAsset(
  config: WatermarkAssetConfig,
): CertificateWatermarkAsset {
  if (
    config.wah_watermark ||
    config.design_variant === "working_at_height" ||
    config.design_variant === "working-at-height" ||
    config.design_variant === "working_at_height_certificate"
  ) {
    return asset("working-at-height", "working-at-height.svg", 0.024);
  }

  if (
    config.design_variant === "standard_scaffold_certificate" ||
    config.design_variant === "professional_scaffold_erection_skills" ||
    config.design_variant === "scaffolding" ||
    config.design_variant === "scaffolding_certificate" ||
    levelOf(config.inspector_watermark_level) ||
    levelOf(config.watermark_level)
  ) {
    return asset("scaffolding", "scaffolding-technical.svg", 0.024);
  }

  const familyAssetByVariant: Record<string, [WatermarkFamily, string, number?]> = {
    confined_space: ["confined-space", "confined-space.svg", 0.024],
    confined_space_certificate: ["confined-space", "confined-space.svg", 0.024],
    lifting_rigging: ["lifting-rigging", "lifting-rigging.svg", 0.024],
    lifting_rigging_certificate: ["lifting-rigging", "lifting-rigging.svg", 0.024],
    boiler: ["boiler", "boiler.svg", 0.024],
    boiler_certificate: ["boiler", "boiler.svg", 0.024],
    mechanical: ["mechanical", "mechanical.svg", 0.024],
    mechanical_certificate: ["mechanical", "mechanical.svg", 0.024],
    electrical: ["electrical", "electrical.svg", 0.024],
    electrical_certificate: ["electrical", "electrical.svg", 0.024],
    fire_safety: ["fire-safety", "fire-safety.svg", 0.024],
    fire_safety_certificate: ["fire-safety", "fire-safety.svg", 0.024],
    general_safety: ["general-safety", "general-industrial.svg", 0.024],
    general_safety_certificate: ["general-safety", "general-industrial.svg", 0.024],
  };
  const mapped = config.design_variant ? familyAssetByVariant[config.design_variant] : undefined;
  return mapped
    ? asset(mapped[0], mapped[1], mapped[2])
    : asset("general-safety", "general-industrial.svg");
}
