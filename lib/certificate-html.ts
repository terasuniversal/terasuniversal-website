import type { CertData, TemplateConfig } from "../components/admin/CertificateDocument";
import { fitHolderNameSize, formatDateRange, isAffirmativeStatus } from "./certificate-format";
import { renderProfessionalScaffoldCertificateDocument } from "./professional-scaffold-certificate-html";
import {
  scaffoldWatermarkLines,
  type ScaffoldWatermarkLevel,
  inspectorWatermarkShapes,
  type InspectorWatermarkLevel,
  workingAtHeightWatermarkShapes,
  type WatermarkPrimitives,
  BLUEPRINT_GRID,
  REGISTRATION_TICKS,
} from "./certificate-watermarks";

/**
 * Standalone HTML string renderer for a certificate — no React / no
 * `react-dom/server`. Next.js App Router forbids importing `react-dom/server`
 * into route handlers, so the Bulk Certificate Download (ZIP) builds each
 * certificate document as a plain string here. The markup mirrors
 * `CertificateDocument`/`CertificateBackPage` (A4 portrait, inline styles,
 * two pages) so print output looks identical — keep both in sync.
 */

const PAGE_W = 794;
const PAGE_H = 1123;
const REG_NO = "202201038223 (1477529-X)";
/** Mirrors SANS in CertificateDocument.tsx — see that constant's comment. */
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

const DEFAULT_BODY_TEXT =
  "This programme focuses on developing practical knowledge, safety awareness and safe working practices through structured learning and practical activities.";
const DEFAULT_OBJECTIVES =
  "This programme is designed to enhance participants' knowledge, awareness and practical understanding through structured learning and applied training activities.";
const DEFAULT_COVERAGE = ["Programme Orientation", "Core Skills & Procedures", "Safe Working Practices", "Hazard Awareness", "Practical Activities", "Industry Best Practices"];
const DEFAULT_OUTCOMES = [
  "Understand the programme's core principles",
  "Recognise common workplace hazards",
  "Apply relevant safe working practices",
  "Demonstrate improved awareness of programme requirements",
];
const DEFAULT_ASSESSMENT = ["Attendance", "Theory Learning", "Practical Activities", "Trainer Observation"];
// Neutral by design — see the same constant's comment in CertificateDocument.tsx.
const DEFAULT_SKILLS_RECORD = [
  { area: "Theory Session", status: "Not Recorded" },
  { area: "Practical Training", status: "Not Recorded" },
  { area: "Safety Awareness", status: "Not Recorded" },
  { area: "Practical Assessment", status: "Not Recorded" },
  { area: "Attendance Requirement", status: "Not Recorded" },
];
const DEFAULT_NOTICE_PARAGRAPHS = [
  "This certificate acknowledges successful completion of the programme conducted by Teras Universal Sdn. Bhd.",
  "It records participation in a structured learning and skills-development programme.",
  "It does not represent or replace any statutory competency certification, licence, registration or authorisation that may be required under applicable laws, regulations or project-specific requirements.",
];

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Mirrors CertificateFrame in CertificateDocument.tsx — see that component's comment for why the ribbon/triple-border treatment was dropped. */
function certificateFrame(navy: string, gold: string): string {
  const corners: [string, string][] = [
    ["tl", "top:18px;left:18px;"],
    ["tr", "top:18px;right:18px;"],
    ["bl", "bottom:18px;left:18px;"],
    ["br", "bottom:18px;right:18px;"],
  ];
  const brackets = corners
    .map(([key, box]) => {
      const vy = key[0] === "t" ? "top:0;" : "bottom:0;";
      const hx = key[1] === "l" ? "left:0;" : "right:0;";
      return `<div style="position:absolute;width:32px;height:32px;pointer-events:none;${box}">
        <div style="position:absolute;width:32px;height:2px;background:${gold};${vy}${hx}"></div>
        <div style="position:absolute;width:2px;height:32px;background:${gold};${vy}${hx}"></div>
        <div style="position:absolute;width:6px;height:6px;background:${gold};${vy}${hx}"></div>
      </div>`;
    })
    .join("");
  // Mid-edge registration marks — mirrors CertificateFrame in CertificateDocument.tsx.
  const ticks = [
    "top:14px;left:50%;width:1px;height:9px;transform:translateX(-50%);",
    "bottom:14px;left:50%;width:1px;height:9px;transform:translateX(-50%);",
    "left:14px;top:50%;width:9px;height:1px;transform:translateY(-50%);",
    "right:14px;top:50%;width:9px;height:1px;transform:translateY(-50%);",
  ]
    .map((t) => `<div style="position:absolute;background:${gold};opacity:.45;pointer-events:none;${t}"></div>`)
    .join("");
  return `
  <div style="position:absolute;inset:9px;border:1.5px solid ${navy};pointer-events:none;"></div>
  <div style="position:absolute;inset:14px;border:1px solid ${gold};opacity:.4;pointer-events:none;"></div>
  <div style="position:absolute;inset:19px;border:1px solid ${navy};opacity:.1;pointer-events:none;"></div>
  ${ticks}
  ${brackets}`;
}

/** Mirrors WatermarkLayer's renderSet in CertificateDocument.tsx — maps one shape set to an SVG `<g>` string at the given stroke weight/opacity. */
function renderWatermarkSet(set: WatermarkPrimitives, color: string, strokeWidth: number, opacity: number): string {
  const lines = set.lines.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join("");
  const rects = set.rects.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("");
  const circles = set.circles.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join("");
  return `<g stroke="${color}" stroke-width="${strokeWidth}" fill="none" opacity="${opacity}">${lines}${rects}${circles}</g>`;
}

/**
 * Mirrors CertificateWatermark in CertificateDocument.tsx — resolves which
 * watermark family a template renders (inspector_watermark_level takes
 * precedence over wah_watermark, which takes precedence over the Scaffold
 * Erector geometry defaulting to "intermediate") and renders its `primary`
 * layer, plus the lighter `secondary` layer when this isn't the smaller
 * back-page corner placement.
 */
function certificateWatermark(config: TemplateConfig, color: string, corner: boolean): string {
  const shapes = config.inspector_watermark_level
    ? inspectorWatermarkShapes(config.inspector_watermark_level)
    : config.wah_watermark
    ? workingAtHeightWatermarkShapes()
    : scaffoldWatermarkLines(config.watermark_level ?? "intermediate");
  // Mirrors WatermarkLayer's placement in CertificateDocument.tsx — both bleed
  // past the page edge so the page's own overflow:hidden crops them.
  const pos = corner ? "bottom:-28px;right:-44px;width:320px;height:230px;" : "bottom:78px;right:-56px;width:600px;height:420px;";
  // Keep the exported certificate just as restrained as the live preview:
  // it is a background watermark, never a graphic competing with the name
  // or programme title.
  const primaryG = renderWatermarkSet(shapes.primary, color, 1.5, 0.035);
  const secondaryG = corner ? "" : renderWatermarkSet(shapes.secondary, color, 0.9, 0.022);
  // Drafting grid + corner registration ticks, front placement only — mirrors
  // WatermarkLayer in CertificateDocument.tsx.
  const strokes = (set: [number, number, number, number][]) =>
    set.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join("");
  const underlayG = corner
    ? ""
    : `<g stroke="${color}" stroke-width="0.6" fill="none" opacity="0.032">${strokes(BLUEPRINT_GRID)}</g>` +
      `<g stroke="${color}" stroke-width="0.9" fill="none" opacity="0.055">${strokes(REGISTRATION_TICKS)}</g>`;
  return `<svg viewBox="0 0 320 240" style="position:absolute;${pos}pointer-events:none;">${underlayG}${primaryG}${secondaryG}</svg>`;
}

type IconKind = "calendar" | "refresh" | "doc" | "id" | "target" | "book" | "bulb" | "clipboard" | "warning" | "shield";
function iconGlyph(kind: IconKind, color: string): string {
  const a = `width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
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
  }
}

/** Mirrors Glyph in CertificateDocument.tsx — bare icon at a fixed box size, no ring/disc. */
function glyph(kind: IconKind, color: string, size = 12): string {
  return `<span style="width:${size}px;height:${size}px;min-width:${size}px;display:inline-flex;align-items:center;justify-content:center;">${iconGlyph(kind, color)}</span>`;
}

/** Mirrors MetaTile in CertificateDocument.tsx — one cell of the front-page record strip. */
function metaTile(icon: IconKind, label: string, value: string, navy: string, gold: string): string {
  return `<div style="flex:1;min-width:0;">
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">
      ${glyph(icon, gold, 10)}
      <span style="font-size:7px;text-transform:uppercase;letter-spacing:1.1px;color:#8a94a6;font-family:${SANS};">${esc(label)}</span>
    </div>
    <div style="font-size:11.5px;font-weight:700;color:${navy};font-family:Georgia,serif;line-height:1.35;word-break:break-word;">${esc(value)}</div>
  </div>`;
}

/** Mirrors QrBlock in CertificateDocument.tsx — svg is pre-generated inline markup, not an <img src>. */
function qrBlock(svg: string, navy: string, gold: string, size: number, caption: boolean): string {
  return `<div style="width:${size + 22}px;text-align:center;">
    <div style="font-size:7px;font-weight:700;color:${navy};letter-spacing:1.6px;margin-bottom:2px;font-family:${SANS};">QR VERIFICATION</div>
    <div style="width:22px;height:1px;background:${gold};margin:0 auto 7px;"></div>
    <div style="position:relative;width:${size + 8}px;height:${size + 8}px;margin:0 auto;">
      <div style="position:absolute;inset:-3px;border:1px solid ${gold};opacity:.7;"></div>
      <div style="position:absolute;inset:0;padding:4px;background:#fff;border:1px solid ${navy};box-sizing:border-box;">${svg}</div>
    </div>
    ${caption ? `<div style="font-size:7px;color:#8a94a6;margin-top:8px;line-height:1.5;font-family:${SANS};letter-spacing:.2px;">Scan to verify this certificate at Teras Universal Database</div>` : ""}
  </div>`;
}

/** Mirrors AuthorisedSignatureLabel in CertificateDocument.tsx — shown only when there's no signature_url, guidance above the still-empty well, never a substitute mark. */
function authorisedSignatureLabel(): string {
  return `<div style="color:#9aa3b2;font-size:6.5px;letter-spacing:1.3px;font-family:${SANS};text-transform:uppercase;margin-bottom:3px;">Authorised Signature</div>`;
}

/** Mirrors StampSeal in CertificateDocument.tsx — neutral double-ring authentication placeholder; no approved company stamp asset exists, so this stays unbranded. */
function stampSeal(navy: string, gold: string): string {
  return `<div style="position:relative;width:74px;height:74px;margin-bottom:4px;">
    <div style="position:absolute;inset:0;border-radius:50%;border:1px solid ${navy};opacity:.55;"></div>
    <div style="position:absolute;inset:5px;border-radius:50%;border:1px solid ${gold};opacity:.6;"></div>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:8px;">
      <span style="font-size:7px;letter-spacing:1.2px;font-family:${SANS};color:#9aa3b2;text-align:center;text-transform:uppercase;">Company Stamp</span>
    </div>
  </div>`;
}

/** Mirrors RibbonBanner in CertificateDocument.tsx — flat navy label plate ruled top and bottom in gold; see that component's comment for why the offset ring was dropped. */
function ribbonBanner(inner: string, navy: string, gold: string, wrapStyle = ""): string {
  return `<div style="display:inline-block;background:${navy};color:#fff;padding:5px 30px;border-top:1px solid ${gold};border-bottom:1px solid ${gold};${wrapStyle}">${inner}</div>`;
}

/** Render the certificate front (page 1, the A4 card) as an HTML string. */
export function renderCertificateFront(data: CertData, config: TemplateConfig): string {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  const showDurationRibbon = config.design_variant !== "standard_scaffold_certificate";
  const nameSize = fitHolderNameSize(data.holder_name) + 8;
  const bgImage = config.background_url ? `background-image:url('${esc(config.background_url)}');background-size:cover;background-position:center;` : "";

  const motif = !config.background_url ? certificateWatermark(config, navy, false) : "";
  const logo = config.logo_url ? `<img src="${esc(config.logo_url)}" alt="" style="width:105px;height:74px;object-fit:contain;display:block;margin:0 auto 6px;"/>` : "";
  const icBlock = data.ic_passport ? `<p style="font-size:9.5px;color:#8a94a6;margin:10px 0 0;letter-spacing:.6px;font-family:${SANS};">Passport / IC No: ${esc(data.ic_passport)}</p>` : "";
  const durationBlock = showDurationRibbon && duration
    ? ribbonBanner(`<span style="font-size:9px;font-weight:600;letter-spacing:2.4px;font-family:${SANS};text-indent:2.4px;">${esc(duration)}</span>`, navy, gold, "margin:19px auto 0;display:block;width:fit-content;")
    : "";
  const dateBlock = dateRange
    ? `<p style="font-size:11px;color:#4b5563;margin:16px 0 0;"><span style="color:#8a94a6;letter-spacing:1.3px;font-size:8.5px;font-family:${SANS};text-transform:uppercase;">Conducted from </span>${esc(dateRange)}</p>`
    : "";
  const qrHtml = config.show_qr !== false && data.qr_svg ? qrBlock(data.qr_svg, navy, gold, 82, true) : "";
  const signatureImg = config.signature_url ? `<img src="${esc(config.signature_url)}" alt="" style="max-height:44px;max-width:150px;object-fit:contain;"/>` : "";
  const signatureWell = `<div style="height:44px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px;">${signatureImg}</div>`;
  const roleLine = (text: string) => `<div style="color:#8a94a6;font-size:8.5px;letter-spacing:1.3px;font-family:${SANS};text-transform:uppercase;margin-top:3px;">${esc(text)}</div>`;
  // Structural guidance only when there's no signature_url -- the well stays
  // visibly empty either way; see authorisedSignatureLabel's own comment.
  const primarySigLabel = config.signature_url ? "" : authorisedSignatureLabel();

  // Mirrors CertificateDocument: Standard Scaffold is issued by the Director
  // only, including legacy configs without an explicit signature_layout.
  const isSingleSignature = config.signature_layout === "single" || config.design_variant === "standard_scaffold_certificate";
  const primarySignatureBlock = isSingleSignature
    ? `<div style="text-align:center;font-size:11px;width:auto;max-width:160px;">
        ${primarySigLabel}
        ${signatureWell}
        <div style="border-top:1px solid ${navy};margin:4px 0 5px;"></div>
        <strong style="color:${navy};letter-spacing:.3px;">${esc(config.signature_name || config.signature_title || "Director")}</strong>
        ${config.signature_name ? roleLine(config.signature_title || "Director") : ""}
      </div>`
    : `<div style="text-align:center;font-size:11px;width:auto;max-width:160px;">
        ${primarySigLabel}
        ${signatureWell}
        <div style="border-top:1px solid ${navy};margin:4px 0 5px;"></div>
        <strong style="color:${navy};letter-spacing:.3px;">${esc(config.signature_name || "Trainer")}</strong>
        ${roleLine("Trainer Signature")}
      </div>`;
  const secondarySignatureBlock = isSingleSignature
    ? ""
    : `<div style="text-align:center;font-size:11px;width:auto;max-width:160px;">
        ${authorisedSignatureLabel()}
        <div style="height:44px;"></div>
        <div style="border-top:1px solid ${navy};margin:4px 0 5px;"></div>
        <strong style="color:${navy};letter-spacing:.3px;">${esc(config.signature_title || "Training Manager")}</strong>
        ${roleLine("Training Manager")}
      </div>`;

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:34px;font-family:Georgia,'Times New Roman',serif;color:#1F2937;overflow:hidden;${bgImage}">
  ${motif}
  ${certificateFrame(navy, gold)}
  <div style="position:relative;height:100%;box-sizing:border-box;padding:30px 40px;display:flex;flex-direction:column;text-align:center;">
    ${logo}
    <div style="letter-spacing:3.4px;font-size:13px;color:${navy};font-weight:700;">TERAS UNIVERSAL SDN. BHD.</div>
    <div style="font-size:8px;color:#8a94a6;margin-top:3px;letter-spacing:1px;font-family:${SANS};">${REG_NO}</div>
    <div style="width:52px;height:1px;background:${gold};margin:11px auto 0;"></div>
    <h1 style="font-size:44px;margin:19px 0 0;letter-spacing:14px;color:${navy};font-weight:700;line-height:1;text-indent:14px;">CERTIFICATE</h1>
    <div style="font-size:8.5px;color:#8a94a6;letter-spacing:5px;font-weight:600;font-family:${SANS};text-indent:5px;margin-top:10px;">OF SUCCESSFUL COMPLETION</div>
    <p style="font-size:9.5px;margin:24px 0 9px;color:#8a94a6;letter-spacing:1.8px;font-family:${SANS};text-transform:uppercase;text-indent:1.8px;">This certificate is proudly presented to</p>
    <div style="position:relative;display:inline-block;margin:0 auto;max-width:660px;">
      <div style="font-size:${nameSize}px;font-weight:700;color:${navy};padding:0 26px 14px;word-break:break-word;line-height:1.22;letter-spacing:.8px;">${esc(data.holder_name)}</div>
      <div style="position:relative;height:1px;background:#d3d9e2;">
        <span style="position:absolute;top:-0.5px;left:50%;transform:translateX(-50%);width:130px;height:2px;background:${gold};"></span>
      </div>
      <div style="height:1px;width:46%;margin:4px auto 0;background:#d3d9e2;opacity:.55;"></div>
    </div>
    ${icBlock}
    <p style="font-size:9px;margin:18px 0 0;color:#8a94a6;letter-spacing:1.8px;font-family:${SANS};text-transform:uppercase;text-indent:1.8px;">For successfully completing the</p>
    <div style="width:30px;height:1px;background:${gold};margin:8px auto 10px;"></div>
    <div style="font-size:23px;font-weight:700;color:${navy};text-transform:uppercase;line-height:1.38;max-width:600px;margin:0 auto;letter-spacing:1.4px;">${esc(data.course_name ?? "")}</div>
    <div style="width:150px;height:1px;background:${navy};opacity:.22;margin:11px auto 0;"></div>
    ${durationBlock}
    ${dateBlock}
    <p style="font-size:10.5px;line-height:1.85;max-width:520px;margin:17px auto 0;color:#6b7280;">${esc(config.body_text || DEFAULT_BODY_TEXT)}</p>
    <div style="margin:auto 0 0;border-top:1px solid ${navy};border-bottom:1px solid #e3e7ee;padding:16px 4px 15px;display:flex;gap:22px;text-align:left;align-items:flex-start;">
      ${metaTile("calendar", "Date of Completion", data.issue_date || "—", navy, gold)}
      <div style="width:1px;background:#e3e7ee;align-self:stretch;"></div>
      ${metaTile("refresh", "Skills Update", config.skills_update_recommendation || "Within Three (3) Years", navy, gold)}
      <div style="width:1px;background:#e3e7ee;align-self:stretch;"></div>
      ${metaTile("doc", "Certificate No.", data.certificate_number, navy, gold)}
      <div style="width:1px;background:#e3e7ee;align-self:stretch;"></div>
      ${metaTile("id", "Participant ID", data.participant_id || "—", navy, gold)}
    </div>
    <div style="position:relative;margin-top:18px;padding-top:18px;border-top:1px solid #e3e7ee;">
    <span style="position:absolute;top:-1px;left:50%;transform:translateX(-50%);width:48px;height:2px;background:${gold};"></span>
    <div style="display:flex;align-items:flex-end;justify-content:center;gap:${isSingleSignature ? 40 : 24}px;">
      ${primarySignatureBlock}
      ${secondarySignatureBlock}
      <div style="width:1px;align-self:stretch;background:#e3e7ee;"></div>
      ${stampSeal(navy, gold)}
      <div style="width:1px;align-self:stretch;background:#e3e7ee;"></div>
      ${qrHtml}
    </div>
    </div>
  </div>
</div>`;
}

/** Render the certificate back (page 2, "Programme Information") as an HTML string. */
export function renderCertificateBack(data: CertData, config: TemplateConfig): string {
  if (config.show_back_page === false) return "";
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const backMotif = certificateWatermark(config, navy, true);
  const coverage = config.coverage_items?.length ? config.coverage_items : DEFAULT_COVERAGE;
  const outcomes = config.learning_outcomes?.length ? config.learning_outcomes : DEFAULT_OUTCOMES;
  const assessment = config.assessment_methods?.length ? config.assessment_methods : DEFAULT_ASSESSMENT;
  const showSkillsRecord = config.show_skills_record !== false;
  const skillsRecord = data.effective_skills_record?.length ? data.effective_skills_record : DEFAULT_SKILLS_RECORD;
  const noticeParagraphs = config.important_notice ? config.important_notice.split(/\n{2,}/).filter(Boolean) : DEFAULT_NOTICE_PARAGRAPHS;

  /** Mirrors SectionHead in CertificateDocument.tsx — one head treatment for every block on this page. */
  const sectionHead = (icon: IconKind, title: string) =>
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
        ${glyph(icon, gold, 11)}<span style="font-size:8.5px;font-weight:700;color:${navy};letter-spacing:1.6px;font-family:${SANS};">${esc(title)}</span>
      </div>
      <div style="display:flex;margin-bottom:7px;">
        <span style="width:22px;height:1.5px;background:${gold};"></span>
        <span style="flex:1;height:1px;background:#e3e7ee;align-self:center;"></span>
      </div>`;
  const section = (icon: IconKind, title: string, body: string) =>
    `<div style="margin-bottom:13px;">
      ${sectionHead(icon, title)}${body}
    </div>`;
  /** Mirrors BulletList in CertificateDocument.tsx — one gold-square bullet treatment for every list on this page. */
  const bulletList = (items: string[]) =>
    `<ul style="margin:0;padding:0;list-style:none;font-size:10px;line-height:1.65;color:#374151;">${items
      .map((it) => `<li style="display:flex;gap:8px;margin-bottom:4px;"><span style="width:6px;height:1px;background:${gold};margin-top:8px;flex-shrink:0;"></span><span>${esc(it)}</span></li>`)
      .join("")}</ul>`;
  const colDivider = `<div style="width:1px;align-self:stretch;background:#edf0f4;"></div>`;
  const thStyle = `text-align:left;font-weight:700;color:#8a94a6;font-family:${SANS};font-size:7.5px;letter-spacing:1.1px;text-transform:uppercase;border-bottom:1px solid ${gold};`;

  const skillsTable = showSkillsRecord
    ? section(
        "doc",
        "PARTICIPANT SKILLS RECORD",
        `<table style="width:100%;border-collapse:collapse;font-size:9.5px;">
          <thead><tr><th style="${thStyle}padding:0 6px 5px 0;">Assessment Area</th><th style="${thStyle}padding:0 0 5px 6px;">Status</th></tr></thead>
          <tbody>${skillsRecord.map((r) => {
            const affirmative = isAffirmativeStatus(r.status);
            const color = affirmative ? navy : "#8a94a6";
            const weight = affirmative ? 700 : 400;
            return `<tr style="border-bottom:1px solid #eef1f5;"><td style="padding:5px 6px 5px 0;color:#374151;">${esc(r.area)}</td><td style="padding:5px 0 5px 6px;color:${color};font-weight:${weight};">${esc(r.status)}</td></tr>`;
          }).join("")}</tbody>
        </table>`
      )
    : "";

  const noticeHtml = noticeParagraphs
    .map((p, i) => `<p style="position:relative;margin:${i === 0 ? 0 : "6px 0 0"};font-size:9.5px;line-height:1.65;color:#6b7280;">${esc(p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme"))}</p>`)
    .join("");
  const verifyRow = (label: string, value: string) =>
    `<div style="border-left:1px solid #e3e7ee;padding-left:10px;">
      <div style="font-size:7.5px;letter-spacing:1.1px;color:#8a94a6;font-family:${SANS};text-transform:uppercase;">${esc(label)}</div>
      <div style="color:${navy};font-weight:700;margin-top:2px;">${esc(value)}</div>
    </div>`;
  const qrHtml = config.show_qr !== false && data.qr_svg
    ? `<div style="border-left:1px solid #e3e7ee;padding-left:20px;">${qrBlock(data.qr_svg, navy, gold, 56, false)}</div>`
    : "";

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:34px;font-family:Georgia,'Times New Roman',serif;color:#1F2937;overflow:hidden;">
  ${backMotif}
  ${certificateFrame(navy, gold)}
  <div style="position:relative;height:100%;box-sizing:border-box;padding:30px 40px;display:flex;flex-direction:column;">
    ${ribbonBanner(`<span style="font-size:9px;font-weight:700;letter-spacing:2.8px;font-family:${SANS};text-indent:2.8px;">PROGRAMME INFORMATION</span>`, navy, gold, "align-self:center;display:block;width:fit-content;margin:0 auto;")}
    <div style="text-align:center;font-size:18px;font-weight:700;color:${navy};text-transform:uppercase;margin:13px 0 0;line-height:1.3;letter-spacing:1px;">${esc(config.programme_title || data.course_name || "")}</div>
    <div style="display:flex;margin:10px 0 15px;">
      <span style="width:28px;height:1.5px;background:${gold};"></span>
      <span style="flex:1;height:1px;background:#e3e7ee;align-self:center;"></span>
    </div>
    <div style="display:flex;gap:26px;flex:1;">
      <div style="flex:1;">
        ${section("target", "PROGRAMME OBJECTIVES", `<p style="margin:0;font-size:10px;line-height:1.7;color:#374151;">${esc(config.objectives_text || DEFAULT_OBJECTIVES)}</p>`)}
        ${section("book", "PROGRAMME COVERAGE", bulletList(coverage))}
      </div>
      ${colDivider}
      <div style="flex:1;">
        ${section(
          "bulb",
          "LEARNING OUTCOMES",
          `<p style="margin:0 0 9px;font-size:10px;line-height:1.65;color:#6b7280;">Upon successful completion, participants should be able to:</p>
           ${bulletList(outcomes)}`
        )}
      </div>
      ${colDivider}
      <div style="flex:1;">
        ${section("clipboard", "ASSESSMENT METHOD", bulletList(assessment))}
        ${skillsTable}
      </div>
    </div>
    <div style="position:relative;border:1px solid #e3e7ee;padding:13px 16px;margin-top:8px;overflow:hidden;background:#FCFDFE;">
      ${sectionHead("warning", "IMPORTANT NOTICE")}
      ${noticeHtml}
    </div>
    <div style="margin-top:14px;">
      ${sectionHead("shield", "VERIFICATION")}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:22px;">
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;row-gap:9px;column-gap:24px;font-size:9.5px;color:#374151;">
          ${verifyRow("Certificate No.", data.certificate_number)}
          ${verifyRow("Contact Number", config.contact_phone || "019-519 3834")}
          ${verifyRow("Website", config.contact_website || "www.terasuniversal.com.my")}
          ${verifyRow("Email", config.contact_email || "admin@terasuniversal.com.my")}
        </div>
        ${qrHtml}
      </div>
    </div>
  </div>
</div>`;
}

/** Both pages concatenated, front then back, for print/preview embedding. */
export function renderCertificateBody(data: CertData, config: TemplateConfig): string {
  const front = renderCertificateFront(data, config);
  const back = renderCertificateBack(data, config);
  if (!back) return front;
  return `<div style="page-break-after:always;">${front}</div>${back}`;
}

/**
 * Full standalone, printable HTML document for one certificate (front +
 * back, A4 portrait). Routed by `config.design_variant` — never by
 * course-name matching — to the dedicated Professional Scaffold renderer;
 * every other template (including the untouched generic default) falls
 * through to the layout below.
 */
export function renderCertificateDocument(data: CertData, config: TemplateConfig): string {
  if (config.design_variant === "professional_scaffold_erection_skills") {
    return renderProfessionalScaffoldCertificateDocument(data, config);
  }
  const title = data.certificate_number || data.holder_name || "Certificate";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  html,body { margin:0; padding:0; background:#fff; }
  @media screen { body { background:#eef1f6; padding:20px; } }
  /* Without this, some browsers' print defaults drop background-color (the
     navy corner wedges, banners, table headers) even though borders/text
     still print fine — the certificate would look broken. */
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
</style></head><body>${renderCertificateBody(data, config)}
<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},400)}</script>
</body></html>`;
}
