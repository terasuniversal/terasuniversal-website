import type { CertData, TemplateConfig } from "../components/admin/CertificateDocument";
import { fitHolderNameSize, formatDateRange, isAffirmativeStatus } from "./certificate-format";

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
  <div style="position:absolute;inset:5px;border:5px solid ${navy};pointer-events:none;"></div>
  <div style="position:absolute;inset:10px;border:2.5px solid ${gold};pointer-events:none;"></div>
  <div style="position:absolute;inset:15px;border:1px solid ${navy};pointer-events:none;"></div>
  <div style="position:absolute;inset:19px;border:1px solid ${gold};opacity:.7;pointer-events:none;"></div>
  <div style="position:absolute;inset:22px;border:1px solid ${gold};opacity:.85;pointer-events:none;"></div>`;
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
  const innerPos = corner === "tl" ? `top:${size * 0.26}px;left:${size * 0.26}px;` : `top:${size * 0.26}px;right:${size * 0.26}px;`;
  const edge =
    corner === "tl"
      ? `top:${size * 0.62}px;left:-2px;width:${size * 0.62}px;height:3px;transform:rotate(-45deg);transform-origin:left center;`
      : `top:${size * 0.62}px;right:-2px;width:${size * 0.62}px;height:3px;transform:rotate(45deg);transform-origin:right center;`;
  return `
  <div style="position:absolute;width:${size}px;height:${size}px;background:${navy};clip-path:${baseClip};${basePos}"></div>
  <div style="position:absolute;width:${size * 0.56}px;height:${size * 0.56}px;background:${gold};clip-path:${baseClip};${innerPos}"></div>
  <div style="position:absolute;background:${gold};${edge}"></div>`;
}

function cornerBracket(corner: "tr" | "bl" | "br", gold: string): string {
  const size = 30;
  const h =
    corner === "tr" ? `top:20px;right:20px;width:${size}px;height:2px;` : corner === "br" ? `bottom:20px;right:20px;width:${size}px;height:2px;` : `bottom:20px;left:20px;width:${size}px;height:2px;`;
  const v =
    corner === "tr" ? `top:20px;right:20px;width:2px;height:${size}px;` : corner === "br" ? `bottom:20px;right:20px;width:2px;height:${size}px;` : `bottom:20px;left:20px;width:2px;height:${size}px;`;
  return `<div style="position:absolute;background:${gold};${h}"></div><div style="position:absolute;background:${gold};${v}"></div>`;
}

function bottomGeoPanel(navy: string, gold: string): string {
  return `<div style="position:absolute;left:-2px;right:-2px;bottom:-2px;height:130px;">
    <div style="position:absolute;inset:0;background:${navy};clip-path:polygon(0% 62%,16% 40%,34% 55%,50% 8%,66% 55%,84% 40%,100% 62%,100% 100%,0% 100%);"></div>
    <svg viewBox="0 0 100 130" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;">
      <polyline points="0,80.6 16,52 34,71.5 50,10.4 66,71.5 84,52 100,80.6" fill="none" stroke="${gold}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
      <polyline points="0,80.6 16,52 34,71.5 50,10.4 66,71.5 84,52 100,80.6" fill="none" stroke="${gold}" stroke-width="1" opacity="0.6" transform="translate(0,-4)" vector-effect="non-scaling-stroke"/>
    </svg>
  </div>`;
}

/** Circular navy/gold seal with curved ribbon text — decorative only, no accreditation claim. Mirrors PremiumSeal. */
function premiumSeal(navy: string, gold: string, size = 138): string {
  const uid = "pssSeal";
  const stars = [...Array(5)]
    .map((_, i) => {
      const a = (-90 + i * 15) * (Math.PI / 180);
      const r = 68;
      return `<circle cx="${100 + r * Math.cos(a)}" cy="${100 + r * Math.sin(a) - 4}" r="1.6" fill="${gold}" opacity="0.9"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 200 200" width="${size}" height="${size}">
    <defs>
      <path id="${uid}-top" d="M 26,108 A 74,74 0 0 1 174,108" fill="none"/>
      <path id="${uid}-bottom" d="M 34,132 A 74,74 0 0 0 166,132" fill="none"/>
    </defs>
    <circle cx="100" cy="100" r="92" fill="${navy}" stroke="${gold}" stroke-width="3"/>
    <circle cx="100" cy="100" r="80" fill="none" stroke="${gold}" stroke-width="1" opacity="0.8"/>
    <circle cx="100" cy="100" r="74" fill="none" stroke="${gold}" stroke-width="0.75" opacity="0.5"/>
    ${stars}
    <text font-size="12.5" font-weight="700" fill="${gold}" letter-spacing="2.2"><textPath href="#${uid}-top" startOffset="50%" text-anchor="middle">BUILDING COMPETENCE</textPath></text>
    <text font-size="12.5" font-weight="700" fill="${gold}" letter-spacing="2.2"><textPath href="#${uid}-bottom" startOffset="50%" text-anchor="middle">CREATING OPPORTUNITIES</textPath></text>
    <text x="100" y="94" text-anchor="middle" font-size="30" font-weight="700" fill="#fff" font-family="Georgia, serif">TU</text>
    <text x="100" y="114" text-anchor="middle" font-size="8.5" fill="${gold}" letter-spacing="1.5">EST. 2012</text>
    <line x1="70" y1="122" x2="130" y2="122" stroke="${gold}" stroke-width="0.75" opacity="0.7"/>
  </svg>`;
}

/** Mirrors ScaffoldSideArt — sparse vertical poles + ledgers + a small worker silhouette, not a lattice. */
function scaffoldSideArt(side: "left" | "right", color: string, top = 70, height = 540): string {
  const flip = side === "right" ? "transform:scaleX(-1);" : "";
  const pos = side === "left" ? "left:-28px;" : "right:-28px;";
  return `<svg viewBox="0 0 130 620" style="position:absolute;top:${top}px;${pos}width:140px;height:${height}px;opacity:.1;pointer-events:none;${flip}">
    <g stroke="${color}" stroke-width="2.7" fill="none" stroke-linecap="round">
      <line x1="24" y1="600" x2="24" y2="15"/><line x1="76" y1="600" x2="76" y2="55"/><line x1="108" y1="600" x2="108" y2="95"/>
      <line x1="24" y1="55" x2="76" y2="55"/><line x1="24" y1="180" x2="76" y2="180"/>
      <line x1="24" y1="305" x2="76" y2="305"/><line x1="24" y1="311" x2="108" y2="311"/><line x1="24" y1="430" x2="76" y2="430"/><line x1="24" y1="555" x2="76" y2="555"/><line x1="24" y1="561" x2="108" y2="561"/>
      <line x1="76" y1="180" x2="108" y2="180"/><line x1="76" y1="305" x2="108" y2="305"/><line x1="76" y1="430" x2="108" y2="430"/><line x1="76" y1="555" x2="108" y2="555"/>
      <line x1="24" y1="55" x2="76" y2="180"/><line x1="24" y1="430" x2="76" y2="555"/><line x1="76" y1="180" x2="108" y2="305"/><line x1="76" y1="430" x2="108" y2="555"/>
      <line x1="15" y1="609" x2="33" y2="609"/><line x1="67" y1="609" x2="85" y2="609"/><line x1="99" y1="609" x2="117" y2="609"/>
    </g>
    <g stroke="${color}" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="255" r="6.5"/>
      <path d="M50,262 L50,288 M50,269 L38,280 M50,269 L62,262 M50,288 L41,308 M50,288 L60,308"/>
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
  return `<div style="width:${size + 40}px;border:1.5px solid ${gold};border-radius:10px;padding:${caption ? "14px 12px" : "10px 12px"};text-align:center;background:#fff;box-shadow:0 1px 3px rgba(11,58,99,.08);">
    <div style="font-size:${caption ? 11 : 9.5}px;font-weight:700;color:${navy};letter-spacing:${caption ? 0.8 : 0.5}px;margin-bottom:${caption ? 9 : 6}px;">QR VERIFICATION</div>
    <div style="width:${size}px;height:${size}px;margin:0 auto;padding:5px;background:#fff;border:1px solid #eee;">${svg}</div>
    ${caption ? `<div style="font-size:9px;color:#6b7280;margin-top:8px;line-height:1.4;">Scan to verify this certificate<br/>at Teras Universal Database</div>` : ""}
  </div>`;
}

function ribbonBanner(inner: string, navy: string, gold: string, wrapStyle = ""): string {
  const clip = "clip-path:polygon(2% 0%,98% 0%,100% 50%,98% 100%,2% 100%,0% 50%);";
  return `<div style="position:relative;display:inline-block;${wrapStyle}">
    <div style="position:absolute;inset:-5px;background:${gold};${clip}"></div>
    <div style="position:relative;background:${navy};color:#fff;${clip}padding:13px 52px;">${inner}</div>
  </div>`;
}

export function renderProfessionalScaffoldCertificateFront(data: CertData, config: TemplateConfig): string {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label || "10-Day Intensive Practical Training";
  const nameSize = fitHolderNameSize(data.holder_name) + 16;
  const programmeName = config.programme_title || data.course_name;

  const logo = `<img src="${esc(config.logo_url || "/teras-universal-logo.png")}" alt="" style="width:172px;height:172px;object-fit:contain;margin:0 auto 2px;display:block;"/>`;
  const icBlock = data.ic_passport ? `<p style="font-size:12.5px;color:#6b7280;margin:5px 0 0;">Passport / IC No: ${esc(data.ic_passport)}</p>` : "";
  const durationBlock = ribbonBanner(`<span style="font-size:15px;font-weight:600;letter-spacing:.6px;">${esc(duration)}</span>`, navy, gold, "margin:6px auto 0;display:block;width:fit-content;");
  const dateBlock = dateRange ? `<p style="font-size:12.5px;color:#4b5563;margin:5px 0 0;"><strong style="color:${navy};">Conducted from</strong> ${esc(dateRange)}</p>` : "";
  const qrHtml = config.show_qr !== false && data.qr_svg ? qrCard(data.qr_svg, navy, gold, 76, true) : "";
  const signatureImg = `<img src="${esc(config.signature_url || DEFAULT_SIGNATURE_URL)}" alt="" style="height:58px;max-width:236px;object-fit:contain;"/>`;

  return `<div style="width:${PAGE_W};height:${PAGE_H};margin:0 auto;position:relative;background:#fff;box-sizing:border-box;font-family:Georgia,'Times New Roman',serif;line-height:1.65;color:#1F2937;overflow:hidden;">
  ${outerFrame(navy, gold)}
  ${cornerWedge("tl", navy, gold)}
  ${cornerWedge("tr", navy, gold)}
  ${scaffoldSideArt("left", navy, 140)}
  ${scaffoldSideArt("right", navy, 140)}
  ${bottomGeoPanel(navy, gold)}
  ${cornerBracket("bl", gold)}
  ${cornerBracket("br", gold)}
  ${cornerDiamonds(gold)}
  <div style="position:relative;height:100%;box-sizing:border-box;padding:${PAD + 6}px ${PAD + 30}px ${PAD + 170}px;display:flex;flex-direction:column;text-align:center;">
    ${logo}
    <div style="letter-spacing:2.4px;font-size:19px;color:${navy};font-weight:700;">TERAS UNIVERSAL SDN. BHD.</div>
    <div style="font-size:11px;color:#6b7280;margin-top:2px;">${REG_NO}</div>
    <h1 style="font-size:88px;margin:3px 0 0;letter-spacing:3px;color:${gold};font-weight:700;line-height:1;text-shadow:0 2px 0 rgba(11,58,99,.12),0 1px 0 rgba(212,175,55,.35);">CERTIFICATE</h1>
    <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:2px;">
      <span style="width:85px;height:2px;background:${gold};display:inline-block;"></span>
      <span style="font-size:16px;color:${navy};letter-spacing:4px;font-weight:600;">OF SUCCESSFUL COMPLETION</span>
      <span style="width:85px;height:2px;background:${gold};display:inline-block;"></span>
    </div>
    <p style="font-size:13.5px;margin:7px 0 3px;color:#4b5563;">This certificate is proudly presented to</p>
    <div style="position:relative;display:inline-block;margin:0 auto;">
      <div style="font-size:${nameSize}px;font-weight:700;color:${navy};display:inline-block;padding:0 26px 5px;max-width:700px;word-break:break-word;font-family:Georgia,serif;">${esc(data.holder_name)}</div>
      <div style="border-top:2.5px solid ${gold};position:relative;">
        <span style="position:absolute;top:-4.5px;left:50%;transform:translateX(-50%) rotate(45deg);width:8px;height:8px;background:${gold};"></span>
      </div>
    </div>
    ${icBlock}
    <p style="font-size:13.5px;margin:7px 0 2px;color:#4b5563;">For successfully completing the</p>
    <div style="font-size:24px;font-weight:700;color:${navy};text-transform:uppercase;line-height:1.2;max-width:600px;margin:0 auto;">${esc(programmeName ?? "")}</div>
    ${durationBlock}
    ${dateBlock}
    <p style="font-size:12px;line-height:1.45;max-width:580px;margin:5px auto 0;color:#4b5563;">${esc(config.body_text || DEFAULT_BODY_TEXT)}</p>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;gap:20px;padding-top:6px;text-align:left;position:relative;">
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;row-gap:11px;column-gap:16px;align-content:center;position:relative;">
          <div style="position:absolute;left:50%;top:4px;bottom:4px;width:1px;background:${gold};opacity:.4;"></div>
          <div style="position:absolute;top:50%;left:4px;right:4px;height:1px;background:${gold};opacity:.4;"></div>
          ${metaTile("calendar", "Date of Completion", data.issue_date || "—", navy, gold)}
          ${metaTile("refresh", "Recommended Skills Update", config.skills_update_recommendation || "Within Three (3) Years", navy, gold)}
          ${metaTile("doc", "Certificate No.", data.certificate_number, navy, gold)}
          ${metaTile("id", "Participant ID", data.participant_id || "—", navy, gold)}
        </div>
        ${qrHtml}
      </div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;padding-top:2px;">
        <div style="text-align:center;font-size:11.5px;width:248px;">
          ${signatureImg}
          <div style="border-top:1px solid ${navy};margin:4px 0 5px;"></div>
          <strong style="color:${navy};font-size:12.5px;white-space:nowrap;display:block;">Muhammad Azri Bin Mohd Latifi Amir</strong>
          <div style="color:#6b7280;margin-top:2px;">Director</div>
        </div>
        <div style="text-align:center;font-size:11px;width:84px;height:84px;border-radius:50%;border:1.5px dashed ${gold};display:flex;align-items:center;justify-content:center;color:#9ca3af;padding:4px;font-weight:600;letter-spacing:.3px;">COMPANY<br/>STAMP</div>
      </div>
    </div>
  </div>
  <!-- size=140: 162 measured only a 4px gap to the signature block, a real near-collision — see React component's comment for the full reasoning. -->
  <div style="position:absolute;left:50%;bottom:40px;transform:translateX(-50%);z-index:2;">${premiumSeal(navy, gold, 140)}</div>
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
    `<div style="margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:10px;border-bottom:2px solid ${gold};padding-bottom:5px;margin-bottom:6px;">
        ${circleIcon(icon, navy, gold, 28)}<span style="font-size:14px;font-weight:700;color:${navy};letter-spacing:.5px;">${esc(title)}</span>
      </div>${body}
    </div>`;
  const checklist = (items: string[]) =>
    `<ul style="margin:0;padding:0;list-style:none;font-size:13.5px;line-height:1.52;color:#374151;">${items.map((it) => `<li style="display:flex;gap:9px;"><span style="color:${gold};font-weight:700;">✓</span>${esc(it)}</li>`).join("")}</ul>`;
  const colDivider = `<div style="width:1px;align-self:stretch;background:linear-gradient(${gold},${gold});background-size:1px 7px;background-repeat:repeat-y;opacity:.55;"></div>`;

  const skillsTable = section(
    "doc",
    "PARTICIPANT SKILLS RECORD",
    `<table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid ${gold};">
      <thead><tr style="background:${navy};color:#fff;"><th style="text-align:left;padding:5px 8px;font-weight:600;">Assessment Area</th><th style="text-align:left;padding:5px 8px;font-weight:600;">Status</th></tr></thead>
      <tbody>${skillsRecord.map((r) => {
        const affirmative = isAffirmativeStatus(r.status);
        const color = affirmative ? gold : "#6b7280";
        const weight = affirmative ? 700 : 400;
        const mark = affirmative ? "✓ " : "– ";
        return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:5px 8px;color:#374151;">${esc(r.area)}</td><td style="padding:5px 8px;color:${color};font-weight:${weight};">${mark}${esc(r.status)}</td></tr>`;
      }).join("")}</tbody>
    </table>`
  );

  const noticeHtml = noticeParagraphs
    .map((p, i) => `<p style="position:relative;margin:${i === 0 ? 0 : "3px 0 0"};font-size:12px;line-height:1.46;color:#4b5563;">${esc(p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme"))}</p>`)
    .join("");
  const qrHtml = config.show_qr !== false && data.qr_svg ? qrCard(data.qr_svg, navy, gold, 60, false) : "";

  return `<div style="width:${PAGE_W};height:${PAGE_H};margin:0 auto;position:relative;background:#fff;box-sizing:border-box;font-family:Georgia,'Times New Roman',serif;line-height:1.65;color:#1F2937;overflow:hidden;">
  ${outerFrame(navy, gold)}
  ${cornerBracket("tr", gold)}
  ${cornerBracket("bl", gold)}
  ${scaffoldSideArt("right", navy, 620, 480)}
  ${cornerDiamonds(gold)}
  <div style="position:relative;height:100%;box-sizing:border-box;padding:${PAD + 6}px ${PAD + 20}px ${PAD + 4}px;display:flex;flex-direction:column;">
    ${ribbonBanner(`<span style="font-size:17px;font-weight:700;letter-spacing:2.2px;">PROGRAMME INFORMATION</span>`, navy, gold, "align-self:center;display:block;width:fit-content;margin:0 auto;")}
    <div style="text-align:center;font-size:24px;font-weight:700;color:${navy};text-transform:uppercase;margin:8px 0 4px;line-height:1.22;">${esc(config.programme_title || data.course_name || "")}</div>
    <div style="display:flex;justify-content:center;margin:0 0 7px;">
      <span style="width:7px;height:7px;background:${gold};transform:rotate(45deg);display:inline-block;"></span>
    </div>
    <div style="display:flex;gap:22px;flex-shrink:0;">
      <div style="flex:1;">
        ${section("target", "PROGRAMME OBJECTIVES", `<p style="margin:0;font-size:13.5px;line-height:1.55;color:#374151;">${esc(config.objectives_text || DEFAULT_OBJECTIVES)}</p>`)}
        ${section("book", "PROGRAMME COVERAGE", checklist(coverage))}
      </div>
      ${colDivider}
      <div style="flex:1;">
        ${section(
          "bulb",
          "LEARNING OUTCOMES",
          `<p style="margin:0 0 6px;font-size:13.5px;line-height:1.45;color:#374151;">Upon successful completion, participants should be able to:</p>
           <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.58;color:#374151;">${outcomes.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`
        )}
      </div>
      ${colDivider}
      <div style="flex:1;">
        ${section("clipboard", "ASSESSMENT METHOD", checklist(assessment))}
        ${skillsTable}
      </div>
    </div>
    <div style="position:relative;border:1.5px solid ${gold};border-radius:8px;padding:8px 16px;margin-top:3px;flex-shrink:0;background:#fff;">
      <div style="position:relative;display:flex;align-items:center;gap:10px;margin-bottom:5px;">
        ${circleIcon("warning", navy, gold, 26)}<span style="font-size:13.5px;font-weight:700;color:${navy};">IMPORTANT NOTICE</span>
      </div>
      ${noticeHtml}
    </div>
    <div style="margin-top:4px;padding-top:5px;border-top:1.5px solid ${gold};flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;">
        ${circleIcon("shield", navy, gold, 26)}<span style="font-size:13.5px;font-weight:700;color:${navy};letter-spacing:.6px;">VERIFICATION</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;row-gap:6px;column-gap:22px;font-size:12.5px;line-height:1.35;color:#374151;">
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
