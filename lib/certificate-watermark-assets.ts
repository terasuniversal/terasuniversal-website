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
  | "professional"
  | "legacy-scaffolding";
export type WatermarkLevel = "basic" | "intermediate" | "advanced";

export interface WatermarkAssetConfig {
  design_variant?: string;
  watermark_level?: string;
  inspector_watermark_level?: string;
  wah_watermark?: boolean;
  /**
   * A frozen render_payload.watermark_asset_family value from an immutable
   * certificate_issuance_snapshots row -- e.g. the live
   * app.capture_c4_wave1_erector_snapshot() trigger writes
   * 'scaffolding-technical' for already-issued Erector certificates. When
   * present and recognized, takes precedence over every field below: a
   * historical fact about an already-issued certificate must never be
   * recomputed against this resolver's current, newer per-level mapping
   * (that would silently restyle an issued certificate). An unrecognized
   * value falls through to normal resolution rather than failing closed --
   * watermark choice is decorative, not a verification-critical fact.
   */
  frozen_watermark_asset_family?: string | null;
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

export function levelOf(value: unknown): WatermarkLevel | null {
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
 * Placement for the Inspector illustration on Golden Reference certificates,
 * shared by the React and HTML renderers. At the generic full-page size the
 * scaffold drawing sat directly behind the holder name and programme columns.
 * Instead, the artwork is fitted into open space: page 1 in the band
 * between Training Venue and the signature row,
 * page 2 under Assessment Method, clear of the Skills Record, text columns
 * and QR. Golden Reference Inspector certificates use the approved ImageGen
 * artwork, extracted to transparent navy line-art PNGs: the inspector scene
 * on page 1 and the checklist/scaffold detail (no figure) on page 2, the
 * same for every level. Each PNG's own pixel aspect is fitted into its area.
 * Legacy Inspector layouts keep inspector-<level>.svg at their existing
 * placement.
 */
const INSPECTOR_GOLDEN_AREAS = {
  pageOne: { src: "inspector-scene.png", aspect: 970 / 850, centerX: 397, top: 600, maxW: 420, maxH: 225, opacity: 0.14 },
  pageTwo: { src: "inspector-detail.png", aspect: 505 / 610, centerX: 632, top: 600, maxW: 195, maxH: 200, opacity: 0.14 },
} as const;

export function inspectorGoldenWatermarkBox(level: WatermarkLevel | undefined, page: keyof typeof INSPECTOR_GOLDEN_AREAS) {
  if (!level) return null;
  const a = INSPECTOR_GOLDEN_AREAS[page];
  const width = Math.min(a.maxW, a.maxH * a.aspect);
  const height = width / a.aspect;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    src: `${ASSET_ROOT}/${a.src}`,
    left: round(a.centerX - width / 2),
    top: round(a.top + (a.maxH - height) / 2),
    width: round(width),
    height: round(height),
    opacity: a.opacity,
  };
}

/**
 * Working at Height Golden Reference placement, fitted into the same open
 * areas as Inspector. Owner visually approved 2026-11-02; independent safety verification is not established.
 * Issued certificates load these files at render time, so never replace them in place. working-at-height.svg stays with
 * legacy WAH certificates and is never used here.
 */
const WAH_GOLDEN_AREAS = {
  pageOne: { src: "wah-scene.png", aspect: 970 / 850, centerX: 397, top: 640, maxW: 420, maxH: 190, opacity: 0.14 },
  pageTwo: { src: "wah-detail.png", aspect: 505 / 610, centerX: 632, top: 625, maxW: 195, maxH: 200, opacity: 0.14 },
} as const;

export function wahGoldenWatermarkBox(page: keyof typeof WAH_GOLDEN_AREAS) {
  const a = WAH_GOLDEN_AREAS[page];
  const width = Math.min(a.maxW, a.maxH * a.aspect);
  const height = width / a.aspect;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    src: `${ASSET_ROOT}/${a.src}`,
    left: round(a.centerX - width / 2),
    top: round(a.top + (a.maxH - height) / 2),
    width: round(width),
    height: round(height),
    opacity: a.opacity,
  };
}

/**
 * Legacy frozen watermark families already baked into real, immutable
 * issuance snapshots before this resolver's current per-level naming
 * existed. Only 'scaffolding-technical' is confirmed real today (the live
 * Erector Wave1A trigger). The asset file itself is unchanged -- still the
 * original generic scaffolding illustration, not remapped to a newer
 * per-level file.
 */
const LEGACY_FROZEN_WATERMARK_ASSETS: Partial<Record<string, CertificateWatermarkAsset>> = {
  "scaffolding-technical": asset("legacy-scaffolding", "scaffolding-technical.svg"),
};

/**
 * Resolve the approved technical illustration for a certificate template.
 * A frozen historical fact (frozen_watermark_asset_family) always wins first.
 * Otherwise precedence is explicit and stable: Professional, WAH, Inspector,
 * Erector. When no approved mapping exists, return null rather than
 * substituting a visually incorrect family.
 */
export function resolveCertificateWatermarkAsset(
  config: WatermarkAssetConfig,
): CertificateWatermarkAsset | null {
  if (config.frozen_watermark_asset_family) {
    const legacy = LEGACY_FROZEN_WATERMARK_ASSETS[config.frozen_watermark_asset_family];
    if (legacy) return legacy;
  }

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
