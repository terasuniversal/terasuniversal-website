import type { CertData, TemplateConfig } from "../components/admin/CertificateDocument";
import { fitHolderNameSize, formatDateRange, formatHumanDate, isAffirmativeStatus } from "./certificate-format";
import { renderTemplateACrestSvg } from "./template-a-crest";

/**
 * Standalone HTML string mirror of
 * components/admin/ProfessionalScaffoldCertificateDocument.tsx — no React /
 * no `react-dom/server` (Route Handlers can't import react-dom/server), used
 * by the bulk ZIP download path. Routed by `config.design_variant`, same as
 * the React renderer — keep both in sync structurally. Every numeric value
 * here was hand-verified against the React version's live-measured layout
 * (both pages overflow their fixed 1123px height by ≤2px) — do not change
 * one file's spacing without mirroring it here.
 */

const PAGE_W = "210mm";
const PAGE_H = "297mm";
const REG_NO = "202201038223 (1477529-X)";
const PAD = 34;
// Approved handwritten Director signature asset — used whenever
// config.signature_url is unset. Mirrors the React renderer's fallback.
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

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function outerFrame(navy: string, gold: string): string {
  return `
  <div style="position:absolute;inset:2px;border:1px solid ${gold};opacity:.35;pointer-events:none;"></div>
  <div style="position:absolute;inset:3px;border:1px solid ${gold};opacity:.9;pointer-events:none;"></div>
  <div style="position:absolute;inset:5px;border:6px solid ${navy};box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -1px 0 rgba(0,0,0,.28);pointer-events:none;"></div>
  <div style="position:absolute;inset:11px;border:1px solid ${gold};opacity:.5;pointer-events:none;"></div>
  <div style="position:absolute;inset:13px;border:2.5px solid ${gold};box-shadow:0 0 5px ${gold}66;pointer-events:none;"></div>
  <div style="position:absolute;inset:17.5px;border:1px solid ${navy};opacity:.85;pointer-events:none;"></div>
  <div style="position:absolute;inset:21.5px;border:1px solid ${gold};opacity:.65;pointer-events:none;"></div>
  <div style="position:absolute;inset:25.5px;border:1px solid ${gold};opacity:.9;pointer-events:none;"></div>
  <div style="position:absolute;inset:28.5px;border:1px solid ${navy};opacity:.3;pointer-events:none;"></div>`;
}

/** Very low-strength radial tint top and bottom of the page — pure background colour, zero effect on page height. Mirrors PageVignette. */
function pageVignette(navy: string): string {
  return `<div style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 100% 30% at 50% 0%,${navy}0D,transparent 60%),radial-gradient(ellipse 100% 30% at 50% 100%,${navy}12,transparent 55%);"></div>`;
}

/** Full-page industrial texture — faint blueprint grid + diagonal hatch. Mirrors PageTexture in the React renderer. */
function pageTexture(navy: string): string {
  return `<div style="position:absolute;inset:0;pointer-events:none;opacity:.022;background-image:linear-gradient(${navy} 1px,transparent 1px),linear-gradient(90deg,${navy} 1px,transparent 1px),repeating-linear-gradient(135deg,transparent 0 16px,${navy} 16px 17px,transparent 17px);background-size:44px 44px,44px 44px,16px 16px;"></div>`;
}

function cornerDiamonds(gold: string): string {
  const d = 9;
  return `<div style="position:absolute;top:2px;left:2px;width:${d}px;height:${d}px;background:${gold};transform:rotate(45deg);pointer-events:none;"></div>
  <div style="position:absolute;top:2px;right:2px;width:${d}px;height:${d}px;background:${gold};transform:rotate(45deg);pointer-events:none;"></div>
  <div style="position:absolute;bottom:2px;left:2px;width:${d}px;height:${d}px;background:${gold};transform:rotate(45deg);pointer-events:none;"></div>
  <div style="position:absolute;bottom:2px;right:2px;width:${d}px;height:${d}px;background:${gold};transform:rotate(45deg);pointer-events:none;"></div>`;
}

function cornerWedge(corner: "tl" | "tr", navy: string, gold: string): string {
  const size = 168;
  const basePos = corner === "tl" ? "top:-2px;left:-2px;" : "top:-2px;right:-2px;";
  const baseClip = corner === "tl" ? "polygon(0 0,100% 0,0 100%)" : "polygon(0 0,100% 0,100% 100%)";
  const gradAngle = corner === "tl" ? "135deg" : "225deg";
  const innerPos = corner === "tl" ? `top:${size * 0.26}px;left:${size * 0.26}px;` : `top:${size * 0.26}px;right:${size * 0.26}px;`;
  const edge =
    corner === "tl"
      ? `top:${size * 0.62}px;left:-2px;width:${size * 0.62}px;height:3px;transform:rotate(-45deg);transform-origin:left center;`
      : `top:${size * 0.62}px;right:-2px;width:${size * 0.62}px;height:3px;transform:rotate(45deg);transform-origin:right center;`;
  const edgeInner =
    corner === "tl"
      ? `top:${size * 0.62 + 5}px;left:-2px;width:${size * 0.58}px;height:1.4px;transform:rotate(-45deg);transform-origin:left center;opacity:.55;`
      : `top:${size * 0.62 + 5}px;right:-2px;width:${size * 0.58}px;height:1.4px;transform:rotate(45deg);transform-origin:right center;opacity:.55;`;
  return `
  <div style="position:absolute;width:${size}px;height:${size}px;background:linear-gradient(${gradAngle},${navy} 55%,#0A2C4D 100%);clip-path:${baseClip};${basePos}"></div>
  <div style="position:absolute;width:${size * 0.56}px;height:${size * 0.56}px;background:linear-gradient(${gradAngle},${gold} 60%,#B8912A 100%);clip-path:${baseClip};${innerPos}"></div>
  <div style="position:absolute;background:${gold};${edge}"></div>
  <div style="position:absolute;background:${gold};${edgeInner}"></div>`;
}

/** Nested-fret corner ornament — mirrors CornerMotif. One top-left-oriented SVG rotated per corner via CSS transform. */
function cornerMotif(corner: "tl" | "tr" | "bl" | "br", gold: string): string {
  const size = 32;
  const pos =
    corner === "tl" ? "top:13px;left:13px;"
    : corner === "tr" ? "top:13px;right:13px;"
    : corner === "bl" ? "bottom:13px;left:13px;"
    : "bottom:13px;right:13px;";
  const rotate = corner === "tl" ? 0 : corner === "tr" ? 90 : corner === "br" ? 180 : 270;
  return `<svg viewBox="0 0 30 30" width="${size}" height="${size}" fill="none" style="position:absolute;${pos}transform:rotate(${rotate}deg);opacity:.88;pointer-events:none;">
    <path d="M1 27 L1 1 L27 1" stroke="${gold}" stroke-width="1.5"/>
    <path d="M1 18 L1 9 L10 9" stroke="${gold}" stroke-width="1" opacity="0.8"/>
    <rect x="1" y="1" width="4" height="4" fill="${gold}"/>
    <circle cx="16" cy="16" r="1.5" fill="${gold}" opacity="0.6"/>
  </svg>`;
}

/** Thin navy/gold chevron trim, not a filled mountain mass — shrunk from an
 * earlier 130px solid block so most of the bottom of the page stays white,
 * per the approved reference's light-footed bottom treatment. Its polygon
 * layers use percentage coordinates (resolution-independent), but the studs
 * and the two decorative SVGs are viewBox/pixel-based, so both are rescaled
 * to match — the SVGs via viewBox height (preserveAspectRatio="none" already
 * stretches them to the container), the studs via an explicit scale factor. */
function bottomGeoPanel(navy: string, gold: string): string {
  const h = 52;
  const scale = h / 130;
  const silhouette = "0% 62%,16% 40%,34% 55%,50% 8%,66% 55%,84% 40%,100% 62%,100% 100%,0% 100%";
  const studs = [[16, 52], [34, 71.5], [50, 10.4], [66, 71.5], [84, 52]]
    .map(([x, y]) => `<div style="position:absolute;left:${x}%;top:${y * scale}px;width:4px;height:4px;background:${gold};transform:translate(-50%,-50%) rotate(45deg);"></div>`)
    .join("");
  return `<div style="position:absolute;left:-2px;right:-2px;bottom:-2px;height:${h}px;">
    <div style="position:absolute;inset:0;background:${navy};clip-path:polygon(${silhouette});"></div>
    <div style="position:absolute;inset:0;background:#11497C;opacity:.3;clip-path:polygon(0% 70%,16% 49%,34% 63%,50% 17%,66% 63%,84% 49%,100% 70%,100% 100%,0% 100%);"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.14) 100%);clip-path:polygon(${silhouette});"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse 60% 70% at 50% 12%,${gold}22,transparent 65%);clip-path:polygon(${silhouette});"></div>
    <svg viewBox="0 0 100 ${h}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;opacity:.12;">
      <g stroke="${gold}" stroke-width="1.8" fill="none" stroke-linecap="round">
        <line x1="8" y1="${120 * scale}" x2="8" y2="${30 * scale}"/><line x1="24" y1="${120 * scale}" x2="24" y2="${52 * scale}"/><line x1="40" y1="${120 * scale}" x2="40" y2="${70 * scale}"/>
        <line x1="8" y1="${52 * scale}" x2="40" y2="${52 * scale}"/><line x1="8" y1="${86 * scale}" x2="40" y2="${86 * scale}"/>
        <line x1="8" y1="${52 * scale}" x2="24" y2="${86 * scale}"/><line x1="40" y1="${52 * scale}" x2="24" y2="${86 * scale}"/>
        <line x1="60" y1="${120 * scale}" x2="60" y2="${30 * scale}"/><line x1="92" y1="${120 * scale}" x2="92" y2="${44 * scale}"/>
        <line x1="60" y1="${44 * scale}" x2="92" y2="${44 * scale}"/><line x1="60" y1="${74 * scale}" x2="92" y2="${74 * scale}"/><line x1="60" y1="${104 * scale}" x2="92" y2="${104 * scale}"/>
        <line x1="60" y1="${44 * scale}" x2="92" y2="${74 * scale}"/><line x1="92" y1="${44 * scale}" x2="60" y2="${74 * scale}"/>
      </g>
    </svg>
    <svg viewBox="0 0 100 ${h}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;">
      <polyline points="0,${80.6 * scale} 16,${52 * scale} 34,${71.5 * scale} 50,${10.4 * scale} 66,${71.5 * scale} 84,${52 * scale} 100,${80.6 * scale}" fill="none" stroke="${gold}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
      <polyline points="0,${80.6 * scale} 16,${52 * scale} 34,${71.5 * scale} 50,${10.4 * scale} 66,${71.5 * scale} 84,${52 * scale} 100,${80.6 * scale}" fill="none" stroke="${gold}" stroke-width="1" opacity="0.6" transform="translate(0,-2)" vector-effect="non-scaling-stroke"/>
    </svg>
    ${studs}
  </div>`;
}

/** Mirrors ScaffoldSideArt — standards, irregular ledgers, diagonal braces, planks, ladder, base plates and coupler clamps at the structural joints, not a lattice. Standards render in their own heavier-weight group for a natural thick/thin hierarchy, and the whole watermark fades out via a mask-image toward the page edge rather than cutting off hard. */
function scaffoldSideArt(side: "left" | "right", color: string, top = 70, height = 540, opacity = 0.12): string {
  const flip = side === "right" ? "transform:scaleX(-1);" : "";
  const pos = side === "left" ? "left:-24px;" : "right:-24px;";
  const mask = side === "left" ? "linear-gradient(90deg,#000 55%,transparent 100%)" : "linear-gradient(270deg,#000 55%,transparent 100%)";
  return `<svg viewBox="0 0 130 620" style="position:absolute;top:${top}px;${pos}width:156px;height:${height}px;opacity:${opacity};pointer-events:none;-webkit-mask-image:${mask};mask-image:${mask};${flip}">
    <g stroke="${color}" stroke-width="2.9" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <line x1="20" y1="600" x2="20" y2="20"/><line x1="62" y1="600" x2="62" y2="40"/><line x1="104" y1="600" x2="104" y2="60"/>
    </g>
    <g stroke="${color}" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <line x1="20" y1="60" x2="62" y2="60"/><line x1="20" y1="130" x2="62" y2="130"/>
      <line x1="20" y1="200" x2="62" y2="200"/><line x1="62" y1="200" x2="104" y2="200"/>
      <line x1="20" y1="270" x2="62" y2="270"/><line x1="20" y1="340" x2="62" y2="340"/>
      <line x1="20" y1="410" x2="62" y2="410"/><line x1="62" y1="410" x2="104" y2="410"/>
      <line x1="20" y1="480" x2="104" y2="480"/><line x1="20" y1="560" x2="104" y2="560"/>
      <line x1="20" y1="130" x2="62" y2="60"/><line x1="62" y1="130" x2="20" y2="60"/>
      <line x1="20" y1="340" x2="62" y2="270"/><line x1="62" y1="340" x2="20" y2="270"/>
      <line x1="20" y1="480" x2="62" y2="410"/><line x1="20" y1="560" x2="62" y2="480"/>
      <line x1="62" y1="270" x2="104" y2="200"/><line x1="104" y1="270" x2="62" y2="200"/>
      <line x1="62" y1="560" x2="104" y2="480"/>
      <line x1="28" y1="196" x2="44" y2="196"/><line x1="48" y1="196" x2="56" y2="196"/><line x1="70" y1="196" x2="96" y2="196"/>
      <line x1="20" y1="160" x2="62" y2="160"/><line x1="26" y1="160" x2="26" y2="200"/><line x1="42" y1="160" x2="42" y2="200"/><line x1="58" y1="160" x2="58" y2="200"/>
      <line x1="92" y1="480" x2="92" y2="230"/><line x1="99" y1="480" x2="99" y2="230"/>
      <line x1="92" y1="270" x2="99" y2="270"/><line x1="92" y1="320" x2="99" y2="320"/><line x1="92" y1="370" x2="99" y2="370"/><line x1="92" y1="420" x2="99" y2="420"/>
      <line x1="12" y1="610" x2="28" y2="610"/><line x1="54" y1="610" x2="70" y2="610"/><line x1="96" y1="610" x2="112" y2="610"/>
      <line x1="20" y1="600" x2="20" y2="612"/><line x1="62" y1="600" x2="62" y2="612"/><line x1="104" y1="600" x2="104" y2="612"/>
    </g>
    <g stroke="${color}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <rect x="17.5" y="197.5" width="5" height="5" transform="rotate(45 20 200)"/>
      <rect x="59.5" y="197.5" width="5" height="5" transform="rotate(45 62 200)"/>
      <rect x="59.5" y="407.5" width="5" height="5" transform="rotate(45 62 410)"/>
      <rect x="17.5" y="477.5" width="5" height="5" transform="rotate(45 20 480)"/>
      <rect x="101.5" y="197.5" width="5" height="5" transform="rotate(45 104 200)"/>
    </g>
  </svg>`;
}

type IconKind = "calendar" | "refresh" | "doc" | "id" | "target" | "book" | "bulb" | "clipboard" | "warning" | "shield" | "globe" | "phone" | "mail";
function iconGlyph(kind: IconKind, color: string): string {
  const a = `width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case "calendar": return `<svg ${a}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
    case "refresh": return `<svg ${a}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>`;
    case "doc": return `<svg ${a}><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M9 12h6M9 16h6"/></svg>`;
    case "id": return `<svg ${a}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4M6 17c.5-1.5 2-2 3-2s2.5.5 3 2"/></svg>`;
    case "target": return `<svg ${a}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="${color}"/></svg>`;
    case "book": return `<svg ${a}><path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5C20 4.7 19.3 4 18.5 4H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>`;
    case "bulb": return `<svg ${a}><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 1 1.6h5c.1-.6.4-1.2 1-1.6A6 6 0 0 0 12 3z"/></svg>`;
    case "clipboard": return `<svg ${a}><rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3" rx="1"/><path d="M8.5 11l2 2 4-4.5M8.5 17h7"/></svg>`;
    case "warning": return `<svg ${a}><path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v4.2M12 17h.01"/></svg>`;
    case "shield": return `<svg ${a}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4.5"/></svg>`;
    case "globe": return `<svg ${a}><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.4-3.8-8.5S9.5 5.9 12 3.5z"/></svg>`;
    case "phone": return `<svg ${a}><path d="M5 4h3l1.5 4.5L7.5 10a12 12 0 0 0 6.5 6.5l1.5-2L20 16v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/></svg>`;
    case "mail": return `<svg ${a}><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/></svg>`;
  }
}

function circleIcon(kind: IconKind, navy: string, gold: string, size: number): string {
  return `<div style="width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;background:${navy};border:1.5px solid ${gold};display:flex;align-items:center;justify-content:center;">${iconGlyph(kind, "#fff")}</div>`;
}

function metaTile(icon: IconKind, label: string, value: string, navy: string, gold: string): string {
  return `<div style="display:flex;gap:11px;align-items:center;">
    ${circleIcon(icon, navy, gold, 40)}
    <div>
      <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;font-weight:600;white-space:nowrap;">${esc(label)}</div>
      <div style="font-size:16px;font-weight:700;color:${navy};font-family:Georgia,serif;white-space:nowrap;">${esc(value)}</div>
    </div>
  </div>`;
}

function qrCard(svg: string, navy: string, gold: string, size: number, caption: boolean): string {
  return `<div style="width:${size + 48}px;border:1.5px solid ${gold};border-radius:10px;padding:${caption ? "14px 14px" : "10px 14px"};text-align:center;background:#fff;box-shadow:0 1px 3px rgba(11,58,99,.08);">
    <div style="font-size:${caption ? 11 : 9.5}px;font-weight:700;color:${navy};letter-spacing:${caption ? 0.8 : 0.5}px;margin-bottom:${caption ? 9 : 6}px;">QR VERIFICATION</div>
    <div style="width:${size}px;height:${size}px;margin:0 auto;padding:7px;background:#fff;border:1px solid #eee;">${svg}</div>
    ${caption ? `<div style="font-size:9px;color:#6b7280;margin-top:8px;line-height:1.4;">Scan to verify this certificate<br/>at Teras Universal Database</div>` : ""}
  </div>`;
}

function ribbonBanner(inner: string, navy: string, gold: string, wrapStyle = "", variant: "navy" | "gold" = "navy"): string {
  const clip = "clip-path:polygon(2% 0%,98% 0%,100% 50%,98% 100%,2% 100%,0% 50%);";
  const border = variant === "gold" ? navy : gold;
  const fill = variant === "gold" ? `linear-gradient(180deg,#F0CD6E 0%,${gold} 48%,#B8912A 100%)` : navy;
  const sheen = variant === "gold" ? "box-shadow:inset 0 1px 0 rgba(255,255,255,.5);" : "";
  return `<div style="position:relative;display:inline-block;${wrapStyle}">
    <div style="position:absolute;inset:-4px;background:${border};${clip}"></div>
    <div style="position:relative;background:${fill};color:#fff;${clip}padding:13px 52px;${sheen}">${inner}</div>
  </div>`;
}

export function renderProfessionalScaffoldCertificateFront(data: CertData, config: TemplateConfig): string {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label || "10-Day Intensive Practical Training";
  const nameSize = fitHolderNameSize(data.holder_name) + 10;
  const programmeName = config.programme_title || data.course_name;

  // Crops the default lockup (public/teras-universal-logo.png, 1144x806) down
  // to just the globe+TU mark — bounding box (225,4)-(903,608) measured
  // directly against the source pixels — so the wordmark underneath (already
  // duplicated by the "TERAS UNIVERSAL SDN. BHD." text line below) doesn't
  // render twice. mix-blend-mode:multiply drops the mark's baked-in white
  // background against the cream page instead of showing a visible box. Both
  // numbers are tuned to this specific asset; a differently-cropped
  // config.logo_url would need this recomputed.
  const isDefaultLogo = !config.logo_url || config.logo_url === "/teras-universal-logo.png";
  const logo = isDefaultLogo
    ? `<div style="width:132px;height:118px;margin:0 auto 2px;background-image:url(/teras-universal-logo.png);background-repeat:no-repeat;background-position:-43.8px -0.8px;background-size:223px 157px;mix-blend-mode:multiply;"></div>`
    : `<img src="${esc(config.logo_url)}" alt="" style="width:132px;height:118px;object-fit:contain;margin:0 auto 2px;display:block;"/>`;
  const icBlock = data.ic_passport ? `<p style="font-size:12.5px;line-height:1.3;color:#6b7280;margin:5px 0 0;">Passport / IC No: ${esc(data.ic_passport)}</p>` : "";
  const durationBlock = ribbonBanner(`<span style="font-size:15px;font-weight:600;letter-spacing:.6px;">${esc(duration)}</span>`, navy, gold, "margin:8px auto 0;display:block;width:fit-content;", "gold");
  const dateBlock = dateRange ? `<p style="font-size:12.5px;color:#4b5563;margin:5px 0 0;"><strong style="color:${navy};">Conducted from</strong> ${esc(dateRange)}</p>` : "";
  const qrHtml = config.show_qr !== false && data.qr_svg ? qrCard(data.qr_svg, navy, gold, 76, true) : "";
  const signatureImg = `<img src="${esc(config.signature_url || DEFAULT_SIGNATURE_URL)}" alt="" style="height:65px;max-width:236px;object-fit:contain;"/>`;

  return `<div style="width:${PAGE_W};height:${PAGE_H};margin:0 auto;position:relative;background:#FDFCF8;box-sizing:border-box;font-family:Georgia,'Times New Roman',serif;line-height:1.3;color:#1F2937;overflow:hidden;">
  ${pageVignette(navy)}
  ${pageTexture(navy)}
  ${outerFrame(navy, gold)}
  ${cornerWedge("tl", navy, gold)}
  ${cornerWedge("tr", navy, gold)}
  ${cornerMotif("tl", gold)}
  ${cornerMotif("tr", gold)}
  ${scaffoldSideArt("left", navy, 140, 540, 0.1)}
  ${scaffoldSideArt("right", navy, 140, 540, 0.1)}
  ${bottomGeoPanel(navy, gold)}
  ${cornerMotif("bl", gold)}
  ${cornerMotif("br", gold)}
  ${cornerDiamonds(gold)}
  <div style="position:relative;height:100%;box-sizing:border-box;padding:${PAD + 2}px ${PAD + 30}px ${PAD + 170}px;display:flex;flex-direction:column;text-align:center;">
    ${logo}
    <div style="letter-spacing:2.4px;font-size:19px;line-height:1.2;color:${navy};font-weight:700;margin-top:4px;">TERAS UNIVERSAL SDN. BHD.</div>
    <div style="font-size:11px;line-height:1.2;color:#6b7280;margin-top:2px;">${REG_NO}</div>
    <h1 style="font-size:73px;margin:8px 0 0;letter-spacing:3px;font-weight:700;line-height:1;font-family:Georgia,'Times New Roman',serif;background:linear-gradient(180deg,#F5D982 0%,${gold} 45%,#B8912A 100%);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 1px 0 rgba(11,58,99,.1);">CERTIFICATE</h1>
    <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:9px;">
      <span style="width:85px;height:2px;background:${gold};display:inline-block;"></span>
      <span style="font-size:16px;line-height:1.2;color:${navy};letter-spacing:4px;font-weight:600;">OF SUCCESSFUL COMPLETION</span>
      <span style="width:85px;height:2px;background:${gold};display:inline-block;"></span>
    </div>
    <p style="font-size:13.5px;line-height:1.3;margin:8px 0 3px;color:#4b5563;">This certificate is proudly presented to</p>
    <div style="position:relative;display:inline-block;margin:0 auto;">
      <div style="font-size:${nameSize}px;line-height:1.15;font-weight:700;color:${navy};display:inline-block;padding:0 26px 5px;max-width:700px;word-break:break-word;font-family:Georgia,serif;">${esc(data.holder_name)}</div>
      <div style="border-top:2.5px solid ${gold};position:relative;">
        <span style="position:absolute;top:-4.5px;left:50%;transform:translateX(-50%) rotate(45deg);width:8px;height:8px;background:${gold};"></span>
      </div>
    </div>
    ${icBlock}
    <p style="font-size:13.5px;line-height:1.3;margin:8px 0 2px;color:#4b5563;">For successfully completing the</p>
    <div style="font-size:24px;font-weight:700;color:${navy};text-transform:uppercase;line-height:1.22;max-width:560px;margin:0 auto;">${esc(programmeName ?? "")}</div>
    ${durationBlock}
    ${dateBlock}
    <p style="font-size:12px;line-height:1.6;max-width:520px;margin:7px auto 0;color:#4b5563;">${esc(config.body_text || DEFAULT_BODY_TEXT)}</p>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;gap:20px;padding-top:6px;text-align:left;position:relative;">
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;row-gap:13px;column-gap:18px;align-content:center;position:relative;">
          <div style="position:absolute;left:50%;top:4px;bottom:4px;width:1px;background:${gold};opacity:.4;"></div>
          <div style="position:absolute;top:50%;left:4px;right:4px;height:1px;background:${gold};opacity:.4;"></div>
          ${metaTile("calendar", "Date of Completion", data.issue_date ? formatHumanDate(data.issue_date) : "—", navy, gold)}
          ${metaTile("refresh", "Recommended Skills Update", config.skills_update_recommendation || "Within Three (3) Years", navy, gold)}
          ${metaTile("doc", "Certificate No.", data.certificate_number, navy, gold)}
          ${metaTile("id", "Participant ID", data.participant_id || "—", navy, gold)}
        </div>
        ${qrHtml}
      </div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;padding-top:2px;">
        <div style="text-align:center;font-size:11.5px;width:248px;">
          ${signatureImg}
          <div style="border-top:1.5px solid ${gold};margin:6px 0 6px;"></div>
          <strong style="color:${navy};font-size:12.5px;white-space:nowrap;display:block;">Muhammad Azri Bin Mohd Latifi Amir</strong>
          <div style="color:#6b7280;margin-top:3px;">Director</div>
        </div>
        <div style="text-align:center;font-size:11px;width:84px;height:84px;border-radius:50%;border:1.5px dashed ${gold};display:flex;align-items:center;justify-content:center;color:#9ca3af;padding:4px;font-weight:600;letter-spacing:.3px;">COMPANY<br/>STAMP</div>
      </div>
    </div>
  </div>
  <!-- size=154 (+10% over the prior 140): 162 measured only a 4px gap to the signature block, a real near-collision — see React component's comment for the full reasoning. 154 was live-measured to keep a safe gap; do not push toward 162 without re-measuring. -->
  <div aria-label="TERAS crest" style="position:absolute;left:50%;bottom:40px;transform:translateX(-50%);z-index:2;width:154px;height:162px;line-height:0;">${renderTemplateACrestSvg(navy, gold)}</div>
</div>`;
}

export function renderProfessionalScaffoldCertificateBack(data: CertData, config: TemplateConfig): string {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const coverage = config.coverage_items?.length ? config.coverage_items : DEFAULT_COVERAGE;
  const outcomes = config.learning_outcomes?.length ? config.learning_outcomes : DEFAULT_OUTCOMES;
  const assessment = config.assessment_methods?.length ? config.assessment_methods : DEFAULT_ASSESSMENT;
  const skillsRecord = config.skills_record?.length ? config.skills_record : DEFAULT_SKILLS_RECORD;
  const noticeParagraphs = config.important_notice ? config.important_notice.split(/\n{2,}/).filter(Boolean) : DEFAULT_NOTICE_PARAGRAPHS;

  const section = (icon: IconKind, title: string, body: string) =>
    `<div style="margin-bottom:7px;">
      <div style="display:flex;align-items:center;gap:10px;border-bottom:2px solid ${gold};padding-bottom:5px;margin-bottom:7px;">
        ${circleIcon(icon, navy, gold, 28)}<span style="font-size:14px;font-weight:700;color:${navy};letter-spacing:.5px;">${esc(title)}</span>
      </div>${body}
    </div>`;
  const checklist = (items: string[]) =>
    `<ul style="margin:0;padding:0;list-style:none;font-size:13.5px;line-height:1.5;color:#374151;">${items.map((it) => `<li style="display:flex;gap:9px;margin-bottom:2px;"><span style="color:${gold};font-weight:700;">✓</span>${esc(it)}</li>`).join("")}</ul>`;
  const colDivider = `<div style="width:1px;align-self:stretch;background:linear-gradient(${gold},${gold});background-size:1px 7px;background-repeat:repeat-y;opacity:.55;"></div>`;

  const skillsTable = section(
    "doc",
    "PARTICIPANT SKILLS RECORD",
    `<table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid ${gold};background:linear-gradient(180deg,${gold}0D,#fff 65%);">
      <thead><tr style="background:${navy};color:#fff;"><th style="text-align:left;padding:7px 9px;font-weight:600;">Assessment Area</th><th style="text-align:left;padding:7px 9px;font-weight:600;">Status</th></tr></thead>
      <tbody>${skillsRecord.map((r) => {
        const affirmative = isAffirmativeStatus(r.status);
        const color = affirmative ? gold : "#6b7280";
        const weight = affirmative ? 700 : 400;
        const mark = affirmative ? "✓ " : "– ";
        return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:7px 9px;color:#374151;">${esc(r.area)}</td><td style="padding:7px 9px;color:${color};font-weight:${weight};">${mark}${esc(r.status)}</td></tr>`;
      }).join("")}</tbody>
    </table>`
  );

  const noticeHtml = noticeParagraphs
    .map((p, i) => `<p style="position:relative;margin:${i === 0 ? 0 : "4px 0 0"};font-size:12px;line-height:1.5;color:#4b5563;">${esc(p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme"))}</p>`)
    .join("");
  const qrHtml = config.show_qr !== false && data.qr_svg ? qrCard(data.qr_svg, navy, gold, 68, false) : "";

  return `<div style="width:${PAGE_W};height:${PAGE_H};margin:0 auto;position:relative;background:#FDFCF8;box-sizing:border-box;font-family:Georgia,'Times New Roman',serif;line-height:1.3;color:#1F2937;overflow:hidden;">
  ${pageVignette(navy)}
  ${pageTexture(navy)}
  ${outerFrame(navy, gold)}
  ${cornerMotif("tl", gold)}
  ${cornerMotif("tr", gold)}
  ${cornerMotif("bl", gold)}
  ${cornerMotif("br", gold)}
  ${scaffoldSideArt("left", navy, 620, 440, 0.09)}
  ${scaffoldSideArt("right", navy, 600, 520, 0.11)}
  ${cornerDiamonds(gold)}
  <div style="position:absolute;left:-2px;right:-2px;bottom:-2px;height:10px;overflow:hidden;">
    <div style="position:absolute;inset:0;background:${navy};clip-path:polygon(0% 100%,0% 55%,12% 30%,25% 70%,38% 25%,50% 55%,62% 25%,75% 70%,88% 30%,100% 55%,100% 100%);"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.2) 100%);clip-path:polygon(0% 100%,0% 55%,12% 30%,25% 70%,38% 25%,50% 55%,62% 25%,75% 70%,88% 30%,100% 55%,100% 100%);"></div>
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;">
      <polyline points="0,5.5 12,3 25,7 38,2.5 50,5.5 62,2.5 75,7 88,3 100,5.5" fill="none" stroke="${gold}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
    </svg>
  </div>
  <!-- padding-bottom is decorative-only here (this flex column packs from the top with no margin-top:auto / flex-grow, so it doesn't reserve real space against the frame) — the actual bottom safe-margin fix is the tightened spacing below, which shifts the verification block itself upward. -->
  <div style="position:relative;height:100%;box-sizing:border-box;padding:${PAD + 6}px ${PAD + 20}px ${PAD + 4}px;display:flex;flex-direction:column;">
    ${ribbonBanner(`<span style="font-size:17px;font-weight:700;letter-spacing:2.2px;">PROGRAMME INFORMATION</span>`, navy, gold, "align-self:center;display:block;width:fit-content;margin:0 auto;")}
    <div style="text-align:center;font-size:24px;font-weight:700;color:${navy};text-transform:uppercase;max-width:640px;margin:8px auto 4px;line-height:1.25;">${esc(config.programme_title || data.course_name || "")}</div>
    <div style="display:flex;justify-content:center;margin:0 0 6px;">
      <span style="width:7px;height:7px;background:${gold};transform:rotate(45deg);display:inline-block;"></span>
    </div>
    <div style="display:flex;gap:24px;flex-shrink:0;">
      <div style="flex:1;">
        ${section("target", "PROGRAMME OBJECTIVES", `<p style="margin:0;font-size:13.5px;line-height:1.58;color:#374151;">${esc(config.objectives_text || DEFAULT_OBJECTIVES)}</p>`)}
        ${section("book", "PROGRAMME COVERAGE", checklist(coverage))}
      </div>
      ${colDivider}
      <div style="flex:1;">
        ${section(
          "bulb",
          "LEARNING OUTCOMES",
          `<p style="margin:0 0 7px;font-size:13.5px;line-height:1.48;color:#374151;">Upon successful completion, participants should be able to:</p>
           <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.6;color:#374151;">${outcomes.map((o) => `<li style="margin-bottom:3px;">${esc(o)}</li>`).join("")}</ul>`
        )}
      </div>
      ${colDivider}
      <div style="flex:1;">
        ${section("clipboard", "ASSESSMENT METHOD", checklist(assessment))}
        ${skillsTable}
      </div>
    </div>
    <div style="position:relative;border:1.5px solid ${gold};border-radius:8px;padding:8px 16px;margin-top:4px;flex-shrink:0;background:linear-gradient(180deg,${gold}0D,#fff 55%);">
      <div style="position:relative;display:flex;align-items:center;gap:10px;margin-bottom:5px;">
        ${circleIcon("warning", navy, gold, 26)}<span style="font-size:13.5px;font-weight:700;color:${navy};">IMPORTANT NOTICE</span>
      </div>
      ${noticeHtml}
    </div>
    <div style="margin-top:4px;padding-top:5px;border-top:1.5px solid ${gold};flex-shrink:0;background:linear-gradient(180deg,${gold}08,transparent 70%);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;">
        ${circleIcon("shield", navy, gold, 26)}<span style="font-size:13.5px;font-weight:700;color:${navy};letter-spacing:.6px;">VERIFICATION</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;row-gap:8px;column-gap:24px;font-size:12.5px;line-height:1.45;color:#374151;">
          <div style="display:flex;gap:9px;align-items:center;">${circleIcon("doc", navy, gold, 26)}<span><strong style="color:${navy};">Certificate No.</strong> ${esc(data.certificate_number)}</span></div>
          <div style="display:flex;gap:9px;align-items:center;">${circleIcon("phone", navy, gold, 26)}<span><strong style="color:${navy};">Contact Number</strong> ${esc(config.contact_phone || "019-519 3834")}</span></div>
          <div style="display:flex;gap:9px;align-items:center;">${circleIcon("globe", navy, gold, 26)}<span><strong style="color:${navy};">Website</strong> ${esc(config.contact_website || "www.terasuniversal.com.my")}</span></div>
          <div style="display:flex;gap:9px;align-items:center;">${circleIcon("mail", navy, gold, 26)}<span><strong style="color:${navy};">Email</strong> ${esc(config.contact_email || "admin@terasuniversal.com.my")}</span></div>
        </div>
        ${qrHtml}
      </div>
    </div>
  </div>
</div>`;
}

/** Both pages concatenated, front then back. */
export function renderProfessionalScaffoldCertificateBody(data: CertData, config: TemplateConfig): string {
  const front = renderProfessionalScaffoldCertificateFront(data, config);
  const back = renderProfessionalScaffoldCertificateBack(data, config);
  return `<div style="page-break-after:always;">${front}</div>${back}`;
}

/** Full standalone, printable HTML document for one certificate (front + back, A4 portrait). */
export function renderProfessionalScaffoldCertificateDocument(data: CertData, config: TemplateConfig): string {
  const title = data.certificate_number || data.holder_name || "Certificate";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  html,body { margin:0; padding:0; background:#fff; }
  * { box-sizing: border-box; }
  @media screen { body { background:#eef1f6; padding:20px; } }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
</style></head><body>${renderProfessionalScaffoldCertificateBody(data, config)}
<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},400)}</script>
</body></html>`;
}
