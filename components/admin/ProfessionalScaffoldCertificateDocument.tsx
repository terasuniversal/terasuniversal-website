import type { CSSProperties, ReactNode } from "react";
import type { CertData, TemplateConfig } from "./CertificateDocument";
import { fitHolderNameSize, formatDateRange, formatHumanDate, isAffirmativeStatus } from "../../lib/certificate-format";
import { TEMPLATE_A_CREST_SRC } from "../../lib/template-a-crest";
import { TEMPLATE_A_LOGO_SRC } from "../../lib/template-a-logo";

/**
 * Dedicated 2-page renderer for the TERAS Professional Scaffold Erection
 * Skills Programme certificate — routed by `config.design_variant ===
 * "professional_scaffold_erection_skills"` (see CertificateRenderer.tsx),
 * never by course-name matching. The generic CertificateDocument/
 * CertificateBackPage remain untouched for every other template; this file
 * exists because that generic, fully config-driven layout was judged too
 * constrained to reproduce the approved reference design (thin single-line
 * frame, 3-signature block, compact back page) — see the design-approval
 * thread for the reference image this file targets.
 *
 * Mirrored, string-for-string in structure, by
 * lib/professional-scaffold-certificate-html.ts for the bulk ZIP download
 * path — keep both in sync.
 */

const PAGE_W = "210mm";
const PAGE_H = "297mm";
const REG_NO = "202201038223 (1477529-X)";
const PAD = 34; // ~9mm safe print margin, matches the generic renderer's own convention
// Approved handwritten Director signature (Muhammad Azri Bin Mohd Latifi Amir)
// cropped from the approved reference photo — used whenever the template's
// config.signature_url is unset, so the signature renders without any
// database/template binding change.
const DEFAULT_SIGNATURE_URL = "/signatures/director-signature.png";

const DEFAULT_BODY_TEXT =
  "This programme focuses on developing practical scaffolding skills, safe work practices and industry best practices through structured theoretical and hands-on practical training.";
const DEFAULT_OBJECTIVES =
  "This programme is designed to develop participants' practical scaffolding erection and dismantling skills, safety awareness and hazard identification capability through structured theoretical instruction and hands-on practical training, in accordance with industry best practices.";
const DEFAULT_COVERAGE = [
  "Introduction to Scaffolding", "Scaffold Components Identification", "Safe Scaffold Erection",
  "Safe Scaffold Dismantling", "Working at Height Safety", "Hazard Identification",
  "Practical Installation Techniques", "Basic Inspection Awareness", "Practical Skills Assessment", "Industry Best Practices",
];
const DEFAULT_OUTCOMES = [
  "Identify scaffolding components correctly", "Apply safe scaffold erection procedures",
  "Demonstrate proper dismantling techniques", "Recognise workplace hazards",
  "Perform work using appropriate PPE", "Apply safe working practices during scaffold activities",
];
const DEFAULT_ASSESSMENT = ["Attendance", "Theory Learning", "Practical Assessment", "Trainer Observation"];
const DEFAULT_SKILLS_RECORD = [
  { area: "Theory Session", status: "Not Recorded" },
  { area: "Practical Training", status: "Not Recorded" },
  { area: "Safety Awareness", status: "Not Recorded" },
  { area: "Practical Assessment", status: "Not Recorded" },
  { area: "Attendance Requirement", status: "Not Recorded" },
];
const DEFAULT_NOTICE_PARAGRAPHS = [
  "This certificate acknowledges the successful completion of the TERAS Professional Scaffold Erection Skills Programme conducted by Teras Universal Sdn. Bhd.",
  "It records participation in a structured skills development programme and practical assessment.",
  "It does not represent or replace any competency certification or licence that may be required under applicable laws, regulations or project-specific requirements.",
  "Participants are encouraged to attend periodic Skills Update Programmes as part of continuous professional development.",
];

/** Layered navy/gold triangular wedge anchored to a corner — a gradient navy base (for depth rather than a flat fill) with a smaller gold inner triangle and a double gold edge trim (a bright hairline plus a softer inner echo) along the hypotenuse, so the wedge reads as machined metal rather than a flat paper cutout. */
function CornerWedge({ corner, navy, gold }: { corner: "tl" | "tr" | "bl" | "br"; navy: string; gold: string }) {
  const size = 168;
  const pos: Record<string, CSSProperties> = {
    tl: { top: -2, left: -2 },
    tr: { top: -2, right: -2 },
    bl: { bottom: -2, left: -2 },
    br: { bottom: -2, right: -2 },
  };
  const clip: Record<string, string> = {
    tl: "polygon(0 0, 100% 0, 0 100%)",
    tr: "polygon(0 0, 100% 0, 100% 100%)",
    bl: "polygon(0 0, 100% 100%, 0 100%)",
    br: "polygon(100% 0, 100% 100%, 0 100%)",
  };
  const gradientAngle: Record<string, string> = { tl: "135deg", tr: "225deg", bl: "45deg", br: "315deg" };
  const inner: Record<string, CSSProperties> = {
    tl: { top: size * 0.26, left: size * 0.26 },
    tr: { top: size * 0.26, right: size * 0.26 },
    bl: { bottom: size * 0.26, left: size * 0.26 },
    br: { bottom: size * 0.26, right: size * 0.26 },
  };
  const edge: Record<string, CSSProperties> = {
    tl: { top: size * 0.62, left: -2, width: size * 0.62, height: 3, transform: "rotate(-45deg)", transformOrigin: "left center" },
    tr: { top: size * 0.62, right: -2, width: size * 0.62, height: 3, transform: "rotate(45deg)", transformOrigin: "right center" },
    bl: { bottom: size * 0.62, left: -2, width: size * 0.62, height: 3, transform: "rotate(45deg)", transformOrigin: "left center" },
    br: { bottom: size * 0.62, right: -2, width: size * 0.62, height: 3, transform: "rotate(-45deg)", transformOrigin: "right center" },
  };
  const edgeInner: Record<string, CSSProperties> = {
    tl: { top: size * 0.62 + 5, left: -2, width: size * 0.58, height: 1.4, transform: "rotate(-45deg)", transformOrigin: "left center", opacity: 0.55 },
    tr: { top: size * 0.62 + 5, right: -2, width: size * 0.58, height: 1.4, transform: "rotate(45deg)", transformOrigin: "right center", opacity: 0.55 },
    bl: { bottom: size * 0.62 + 5, left: -2, width: size * 0.58, height: 1.4, transform: "rotate(45deg)", transformOrigin: "left center", opacity: 0.55 },
    br: { bottom: size * 0.62 + 5, right: -2, width: size * 0.58, height: 1.4, transform: "rotate(-45deg)", transformOrigin: "right center", opacity: 0.55 },
  };
  return (
    <>
      <div style={{ position: "absolute", width: size, height: size, background: `linear-gradient(${gradientAngle[corner]}, ${navy} 55%, #0A2C4D 100%)`, clipPath: clip[corner], ...pos[corner] }} />
      <div style={{ position: "absolute", width: size * 0.56, height: size * 0.56, background: `linear-gradient(${gradientAngle[corner]}, ${gold} 60%, #B8912A 100%)`, clipPath: clip[corner], ...inner[corner] }} />
      <div style={{ position: "absolute", background: gold, ...edge[corner] }} />
      <div style={{ position: "absolute", background: gold, ...edgeInner[corner] }} />
    </>
  );
}

/**
 * Layered navy/gold rule around the full page — a crisp outer gold hairline,
 * a substantial navy band, a double gold mid-rule and two fine inner lines so
 * the frame reads as a single deep, machined border rather than one thin line.
 */
function OuterFrame({ navy, gold }: { navy: string; gold: string }) {
  return (
    <>
      <div style={{ position: "absolute", inset: 2, border: `1px solid ${gold}`, opacity: 0.35, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 3, border: `1px solid ${gold}`, opacity: 0.9, pointerEvents: "none" }} />
      {/* Bevelled navy band — a bright top/left inner highlight and a dark bottom/right inner shadow so the band reads as a machined, three-dimensional rail rather than a flat colour fill. */}
      <div style={{ position: "absolute", inset: 5, border: `6px solid ${navy}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,.18), inset 0 -1px 0 rgba(0,0,0,.28)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 11, border: `1px solid ${gold}`, opacity: 0.5, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 13, border: `2.5px solid ${gold}`, boxShadow: `0 0 5px ${gold}66`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 17.5, border: `1px solid ${navy}`, opacity: 0.85, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 21.5, border: `1px solid ${gold}`, opacity: 0.65, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 25.5, border: `1px solid ${gold}`, opacity: 0.9, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 28.5, border: `1px solid ${navy}`, opacity: 0.3, pointerEvents: "none" }} />
    </>
  );
}

/**
 * Very low-strength radial tint top and bottom of the page — the "less flat"
 * finishing layer. Pure background colour, position: absolute and outside
 * document flow, so it never affects either page's tightly-tuned content
 * height. Kept under 8% opacity so it reads as paper depth, not shading.
 */
function PageVignette({ navy }: { navy: string }) {
  return (
    <div
      style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse 100% 30% at 50% 0%, ${navy}0D, transparent 60%), radial-gradient(ellipse 100% 30% at 50% 100%, ${navy}12, transparent 55%)`,
      }}
    />
  );
}

/**
 * Full-page industrial texture — a faint blueprint grid with a diagonal hatch
 * overlay, drawn in the primary colour at ~5% strength so it reads as a
 * premium engineered paper finish without competing with the certificate text.
 */
function PageTexture({ color }: { color: string }) {
  return (
    <div
      style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage:
          `linear-gradient(${color} 1px, transparent 1px),` +
          `linear-gradient(90deg, ${color} 1px, transparent 1px),` +
          `repeating-linear-gradient(135deg, transparent 0 16px, ${color} 16px 17px, transparent 17px)`,
        backgroundSize: "44px 44px, 44px 44px, 16px 16px",
        opacity: 0.022,
      }}
    />
  );
}

/** Gold stud at each of the four page corners — rendered last so it sits on top of the navy wedges and bottom panel. */
function CornerDiamonds({ gold }: { gold: string }) {
  const d = 9;
  const pos: CSSProperties[] = [
    { top: 2, left: 2 },
    { top: 2, right: 2 },
    { bottom: 2, left: 2 },
    { bottom: 2, right: 2 },
  ];
  return (
    <>
      {pos.map((p, i) => (
        <div key={i} style={{ position: "absolute", width: d, height: d, background: gold, transform: "rotate(45deg)", pointerEvents: "none", ...p }} />
      ))}
    </>
  );
}

/**
 * Nested-fret corner ornament — a single top-left-oriented design (an outer
 * L trace, a smaller inset L echo, a solid gold tip square and an inner
 * diamond stud) rotated 0/90/180/270deg per corner via CSS transform, so one
 * SVG covers all four corners identically. Reads as an integrated gold
 * fretwork/key-pattern bracket rather than a plain crossed-line L, matching
 * the approved reference's corner treatment. Used standalone on corners with
 * no CornerWedge (front bl/br, all of the back page) and layered on top of
 * CornerWedge on the front's tl/tr for a richer, more "finished" corner.
 */
function CornerMotif({ corner, gold }: { corner: "tl" | "tr" | "bl" | "br"; gold: string }) {
  const size = 32;
  const pos: Record<string, CSSProperties> = {
    tl: { top: 13, left: 13 },
    tr: { top: 13, right: 13 },
    bl: { bottom: 13, left: 13 },
    br: { bottom: 13, right: 13 },
  };
  const rotate: Record<string, number> = { tl: 0, tr: 90, br: 180, bl: 270 };
  return (
    <svg
      viewBox="0 0 30 30" width={size} height={size} fill="none"
      style={{ position: "absolute", ...pos[corner], transform: `rotate(${rotate[corner]}deg)`, opacity: 0.88, pointerEvents: "none" }}
    >
      <path d="M1 27 L1 1 L27 1" stroke={gold} strokeWidth={1.5} />
      <path d="M1 18 L1 9 L10 9" stroke={gold} strokeWidth={1} opacity={0.8} />
      <rect x={1} y={1} width={4} height={4} fill={gold} />
      <circle cx={16} cy={16} r={1.5} fill={gold} opacity={0.6} />
    </svg>
  );
}

/**
 * Thin navy/gold chevron trim spanning the bottom of the front page — shrunk
 * from an earlier 130px solid mountain mass so most of the bottom of the
 * page stays white, per the approved reference's light-footed bottom
 * treatment. The clip-path layers use percentage coordinates (resolution-
 * independent), but the studs and the two decorative SVGs are viewBox/pixel-
 * based, so both are rescaled by `scale` to match the shrunk height.
 */
function BottomGeoPanel({ navy, gold }: { navy: string; gold: string }) {
  const h = 52;
  const scale = h / 130;
  const silhouette = "0% 62%, 16% 40%, 34% 55%, 50% 8%, 66% 55%, 84% 40%, 100% 62%, 100% 100%, 0% 100%";
  return (
    <div style={{ position: "absolute", left: -2, right: -2, bottom: -2, height: h }}>
      <div
        style={{
          position: "absolute", inset: 0, background: navy,
          clipPath: `polygon(${silhouette})`,
        }}
      />
      {/* Slightly-lighter navy echo just inside the silhouette for depth. */}
      <div
        style={{
          position: "absolute", inset: 0, background: "#11497C", opacity: 0.3,
          clipPath: `polygon(0% 70%, 16% 49%, 34% 63%, 50% 17%, 66% 63%, 84% 49%, 100% 70%, 100% 100%, 0% 100%)`,
        }}
      />
      {/* Dark navy gradient wash across the panel base for weight. */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.14) 100%)",
          clipPath: `polygon(${silhouette})`,
        }}
      />
      {/* Warm gold glow rising from the centre peak, where the seal sits —
          gives the panel a lit, dimensional quality instead of a flat navy
          fill, echoing the reference's richer bottom geometry. */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse 60% 70% at 50% 12%, ${gold}22, transparent 65%)`,
          clipPath: `polygon(${silhouette})`,
        }}
      />
      {/* Embossed scaffold watermark recessed into the navy panel — gold line-art at
          low opacity so the industrial identity carries onto the front page without
          competing with the seal that sits on the centre peak. */}
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.12 }}>
        <g stroke={gold} strokeWidth="1.8" fill="none" strokeLinecap="round">
          <line x1="8" y1={120 * scale} x2="8" y2={30 * scale} />
          <line x1="24" y1={120 * scale} x2="24" y2={52 * scale} />
          <line x1="40" y1={120 * scale} x2="40" y2={70 * scale} />
          <line x1="8" y1={52 * scale} x2="40" y2={52 * scale} />
          <line x1="8" y1={86 * scale} x2="40" y2={86 * scale} />
          <line x1="8" y1={52 * scale} x2="24" y2={86 * scale} />
          <line x1="40" y1={52 * scale} x2="24" y2={86 * scale} />
          <line x1="60" y1={120 * scale} x2="60" y2={30 * scale} />
          <line x1="92" y1={120 * scale} x2="92" y2={44 * scale} />
          <line x1="60" y1={44 * scale} x2="92" y2={44 * scale} />
          <line x1="60" y1={74 * scale} x2="92" y2={74 * scale} />
          <line x1="60" y1={104 * scale} x2="92" y2={104 * scale} />
          <line x1="60" y1={44 * scale} x2="92" y2={74 * scale} />
          <line x1="92" y1={44 * scale} x2="60" y2={74 * scale} />
        </g>
      </svg>
      {/* Gold edge trim tracing the same silhouette, with an inner echo line. */}
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <polyline
          points={`0,${80.6 * scale} 16,${52 * scale} 34,${71.5 * scale} 50,${10.4 * scale} 66,${71.5 * scale} 84,${52 * scale} 100,${80.6 * scale}`}
          fill="none" stroke={gold} strokeWidth="2.2" vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={`0,${80.6 * scale} 16,${52 * scale} 34,${71.5 * scale} 50,${10.4 * scale} 66,${71.5 * scale} 84,${52 * scale} 100,${80.6 * scale}`}
          fill="none" stroke={gold} strokeWidth="1" opacity="0.6" transform="translate(0,-2)" vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Gold stud at each silhouette notch for a machined finish. */}
      {[
        [16, 52], [34, 71.5], [50, 10.4], [66, 71.5], [84, 52],
      ].map(([x, y]) => (
        <div key={`${x}-${y}`} style={{ position: "absolute", left: `${x}%`, top: y * scale, width: 4, height: 4, background: gold, transform: "translate(-50%,-50%) rotate(45deg)" }} />
      ))}
    </div>
  );
}

/**
 * Original, hand-drawn scaffold structure line-art (not a photo/third-party
 * asset) — three offset standards with ledgers at irregular heights, diagonal
 * braces, a working platform with a planks row, a ladder, base plates and
 * coupler clamps at the structural joints so it reads as a real scaffold
 * erection rather than a plain lattice grid. Anchored to one side of the
 * page at low opacity, no visible bounding box.
 */
function ScaffoldSideArt({ side, color, top = 70, height = 540, opacity = 0.12 }: { side: "left" | "right"; color: string; top?: number; height?: number; opacity?: number }) {
  const flip = side === "right" ? "scaleX(-1)" : undefined;
  // A soft outer-edge fade (mask-image, not opacity) so the structure reads
  // as a natural watermark bleeding off the page edge rather than a
  // hard-edged rectangular strip — the "more natural" refinement goal.
  const fadeMask = side === "left" ? "linear-gradient(90deg, #000 55%, transparent 100%)" : "linear-gradient(270deg, #000 55%, transparent 100%)";
  // Coordinates were tuned by hand against the 130x620 viewBox so the
  // structure reads as scaffolding: irregular brace spacing (not a uniform
  // grid), a ladder, planks and coupler clamps at the joints rather than
  // construction guides. Standards render in their own, heavier-weight
  // group so the structure has a natural thick/thin hand-drawn hierarchy
  // instead of one uniform line weight throughout.
  return (
    <svg
      viewBox="0 0 130 620"
      style={{
        position: "absolute", top, [side]: -24, width: 156, height,
        opacity, pointerEvents: "none", transform: flip,
        WebkitMaskImage: fadeMask, maskImage: fadeMask,
      } as CSSProperties}
    >
      <g stroke={color} strokeWidth="2.9" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* Standards (vertical poles) */}
        <line x1="20" y1="600" x2="20" y2="20" />
        <line x1="62" y1="600" x2="62" y2="40" />
        <line x1="104" y1="600" x2="104" y2="60" />
      </g>
      <g stroke={color} strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* Ledgers (horizontal ties) at irregular heights */}
        <line x1="20" y1="60" x2="62" y2="60" />
        <line x1="20" y1="130" x2="62" y2="130" />
        <line x1="20" y1="200" x2="62" y2="200" />
        <line x1="62" y1="200" x2="104" y2="200" />
        <line x1="20" y1="270" x2="62" y2="270" />
        <line x1="20" y1="340" x2="62" y2="340" />
        <line x1="20" y1="410" x2="62" y2="410" />
        <line x1="62" y1="410" x2="104" y2="410" />
        <line x1="20" y1="480" x2="104" y2="480" />
        <line x1="20" y1="560" x2="104" y2="560" />
        {/* Diagonal braces — X-pairs and single rakers */}
        <line x1="20" y1="130" x2="62" y2="60" />
        <line x1="62" y1="130" x2="20" y2="60" />
        <line x1="20" y1="340" x2="62" y2="270" />
        <line x1="62" y1="340" x2="20" y2="270" />
        <line x1="20" y1="480" x2="62" y2="410" />
        <line x1="20" y1="560" x2="62" y2="480" />
        <line x1="62" y1="270" x2="104" y2="200" />
        <line x1="104" y1="270" x2="62" y2="200" />
        <line x1="62" y1="560" x2="104" y2="480" />
        {/* Working platform planks on the mid ledge */}
        <line x1="28" y1="196" x2="44" y2="196" />
        <line x1="48" y1="196" x2="56" y2="196" />
        <line x1="70" y1="196" x2="96" y2="196" />
        {/* Guardrail above the platform */}
        <line x1="20" y1="160" x2="62" y2="160" />
        <line x1="26" y1="160" x2="26" y2="200" />
        <line x1="42" y1="160" x2="42" y2="200" />
        <line x1="58" y1="160" x2="58" y2="200" />
        {/* Ladder on the right standard */}
        <line x1="92" y1="480" x2="92" y2="230" />
        <line x1="99" y1="480" x2="99" y2="230" />
        <line x1="92" y1="270" x2="99" y2="270" />
        <line x1="92" y1="320" x2="99" y2="320" />
        <line x1="92" y1="370" x2="99" y2="370" />
        <line x1="92" y1="420" x2="99" y2="420" />
        {/* Base plates at the foot of each standard */}
        <line x1="12" y1="610" x2="28" y2="610" />
        <line x1="54" y1="610" x2="70" y2="610" />
        <line x1="96" y1="610" x2="112" y2="610" />
        <line x1="20" y1="600" x2="20" y2="612" />
        <line x1="62" y1="600" x2="62" y2="612" />
        <line x1="104" y1="600" x2="104" y2="612" />
      </g>
      {/* coupler clamps at the structural joints — bolted-connection marks, not human figures */}
      <g stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="17.5" y="197.5" width="5" height="5" transform="rotate(45 20 200)" />
        <rect x="59.5" y="197.5" width="5" height="5" transform="rotate(45 62 200)" />
        <rect x="59.5" y="407.5" width="5" height="5" transform="rotate(45 62 410)" />
        <rect x="17.5" y="477.5" width="5" height="5" transform="rotate(45 20 480)" />
        <rect x="101.5" y="197.5" width="5" height="5" transform="rotate(45 104 200)" />
      </g>
    </svg>
  );
}

type IconKind = "calendar" | "refresh" | "doc" | "id" | "target" | "book" | "bulb" | "clipboard" | "warning" | "shield" | "globe" | "phone" | "mail" | "qr";
function iconGlyph(kind: IconKind, color: string, strokeWidth = 1.6) {
  const common = { width: "58%", height: "58%", viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "calendar": return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;
    case "refresh": return <svg {...common}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v5h-5" /></svg>;
    case "doc": return <svg {...common}><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></svg>;
    case "id": return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="12" r="2" /><path d="M14 10h4M14 14h4M6 17c.5-1.5 2-2 3-2s2.5.5 3 2" /></svg>;
    case "target": return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" fill={color} /></svg>;
    case "book": return <svg {...common}><path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5C20 4.7 19.3 4 18.5 4H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5z" /></svg>;
    case "bulb": return <svg {...common}><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 1 1.6h5c.1-.6.4-1.2 1-1.6A6 6 0 0 0 12 3z" /></svg>;
    case "clipboard": return <svg {...common}><rect x="5" y="4" width="14" height="17" rx="2" /><rect x="9" y="2.5" width="6" height="3" rx="1" /><path d="M8.5 11l2 2 4-4.5M8.5 17h7" /></svg>;
    case "warning": return <svg {...common}><path d="M12 3.5 21.5 20h-19z" /><path d="M12 9.5v4.2M12 17h.01" /></svg>;
    case "shield": return <svg {...common}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4.5" /></svg>;
    case "globe": return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.4-3.8-8.5S9.5 5.9 12 3.5z" /></svg>;
    case "phone": return <svg {...common}><path d="M5 4h3l1.5 4.5L7.5 10a12 12 0 0 0 6.5 6.5l1.5-2L20 16v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z" /></svg>;
    case "mail": return <svg {...common}><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 6.5 12 13l8.5-6.5" /></svg>;
    default: return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="1" /><rect x="8" y="8" width="8" height="8" /></svg>;
  }
}

function CircleIcon({ kind, navy, gold, size = 34 }: { kind: IconKind; navy: string; gold: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, minWidth: size, borderRadius: "50%", background: navy, border: `1.5px solid ${gold}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {iconGlyph(kind, "#fff")}
    </div>
  );
}

function MetaTile({ icon, label, value, navy, gold }: { icon: IconKind; label: string; value: string; navy: string; gold: string }) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
      <CircleIcon kind={icon} navy={navy} gold={gold} size={40} />
      <div>
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: navy, fontFamily: "Georgia, serif", whiteSpace: "nowrap" }}>{value}</div>
      </div>
    </div>
  );
}

function QrCard({ svg, navy, gold, size, caption }: { svg: string; navy: string; gold: string; size: number; caption: boolean }) {
  return (
    <div style={{ width: size + 48, border: `1.5px solid ${gold}`, borderRadius: 10, padding: caption ? "14px 14px" : "10px 14px", textAlign: "center", background: "#fff", boxShadow: "0 1px 3px rgba(11,58,99,.08)" }}>
      <div style={{ fontSize: caption ? 11 : 9.5, fontWeight: 700, color: navy, letterSpacing: caption ? 0.8 : 0.5, marginBottom: caption ? 9 : 6 }}>QR VERIFICATION</div>
      <div style={{ width: size, height: size, margin: "0 auto", padding: 7, background: "#fff", border: "1px solid #eee" }} dangerouslySetInnerHTML={{ __html: svg }} />
      {caption && <div style={{ fontSize: 9, color: "#6b7280", marginTop: 8, lineHeight: 1.4 }}>Scan to verify this certificate<br />at Teras Universal Database</div>}
    </div>
  );
}

function RibbonBanner({ children, navy, gold, style, variant = "navy" }: { children: ReactNode; navy: string; gold: string; style?: CSSProperties; variant?: "navy" | "gold" }) {
  const clip = "polygon(2% 0%, 98% 0%, 100% 50%, 98% 100%, 2% 100%, 0% 50%)";
  const border = variant === "gold" ? navy : gold;
  const fill = variant === "gold" ? `linear-gradient(180deg, #F0CD6E 0%, ${gold} 48%, #B8912A 100%)` : navy;
  const sheen = variant === "gold" ? "inset 0 1px 0 rgba(255,255,255,.5)" : undefined;
  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <div style={{ position: "absolute", inset: -4, background: border, clipPath: clip }} />
      <div style={{ position: "relative", background: fill, color: "#fff", clipPath: clip, padding: "13px 52px", boxShadow: sheen }}>{children}</div>
    </div>
  );
}

export function ProfessionalScaffoldCertificateDocument({ data, config }: { data: CertData; config: TemplateConfig }) {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label || "10-Day Intensive Practical Training";
  // Dedicated template's own scale over the generic renderer's formula so
  // the holder name reads as one of the page's dominant elements without
  // competing with the CERTIFICATE headline above it — still shrinks for
  // long names.
  const nameSize = fitHolderNameSize(data.holder_name) + 10;
  // Front headline must show the programme's own title, not whatever
  // `data.course_name` happens to be (e.g. a template-editor preview's
  // generic sample data) — same fallback pattern the back page already uses.
  const programmeName = config.programme_title || data.course_name;
  // Template A's top mark is ALWAYS TEMPLATE_A_LOGO_SRC — config.logo_url is
  // deliberately never consulted here, unlike the generic renderer. This
  // component only ever renders when config.design_variant ===
  // "professional_scaffold_erection_skills" (see CertificateRenderer.tsx's
  // dispatch), so there is no legitimate case where a different logo should
  // show. The live certificate_templates row for this template has
  // config.logo_url = "/teras-universal-logo.png" (the full company lockup,
  // with the "TERAS UNIVERSAL" wordmark and tagline baked into the image)
  // left over from before this template had its own dedicated icon-only
  // asset — `config.logo_url || TEMPLATE_A_LOGO_SRC` let that persisted
  // value win every time, which is what actually put the wordmark inside
  // the rendered logo image. TEMPLATE_A_LOGO_SRC (see lib/template-a-logo.ts)
  // is a real, pre-cropped, genuinely transparent icon-only asset — instead
  // of CSS-cropping the full lockup with background-position/background-size
  // + mix-blend-mode:multiply, which visibly clipped the gold swoosh's
  // anti-aliased tips (multiply blending fades near-white pixels to
  // invisible, and the coded crop box had almost no source-pixel margin to
  // absorb that).
  const logoSrc = TEMPLATE_A_LOGO_SRC;

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#FDFCF8", boxSizing: "border-box", fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: 1.3, color: "#1F2937", overflow: "hidden" }}>
      <PageVignette navy={navy} />
      <PageTexture color={navy} />
      <OuterFrame navy={navy} gold={gold} />
      <CornerWedge corner="tl" navy={navy} gold={gold} />
      <CornerWedge corner="tr" navy={navy} gold={gold} />
      {/* Layered on top of the wedges for a more integrated, finished corner. */}
      <CornerMotif corner="tl" gold={gold} />
      <CornerMotif corner="tr" gold={gold} />
      <ScaffoldSideArt side="left" color={navy} top={140} opacity={0.1} />
      <ScaffoldSideArt side="right" color={navy} top={140} opacity={0.1} />
      <BottomGeoPanel navy={navy} gold={gold} />
      {/* Rendered after the bottom panel so the gold motifs sit on top of the navy. */}
      <CornerMotif corner="bl" gold={gold} />
      <CornerMotif corner="br" gold={gold} />
      <CornerDiamonds gold={gold} />

      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: `${PAD + 2}px ${PAD + 30}px ${PAD + 170}px`, display: "flex", flexDirection: "column", textAlign: "center" }}>
        <img src={logoSrc} alt="" style={{ width: 116, height: 103, objectFit: "contain", margin: "0 auto 2px", display: "block" }} />
        <div style={{ letterSpacing: 2.4, fontSize: 19, lineHeight: 1.2, color: navy, fontWeight: 700, marginTop: 4 }}>TERAS UNIVERSAL SDN. BHD.</div>
        <div style={{ fontSize: 11, lineHeight: 1.2, color: "#6b7280", marginTop: 2 }}>{REG_NO}</div>

        <h1 style={{ fontSize: 73, margin: "14px 0 0", letterSpacing: 3, fontWeight: 700, lineHeight: 1, fontFamily: "Georgia, 'Times New Roman', serif", background: `linear-gradient(180deg, #F5D982 0%, ${gold} 45%, #B8912A 100%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", textShadow: "0 1px 0 rgba(11,58,99,.1)" } as CSSProperties}>CERTIFICATE</h1>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 9 }}>
          <span style={{ width: 85, height: 2, background: gold, display: "inline-block" }} />
          <span style={{ fontSize: 16, lineHeight: 1.2, color: navy, letterSpacing: 4, fontWeight: 600 }}>OF SUCCESSFUL COMPLETION</span>
          <span style={{ width: 85, height: 2, background: gold, display: "inline-block" }} />
        </div>

        <p style={{ fontSize: 13.5, lineHeight: 1.3, margin: "8px 0 3px", color: "#4b5563" }}>This certificate is proudly presented to</p>
        <div style={{ position: "relative", display: "inline-block", margin: "0 auto" }}>
          <div style={{ fontSize: nameSize, lineHeight: 1.15, fontWeight: 700, color: navy, display: "inline-block", padding: "0 26px 5px", maxWidth: 700, wordBreak: "break-word", fontFamily: "Georgia, serif" }}>
            {data.holder_name}
          </div>
          <div style={{ borderTop: `2.5px solid ${gold}`, position: "relative" }}>
            <span style={{ position: "absolute", top: -4.5, left: "50%", transform: "translateX(-50%) rotate(45deg)", width: 8, height: 8, background: gold }} />
          </div>
        </div>
        {data.ic_passport && <p style={{ fontSize: 12.5, lineHeight: 1.3, color: "#6b7280", margin: "5px 0 0" }}>Passport / IC No: {data.ic_passport}</p>}

        <p style={{ fontSize: 13.5, lineHeight: 1.3, margin: "8px 0 2px", color: "#4b5563" }}>For successfully completing the</p>
        <div style={{ fontSize: 24, fontWeight: 700, color: navy, textTransform: "uppercase", lineHeight: 1.22, maxWidth: 560, margin: "0 auto" }}>
          {programmeName}
        </div>
        <RibbonBanner navy={navy} gold={gold} variant="gold" style={{ margin: "8px auto 0" }}>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.6 }}>{duration}</span>
        </RibbonBanner>
        {dateRange && <p style={{ fontSize: 12.5, lineHeight: 1.3, color: "#4b5563", margin: "5px 0 0" }}><strong style={{ color: navy }}>Conducted from</strong> {dateRange}</p>}

        <p style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 520, margin: "7px auto 0", color: "#4b5563" }}>
          {config.body_text || DEFAULT_BODY_TEXT}
        </p>

        {/* A single auto-margin wrapper pushes this whole tail block to the
            bottom as one unit — putting `margin: auto` on the metadata row
            alone (the earlier bug) greedily consumes all remaining flex
            space and leaves nothing for the signature row after it, which
            then collapses under the absolutely-positioned bottom panel.
            Every size/spacing value above this point was tightened so the
            full stack fits within the fixed 1123px page height with real
            room to spare — a flex `margin-top: auto` push only works when
            there is actual free space for it to consume; when content
            overflows its container, auto margins resolve to 0 and the
            "pushed" block just renders wherever normal flow puts it. */}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 20, paddingTop: 6, textAlign: "left", position: "relative" }}>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 13, columnGap: 18, alignContent: "center", position: "relative" }}>
              <div style={{ position: "absolute", left: "50%", top: 4, bottom: 4, width: 1, background: gold, opacity: 0.4 }} />
              <div style={{ position: "absolute", top: "50%", left: 4, right: 4, height: 1, background: gold, opacity: 0.4 }} />
              <MetaTile icon="calendar" label="Date of Completion" value={data.issue_date ? formatHumanDate(data.issue_date) : "—"} navy={navy} gold={gold} />
              <MetaTile icon="refresh" label="Recommended Skills Update" value={config.skills_update_recommendation || "Within Three (3) Years"} navy={navy} gold={gold} />
              <MetaTile icon="doc" label="Certificate No." value={data.certificate_number} navy={navy} gold={gold} />
              <MetaTile icon="id" label="Participant ID" value={data.participant_id || "—"} navy={navy} gold={gold} />
            </div>
            {config.show_qr !== false && data.qr_svg && <QrCard svg={data.qr_svg} navy={navy} gold={gold} size={76} caption />}
          </div>

          {/* Signature — Director only, per approved design. No Trainer / Training Manager block.
              Renders the approved handwritten Director signature asset by default
              (DEFAULT_SIGNATURE_URL) whenever config.signature_url is unset, so no
              database/template binding change is needed for the signature to appear. */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", paddingTop: 2 }}>
            {/* Fixed to ~250px: the signature block sits at the left edge of a
                space-between row while PremiumSeal is centered on the full
                page width — anything wider than ~255px starts overlapping
                the seal's horizontal footprint (a real bug caught here: the
                two were colliding at 320px/148px). */}
            <div style={{ textAlign: "center", fontSize: 11.5, width: 248 }}>
              {/* Box width corrected from an earlier 236 down to match the
                  asset's true aspect ratio (public/signatures/director-signature.png,
                  418x285, genuinely transparent, only ~6px of transparent
                  padding on every side — not "excessive") — object-fit:contain
                  inside a mismatched box left an invisible oversized hit-box
                  around the ink. 110x75 keeps the 418:285 ratio exactly
                  (110 * 285/418 ≈ 75) while sizing the ink up slightly so it
                  no longer reads as a small detached image. */}
              <img
                src={config.signature_url || DEFAULT_SIGNATURE_URL}
                alt=""
                style={{
                  display: "block",
                  width: 110,
                  height: 75,
                  margin: "3px auto 0",
                  objectFit: "contain",
                  objectPosition: "center bottom",
                  background: "transparent",
                  border: 0,
                  boxShadow: "none",
                }}
              />
              <div style={{ borderTop: `1.5px solid ${gold}`, margin: "6px 0 6px" }} />
              <strong style={{ color: navy, fontSize: 12.5, whiteSpace: "nowrap", display: "block" }}>Muhammad Azri Bin Mohd Latifi Amir</strong>
              <div style={{ color: "#6b7280", marginTop: 3 }}>Director</div>
            </div>
            <div style={{ textAlign: "center", fontSize: 11, width: 84, height: 84, borderRadius: "50%", border: `1.5px dashed ${gold}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", padding: 4, fontWeight: 600, letterSpacing: 0.3 }}>
              COMPANY<br />STAMP
            </div>
          </div>
        </div>
      </div>

      {/* Straddles the boundary of the white canvas and the bottom geometric
          panel, matching the reference's layered composition — positioned
          on the page itself (not inside the padded content flow) so it
          isn't affected by the content column's own flex layout. */}
      {/* size=154 (+10% over the prior 140), not the 162 tried earlier: with
          a 248px-wide left-anchored signature block and a page-centered
          seal, live measurement showed only a 4px horizontal gap at 162px
          (a real, fragile near-collision — different print/PDF engines
          round differently and this would eventually overlap "Muhammad
          Azri..."). 154px was live-measured to keep a safe gap; do not push
          toward 162 without re-measuring. Shrinking the signature block
          instead was rejected: it would force the Director's name onto two
          lines, which reopens the vertical A4-overflow bug this file's own
          history documents. */}
      {/* v3 crest is a true circle (200x200 viewBox) — box kept square so
          object-fit:contain doesn't letterbox a visible gap. Sized down to
          140x140 (from 154) and lifted to bottom:60 (from 40) so it reads
          as part of the signature/authentication row instead of sitting on
          top of the bottom navy chevron panel — at bottom:40/154 tall its
          lower half visually overlapped the panel's top peak. Width/bottom
          both stay well inside the previously live-measured safe margins
          (154 wide / 40 from bottom were themselves the tested maximums
          before colliding with the signature block and the panel
          respectively), so shrinking+lifting only widens those margins. */}
      <div style={{ position: "absolute", left: "50%", bottom: 60, transform: "translateX(-50%)", zIndex: 2 }}>
        <img
          src={TEMPLATE_A_CREST_SRC}
          alt="TERAS crest"
          style={{ display: "block", width: 140, height: 140, objectFit: "contain", background: "transparent", border: 0 }}
        />
      </div>
    </div>
  );
}

export function ProfessionalScaffoldCertificateBackPage({ data, config }: { data: CertData; config: TemplateConfig }) {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const coverage = config.coverage_items?.length ? config.coverage_items : DEFAULT_COVERAGE;
  const outcomes = config.learning_outcomes?.length ? config.learning_outcomes : DEFAULT_OUTCOMES;
  const assessment = config.assessment_methods?.length ? config.assessment_methods : DEFAULT_ASSESSMENT;
  const skillsRecord = config.skills_record?.length ? config.skills_record : DEFAULT_SKILLS_RECORD;
  const noticeParagraphs = config.important_notice ? config.important_notice.split(/\n{2,}/).filter(Boolean) : DEFAULT_NOTICE_PARAGRAPHS;

  const Section = ({ icon, title, children }: { icon: IconKind; title: string; children: ReactNode }) => (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: `2px solid ${gold}`, paddingBottom: 5, marginBottom: 7 }}>
        <CircleIcon kind={icon} navy={navy} gold={gold} size={28} />
        <span style={{ fontSize: 14, fontWeight: 700, color: navy, letterSpacing: 0.5 }}>{title}</span>
      </div>
      {children}
    </div>
  );
  const CheckList = ({ items }: { items: string[] }) => (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13.5, lineHeight: 1.5, color: "#374151" }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: "flex", gap: 9, marginBottom: 2 }}><span style={{ color: gold, fontWeight: 700 }}>✓</span>{it}</li>
      ))}
    </ul>
  );
  const ColumnDivider = () => <div style={{ width: 1, alignSelf: "stretch", background: `linear-gradient(${gold},${gold})`, backgroundSize: "1px 7px", backgroundRepeat: "repeat-y", opacity: 0.55 }} />;

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#FDFCF8", boxSizing: "border-box", fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: 1.3, color: "#1F2937", overflow: "hidden" }}>
      <PageVignette navy={navy} />
      <PageTexture color={navy} />
      <OuterFrame navy={navy} gold={gold} />
      <CornerMotif corner="tl" gold={gold} />
      <CornerMotif corner="tr" gold={gold} />
      <CornerMotif corner="bl" gold={gold} />
      <CornerMotif corner="br" gold={gold} />
      {/* Lower half only, behind the Important Notice / Verification
          sections — matches the reference's weighting (not a top banner).
          Right side sized/weighted slightly heavier than the left, echoing
          the reference's bottom-right scaffold emphasis, without crowding
          the three-column text above it. */}
      <ScaffoldSideArt side="left" color={navy} top={620} height={440} opacity={0.09} />
      <ScaffoldSideArt side="right" color={navy} top={600} height={520} opacity={0.11} />
      <CornerDiamonds gold={gold} />
      {/* Subtle bottom navy band with gold trim echoing the front page's
          geometric panel, kept to 10px so it never crowds the verification
          block (whose bottom edge sits ~15px above the page bottom). */}
      <div style={{ position: "absolute", left: -2, right: -2, bottom: -2, height: 10, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: navy, clipPath: "polygon(0% 100%, 0% 55%, 12% 30%, 25% 70%, 38% 25%, 50% 55%, 62% 25%, 75% 70%, 88% 30%, 100% 55%, 100% 100%)" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.2) 100%)", clipPath: "polygon(0% 100%, 0% 55%, 12% 30%, 25% 70%, 38% 25%, 50% 55%, 62% 25%, 75% 70%, 88% 30%, 100% 55%, 100% 100%)" }} />
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <polyline points="0,5.5 12,3 25,7 38,2.5 50,5.5 62,2.5 75,7 88,3 100,5.5" fill="none" stroke={gold} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      {/* padding-bottom is decorative-only here (this flex column packs from
          the top with no margin-top:auto / flex-grow, so it doesn't reserve
          real space against the frame) — the bottom safe-margin comes from
          the tightened spacing below instead, which shifts the verification
          block itself upward. */}
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: `${PAD + 6}px ${PAD + 20}px ${PAD + 4}px`, display: "flex", flexDirection: "column" }}>
        <RibbonBanner navy={navy} gold={gold} style={{ alignSelf: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 2.2 }}>PROGRAMME INFORMATION</span>
        </RibbonBanner>
        <div style={{ textAlign: "center", fontSize: 24, fontWeight: 700, color: navy, textTransform: "uppercase", maxWidth: 640, margin: "8px auto 4px", lineHeight: 1.25 }}>
          {config.programme_title || data.course_name}
        </div>
        <div style={{ display: "flex", justifyContent: "center", margin: "0 0 6px" }}>
          <span style={{ width: 7, height: 7, background: gold, transform: "rotate(45deg)", display: "inline-block" }} />
        </div>

        <div style={{ display: "flex", gap: 24, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <Section icon="target" title="PROGRAMME OBJECTIVES">
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.58, color: "#374151" }}>{config.objectives_text || DEFAULT_OBJECTIVES}</p>
            </Section>
            <Section icon="book" title="PROGRAMME COVERAGE"><CheckList items={coverage} /></Section>
          </div>
          <ColumnDivider />
          <div style={{ flex: 1 }}>
            <Section icon="bulb" title="LEARNING OUTCOMES">
              <p style={{ margin: "0 0 7px", fontSize: 13.5, lineHeight: 1.48, color: "#374151" }}>Upon successful completion, participants should be able to:</p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6, color: "#374151" }}>
                {outcomes.map((o, i) => <li key={i} style={{ marginBottom: 3 }}>{o}</li>)}
              </ul>
            </Section>
          </div>
          <ColumnDivider />
          <div style={{ flex: 1 }}>
            <Section icon="clipboard" title="ASSESSMENT METHOD"><CheckList items={assessment} /></Section>
            <Section icon="doc" title="PARTICIPANT SKILLS RECORD">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, border: `1px solid ${gold}`, background: `linear-gradient(180deg, ${gold}0D, #fff 65%)` }}>
                <thead>
                  <tr style={{ background: navy, color: "#fff" }}>
                    <th style={{ textAlign: "left", padding: "7px 9px", fontWeight: 600 }}>Assessment Area</th>
                    <th style={{ textAlign: "left", padding: "7px 9px", fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {skillsRecord.map((r, i) => {
                    const affirmative = isAffirmativeStatus(r.status);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <td style={{ padding: "7px 9px", color: "#374151" }}>{r.area}</td>
                        <td style={{ padding: "7px 9px", color: affirmative ? gold : "#6b7280", fontWeight: affirmative ? 700 : 400 }}>
                          {affirmative ? "✓ " : "– "}{r.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          </div>
        </div>

        <div style={{ position: "relative", border: `1.5px solid ${gold}`, borderRadius: 8, padding: "8px 16px", marginTop: 4, flexShrink: 0, background: `linear-gradient(180deg, ${gold}0D, #fff 55%)` }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
            <CircleIcon kind="warning" navy={navy} gold={gold} size={26} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: navy }}>IMPORTANT NOTICE</span>
          </div>
          {noticeParagraphs.map((p, i) => (
            <p key={i} style={{ position: "relative", margin: i === 0 ? 0 : "4px 0 0", fontSize: 12, lineHeight: 1.5, color: "#4b5563" }}>
              {p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme")}
            </p>
          ))}
        </div>

        <div style={{ marginTop: 4, paddingTop: 5, borderTop: `1.5px solid ${gold}`, flexShrink: 0, background: `linear-gradient(180deg, ${gold}08, transparent 70%)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
            <CircleIcon kind="shield" navy={navy} gold={gold} size={26} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: navy, letterSpacing: 0.6 }}>VERIFICATION</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 8, columnGap: 24, fontSize: 12.5, lineHeight: 1.45, color: "#374151" }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}><CircleIcon kind="doc" navy={navy} gold={gold} size={26} /><span><strong style={{ color: navy }}>Certificate No.</strong> {data.certificate_number}</span></div>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}><CircleIcon kind="phone" navy={navy} gold={gold} size={26} /><span><strong style={{ color: navy }}>Contact Number</strong> {config.contact_phone || "019-519 3834"}</span></div>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}><CircleIcon kind="globe" navy={navy} gold={gold} size={26} /><span><strong style={{ color: navy }}>Website</strong> {config.contact_website || "www.terasuniversal.com.my"}</span></div>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}><CircleIcon kind="mail" navy={navy} gold={gold} size={26} /><span><strong style={{ color: navy }}>Email</strong> {config.contact_email || "admin@terasuniversal.com.my"}</span></div>
            </div>
            {config.show_qr !== false && data.qr_svg && <QrCard svg={data.qr_svg} navy={navy} gold={gold} size={68} caption={false} />}
          </div>
        </div>
      </div>
    </div>
  );
}
