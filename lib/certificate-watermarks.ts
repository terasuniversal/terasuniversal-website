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

/**
 * Scaffold Inspector watermark family -- a distinct visual theme from the
 * Erector family above (inspection clipboard/checklist + magnifier + tagged
 * scaffold inspection points, not a pure pole/ledger/brace structure), used
 * so Inspector certificates read as visually related to but clearly
 * different from Erector ones. Same coordinate space (viewBox 0 0 320 240)
 * and consumption pattern: one shared geometry function, both the React and
 * HTML/ZIP renderers map the same shape lists themselves. Never a photo,
 * never the TERAS logo, no external image URL, no binary asset file.
 *
 * This is entirely additive -- ScaffoldWatermarkLevel/WatermarkLineSet/
 * scaffoldWatermarkLines above (the Erector geometry) are untouched.
 */
export type InspectorWatermarkLevel = "basic" | "intermediate" | "advanced";

export interface WatermarkShapeSet {
  /** [x1, y1, x2, y2] straight lines (checklist rows, magnifier handle/crosshair, scaffold poles/ledgers/braces). */
  lines: [number, number, number, number][];
  /** [x, y, width, height] rectangles (the clipboard body and its clip tab). */
  rects: [number, number, number, number][];
  /** [cx, cy, r] circles (checklist tick marks, the magnifier lens, tagged scaffold inspection points). */
  circles: [number, number, number][];
}

/**
 * basic: 3-row checklist, small magnifier, a minimal 2-pole scaffold detail
 *   with no tagged inspection points -- reads as "just getting started."
 * intermediate: 5-row checklist, a slightly larger magnifier, a 3-pole
 *   scaffold with 2 tagged inspection points (small circles at joints).
 * advanced: 7-row checklist, the largest magnifier with an internal
 *   crosshair (denser/more technical), and a 4-pole braced scaffold with 4
 *   tagged inspection points -- the densest of the three, same visual
 *   grammar (clipboard, checklist, magnifier, scaffold + tags) throughout so
 *   all three read as one TERAS family, distinct from the Erector family.
 */
export function inspectorWatermarkShapes(level: InspectorWatermarkLevel): WatermarkShapeSet {
  const clipboardBody: [number, number, number, number] = [95, 45, 90, 125];
  const clipboardTab: [number, number, number, number] = [125, 32, 30, 16];

  const checklistRows = level === "basic" ? 3 : level === "intermediate" ? 5 : 7;
  const checklistLines: [number, number, number, number][] = [];
  const checkCircles: [number, number, number][] = [];
  for (let i = 0; i < checklistRows; i++) {
    const y = 72 + i * 13;
    checklistLines.push([112, y, 172, y]);
    checkCircles.push([104, y, 3]);
  }

  const magnifierR = level === "basic" ? 20 : level === "intermediate" ? 25 : 30;
  const magCenter: [number, number] = level === "basic" ? [230, 170] : level === "intermediate" ? [235, 175] : [240, 180];
  const magLines: [number, number, number, number][] = [
    [
      magCenter[0] + magnifierR * 0.7,
      magCenter[1] + magnifierR * 0.7,
      magCenter[0] + magnifierR * 1.35,
      magCenter[1] + magnifierR * 1.35,
    ],
  ];
  if (level === "advanced") {
    magLines.push(
      [magCenter[0] - 10, magCenter[1], magCenter[0] + 10, magCenter[1]],
      [magCenter[0], magCenter[1] - 10, magCenter[0], magCenter[1] + 10]
    );
  }

  let scaffoldLines: [number, number, number, number][] = [];
  let scaffoldCircles: [number, number, number][] = [];
  if (level === "basic") {
    scaffoldLines = [
      [20, 220, 20, 140],
      [55, 220, 55, 140],
      [20, 180, 55, 180],
    ];
  } else if (level === "intermediate") {
    scaffoldLines = [
      [15, 220, 15, 120],
      [50, 220, 50, 120],
      [85, 220, 85, 120],
      [15, 150, 85, 150],
      [15, 190, 85, 190],
    ];
    scaffoldCircles = [
      [50, 150, 4],
      [85, 190, 4],
    ];
  } else {
    scaffoldLines = [
      [10, 225, 10, 100],
      [40, 225, 40, 100],
      [70, 225, 70, 100],
      [100, 225, 100, 100],
      [10, 135, 100, 135],
      [10, 175, 100, 175],
      [10, 215, 100, 215],
      [10, 135, 40, 175],
      [40, 135, 10, 175],
    ];
    scaffoldCircles = [
      [10, 135, 4],
      [70, 175, 4],
      [100, 215, 4],
      [40, 100, 4],
    ];
  }

  return {
    lines: [...checklistLines, ...magLines, ...scaffoldLines],
    rects: [clipboardBody, clipboardTab],
    circles: [...checkCircles, [magCenter[0], magCenter[1], magnifierR], ...scaffoldCircles],
  };
}

/**
 * Working at Height watermark -- a third, distinct visual theme from both
 * ScaffoldMotif and InspectorWatermark above (full-body harness silhouette +
 * twin-leg lanyard + overhead anchorage/fall-arrest line, not a pole/ledger
 * structure or a clipboard/magnifier), used so Working at Height certificates
 * read as visually related to but clearly different from either Scaffold
 * family. Same coordinate space (viewBox 0 0 320 240) and consumption
 * pattern as the two functions above: one shared geometry function, both the
 * React and HTML/ZIP renderers map the same shape lists themselves. Never a
 * photo, never the TERAS logo, no external image URL, no binary asset file,
 * and depicts only equipment in its normal worn/rigged state -- no fall,
 * no injury, no unsafe posture.
 *
 * Unlike scaffoldWatermarkLines/inspectorWatermarkShapes there is exactly one
 * Working at Height programme (see lib/working-at-height-programme.ts), so
 * this takes no level parameter -- one fixed density, not a 3-tier family.
 *
 * Harness (left of centre): shoulder straps converge at a dorsal/neck ring,
 * continue as torso straps to a chest D-ring, a waist band, and leg straps
 * ending in leg-loop rings -- the standard full-body-harness strap layout
 * read as a flat line-art schematic, not an anatomical illustration.
 * Lanyard + anchorage (right of centre, mirroring where InspectorWatermark
 * places its magnifier): twin lanyard legs run from the same dorsal ring up
 * to two separate hook connectors, each dropped from an overhead anchorage
 * beam with its own fixed anchorage device; a separate vertical line with a
 * small shock-absorber-pack rect represents the fall-arrest lifeline,
 * subtly distinct from the two lanyard legs.
 */
export function workingAtHeightWatermarkShapes(): WatermarkShapeSet {
  const dorsalRing: [number, number, number] = [120, 45, 5];
  const chestRing: [number, number, number] = [120, 110, 5];
  const legLoopL: [number, number, number] = [75, 210, 5];
  const legLoopR: [number, number, number] = [165, 210, 5];
  const hook1: [number, number, number] = [170, 25, 4];
  const hook2: [number, number, number] = [230, 25, 4];

  const harnessLines: [number, number, number, number][] = [
    [120, 45, 85, 70], // shoulder strap L (dorsal ring -> left shoulder)
    [120, 45, 155, 70], // shoulder strap R
    [85, 70, 120, 110], // torso strap L (shoulder -> chest ring)
    [155, 70, 120, 110], // torso strap R
    [95, 150, 75, 210], // leg strap L (waist -> leg loop L)
    [145, 150, 165, 210], // leg strap R (waist -> leg loop R)
  ];
  const waistBand: [number, number, number, number] = [80, 146, 80, 8];

  const lanyardLines: [number, number, number, number][] = [
    [120, 45, 170, 25], // twin lanyard leg 1 (dorsal ring -> hook 1)
    [120, 45, 230, 25], // twin lanyard leg 2 (dorsal ring -> hook 2)
    [60, 15, 280, 15], // overhead anchorage beam
    [170, 15, 170, 25], // connector drop, beam -> hook 1
    [230, 15, 230, 25], // connector drop, beam -> hook 2
    [200, 15, 200, 140], // fall-arrest vertical lifeline, separate from the lanyard legs
  ];
  const anchorageDevice: [number, number, number, number] = [145, 10, 20, 8];
  const shockAbsorberPack: [number, number, number, number] = [195, 70, 10, 18];

  return {
    lines: [...harnessLines, ...lanyardLines],
    rects: [waistBand, anchorageDevice, shockAbsorberPack],
    circles: [dorsalRing, chestRing, legLoopL, legLoopR, hook1, hook2],
  };
}
