/**
 * Shared certificate-watermark geometry — the single source of truth
 * consumed by both the React print renderer (components/admin/CertificateDocument.tsx's
 * WatermarkLayer/CertificateWatermark) and the string/HTML ZIP renderer
 * (lib/certificate-html.ts's renderWatermarkSet/certificateWatermark). Both
 * call the geometry functions below and map the returned coordinates to
 * SVG elements themselves (JSX vs string) — the geometry itself is never
 * duplicated, only the thin per-renderer mapping is.
 *
 * Every family returns a LayeredWatermark: a `primary` shape set (the main
 * structural/conceptual motif — drawn heavier, more visible) and a
 * `secondary` shape set (supporting technical detail — drawn lighter, more
 * subtle). This is the "deliberate hierarchy" the premium refinement asked
 * for: the front-page placement renders both layers; the back-page corner
 * placement renders `primary` only, at a smaller scale, so it reads as a
 * genuinely partial/secondary mark rather than a second full copy of the
 * front watermark. All three families share the same viewBox 0 0 320 240
 * coordinate space so they drop into the same layout slot regardless of
 * which one a given template selects.
 *
 * Never a photo, never the TERAS logo -- pure line-art generated at render
 * time, no external image URL, no binary asset file.
 */

export type ScaffoldWatermarkLevel = "basic" | "intermediate" | "advanced";
export type InspectorWatermarkLevel = "basic" | "intermediate" | "advanced";

export interface WatermarkPrimitives {
  /** [x1, y1, x2, y2] straight lines. */
  lines: [number, number, number, number][];
  /** [x, y, width, height] rectangles. */
  rects: [number, number, number, number][];
  /** [cx, cy, r] circles. */
  circles: [number, number, number][];
}

export interface LayeredWatermark {
  /** Heavier stroke, higher opacity -- the main structural/conceptual motif. Shown on both front and back placements. */
  primary: WatermarkPrimitives;
  /** Lighter stroke, lower opacity -- supporting technical detail. Shown only on the front (full) placement, omitted from the smaller back-page corner mark. */
  secondary: WatermarkPrimitives;
}

function emptyPrimitives(): WatermarkPrimitives {
  return { lines: [], rects: [], circles: [] };
}

/**
 * Drafting grid drawn beneath every family's motif on the front placement, in
 * the same viewBox 0 0 320 240 space. Rendered at a lower opacity than either
 * motif layer, it supplies the "technical blueprint underlay" reading the
 * motifs alone can't: a lone line drawing floating in whitespace looks like
 * clipart, the same drawing over a faint drafting grid looks like a working
 * document. Family identity is unaffected — this sits behind the motif and is
 * identical for Erector, Inspector and Working at Height.
 */
export const BLUEPRINT_GRID: [number, number, number, number][] = [
  ...Array.from({ length: 17 }, (_, i): [number, number, number, number] => [i * 20, 0, i * 20, 240]),
  ...Array.from({ length: 13 }, (_, i): [number, number, number, number] => [0, i * 20, 320, i * 20]),
];

/** Corner registration crosses — the standard drafting-sheet alignment mark, drawn slightly stronger than the grid so the underlay reads as a real technical sheet rather than graph paper. */
export const REGISTRATION_TICKS: [number, number, number, number][] = [
  [6, 14, 22, 14], [14, 6, 14, 22],
  [298, 14, 314, 14], [306, 6, 306, 22],
  [6, 226, 22, 226], [14, 218, 14, 234],
  [298, 226, 314, 226], [306, 218, 306, 234],
];

/** A pair of parallel lines offset perpendicular to (x1,y1)-(x2,y2) by `gap` -- gives straps/standards visual width (a webbing/tube outline) instead of a single wire-thin stroke. */
function doubleLine(x1: number, y1: number, x2: number, y2: number, gap: number): [number, number, number, number][] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * gap;
  const ny = (dx / len) * gap;
  return [
    [x1 + nx, y1 + ny, x2 + nx, y2 + ny],
    [x1 - nx, y1 - ny, x2 - nx, y2 - ny],
  ];
}

/** A short row of diagonal hatch ticks inside [x, y, width, height] -- reads as a cut-plank/decking texture, the standard blueprint convention for a board surface. */
function hatchTicks(x: number, y: number, width: number, height: number, count: number): [number, number, number, number][] {
  const ticks: [number, number, number, number][] = [];
  const step = width / (count + 1);
  for (let i = 1; i <= count; i++) {
    const cx = x + i * step;
    ticks.push([cx - height * 0.4, y + height, cx + height * 0.4, y]);
  }
  return ticks;
}

/**
 * Scaffold Erector watermark -- an architectural elevation, not a stick
 * sketch: paired-line standards (steel tube outline), ledgers, base plates
 * and a symmetric zig-zag "K-brace" pattern form the `primary` structural
 * layer; junction coupler dots and board/hatch platform hints form the
 * lighter `secondary` annotation layer.
 *
 * basic: 2-bay elevation, 2 ledger levels, a single brace, one board hint --
 *   deliberately compact and simple.
 * intermediate: 4-bay elevation, 4 levels, a 3-step ascending K-brace
 *   zigzag, one board hint -- reads as a real working scaffold face.
 * advanced: 6-bay elevation, 5 levels, a symmetric mirrored K-brace
 *   ("gable") pattern meeting at the top centre, two board hints -- the
 *   most structurally complex, but the mirrored bracing keeps it visually
 *   ordered rather than dense/busy.
 */
export function scaffoldWatermarkLines(level: ScaffoldWatermarkLevel): LayeredWatermark {
  const primary: WatermarkPrimitives = emptyPrimitives();
  const secondary: WatermarkPrimitives = emptyPrimitives();
  const standardGap = 1.6;

  const build = (xs: number[], top: number, base: number, levels: number[], braces: [number, number, number, number][], boards: [number, number, number, number][], hatchCounts: number[]) => {
    for (const x of xs) {
      primary.lines.push(...doubleLine(x, top, x, base, standardGap));
      primary.rects.push([x - 5, base - 2, 10, 5]);
    }
    for (const y of levels) {
      primary.lines.push([xs[0] - 2, y, xs[xs.length - 1] + 2, y]);
    }
    primary.lines.push(...braces);
    for (const x of xs) {
      for (const y of levels) {
        secondary.circles.push([x, y, 1.6]);
      }
    }
    boards.forEach(([bx, by, bw, bh], i) => {
      secondary.rects.push([bx, by, bw, bh]);
      secondary.lines.push(...hatchTicks(bx, by, bw, bh, hatchCounts[i] ?? 4));
    });
  };

  switch (level) {
    case "basic": {
      const xs = [90, 160, 230];
      const levels = [150, 90];
      build(xs, 70, 210, levels, [[90, 150, 160, 90]], [[90, 86, 70, 5]], [4]);
      break;
    }
    case "advanced": {
      const xs = [10, 60, 110, 160, 210, 260, 310];
      const levels = [220, 170, 120, 70, 20];
      const braces: [number, number, number, number][] = [
        [10, 220, 60, 170],
        [110, 170, 60, 120],
        [110, 120, 160, 70],
        [310, 220, 260, 170],
        [210, 170, 260, 120],
        [210, 120, 160, 70],
      ];
      const boards: [number, number, number, number][] = [
        [60, 166, 150, 5],
        [110, 66, 100, 5],
      ];
      build(xs, 15, 225, levels, braces, boards, [10, 7]);
      break;
    }
    case "intermediate":
    default: {
      const xs = [20, 90, 160, 230, 300];
      const levels = [190, 140, 90, 40];
      const braces: [number, number, number, number][] = [
        [20, 190, 90, 140],
        [160, 140, 90, 90],
        [160, 90, 230, 40],
      ];
      const boards: [number, number, number, number][] = [[90, 136, 140, 5]];
      build(xs, 30, 215, levels, braces, boards, [8]);
      break;
    }
  }

  return { primary, secondary };
}

/**
 * Scaffold Inspector watermark -- an inspection technical drawing, not a
 * clipboard icon. The `primary` layer is a compact scaffold-node structure
 * with tagged connection-point markers (the actual subject of an
 * inspection); the `secondary` layer is a small fixed-size clipboard/
 * checklist and a subtle magnifier -- explicitly supporting chrome, not the
 * complexity driver.
 *
 * Complexity increases Basic -> Intermediate -> Advanced by widening the
 * *vocabulary* of inspection markers, not by inflating raw shape count:
 * basic uses only a plain check-tag; intermediate introduces a flag-tag
 * (a defect/attention marker); advanced adds a ring-tag (a critical/
 * escalated item marker) on top of both. The clipboard and magnifier are
 * identical across all three levels -- they are secondary in every sense.
 */
export function inspectorWatermarkShapes(level: InspectorWatermarkLevel): LayeredWatermark {
  const primary: WatermarkPrimitives = emptyPrimitives();
  const secondary: WatermarkPrimitives = emptyPrimitives();

  // Compact 2-bay / 2-level scaffold-node skeleton, single-weight lines
  // (lighter than the Erector family's paired-line standards -- this reads
  // as an inspection overlay/diagram, not physical steelwork).
  const xs = [40, 100, 160];
  const ys = [90, 170];
  for (const x of xs) primary.lines.push([x, 70, x, 190]);
  for (const y of ys) primary.lines.push([xs[0] - 2, y, xs[xs.length - 1] + 2, y]);

  type Tag = "check" | "flag" | "ring";
  const nodes: Record<string, [number, number]> = {
    P0: [40, 90], P1: [100, 90], P2: [160, 90],
    P3: [40, 170], P4: [100, 170], P5: [160, 170],
  };
  const tagsByLevel: Record<InspectorWatermarkLevel, Partial<Record<string, Tag>>> = {
    basic: { P1: "check", P4: "check" },
    intermediate: { P0: "check", P1: "check", P5: "check", P4: "flag" },
    advanced: { P0: "check", P1: "check", P5: "check", P2: "flag", P3: "flag", P4: "ring" },
  };

  for (const [key, tag] of Object.entries(tagsByLevel[level])) {
    const [cx, cy] = nodes[key];
    if (tag === "ring") {
      primary.circles.push([cx, cy, 2], [cx, cy, 4]);
      continue;
    }
    primary.circles.push([cx, cy, 1.8]);
    if (tag === "check") {
      primary.lines.push([cx + 4, cy, cx + 7, cy + 3], [cx + 7, cy + 3, cx + 13, cy - 4]);
    } else if (tag === "flag") {
      primary.lines.push([cx + 5, cy - 5, cx + 5, cy + 5], [cx + 5, cy - 5, cx + 12, cy - 1], [cx + 12, cy - 1, cx + 5, cy + 5]);
    }
  }

  // Secondary, fixed across all levels: a small clipboard + 3-row checklist
  // (top-right corner) and a subtle magnifier hovering near the structure.
  secondary.rects.push([228, 28, 58, 78], [248, 18, 20, 10]);
  const checklistYs = [50, 63, 76];
  for (const y of checklistYs) {
    secondary.lines.push([240, y, 274, y]);
    secondary.circles.push([234, y, 2.2]);
  }
  const magCenter: [number, number] = [222, 118];
  const magR = 15;
  secondary.circles.push([magCenter[0], magCenter[1], magR]);
  secondary.lines.push([magCenter[0] + magR * 0.65, magCenter[1] + magR * 0.65, magCenter[0] + magR * 1.25, magCenter[1] + magR * 1.25]);

  return { primary, secondary };
}

/**
 * Working at Height watermark -- a professional fall-protection schematic.
 * `primary` is the full-body harness itself (paired-line straps for visual
 * webbing width, ring hardware drawn as concentric circles) -- the element
 * that must read clearly on its own on the smaller back-page mark.
 * `secondary` is the twin-leg lanyard, anchorage beam and lifeline/shock
 * absorber -- the supporting fall-arrest system, shown only on the front.
 *
 * Unlike the two families above there is exactly one Working at Height
 * programme (see lib/working-at-height-programme.ts), so this takes no
 * level parameter -- one fixed, carefully proportioned motif.
 */
export function workingAtHeightWatermarkShapes(): LayeredWatermark {
  const primary: WatermarkPrimitives = emptyPrimitives();
  const secondary: WatermarkPrimitives = emptyPrimitives();

  const dorsal: [number, number] = [120, 50];
  const shoulderL: [number, number] = [85, 75];
  const shoulderR: [number, number] = [155, 75];
  const chest: [number, number] = [120, 115];
  const waistL: [number, number] = [95, 152];
  const waistR: [number, number] = [145, 152];
  const legL: [number, number] = [72, 215];
  const legR: [number, number] = [168, 215];
  const strapGap = 2.2;

  primary.lines.push(
    ...doubleLine(dorsal[0], dorsal[1], shoulderL[0], shoulderL[1], strapGap),
    ...doubleLine(dorsal[0], dorsal[1], shoulderR[0], shoulderR[1], strapGap),
    ...doubleLine(shoulderL[0], shoulderL[1], chest[0], chest[1], strapGap),
    ...doubleLine(shoulderR[0], shoulderR[1], chest[0], chest[1], strapGap),
    ...doubleLine(waistL[0], waistL[1], legL[0], legL[1], strapGap),
    ...doubleLine(waistR[0], waistR[1], legR[0], legR[1], strapGap)
  );
  primary.rects.push([78, 148, 84, 7]); // waist band
  // Ring hardware -- outer/inner concentric circles read as a D-ring, not a plain dot.
  for (const [cx, cy] of [dorsal, chest, legL, legR]) {
    primary.circles.push([cx, cy, 6], [cx, cy, 3]);
  }

  const hook1: [number, number] = [172, 28];
  const hook2: [number, number] = [228, 28];
  secondary.lines.push(
    [dorsal[0], dorsal[1], hook1[0], hook1[1]], // twin lanyard leg 1
    [dorsal[0], dorsal[1], hook2[0], hook2[1]], // twin lanyard leg 2
    [hook1[0], 22, hook1[0], hook1[1]], // beam -> hook 1 drop
    [hook2[0], 22, hook2[0], hook2[1]], // beam -> hook 2 drop
    [200, 22, 200, 145] // fall-arrest lifeline
  );
  secondary.rects.push(
    [55, 15, 210, 7], // anchorage beam
    [194, 75, 12, 20] // shock-absorber pack
  );
  secondary.circles.push([hook1[0], hook1[1], 3.5], [hook2[0], hook2[1], 3.5]);

  return { primary, secondary };
}
