import type { CertData, TemplateConfig } from "../components/admin/CertificateDocument";
import { fitHolderNameSize, formatDateRange, formatHumanDate, isAffirmativeStatus } from "./certificate-format";
import { CERTIFICATE_DESIGN, certificateFamilyLabel, isGoldenReferenceFamily } from "./certificate-design-system";
import { TERAS_COMPANY_NAME, TERAS_COMPANY_REGISTRATION, TERAS_COMPANY_TAGLINE } from "./teras-company";
import { resolveCertificateWatermarkAsset } from "./certificate-watermark-assets";
import { DIRECTOR_SIGNATURE_ASSET, EMBOSS_MEDALLION_LIFT_PX, EMBOSS_MEDALLION_SIZE_PX } from "./certificate-approval-assets";

/**
 * Standalone HTML string renderer for a certificate — no React / no
 * `react-dom/server`. Next.js App Router forbids importing `react-dom/server`
 * into route handlers, so the Bulk Certificate Download (ZIP) builds each
 * certificate document as a plain string here. The markup mirrors
 * `CertificateDocument`/`CertificateBackPage` (A4 portrait, inline styles,
 * with optional overflow continuation pages) so print output looks identical — keep both in sync.
 */

const PAGE_W = CERTIFICATE_DESIGN.page.widthPx;
const PAGE_H = CERTIFICATE_DESIGN.page.heightPx;
const DEFAULT_LOGO_URL = "/certificates/template-a/teras-symbol-v2.png";
/** Mirrors SANS in CertificateDocument.tsx — see that constant's comment. */
const SANS = CERTIFICATE_DESIGN.typography.sans;

// C4 BODY TEXT SPLIT START
const CERTIFICATE_BODY_TEXT_PAGE1_LIMIT = 360;
const CERTIFICATE_BODY_TEXT_CONTINUATION_LIMIT = 3000;

function splitCertificateTextChunk(text: string, limit: number) {
  if (text.length <= limit) return [text, ""];
  let splitAt = -1;
  for (let index = Math.min(limit, text.length - 1); index > 0; index -= 1) {
    if (/\s/.test(text[index])) {
      splitAt = index;
      break;
    }
  }
  if (splitAt <= 0) splitAt = limit;
  return [text.slice(0, splitAt), text.slice(splitAt)];
}

function splitCertificateBodyText(bodyText: string | null = "") {
  const safeBodyText = typeof bodyText === "string" ? bodyText : "";
  const [pageOneText, firstRemainder] = splitCertificateTextChunk(safeBodyText, CERTIFICATE_BODY_TEXT_PAGE1_LIMIT);
  if (firstRemainder && !firstRemainder.trim()) {
    return { pageOneText: pageOneText + firstRemainder, continuationPages: [] };
  }
  const continuationPages = [];
  let remainder = firstRemainder;
  while (remainder.length > 0) {
    const [pageText, nextRemainder] = splitCertificateTextChunk(remainder, CERTIFICATE_BODY_TEXT_CONTINUATION_LIMIT);
    if (nextRemainder && !nextRemainder.trim()) {
      continuationPages.push(pageText + nextRemainder);
      remainder = "";
    } else {
      continuationPages.push(pageText);
      remainder = nextRemainder;
    }
  }
  return { pageOneText, continuationPages };
}
// C4 BODY TEXT SPLIT END


// Neutral by design — see the same constant's comment in CertificateDocument.tsx.
const DEFAULT_SKILLS_RECORD = [
  { area: "Theory Session", status: "Not Recorded" },
  { area: "Practical Training", status: "Not Recorded" },
  { area: "Safety Awareness", status: "Not Recorded" },
  { area: "Practical Assessment", status: "Not Recorded" },
  { area: "Attendance Requirement", status: "Not Recorded" },
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
    ["tl", "top:30px;left:30px;"],
    ["tr", "top:30px;right:30px;"],
    ["bl", "bottom:30px;left:30px;"],
    ["br", "bottom:30px;right:30px;"],
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
  <div style="position:absolute;inset:${CERTIFICATE_DESIGN.page.borderInsetPx}px;border:5px solid ${navy};box-shadow:inset 0 0 0 2px ${gold},inset 0 0 0 6px #fff,inset 0 0 0 8px ${gold};pointer-events:none;z-index:5;"></div>
  <div style="position:absolute;top:${CERTIFICATE_DESIGN.page.borderInsetPx}px;left:${CERTIFICATE_DESIGN.page.borderInsetPx}px;width:159px;height:159px;background:${navy};clip-path:polygon(0 0,100% 0,0 100%);opacity:.97;pointer-events:none;z-index:1;"></div>
  <div style="position:absolute;right:${CERTIFICATE_DESIGN.page.borderInsetPx}px;bottom:${CERTIFICATE_DESIGN.page.borderInsetPx}px;width:159px;height:159px;background:linear-gradient(135deg,${navy} 70%,${gold} 70%,${gold} 75%,transparent 75%);clip-path:polygon(100% 0,100% 100%,0 100%);pointer-events:none;z-index:1;"></div>
  ${ticks}
  ${brackets}`;
}

/** Mirrors CertificateWatermark in CertificateDocument.tsx exactly. */
function certificateWatermark(config: TemplateConfig, corner: boolean, goldenReferencePageOne = false): string {
  const asset = resolveCertificateWatermarkAsset(config);
  if (!asset) return "";
  const pos = goldenReferencePageOne ? "top:270px;right:-24px;width:800px;height:560px;" : corner ? "top:220px;right:-190px;width:900px;height:720px;" : "top:253px;right:-95px;width:700px;height:560px;";
  const opacity = goldenReferencePageOne ? 0.048 : corner ? asset.page2Opacity : asset.primaryOpacity;
  return `<img src="${esc(asset.src)}" alt="" aria-hidden="true" style="position:absolute;${pos}object-fit:contain;pointer-events:none;opacity:${opacity};"/>`;
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
    <div style="font-size:${value.length > 28 ? 9 : value.length > 20 ? 10 : 11.5}px;font-weight:700;color:${navy};font-family:Georgia,serif;line-height:1.35;word-break:break-word;">${esc(value)}</div>
  </div>`;
}

/** Mirrors QrBlock in CertificateDocument.tsx — svg is pre-generated inline markup, not an <img src>. */
function qrBlock(svg: string, navy: string, gold: string, size: number, caption: boolean, safeZone = false): string {
  return `<div style="width:${size + 22}px;text-align:center;${safeZone ? "transform:translate(-56px,-26px);" : ""}">
    <div style="font-size:7px;font-weight:700;color:${navy};letter-spacing:1.6px;margin-bottom:2px;font-family:${SANS};">QR VERIFICATION</div>
    <div style="width:22px;height:1px;background:${gold};margin:0 auto 7px;"></div>
    <div style="position:relative;width:${size + 8}px;height:${size + 8}px;margin:0 auto;">
      <div style="position:absolute;inset:-3px;border:1px solid ${gold};opacity:.7;"></div>
      <div style="position:absolute;inset:0;padding:4px;background:#fff;border:1px solid ${navy};box-sizing:border-box;">${svg}</div>
    </div>
    ${caption ? `<div style="font-size:7px;color:#667085;margin-top:8px;line-height:1.5;font-family:${SANS};letter-spacing:.2px;">Scan to verify this certificate at Teras Universal Database</div>` : ""}
  </div>`;
}

function taglineFooter(navy: string, gold: string): string {
  return `<div style="position:absolute;left:${CERTIFICATE_DESIGN.page.safeMarginPx}px;right:${CERTIFICATE_DESIGN.page.safeMarginPx}px;bottom:28px;z-index:3;display:flex;align-items:center;justify-content:center;gap:10px;color:${navy};font-size:8.2px;font-weight:600;letter-spacing:1.6px;font-family:${SANS};text-align:center;white-space:nowrap;"><span style="width:28px;height:1px;background:${gold};opacity:.75;"></span><span>${TERAS_COMPANY_TAGLINE}</span><span style="width:28px;height:1px;background:${gold};opacity:.75;"></span></div>`;
}

/** Mirrors AuthorisedSignatureLabel in CertificateDocument.tsx — shown only when there's no signature_url, guidance above the still-empty well, never a substitute mark. */
function authorisedSignatureLabel(): string {
  return `<div style="color:#9aa3b2;font-size:6.5px;letter-spacing:1.3px;font-family:${SANS};text-transform:uppercase;margin-bottom:3px;">Authorised Signature</div>`;
}


/** Mirrors RibbonBanner in CertificateDocument.tsx — flat navy label plate ruled top and bottom in gold; see that component's comment for why the offset ring was dropped. */
function ribbonBanner(inner: string, navy: string, gold: string, wrapStyle = ""): string {
  return `<div style="display:inline-block;background:${navy};color:#fff;padding:5px 30px;border-top:1px solid ${gold};border-bottom:1px solid ${gold};${wrapStyle}">${inner}</div>`;
}

function renderGoldenReferencePageOne(data: CertData, config: TemplateConfig, navy: string, gold: string): string {
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  const { pageOneText } = splitCertificateBodyText(config.body_text);
  const signatureUrl = DIRECTOR_SIGNATURE_ASSET;
  const directorName = "Director";
  const logo = `<img src="${esc(config.logo_url || DEFAULT_LOGO_URL)}" alt="TERAS Universal" style="width:124px;height:91px;object-fit:contain;object-position:center;display:block;mix-blend-mode:multiply;"/>`;
  const dateInfo = `${dateRange ? `<div style="color:#8a94a6;font-size:7.5px;letter-spacing:1.4px;text-transform:uppercase;">Conducted from</div><div style="font-size:10.5px;font-weight:600;margin-top:2px;">${esc(dateRange)}</div>` : ""}${data.venue ? `<div style="color:#8a94a6;font-size:7.5px;letter-spacing:1.4px;text-transform:uppercase;margin-top:8px;">At</div><div style="font-size:10px;margin-top:1px;">${esc(data.venue)}</div>` : ""}${duration ? `<div style="color:${navy};font-size:9px;font-weight:700;letter-spacing:.85px;margin-top:8px;">TRAINING DURATION: ${esc(duration)}</div>` : ""}`;
  const signature = `<div style="height:68px;display:flex;align-items:flex-end;justify-content:center;"><img src="${esc(signatureUrl)}" alt="" style="max-height:62px;max-width:180px;object-fit:contain;"/></div>`;
  const bodyText = pageOneText ? `<p style="font-size:9px;line-height:1.55;max-width:520px;margin:11px auto 0;color:#596273;overflow-wrap:anywhere;">${esc(pageOneText)}</p>` : "";

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:${CERTIFICATE_DESIGN.colors.white};box-sizing:border-box;padding:${CERTIFICATE_DESIGN.page.safeMarginPx}px;font-family:${CERTIFICATE_DESIGN.typography.sans};color:${CERTIFICATE_DESIGN.colors.ink};overflow:hidden;">
    ${certificateWatermark(config, false, true)}
    ${certificateFrame(navy, gold)}
    <div style="position:relative;z-index:2;height:100%;box-sizing:border-box;padding:15px 8px 120px;display:flex;flex-direction:column;text-align:center;">
      <header style="display:flex;flex-direction:column;align-items:center;text-align:center;">
        ${logo}
        <div style="color:${navy};font-family:${CERTIFICATE_DESIGN.typography.heading};font-size:13.5px;font-weight:700;letter-spacing:2.1px;margin-top:1px;">${TERAS_COMPANY_NAME}</div>
        <div style="color:#667085;font-family:${SANS};font-size:6.5px;letter-spacing:.65px;margin-top:3px;">${TERAS_COMPANY_TAGLINE}</div>
        <div style="color:#667085;font-family:${SANS};font-size:7px;letter-spacing:.65px;margin-top:3px;">REG. NO. ${TERAS_COMPANY_REGISTRATION}</div>
        <div style="width:100%;height:1px;margin-top:12px;background:linear-gradient(90deg,${navy} 0 31%,${gold} 31% 69%,${navy} 69% 100%);"></div>
      </header>
      <h1 style="color:${navy};font-family:${CERTIFICATE_DESIGN.typography.heading};font-size:22px;font-weight:700;letter-spacing:2.3px;line-height:1.2;margin:14px 0 0;">${esc(config.certificate_title || "")}</h1>
      <p style="color:#8a94a6;font-family:${SANS};font-size:9px;letter-spacing:1.55px;line-height:1.4;margin:21px 0 9px;text-transform:uppercase;">This certificate is proudly presented to</p>
      <div style="font-size:${Math.min(fitHolderNameSize(data.holder_name) + 8, CERTIFICATE_DESIGN.typography.participantNamePx)}px;font-weight:700;color:${navy};padding:0 8px 12px;word-break:break-word;line-height:1.15;letter-spacing:.35px;font-family:${CERTIFICATE_DESIGN.typography.heading};">${esc(data.holder_name)}</div>
      <div style="width:210px;max-width:60%;height:1px;background:#d3d9e2;margin:0 auto;"><span style="display:block;width:52px;height:2px;margin:0 auto;background:${gold};"></span></div>
      ${data.ic_passport ? `<p style="font-size:9px;color:#667085;margin:7px 0 0;letter-spacing:.35px;font-family:${SANS};overflow-wrap:anywhere;">IC / Passport No.: <strong style="color:${navy};font-weight:700;">${esc(data.ic_passport)}</strong></p>` : ""}
      <p style="font-size:8.5px;margin:16px 0 6px;color:#8a94a6;letter-spacing:1.6px;font-family:${SANS};text-transform:uppercase;">For successfully completing the</p>
      <div style="font-size:20px;font-weight:700;color:${navy};text-transform:uppercase;line-height:1.25;max-width:610px;margin:0 auto;letter-spacing:.65px;font-family:${CERTIFICATE_DESIGN.typography.heading};overflow-wrap:anywhere;">${esc(data.course_name)}</div>
      ${config.programme_title ? `<div style="color:#536174;font-family:${SANS};font-size:8px;font-weight:600;letter-spacing:1.05px;margin-top:6px;">${esc(config.programme_title)}</div>` : ""}
      <div style="margin:30px auto 0;color:${navy};font-family:${SANS};line-height:1.5;">${dateInfo}</div>
      ${bodyText}
      <div style="margin-top:auto;padding-top:18px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;text-align:center;">
        <div style="flex:0 0 165px;text-align:left;font-size:9px;"><div style="color:#8a94a6;font-size:7px;letter-spacing:1.1px;font-family:${SANS};text-transform:uppercase;margin-bottom:4px;">Certificate No.</div><strong style="color:${navy};font-family:Georgia,serif;font-size:10px;overflow-wrap:anywhere;">${esc(data.certificate_number)}</strong>${data.issue_date ? `<div style="color:#667085;font-size:8px;margin-top:5px;">Issued ${esc(formatHumanDate(data.issue_date))}</div>` : ""}</div>
        <div style="flex:1 1 270px;max-width:300px;min-width:220px;display:flex;flex-direction:column;align-items:center;font-size:9px;">${signature}<div style="width:86%;border-top:1px solid ${navy};margin:3px 0 4px;"></div><strong style="color:${navy};font-family:${CERTIFICATE_DESIGN.typography.heading};font-size:8.5px;letter-spacing:.3px;">${esc(directorName)}</strong><div style="color:${navy};font-family:${SANS};font-size:7.5px;font-weight:700;letter-spacing:1.1px;margin-top:2px;">AUTHORIZED DIRECTOR</div><div style="color:#667085;font-family:${SANS};font-size:7px;letter-spacing:.45px;margin-top:2px;">${TERAS_COMPANY_NAME}</div></div>
        <div style="flex:0 0 145px;display:flex;flex-direction:column;align-items:center;"><div aria-label="STAMP_ASSET_PENDING — neutral seal placeholder for review only" style="width:108px;height:108px;border:1.5px solid rgba(201,162,39,.72);border-radius:50%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:9px;color:#8a94a6;font-family:${SANS};font-size:7px;letter-spacing:.8px;line-height:1.4;text-align:center;">STAMP_ASSET_PENDING</div><div style="color:#8a94a6;font-family:${SANS};font-size:6.5px;letter-spacing:.65px;margin-top:3px;">FOR REVIEW ONLY</div></div>
      </div>
    </div>
    ${taglineFooter(navy, gold)}</div>`;
}

/** Render the certificate front (page 1, the A4 card) as an HTML string. */
export function renderCertificateFront(data: CertData, config: TemplateConfig): string {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  const showDurationRibbon = Boolean(duration);
  const { pageOneText: pageOneBodyText } = splitCertificateBodyText(config.body_text);
  const nameSize = fitHolderNameSize(data.holder_name) + 8;
  const motif = certificateWatermark(config, false);
  const logo = `<img src="${esc(config.logo_url || DEFAULT_LOGO_URL)}" alt="TERAS Universal" style="width:228px;height:106px;margin-left:52px;object-fit:contain;object-position:left center;display:block;mix-blend-mode:multiply;position:relative;z-index:2;"/>`;
  const icBlock = data.ic_passport ? `<p style="font-size:9.5px;color:#667085;margin:10px 0 0;letter-spacing:.6px;font-family:${SANS};overflow-wrap:anywhere;">IC / Passport No.: <strong style="color:${navy};font-weight:700;">${esc(data.ic_passport)}</strong></p>` : "";
  const durationBlock = showDurationRibbon && duration
    ? ribbonBanner(`<span style="font-size:9px;font-weight:600;letter-spacing:2.4px;font-family:${SANS};text-indent:2.4px;">${esc(duration)}</span>`, navy, gold, "margin:19px auto 0;display:block;width:fit-content;")
    : "";
  const bodyText = pageOneBodyText ? `<p style="font-size:10.5px;line-height:1.85;max-width:520px;margin:17px auto 0;color:#6b7280;overflow-wrap:anywhere;">${esc(pageOneBodyText)}</p>` : "";
  const dateBlock = dateRange
    ? `<p style="font-size:11px;color:#4b5563;margin:16px 0 0;line-height:1.45;"><span style="display:block;"><span style="color:#667085;letter-spacing:1.3px;font-size:8.5px;font-family:${SANS};text-transform:uppercase;">Conducted from </span>${esc(dateRange)}</span>${data.venue ? `<span style="display:block;margin-top:2px;">at ${esc(data.venue)}</span>` : ""}</p>`
    : "";

  // Mirrors CertificateDocument: Scaffold, Professional Scaffold and Working
  // at Height certificates use the Director-only block without an explicit
  // signature_layout.
  const isSingleSignature = config.signature_layout === "single" || config.design_variant === "standard_scaffold_certificate" || config.design_variant === "working_at_height_certificate" || config.design_variant === "professional_scaffold_erection_skills";
  const signatureUrl = config.signature_url || (isSingleSignature ? DIRECTOR_SIGNATURE_ASSET : undefined);
  const useGoldenReferencePageOne = isGoldenReferenceFamily(config);
  if (useGoldenReferencePageOne) return renderGoldenReferencePageOne(data, config, navy, gold);
  const signatureImg = signatureUrl ? `<img src="${esc(signatureUrl)}" alt="" style="max-height:92px;max-width:145px;object-fit:contain;"/>` : "";
  const signatureWell = `<div style="height:92px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px;">${signatureImg}</div>`;
  const roleLine = (text: string) => `<div style="color:#8a94a6;font-size:8.5px;letter-spacing:1.3px;font-family:${SANS};text-transform:uppercase;margin-top:3px;">${esc(text)}</div>`;
  // Structural guidance only when there's no signature URL -- the well stays
  // visibly empty either way; see authorisedSignatureLabel's own comment.
  const primarySigLabel = signatureUrl ? "" : authorisedSignatureLabel();
  const primarySignatureBlock = isSingleSignature
    ? `<div style="text-align:center;font-size:11px;width:auto;max-width:160px;">
        ${primarySigLabel}
        ${signatureWell}
        <div style="border-top:1px solid ${navy};margin:4px 0 5px;"></div>
        <strong style="color:${navy};letter-spacing:.3px;">AUTHORISED DIRECTOR</strong>
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

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:${CERTIFICATE_DESIGN.page.safeMarginPx}px;font-family:${CERTIFICATE_DESIGN.typography.sans};color:${CERTIFICATE_DESIGN.colors.ink};overflow:hidden;">
  ${motif}
  ${certificateFrame(navy, gold)}
  <div style="position:relative;height:100%;box-sizing:border-box;padding:14px 0 0;display:flex;flex-direction:column;text-align:center;">
    <div style="position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:18px;text-align:left;min-height:110px;padding:0 8px 12px;border-bottom:1px solid ${gold};">${logo}<div style="padding-top:6px;text-align:right;color:#667085;font-family:${SANS};font-size:7px;letter-spacing:1.1px;line-height:1.55;"><div style="color:${navy};font-weight:700;letter-spacing:1.6px;">OFFICIAL TERAS UNIVERSAL CERTIFICATE</div><div style="margin-top:3px;opacity:.82;">REG. NO. ${TERAS_COMPANY_REGISTRATION}</div></div><div style="position:absolute;left:-8px;bottom:-2px;width:210px;height:3px;background:linear-gradient(90deg,${navy} 0 78%,${gold} 78% 100%);"></div></div>
    <div style="letter-spacing:2.5px;font-size:11px;color:${navy};font-weight:700;font-family:'Montserrat','Poppins','Inter',Arial,sans-serif;text-align:left;margin-top:3px;">${TERAS_COMPANY_NAME}</div>
    <div style="width:52px;height:1px;background:${gold};margin:11px auto 0;"></div>
    <div style="font-size:8px;color:${navy};margin-top:9px;letter-spacing:1.8px;font-weight:700;font-family:${SANS};">${esc(certificateFamilyLabel(config))}</div>
    <h1 style="font-size:${CERTIFICATE_DESIGN.typography.certificateTitlePx}px;margin:12px 0 0;letter-spacing:5px;color:${navy};font-weight:700;line-height:1.1;font-family:'Montserrat','Poppins','Inter',Arial,sans-serif;">CERTIFICATE</h1>
    ${config.certificate_subtitle ? `<div style="font-size:8.5px;color:#667085;letter-spacing:3.5px;font-weight:600;font-family:${SANS};text-indent:3.5px;margin-top:10px;">${esc(config.certificate_subtitle)}</div>` : ""}
    <p style="font-size:9.5px;margin:24px 0 9px;color:#8a94a6;letter-spacing:1.8px;font-family:${SANS};text-transform:uppercase;text-indent:1.8px;">This certificate is proudly presented to</p>
    <div style="position:relative;display:inline-block;margin:0 auto;max-width:660px;">
      <div style="font-size:${Math.min(nameSize, CERTIFICATE_DESIGN.typography.participantNamePx)}px;font-weight:700;color:${navy};padding:0 12px 14px;word-break:break-word;line-height:1.18;letter-spacing:.4px;font-family:'Montserrat','Poppins','Inter',Arial,sans-serif;">${esc(data.holder_name)}</div>
      <div style="position:relative;height:1px;background:#d3d9e2;">
        <span style="position:absolute;top:-0.5px;left:50%;transform:translateX(-50%);width:130px;height:2px;background:${gold};"></span>
      </div>
      <div style="height:1px;width:46%;margin:4px auto 0;background:#d3d9e2;opacity:.55;"></div>
    </div>
    ${icBlock}
    <p style="font-size:9px;margin:18px 0 0;color:#8a94a6;letter-spacing:1.8px;font-family:${SANS};text-transform:uppercase;text-indent:1.8px;">For successfully completing the</p>
    <div style="width:30px;height:1px;background:${gold};margin:8px auto 10px;"></div>
    <div style="font-size:${CERTIFICATE_DESIGN.typography.courseNamePx}px;font-weight:700;color:${navy};text-transform:uppercase;line-height:1.3;max-width:600px;margin:0 auto;letter-spacing:.8px;font-family:'Montserrat','Poppins','Inter',Arial,sans-serif;overflow-wrap:anywhere;">${esc(data.course_name)}</div>
    <div style="width:150px;height:1px;background:${navy};opacity:.22;margin:11px auto 0;"></div>
    ${durationBlock}
    ${dateBlock}
    ${bodyText}
    <div style="margin:auto 0 0;border-top:1px solid ${navy};border-bottom:1px solid #e3e7ee;padding:12px 4px 11px;display:flex;gap:18px;text-align:left;align-items:flex-start;">
      ${metaTile("refresh", "Programme Duration", duration || "—", navy, gold)}
      <div style="width:1px;background:#e3e7ee;align-self:stretch;"></div>
      ${metaTile("id", "Venue", data.venue || "—", navy, gold)}
    </div>
    <div style="position:relative;margin-top:18px;padding-top:18px;border-top:1px solid #e3e7ee;">
    <span style="position:absolute;top:-1px;left:50%;transform:translateX(-50%);width:48px;height:2px;background:${gold};"></span>
    <div style="display:flex;align-items:flex-end;justify-content:center;gap:${isSingleSignature ? 16 : 24}px;">
      <div style="text-align:left;font-size:9px;width:155px;align-self:center;"><div style="color:#8a94a6;font-size:7px;letter-spacing:1.1px;font-family:${SANS};text-transform:uppercase;margin-bottom:4px;">Certificate No.</div><strong style="color:${navy};font-family:Georgia,serif;font-size:10.5px;white-space:nowrap;">${esc(data.certificate_number)}</strong>${data.issue_date ? `<div style="color:#8a94a6;font-size:8px;margin-top:4px;white-space:nowrap;">Date Issued · ${esc(data.issue_date)}</div>` : ""}</div>
      <div style="width:1px;align-self:stretch;background:#e3e7ee;"></div>
      ${primarySignatureBlock}
      ${secondarySignatureBlock}
      <div style="width:1px;align-self:stretch;background:#e3e7ee;"></div>
      ${isSingleSignature
        ? `<div aria-label="Gold Emboss Medallion Guide" style="position:relative;transform:translateY(-${EMBOSS_MEDALLION_LIFT_PX}px);flex:0 0 auto;width:${EMBOSS_MEDALLION_SIZE_PX}px;height:${EMBOSS_MEDALLION_SIZE_PX}px;border:1.5px solid rgba(201,162,39,.78);border-radius:50%;box-sizing:border-box;background:radial-gradient(circle,transparent 0 62%,rgba(201,162,39,.045) 62% 63%,transparent 63%);"><span style="position:absolute;inset:7px;border:1px solid rgba(201,162,39,.52);border-radius:50%;"></span></div>`
        : `<div aria-hidden="true" style="width:88px;min-height:72px;"></div>`}
      <div style="width:1px;align-self:stretch;background:#e3e7ee;"></div>
    </div>
        </div>
      </div>
    ${taglineFooter(navy, gold)}</div>`;
}

/** Render the certificate back (page 2, "Programme Information") as an HTML string. */
export function renderCertificateBack(data: CertData, config: TemplateConfig): string {
  if (config.show_back_page === false) return "";
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const backMotif = certificateWatermark(config, true);
  const coverage = config.coverage_items || [];
  const outcomes = config.learning_outcomes || [];
  const assessment = config.assessment_methods || [];
  const showSkillsRecord = config.show_skills_record !== false;
  const skillsRecord = data.skills?.length ? data.skills : DEFAULT_SKILLS_RECORD;
  const noticeParagraphs = config.important_notice?.split(/\n{2,}/).filter(Boolean) || [];

  /** Mirrors SectionHead in CertificateDocument.tsx — one head treatment for every block on this page. */
  const sectionHead = (icon: IconKind, title: string) =>
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        ${glyph(icon, gold, 11)}<span style="font-size:9px;font-weight:700;color:${navy};letter-spacing:1.6px;font-family:${SANS};">${esc(title)}</span>
      </div>
      <div style="display:flex;margin-bottom:8px;">
        <span style="width:22px;height:1.5px;background:${gold};"></span>
        <span style="flex:1;height:1px;background:#e3e7ee;align-self:center;"></span>
      </div>`;
  const section = (icon: IconKind, title: string, body: string) =>
    `<div style="margin-bottom:16px;">
      ${sectionHead(icon, title)}${body}
    </div>`;
  /** Mirrors BulletList in CertificateDocument.tsx — one gold-square bullet treatment for every list on this page. */
  const bulletList = (items: string[]) =>
    `<ul style="margin:0;padding:0;list-style:none;font-size:10.5px;line-height:1.7;color:#374151;">${items
      .map((it) => `<li style="display:flex;gap:8px;margin-bottom:4px;"><span style="width:6px;height:1px;background:${gold};margin-top:8px;flex-shrink:0;"></span><span>${esc(it)}</span></li>`)
      .join("")}</ul>`;
  const colDivider = `<div style="width:1px;align-self:stretch;background:#edf0f4;"></div>`;
  const thStyle = `text-align:left;font-weight:700;color:#8a94a6;font-family:${SANS};font-size:8px;letter-spacing:1.1px;text-transform:uppercase;border-bottom:1px solid ${gold};`;

  const skillsTable = showSkillsRecord
    ? `${sectionHead("doc", "PARTICIPANT SKILLS RECORD")}
        <table style="width:100%;border-collapse:collapse;font-size:9.5px;">
          <thead><tr><th style="${thStyle}padding:0 6px 7px 0;font-size:8.2px;">Assessment Area</th><th style="${thStyle}padding:0 0 7px 6px;font-size:8.2px;">Status</th></tr></thead>
          <tbody>${skillsRecord.map((r) => {
            const affirmative = isAffirmativeStatus(r.status);
            const color = affirmative ? navy : "#8a94a6";
            const weight = affirmative ? 700 : 400;
            return `<tr style="border-bottom:1px solid #eef1f5;"><td style="padding:7px 6px 7px 0;color:#374151;">${esc(r.area)}</td><td style="padding:7px 0 7px 6px;color:${color};font-weight:${weight};">${esc(r.status)}</td></tr>`;
          }).join("")}</tbody>
        </table>`
    : "";

  const noticeHtml = noticeParagraphs
    .map((p, i) => `<p style="position:relative;margin:${i === 0 ? 0 : "6px 0 0"};font-size:9.5px;line-height:1.65;color:#6b7280;">${esc(p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme"))}</p>`)
    .join("");
  const verifyRow = (label: string, value: string) =>
    `<div style="border-left:1px solid #e3e7ee;padding-left:10px;">
      <div style="font-size:8px;letter-spacing:1.1px;color:#8a94a6;font-family:${SANS};text-transform:uppercase;">${esc(label)}</div>
      <div style="color:${navy};font-weight:700;margin-top:2px;">${esc(value)}</div>
    </div>`;
  const qrHtml = config.show_qr !== false && data.qr_svg
    ? `<div style="border-left:1px solid #e3e7ee;padding-left:20px;">${qrBlock(data.qr_svg, navy, gold, CERTIFICATE_DESIGN.qr.sizePx - 34, true, true)}</div>`
    : "";

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:${CERTIFICATE_DESIGN.page.safeMarginPx}px;font-family:${CERTIFICATE_DESIGN.typography.sans};color:${CERTIFICATE_DESIGN.colors.ink};overflow:hidden;${splitCertificateBodyText(config.body_text).continuationPages.length ? "page-break-after:always;" : ""}">
  ${backMotif}
  ${certificateFrame(navy, gold)}
  <div style="position:relative;height:100%;box-sizing:border-box;padding:14px 0 0;display:flex;flex-direction:column;">
    ${ribbonBanner(`<span style="font-size:9px;font-weight:700;letter-spacing:2.2px;font-family:${SANS};text-indent:2.2px;">PARTICIPANT SKILLS RECORD</span>`, navy, gold, "align-self:center;display:block;width:fit-content;margin:0 auto;")}
    <div style="text-align:center;font-size:16px;font-weight:700;color:${navy};text-transform:uppercase;margin:13px 0 0;line-height:1.3;letter-spacing:.8px;font-family:'Montserrat','Poppins','Inter',Arial,sans-serif;overflow-wrap:anywhere;">${esc(config.programme_title || data.course_name || "")}</div>
    <div style="display:flex;justify-content:center;gap:18px;flex-wrap:wrap;margin:8px 0 0;color:#667085;font-family:${SANS};font-size:8.5px;"><span>Participant: <strong style="color:${navy}">${esc(data.holder_name)}</strong></span>${data.ic_passport ? `<span style="overflow-wrap:anywhere;">IC / Passport No.: <strong style="color:${navy}">${esc(data.ic_passport)}</strong></span>` : ""}<span>Certificate No.: <strong style="color:${navy}">${esc(data.certificate_number)}</strong></span><span>Training period: <strong style="color:${navy}">${esc(formatDateRange(data.training_date, data.training_end_date) || "—")}</strong></span></div>
    <div style="display:flex;margin:10px 0 15px;">
      <span style="width:28px;height:1.5px;background:${gold};"></span>
      <span style="flex:1;height:1px;background:#e3e7ee;align-self:center;"></span>
    </div>
    ${showSkillsRecord ? `<div style="border-top:1px solid ${navy};border-bottom:1px solid #e3e7ee;padding:12px 14px 10px;margin-bottom:18px;">${skillsTable}</div>` : ""}
    <div style="display:flex;gap:26px;flex:1;">
      <div style="flex:1;padding-top:16px;">
        ${config.objectives_text ? section("target", "PROGRAMME OBJECTIVES", `<p style="margin:0;font-size:10px;line-height:1.7;color:#374151;">${esc(config.objectives_text)}</p>`) : ""}
        ${coverage.length ? section("book", "PROGRAMME COVERAGE", bulletList(coverage)) : ""}
      </div>
      ${colDivider}
      <div style="flex:1;padding-top:16px;">
        ${outcomes.length ? section(
                  "bulb",
                  "LEARNING OUTCOMES",
                  `<p style="margin:0 0 10px;font-size:10.5px;line-height:1.7;color:#6b7280;">Upon successful completion, participants should be able to:</p>
                   ${bulletList(outcomes)}`
                ) : ""}
      </div>
      ${colDivider}
      <div style="flex:1;padding-top:16px;">
        ${assessment.length ? section("clipboard", "ASSESSMENT METHOD", bulletList(assessment)) : ""}
      </div>
    </div>
    ${noticeParagraphs.length ? `<div style="position:relative;border:1px solid #e3e7ee;padding:13px 16px;margin-top:8px;overflow:hidden;background:#FCFDFE;">
          ${sectionHead("warning", "IMPORTANT NOTICE")}
          ${noticeHtml}
        </div>` : ""}
    <div style="margin-top:16px;padding-bottom:8px;">
      ${sectionHead("shield", "VERIFICATION")}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:22px;">
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;row-gap:11px;column-gap:24px;font-size:10px;color:#374151;">
          ${verifyRow("Certificate No.", data.certificate_number)}
          ${config.contact_phone ? verifyRow("Contact Number", config.contact_phone) : ""}
          ${config.contact_website ? verifyRow("Website", config.contact_website) : ""}
          ${config.contact_email ? verifyRow("Email", config.contact_email) : ""}
        </div>
        ${qrHtml}
      </div>
          </div>
        </div>
      ${taglineFooter(navy, gold)}</div>`;
}

function renderCertificateBodyTextContinuationPage(
  data: CertData,
  config: TemplateConfig,
  text: string,
  pageIndex: number,
  totalPages: number,
): string {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const firstContinuationPage = config.show_back_page === false ? 2 : 3;
  const totalDocumentPages = totalPages + firstContinuationPage - 1;
  const logicalPageNumber = pageIndex + firstContinuationPage;
  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:${CERTIFICATE_DESIGN.page.safeMarginPx}px;font-family:${CERTIFICATE_DESIGN.typography.sans};color:${navy};overflow:hidden;${pageIndex < totalPages - 1 ? "page-break-after:always;" : ""}">
    ${certificateWatermark(config, false)}
    ${certificateFrame(navy, gold)}
    <div style="position:relative;z-index:2;display:flex;flex-direction:column;height:100%;box-sizing:border-box;padding-top:22px;">
      <div style="display:flex;align-items:center;gap:18px;padding-bottom:16px;border-bottom:1px solid #e3e7ee;">
        <img src="${esc(config.logo_url || DEFAULT_LOGO_URL)}" alt="${TERAS_COMPANY_NAME}" style="width:92px;height:70px;object-fit:contain;"/>
        <div style="flex:1;display:flex;justify-content:space-between;align-items:center;gap:14px;">
          <div>
            <div style="font-family:${CERTIFICATE_DESIGN.typography.heading};font-size:15px;font-weight:700;letter-spacing:1.5px;">${TERAS_COMPANY_NAME}</div>
            <div style="margin-top:5px;font-size:8px;letter-spacing:1.5px;color:#667085;">${TERAS_COMPANY_REGISTRATION}</div>
          </div>
          <div style="font-size:8px;color:#667085;letter-spacing:.8px;text-align:right;">CONTINUED — PAGE ${logicalPageNumber} OF ${totalDocumentPages}</div>
        </div>
      </div>
      <div style="margin-top:30px;text-align:center;">
        <div style="font-size:8px;letter-spacing:2px;color:#8a94a6;font-family:${SANS};text-transform:uppercase;">Certificate Information</div>
        <h1 style="margin:10px 0 0;font-size:19px;line-height:1.25;letter-spacing:2.2px;font-family:${CERTIFICATE_DESIGN.typography.heading};color:${navy};">PROGRAMME DETAILS (CONTINUED)</h1>
        <div style="margin-top:12px;font-size:8.5px;color:#667085;letter-spacing:.6px;font-family:${SANS};">Certificate No. <strong style="color:${navy};overflow-wrap:anywhere;">${esc(data.certificate_number)}</strong></div>
        <div style="width:52px;height:1px;background:${gold};margin:15px auto 0;"></div>
      </div>
      <div style="flex:1;min-height:0;margin-top:24px;border-left:2px solid ${gold};padding:4px 0 4px 18px;font-size:11px;line-height:1.65;color:#4b5563;white-space:pre-wrap;overflow-wrap:anywhere;">${esc(text)}</div>
    </div>
    ${taglineFooter(navy, gold)}
  </div>`;
}

function renderCertificateBodyTextContinuationPages(data: CertData, config: TemplateConfig): string {
  const { continuationPages } = splitCertificateBodyText(config.body_text);
  return continuationPages
    .map((text, index) => renderCertificateBodyTextContinuationPage(data, config, text, index, continuationPages.length))
    .join("");
}

/** Front then Page 2; optional text continuation pages follow without moving Page 2 QR. */
export function renderCertificateBody(data: CertData, config: TemplateConfig): string {
  const front = renderCertificateFront(data, config);
  const back = renderCertificateBack(data, config);
  const continuation = renderCertificateBodyTextContinuationPages(data, config);
  const firstPage = back || continuation ? `<div style="page-break-after:always;">${front}</div>` : front;
  return `${firstPage}${back}${continuation}`;
}

/** Full standalone, printable HTML document using the shared TERAS master layout. */
export function renderCertificateDocument(data: CertData, config: TemplateConfig): string {
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
