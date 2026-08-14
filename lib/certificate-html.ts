import type { CertData, TemplateConfig } from "../components/admin/CertificateDocument";
import { fitHolderNameSize, formatDateRange, isAffirmativeStatus } from "./certificate-format";
import { renderProfessionalScaffoldCertificateDocument } from "./professional-scaffold-certificate-html";

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

/** Mirrors CornerRibbon in CertificateDocument.tsx — the standard rotated-band CSS corner-ribbon technique. */
function cornerRibbon(corner: "tl" | "br", navy: string, gold: string): string {
  const isTl = corner === "tl";
  const place = isTl ? "top:26px;left:-54px;" : "bottom:26px;right:-54px;";
  const placeTrim = isTl ? "top:37px;left:-54px;" : "bottom:37px;right:-54px;";
  const placeLine = isTl ? "top:18px;left:-54px;" : "bottom:18px;right:-54px;";
  return `
  <div style="position:absolute;width:200px;height:25px;background:${navy};transform:rotate(-45deg);transform-origin:center;${place}"></div>
  <div style="position:absolute;width:200px;height:3px;background:${gold};transform:rotate(-45deg);transform-origin:center;${placeTrim}"></div>
  <div style="position:absolute;width:200px;height:1px;background:${gold};opacity:.55;transform:rotate(-45deg);transform-origin:center;${placeLine}"></div>`;
}

function ornateBorder(navy: string, gold: string): string {
  const bracket = (corner: "tr" | "bl", size: number) => {
    const h = corner === "tr" ? `top:12px;right:12px;width:${size}px;height:2px;` : `bottom:12px;left:12px;width:${size}px;height:2px;`;
    const v = corner === "tr" ? `top:12px;right:12px;width:2px;height:${size}px;` : `bottom:12px;left:12px;width:2px;height:${size}px;`;
    const h2 = corner === "tr" ? `top:18px;right:18px;width:${size * 0.6}px;height:1px;` : `bottom:18px;left:18px;width:${size * 0.6}px;height:1px;`;
    const v2 = corner === "tr" ? `top:18px;right:18px;width:1px;height:${size * 0.6}px;` : `bottom:18px;left:18px;width:1px;height:${size * 0.6}px;`;
    return `<div style="position:absolute;background:${gold};${h}"></div><div style="position:absolute;background:${gold};${v}"></div>
      <div style="position:absolute;background:${gold};opacity:.6;${h2}"></div><div style="position:absolute;background:${gold};opacity:.6;${v2}"></div>`;
  };
  return `
  ${cornerRibbon("tl", navy, gold)}
  ${cornerRibbon("br", navy, gold)}
  ${bracket("tr", 38)}
  ${bracket("bl", 38)}
  <div style="position:absolute;inset:4px;border:2px solid ${navy};pointer-events:none;"></div>
  <div style="position:absolute;inset:9px;border:1px solid ${gold};pointer-events:none;"></div>
  <div style="position:absolute;inset:13px;border:1px solid ${navy};opacity:.25;pointer-events:none;"></div>`;
}

/** Mirrors ScaffoldMotif in CertificateDocument.tsx — original SVG pole/brace lines, not a photo/third-party asset. */
function scaffoldMotif(color: string, corner: boolean): string {
  const pos = corner ? "bottom:-10px;right:-30px;width:460px;height:340px;" : "bottom:150px;left:50%;transform:translateX(-50%);width:460px;height:320px;";
  return `<svg viewBox="0 0 320 240" style="position:absolute;${pos}opacity:.055;pointer-events:none;">
    <g stroke="${color}" stroke-width="2.5" fill="none">
      <line x1="20" y1="220" x2="20" y2="10"/><line x1="90" y1="220" x2="90" y2="10"/>
      <line x1="160" y1="220" x2="160" y2="10"/><line x1="230" y1="220" x2="230" y2="10"/><line x1="300" y1="220" x2="300" y2="10"/>
      <line x1="20" y1="30" x2="300" y2="30"/><line x1="20" y1="90" x2="300" y2="90"/>
      <line x1="20" y1="150" x2="300" y2="150"/><line x1="20" y1="210" x2="300" y2="210"/>
      <line x1="20" y1="30" x2="90" y2="90"/><line x1="90" y1="30" x2="20" y2="90"/>
      <line x1="160" y1="90" x2="230" y2="150"/><line x1="230" y1="90" x2="160" y2="150"/>
      <line x1="20" y1="150" x2="90" y2="210"/><line x1="90" y1="150" x2="20" y2="210"/>
      <line x1="230" y1="30" x2="300" y2="90"/><line x1="300" y1="30" x2="230" y2="90"/>
    </g>
  </svg>`;
}

type IconKind = "calendar" | "refresh" | "doc" | "id" | "target" | "book" | "bulb" | "clipboard" | "warning" | "shield" | "globe" | "phone" | "mail";
function iconGlyph(kind: IconKind, color: string): string {
  const a = `width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;
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

function circleIcon(kind: IconKind, navy: string, gold: string, size = 30): string {
  return `<div style="width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;background:${navy};border:1.5px solid ${gold};display:flex;align-items:center;justify-content:center;">${iconGlyph(kind, "#fff")}</div>`;
}

function metaTile(icon: IconKind, label: string, value: string, navy: string, gold: string): string {
  return `<div style="display:flex;gap:10px;align-items:center;">
    ${circleIcon(icon, navy, gold, 34)}
    <div>
      <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;">${esc(label)}</div>
      <div style="font-size:13.5px;font-weight:700;color:${navy};font-family:Georgia,serif;">${esc(value)}</div>
    </div>
  </div>`;
}

/** Mirrors QrBlock in CertificateDocument.tsx — svg is pre-generated inline markup, not an <img src>. */
function qrBlock(svg: string, navy: string, gold: string, size: number, caption: boolean): string {
  return `<div style="width:${size + 34}px;border:1.5px solid ${gold};border-radius:6px;padding:12px 9px;text-align:center;background:#fff;">
    <div style="font-size:10px;font-weight:700;color:${navy};letter-spacing:.6px;margin-bottom:7px;">QR VERIFICATION</div>
    <div style="width:${size}px;height:${size}px;margin:0 auto;padding:4px;background:#fff;border:1px solid #eee;">${svg}</div>
    ${caption ? `<div style="font-size:8.5px;color:#6b7280;margin-top:7px;line-height:1.35;">Scan to verify this certificate at Teras Universal Database</div>` : ""}
  </div>`;
}

/** Mirrors RibbonBanner in CertificateDocument.tsx — pointed-end banner shape via clip-path. */
function ribbonBanner(inner: string, navy: string, gold: string, wrapStyle = ""): string {
  const clip = "clip-path:polygon(2% 0%,98% 0%,100% 50%,98% 100%,2% 100%,0% 50%);";
  return `<div style="position:relative;display:inline-block;${wrapStyle}">
    <div style="position:absolute;inset:-3px;background:${gold};${clip}"></div>
    <div style="position:relative;background:${navy};color:#fff;${clip}padding:8px 34px;">${inner}</div>
  </div>`;
}

/** Render the certificate front (page 1, the A4 card) as an HTML string. */
export function renderCertificateFront(data: CertData, config: TemplateConfig): string {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  const nameSize = fitHolderNameSize(data.holder_name) + 4;
  const bgImage = config.background_url ? `background-image:url('${esc(config.background_url)}');background-size:cover;background-position:center;` : "";

  const motif = !config.background_url ? scaffoldMotif(navy, false) : "";
  const logo = config.logo_url ? `<img src="${esc(config.logo_url)}" alt="" style="width:104px;height:104px;object-fit:contain;margin:0 auto 6px;display:block;"/>` : "";
  const icBlock = data.ic_passport ? `<p style="font-size:12.5px;color:#6b7280;margin:10px 0 0;">Passport / IC No: ${esc(data.ic_passport)}</p>` : "";
  const durationBlock = duration
    ? ribbonBanner(`<span style="font-size:12.5px;font-weight:600;letter-spacing:.5px;">${esc(duration)}</span>`, navy, gold, "margin:14px auto 0;display:block;width:fit-content;")
    : "";
  // Mirrors CertificateDocument.tsx's programme_level pill — see that file's
  // TemplateConfig comment for why this is a generic, gated-by-config field
  // rather than a dedicated design variant.
  const levelBlock = config.programme_level
    ? `<div style="display:inline-block;margin:9px auto 0;padding:4px 16px;background:${gold};color:${navy};font-size:11px;font-weight:700;letter-spacing:1.4px;border-radius:3px;">${esc(config.programme_level.toLowerCase() === "awareness" ? "AWARENESS" : `${config.programme_level.toUpperCase()} LEVEL`)}</div>`
    : "";
  const dateBlock = dateRange ? `<p style="font-size:12.5px;color:#4b5563;margin:13px 0 0;"><strong style="color:${navy};">Conducted from</strong> ${esc(dateRange)}</p>` : "";
  const qrHtml = config.show_qr !== false && data.qr_svg ? qrBlock(data.qr_svg, navy, gold, 104, true) : "";
  const signatureImg = config.signature_url ? `<img src="${esc(config.signature_url)}" alt="" style="height:38px;object-fit:contain;"/>` : "";

  const isSingleSignature = config.signature_layout === "single";
  const primarySignatureBlock = isSingleSignature
    ? `<div style="text-align:center;font-size:11.5px;width:180px;">
        ${signatureImg}
        <div style="border-top:1px solid ${navy};margin:4px 0;"></div>
        <strong style="color:${navy};">${esc(config.signature_name || config.signature_title || "Director")}</strong>
        ${config.signature_name ? `<div style="color:#6b7280;">${esc(config.signature_title || "Director")}</div>` : ""}
      </div>`
    : `<div style="text-align:center;font-size:11.5px;width:180px;">
        ${signatureImg}
        <div style="border-top:1px solid ${navy};margin:4px 0;"></div>
        <strong style="color:${navy};">${esc(config.signature_name || "Trainer")}</strong>
        <div style="color:#6b7280;">Trainer Signature</div>
      </div>`;
  const secondarySignatureBlock = isSingleSignature
    ? ""
    : `<div style="text-align:center;font-size:11.5px;width:180px;">
        <div style="height:38px;"></div>
        <div style="border-top:1px solid ${navy};margin:4px 0;"></div>
        <strong style="color:${navy};">${esc(config.signature_title || "Training Manager")}</strong>
        <div style="color:#6b7280;">Training Manager</div>
      </div>`;

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:34px;font-family:Georgia,'Times New Roman',serif;color:#1F2937;overflow:hidden;${bgImage}">
  ${motif}
  ${ornateBorder(navy, gold)}
  <div style="position:relative;height:100%;padding:26px 34px;display:flex;flex-direction:column;text-align:center;">
    ${logo}
    <div style="letter-spacing:2px;font-size:15px;color:${navy};font-weight:700;">TERAS UNIVERSAL SDN. BHD.</div>
    <div style="font-size:9.5px;color:#6b7280;margin-top:2px;">${REG_NO}</div>
    <h1 style="font-size:56px;margin:18px 0 0;letter-spacing:2px;color:${gold};font-weight:700;line-height:1;">CERTIFICATE</h1>
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:8px;">
      <span style="width:46px;height:1.5px;background:${gold};display:inline-block;"></span>
      <span style="font-size:14px;color:${navy};letter-spacing:3px;font-weight:600;">OF SUCCESSFUL COMPLETION</span>
      <span style="width:46px;height:1.5px;background:${gold};display:inline-block;"></span>
    </div>
    <p style="font-size:13.5px;margin:22px 0 6px;color:#4b5563;">This certificate is proudly presented to</p>
    <div style="position:relative;display:inline-block;margin:0 auto;">
      <div style="font-size:${nameSize}px;font-weight:700;color:${navy};display:inline-block;padding:0 24px 8px;max-width:660px;word-break:break-word;">${esc(data.holder_name)}</div>
      <div style="border-top:2px solid ${gold};position:relative;">
        <span style="position:absolute;top:-4px;left:50%;transform:translateX(-50%) rotate(45deg);width:7px;height:7px;background:${gold};"></span>
      </div>
    </div>
    ${icBlock}
    <p style="font-size:13.5px;margin:20px 0 4px;color:#4b5563;">For successfully completing the</p>
    <div style="font-size:20px;font-weight:700;color:${navy};text-transform:uppercase;line-height:1.35;max-width:640px;margin:0 auto;">${esc(config.programme_title || data.course_name || "")}</div>
    ${levelBlock}
    ${durationBlock}
    ${dateBlock}
    <p style="font-size:12.5px;line-height:1.65;max-width:590px;margin:16px auto 0;color:#4b5563;">${esc(config.body_text || DEFAULT_BODY_TEXT)}</p>
    <div style="display:flex;gap:20px;margin:auto 0 0;padding-top:20px;text-align:left;position:relative;">
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;row-gap:20px;column-gap:14px;align-content:center;">
        ${metaTile("calendar", "Date of Completion", data.issue_date || "—", navy, gold)}
        ${metaTile("refresh", "Recommended Skills Update", config.skills_update_recommendation || "Within Three (3) Years", navy, gold)}
        ${metaTile("doc", "Certificate No.", data.certificate_number, navy, gold)}
        ${metaTile("id", "Participant ID", data.participant_id || "—", navy, gold)}
      </div>
      ${qrHtml}
    </div>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:28px;padding-top:4px;">
      ${primarySignatureBlock}
      ${secondarySignatureBlock}
      <div style="text-align:center;font-size:10.5px;width:66px;height:66px;border-radius:50%;border:1px dashed ${gold};display:flex;align-items:center;justify-content:center;color:#9ca3af;padding:4px;">COMPANY STAMP</div>
    </div>
  </div>
</div>`;
}

/** Render the certificate back (page 2, "Programme Information") as an HTML string. */
export function renderCertificateBack(data: CertData, config: TemplateConfig): string {
  if (config.show_back_page === false) return "";
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const coverage = config.coverage_items?.length ? config.coverage_items : DEFAULT_COVERAGE;
  const outcomes = config.learning_outcomes?.length ? config.learning_outcomes : DEFAULT_OUTCOMES;
  const assessment = config.assessment_methods?.length ? config.assessment_methods : DEFAULT_ASSESSMENT;
  const showSkillsRecord = config.show_skills_record !== false;
  // Mirrors CertificateDocument.tsx's CertificateBackPage precedence fix —
  // see that file's comment.
  const skillsRecord = data.certificate_skills_record?.length
    ? data.certificate_skills_record
    : data.participant_skills_record?.length
      ? data.participant_skills_record
      : config.skills_record?.length ? config.skills_record : DEFAULT_SKILLS_RECORD;
  const noticeParagraphs = config.important_notice ? config.important_notice.split(/\n{2,}/).filter(Boolean) : DEFAULT_NOTICE_PARAGRAPHS;

  const section = (icon: IconKind, title: string, body: string) =>
    `<div style="margin-bottom:18px;">
      <div style="display:flex;align-items:center;gap:8px;border-bottom:2px solid ${gold};padding-bottom:6px;margin-bottom:9px;">
        ${circleIcon(icon, navy, gold, 24)}<span style="font-size:12.5px;font-weight:700;color:${navy};letter-spacing:.4px;">${esc(title)}</span>
      </div>${body}
    </div>`;
  const checklist = (items: string[]) =>
    `<ul style="margin:0;padding:0;list-style:none;font-size:11.5px;line-height:1.9;color:#374151;">${items.map((it) => `<li style="display:flex;gap:6px;"><span style="color:${gold};font-weight:700;">✓</span>${esc(it)}</li>`).join("")}</ul>`;
  const colDivider = `<div style="width:1px;align-self:stretch;background:linear-gradient(${gold},${gold});background-size:1px 6px;background-repeat:repeat-y;opacity:.55;"></div>`;

  const skillsTable = showSkillsRecord
    ? section(
        "doc",
        "PARTICIPANT SKILLS RECORD",
        `<table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead><tr style="background:${navy};color:#fff;"><th style="text-align:left;padding:5px 6px;font-weight:600;">Assessment Area</th><th style="text-align:left;padding:5px 6px;font-weight:600;">Status</th></tr></thead>
          <tbody>${skillsRecord.map((r) => {
            const affirmative = isAffirmativeStatus(r.status);
            const color = affirmative ? gold : "#6b7280";
            const weight = affirmative ? 700 : 400;
            const mark = affirmative ? "✓ " : "";
            return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:5px 6px;color:#374151;">${esc(r.area)}</td><td style="padding:5px 6px;color:${color};font-weight:${weight};">${mark}${esc(r.status)}</td></tr>`;
          }).join("")}</tbody>
        </table>`
      )
    : "";

  const noticeHtml = noticeParagraphs
    .map((p, i) => `<p style="position:relative;margin:${i === 0 ? 0 : "7px 0 0"};font-size:10.5px;line-height:1.7;color:#4b5563;">${esc(p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme"))}</p>`)
    .join("");
  const qrHtml = config.show_qr !== false && data.qr_svg ? qrBlock(data.qr_svg, navy, gold, 58, false) : "";

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:34px;font-family:Georgia,'Times New Roman',serif;color:#1F2937;overflow:hidden;">
  ${scaffoldMotif(navy, true)}
  ${ornateBorder(navy, gold)}
  <div style="position:relative;height:100%;padding:28px 34px;display:flex;flex-direction:column;">
    ${ribbonBanner(`<span style="font-size:15px;font-weight:700;letter-spacing:2px;">PROGRAMME INFORMATION</span>`, navy, gold, "align-self:center;display:block;width:fit-content;margin:0 auto;")}
    <div style="text-align:center;font-size:20px;font-weight:700;color:${navy};text-transform:uppercase;margin:16px 0 6px;line-height:1.3;">${esc(config.programme_title || data.course_name || "")}</div>
    <div style="display:flex;justify-content:center;margin:0 0 20px;">
      <span style="width:6px;height:6px;background:${gold};transform:rotate(45deg);display:inline-block;"></span>
    </div>
    <div style="display:flex;gap:22px;flex:1;">
      <div style="flex:1;">
        ${section("target", "PROGRAMME OBJECTIVES", `<p style="margin:0;font-size:11.5px;line-height:1.75;color:#374151;">${esc(config.objectives_text || DEFAULT_OBJECTIVES)}</p>`)}
        ${section("book", "PROGRAMME COVERAGE", checklist(coverage))}
      </div>
      ${colDivider}
      <div style="flex:1;">
        ${section(
          "bulb",
          "LEARNING OUTCOMES",
          `<p style="margin:0 0 8px;font-size:11.5px;color:#374151;">Upon successful completion, participants should be able to:</p>
           <ul style="margin:0;padding-left:18px;font-size:11.5px;line-height:1.9;color:#374151;">${outcomes.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`
        )}
      </div>
      ${colDivider}
      <div style="flex:1;">
        ${section("clipboard", "ASSESSMENT METHOD", checklist(assessment))}
        ${skillsTable}
      </div>
    </div>
    <div style="position:relative;border:1.5px solid ${gold};border-radius:6px;padding:14px 18px;margin-top:10px;overflow:hidden;">
      ${scaffoldMotif(navy, true)}
      <div style="position:relative;display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        ${circleIcon("warning", navy, gold, 24)}<span style="font-size:12.5px;font-weight:700;color:${navy};">IMPORTANT NOTICE</span>
      </div>
      ${noticeHtml}
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1.5px solid ${gold};">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        ${circleIcon("shield", navy, gold, 24)}<span style="font-size:12.5px;font-weight:700;color:${navy};letter-spacing:.5px;">VERIFICATION</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:grid;grid-template-columns:1fr 1fr;row-gap:8px;column-gap:28px;font-size:10.5px;color:#374151;">
          <div style="display:flex;gap:8px;align-items:center;">${circleIcon("doc", navy, gold, 20)}<span><strong style="color:${navy};">Certificate No.</strong> ${esc(data.certificate_number)}</span></div>
          <div style="display:flex;gap:8px;align-items:center;">${circleIcon("phone", navy, gold, 20)}<span><strong style="color:${navy};">Contact Number</strong> ${esc(config.contact_phone || "019-519 3834")}</span></div>
          <div style="display:flex;gap:8px;align-items:center;">${circleIcon("globe", navy, gold, 20)}<span><strong style="color:${navy};">Website</strong> ${esc(config.contact_website || "www.terasuniversal.com.my")}</span></div>
          <div style="display:flex;gap:8px;align-items:center;">${circleIcon("mail", navy, gold, 20)}<span><strong style="color:${navy};">Email</strong> ${esc(config.contact_email || "admin@terasuniversal.com.my")}</span></div>
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
