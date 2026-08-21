/**
 * Shared scaffold-watermark line geometry — the single source of truth
 * consumed by both the React print renderer (components/admin/CertificateDocument.tsx's
 * ScaffoldMotif) and the string/HTML ZIP renderer (lib/certificate-html.ts's
 * scaffoldMotif). Both call scaffoldWatermarkLines() and map the same
 * coordinates to <line> elements themselves (JSX vs string) — the geometry
 * itself is never duplicated, only the thin per-renderer mapping is.
 *
 * All three levels share the existing ScaffoldMotif's coordinate space
 * (viewBox 0 0 320 240, the same stroke-width/opacity/placement) so they
 * drop in as a same-sized replacement with no layout changes -- only the
 * line count/density differs per level, which is what reads as "simple" vs
 * "complex" at the ~3-5% opacity this renders at (config.watermark_level,
 * see TemplateConfig). Never a photo, never the TERAS logo -- pure line-art
 * generated at render time, no external image URL, no binary asset file.
 */

export type ScaffoldWatermarkLevel = "basic" | "intermediate" | "advanced";

export interface WatermarkLineSet {
  /** [x, yTop, yBottom] vertical pole lines. */
  verticals: [number, number, number][];
  /** [xStart, xEnd, y] horizontal ledger lines. */
  horizontals: [number, number, number][];
  /** [x1, y1, x2, y2] diagonal brace lines. */
  braces: [number, number, number, number][];
}

/**
 * basic: 1-2 bay scaffold, 2 poles, 2 ledger levels, a single brace --
 *   deliberately sparse, reads as "just starting out."
 * intermediate: unchanged from the pre-existing generic ScaffoldMotif
 *   geometry (5 poles, 4 ledger levels, partial cross-bracing) -- already
 *   reads as a real scaffold bay with visible cross-bracing, so it's kept
 *   byte-for-byte identical rather than redesigned.
 * advanced: wider (7 poles) and taller (5 ledger levels) than intermediate,
 *   with cross-bracing filling every bay/level cell -- denser and more
 *   complex, built from the same visual grammar (poles/ledgers/braces, same
 *   stroke style) so all three read as one TERAS visual family.
 */
export function scaffoldWatermarkLines(level: ScaffoldWatermarkLevel): WatermarkLineSet {
  switch (level) {
    case "basic":
      return {
        verticals: [
          [60, 200, 40],
          [150, 200, 40],
          [240, 200, 40],
        ],
        horizontals: [
          [60, 240, 60],
          [60, 240, 140],
        ],
        braces: [
          [60, 140, 150, 200],
          [150, 140, 240, 200],
        ],
      };

    case "advanced": {
      const xs = [10, 60, 110, 160, 210, 260, 310];
      const ys = [20, 70, 120, 170, 220];
      const verticals: [number, number, number][] = xs.map((x) => [x, 230, ys[0]]);
      const horizontals: [number, number, number][] = ys.map((y) => [xs[0], xs[xs.length - 1], y]);
      const braces: [number, number, number, number][] = [];
      for (let i = 0; i < xs.length - 1; i++) {
        for (let j = 0; j < ys.length - 1; j++) {
          const x1 = xs[i];
          const x2 = xs[i + 1];
          const y1 = ys[j];
          const y2 = ys[j + 1];
          braces.push([x1, y1, x2, y2], [x2, y1, x1, y2]);
        }
      }
      return { verticals, horizontals, braces };
    }

    case "intermediate":
    default:
      // Byte-for-byte identical to the existing generic ScaffoldMotif.
      return {
        verticals: [
          [20, 220, 10],
          [90, 220, 10],
          [160, 220, 10],
          [230, 220, 10],
          [300, 220, 10],
        ],
        horizontals: [
          [20, 300, 30],
          [20, 300, 90],
          [20, 300, 150],
          [20, 300, 210],
        ],
        braces: [
          [20, 30, 90, 90],
          [90, 30, 20, 90],
          [160, 90, 230, 150],
          [230, 90, 160, 150],
          [20, 150, 90, 210],
          [90, 150, 20, 210],
          [230, 30, 300, 90],
          [300, 30, 230, 90],
        ],
      };
  }
}
