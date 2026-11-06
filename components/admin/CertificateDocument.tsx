import type { CSSProperties, ReactNode } from "react";
import { fitHolderNameSize, formatAddressLines, formatDateRange, formatHumanDate, isAffirmativeStatus } from "../../lib/certificate-format";
import type { CertificateSkillRow, CertificateSkillsCompleteness, CertificateSkillsProvenance } from "../../lib/certificate-skills";
import { erectorGoldenWatermarkBox, inspectorGoldenWatermarkBox, wahGoldenWatermarkBox, resolveCertificateWatermarkAsset, type WatermarkLevel } from "../../lib/certificate-watermark-assets";
import { CERTIFICATE_DESIGN, certificateFamilyLabel, isGoldenReferenceFamily, type GoldenReferenceFamily } from "../../lib/certificate-design-system";
import { TERAS_COMPANY_NAME, TERAS_COMPANY_REGISTRATION, TERAS_COMPANY_TAGLINE } from "../../lib/teras-company";
import { C4_SIGNATURE_MAX_HEIGHT_PX, COMMON_SEAL_IMAGE_PX, EMBOSS_MEDALLION_LIFT_PX, EMBOSS_MEDALLION_SIZE_PX, RENDER_ASSET_PREVIEW_LABEL, renderAssetSources, type CertificateRenderAssets } from "../../lib/certificate-approval-assets";

/**
 * Template-driven certificate renderer (server component, no client JS).
 * Given the certificate row + its template config + related data, renders
 * the two-page A4 portrait certificate (front + Programme Information back).
 * Used by the preview, the template editor, and the A4 print/PDF page.
 * Styling is inline so it renders identically in a standalone print document.
 * Mirrored, string-for-string in structure, by lib/certificate-html.ts for
 * the bulk ZIP download path — keep both in sync.
 */
export interface CertData {
  /** Explicit runtime provenance: modern rows render from the immutable issuance contract. */
  render_mode?: "MODERN_SNAPSHOT" | "LEGACY_FALLBACK";
  skills_provenance?: CertificateSkillsProvenance;
  skills_completeness?: CertificateSkillsCompleteness;
  renderer_version?: string | null;
  certificate_number: string;
  holder_name: string;
  course_name?: string | null;
  programme_duration?: string | null;
  ic_passport?: string | null;
  participant_id?: string | null;
  training_date?: string | null;
  training_end_date?: string | null;
  venue?: string | null;
  trainer?: string | null;
  issue_date?: string | null;
  /** Absolute URL already resolved by certData.ts from stored verification metadata. */
  verification_url?: string | null;
  /** Inline QR SVG markup, generated once in certData.ts (see generateQrSvg). */
  qr_svg?: string | null;
  /**
   * Immutable issuance snapshot (Phase 2C), loaded from
   * certificate_skill_results keyed by this certificate's own id — what was
   * true when THIS certificate was issued, permanently. Takes precedence
   * over everything else when present (a Phase-2C-issued certificate always
   * has all 5 rows; never partially present). Never merged row-by-row with
   * participant_skills_record — the snapshot is authoritative as a whole or
   * not used at all. Null for every certificate issued before Phase 2C.
   */
  certificate_skills_record?: CertificateSkillRow[] | null;
  /** Deprecated compatibility field; certificate rendering never uses live participant state. */
  participant_skills_record?: CertificateSkillRow[] | null;
  /**
   * Compatibility alias for the normalized historical model. New render paths
   * should read `skills`, which is resolved once by certData.ts and shared by
   * React and HTML output.
   */
  effective_skills_record?: CertificateSkillRow[] | null;
  /** Normalized historical skills consumed identically by React and HTML renderers. */
  skills?: CertificateSkillRow[] | null;
  /** Signature and Common Seal image sources; required by every front page. See lib/certificate-approval-assets.ts. */
  render_assets?: CertificateRenderAssets;
  /**
   * Issuing branch's registered address, as an authoritative historical fact
   * resolved once by certData.ts (MODERN_SNAPSHOT: only the frozen snapshot
   * row's own branch_address, never a live/legacy fallback; LEGACY_FALLBACK:
   * the certificate's own base row). Null when no authoritative address was
   * captured -- the renderer must not substitute venue or any other field.
   */
  issuer_branch_address?: string | null;
}

export interface TemplateConfig {
  /** Selects a dedicated renderer component in CertificateRenderer.tsx instead of this generic one. Routed by exact key match, never by course-name/title matching. */
  design_variant?: string;
  /**
   * Set by certData.ts from a frozen issuance snapshot's
   * render_payload.certificate_family -- never recomputed from current
   * programme/template data. Together with certificate_title, this is what
   * isGoldenReferenceFamily() checks to decide whether GoldenReferencePageOne
   * renders instead of the generic layout below.
   */
  golden_reference_family?: GoldenReferenceFamily;
  /** Set by certData.ts, either from a frozen snapshot's render_payload.certificate_title or (legacy/no-snapshot certificates) left unset. */
  certificate_title?: string;
  /** A frozen render_payload.watermark_asset_family value -- see WatermarkAssetConfig's own comment in lib/certificate-watermark-assets.ts. */
  frozen_watermark_asset_family?: string | null;
  logo_url?: string;
  background_url?: string;
  accent_color?: string;
  primary_color?: string;
  signature_url?: string;
  signature_name?: string;
  signature_title?: string;
  /** "dual" (default) = Trainer + Training Manager blocks either side of the stamp, matching the generic template. "single" = one signature block (e.g. Director) beside the stamp only — used by templates that must show exactly one signatory. */
  signature_layout?: "dual" | "single";
  body_text?: string;
  /** Optional certificate-specific subtitle supplied by the persisted template contract. */
  certificate_subtitle?: string;
  show_qr?: boolean;
  /** Swaps the generic scaffold-pole background watermark for a level-specific density (Standard Scaffold Erector only, resolved per-course by certData.ts's merge — see lib/certificate-watermarks.ts). Unset everywhere else, which renders the same generic watermark this template always had. */
  watermark_level?: WatermarkLevel;
  /** Swaps the background watermark for the distinct clipboard/magnifier Inspector motif (Standard Scaffold Inspector only, resolved per-course by certData.ts's merge — see lib/certificate-watermarks.ts). Takes precedence over watermark_level if both were somehow set, but the two are never set on the same programme. */
  inspector_watermark_level?: WatermarkLevel;
  /** Swaps the background watermark for the harness/twin-lanyard/anchorage Working at Height motif, set unconditionally by certData.ts's merge whenever config.design_variant === "working_at_height_certificate" (see lib/certificate-watermarks.ts). Takes precedence over inspector_watermark_level/watermark_level; never set alongside either since design_variant scopes each family to its own template. */
  wah_watermark?: boolean;
  // Front page
  duration_label?: string;
  skills_update_recommendation?: string;
  /** e.g. "TU-SESP" — when set, generateCertificate/bulkGenerate assign "{prefix}-{year}-{0001}" instead of the generic CERT-YYYY-NNNNNN fallback. Unset for every other template today; see certificates/actions.ts. */
  certificate_number_prefix?: string;
  // Back page ("Programme Information") — configurable per template because
  // it's programme-specific content, not per-certificate data.
  show_back_page?: boolean;
  programme_title?: string;
  objectives_text?: string;
  coverage_items?: string[];
  learning_outcomes?: string[];
  assessment_methods?: string[];
  skills_record?: { area: string; status: string }[];
  /** Show the Participant Skills Record table with neutral placeholder rows when no data is configured. Default true. */
  show_skills_record?: boolean;
  important_notice?: string;
  contact_phone?: string;
  contact_email?: string;
  contact_website?: string;
}

const PAGE_W = CERTIFICATE_DESIGN.page.widthPx;
const PAGE_H = CERTIFICATE_DESIGN.page.heightPx;
const DEFAULT_LOGO_URL = "/certificates/template-a/teras-symbol-v2.png";
/**
 * Micro-typography stack for eyebrows/labels/table headers. The display type
 * stays Georgia (serif) — pairing it with a tracked-out sans for the small
 * supporting type is what separates a corporate competency document from a
 * single-serif "template default" look. Mirrored in lib/certificate-html.ts.
 */
const SANS = CERTIFICATE_DESIGN.typography.sans;


// Neutral by design — no participant-level attendance/assessment data is
// wired into this renderer, so a default row must never claim "Completed" or
// "Achieved" on anyone's behalf. A template can supply real config.skills_record
// once that data exists, or set show_skills_record:false to hide the section.
const DEFAULT_SKILLS_RECORD = [
  { area: "Theory Session", status: "Not Recorded" },
  { area: "Practical Training", status: "Not Recorded" },
  { area: "Safety Awareness", status: "Not Recorded" },
  { area: "Practical Assessment", status: "Not Recorded" },
  { area: "Attendance Requirement", status: "Not Recorded" },
];


/**
 * Approved V2R2 frame: near-edge Navy structural rule, Gold inner rule,
 * restrained top-left/bottom-right Navy sweeps and Gold corner accents.
 * White remains dominant; the sweeps provide the ceremonial opening/closure
 * without becoming a full-width ink-heavy header or footer.
 */
function CertificateFrame({ navy, gold }: { navy: string; gold: string }) {
  const corners: { key: string; box: CSSProperties }[] = [
    { key: "tl", box: { top: 30, left: 30 } },
    { key: "tr", box: { top: 30, right: 30 } },
    { key: "bl", box: { bottom: 30, left: 30 } },
    { key: "br", box: { bottom: 30, right: 30 } },
  ];
  const ticks: CSSProperties[] = [
    { top: 14, left: "50%", width: 1, height: 9, transform: "translateX(-50%)" },
    { bottom: 14, left: "50%", width: 1, height: 9, transform: "translateX(-50%)" },
    { left: 14, top: "50%", width: 9, height: 1, transform: "translateY(-50%)" },
    { right: 14, top: "50%", width: 9, height: 1, transform: "translateY(-50%)" },
  ];
  return (
    <>
      <div style={{ position: "absolute", inset: CERTIFICATE_DESIGN.page.borderInsetPx, border: `5px solid ${navy}`, boxShadow: `inset 0 0 0 2px ${gold}, inset 0 0 0 6px #fff, inset 0 0 0 8px ${gold}`, pointerEvents: "none", zIndex: 5 }} />
      <div style={{ position: "absolute", top: CERTIFICATE_DESIGN.page.borderInsetPx, left: CERTIFICATE_DESIGN.page.borderInsetPx, width: 159, height: 159, background: navy, clipPath: "polygon(0 0, 100% 0, 0 100%)", opacity: 0.97, pointerEvents: "none", zIndex: 1 }} />
      <div style={{ position: "absolute", right: CERTIFICATE_DESIGN.page.borderInsetPx, bottom: CERTIFICATE_DESIGN.page.borderInsetPx, width: 159, height: 159, background: `linear-gradient(135deg, ${navy} 70%, ${gold} 70%, ${gold} 75%, transparent 75%)`, clipPath: "polygon(100% 0, 100% 100%, 0 100%)", pointerEvents: "none", zIndex: 1 }} />
      {ticks.map((t, i) => (
        <div key={`tick${i}`} style={{ position: "absolute", background: gold, opacity: 0.45, pointerEvents: "none", ...t }} />
      ))}
      {corners.map(({ key, box }) => {
        const vy: CSSProperties = key[0] === "t" ? { top: 0 } : { bottom: 0 };
        const hx: CSSProperties = key[1] === "l" ? { left: 0 } : { right: 0 };
        return (
          <div key={key} style={{ position: "absolute", width: 32, height: 32, pointerEvents: "none", ...box }}>
            <div style={{ position: "absolute", width: 32, height: 2, background: gold, ...vy, ...hx }} />
            <div style={{ position: "absolute", width: 2, height: 32, background: gold, ...vy, ...hx }} />
            {/* Gold corner geometry reinforces the approved Navy sweeps. */}
            <div style={{ position: "absolute", width: 6, height: 6, background: gold, ...vy, ...hx }} />
          </div>
        );
      })}
    </>
  );
}

/** Shared asset placement for the React and HTML certificate renderers. */
function CertificateWatermark({ config, corner = false, goldenReferencePageOne = false }: { config: TemplateConfig; corner?: boolean; goldenReferencePageOne?: boolean }) {
  const asset = resolveCertificateWatermarkAsset(config);
  if (!asset) return null;
  const goldenPlacement = !isGoldenReferenceFamily(config)
    ? null
    : asset.family === "inspector"
      ? inspectorGoldenWatermarkBox(asset.level, goldenReferencePageOne ? "pageOne" : "pageTwo")
      : asset.family === "working-at-height"
        ? wahGoldenWatermarkBox(goldenReferencePageOne ? "pageOne" : "pageTwo")
        : config.golden_reference_family === "scaffold_erector"
          ? erectorGoldenWatermarkBox(goldenReferencePageOne ? "pageOne" : "pageTwo")
          : null;
  if (goldenPlacement) {
    const { opacity, src, ...box } = goldenPlacement;
    return <img src={src} alt="" aria-hidden="true" style={{ position: "absolute", ...box, objectFit: "contain", pointerEvents: "none", opacity }} />;
  }
  const size = goldenReferencePageOne
    ? { width: 800, height: 560, style: { top: 270, right: -24 } }
    : corner
      ? { width: 900, height: 720, style: { top: 220, right: -190 } }
      : { width: 700, height: 560, style: { top: 253, right: -95 } };
  return (
    <img
      src={asset.src}
      alt=""
      aria-hidden="true"
      style={{
        position: "absolute",
        width: size.width,
        height: size.height,
        objectFit: "contain",
        pointerEvents: "none",
        opacity: goldenReferencePageOne ? 0.048 : corner ? asset.page2Opacity : asset.primaryOpacity,
        ...size.style,
      }}
    />
  );
}

type IconKind = "calendar" | "refresh" | "doc" | "id" | "target" | "book" | "bulb" | "clipboard" | "warning" | "shield" | "qrMini";
function iconGlyph(kind: IconKind, color: string, strokeWidth = 1.7) {
  const common = { width: "100%", height: "100%", viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
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
    default: return <svg {...common}><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="2.5" height="2.5" fill={color} stroke="none" /><rect x="17.5" y="17.5" width="2.5" height="2.5" fill={color} stroke="none" /></svg>;
  }
}

/**
 * Bare icon glyph at a fixed box size. Dropping the ring/disc entirely is the
 * last step away from the "badge" language: a chip repeated at every heading
 * and every metadata row still reads as UI chrome, while an unboxed hairline
 * glyph reads as an editorial marker. Used at one size per context, gold on
 * the front metadata strip and on back-page headings.
 */
function Glyph({ kind, color, size = 12 }: { kind: IconKind; color: string; size?: number }) {
  return (
    <span style={{ width: size, height: size, minWidth: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {iconGlyph(kind, color, 1.8)}
    </span>
  );
}

/**
 * One cell of the front-page record strip. Label and value share a left edge
 * (the glyph sits inline with the label, not beside the pair) so four cells
 * across form clean columns — the previous icon-beside-a-stacked-pair layout
 * indented every value differently and read as a form field.
 */
function MetaTile({ icon, label, value, navy, gold }: { icon: IconKind; label: string; value: string; navy: string; gold: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
        <Glyph kind={icon} color={gold} size={10} />
        <span style={{ fontSize: 7, textTransform: "uppercase", letterSpacing: 1.1, color: "#8a94a6", fontFamily: SANS }}>{label}</span>
      </div>
      <div style={{ fontSize: value.length > 28 ? 9 : value.length > 20 ? 10 : 11.5, fontWeight: 700, color: navy, fontFamily: "Georgia, serif", lineHeight: 1.35, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

/**
 * Inline QR — see generateQrSvg's comment for why this isn't an
 * <img src="https://..."> anymore. Presented as a bordered plate with a
 * tracked-out caption rather than the previous rounded gold-outlined card,
 * which read as a utility widget bolted onto the layout.
 */
function QrBlock({ svg, navy, gold, size, caption, safeZone = false }: { svg: string; navy: string; gold: string; size: number; caption: boolean; safeZone?: boolean }) {
  return (
    <div style={{ width: size + 22, textAlign: "center", transform: safeZone ? "translate(-56px, -26px)" : undefined }}>
      <div style={{ fontSize: 7, fontWeight: 700, color: navy, letterSpacing: 1.6, marginBottom: 2, fontFamily: SANS }}>QR VERIFICATION</div>
      <div style={{ width: 22, height: 1, background: gold, margin: "0 auto 7px" }} />
      {/* Navy plate inside an offset gold hairline — the same frame language as
          the duration banner, so the QR reads as an issued verification seal
          rather than a bolted-on utility square. */}
      <div style={{ position: "relative", width: size + 8, height: size + 8, margin: "0 auto" }}>
        <div style={{ position: "absolute", inset: -3, border: `1px solid ${gold}`, opacity: 0.7 }} />
        <div style={{ position: "absolute", inset: 0, padding: 4, background: "#fff", border: `1px solid ${navy}`, boxSizing: "border-box" }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      {caption && (
        <div style={{ fontSize: 7, color: "#667085", marginTop: 8, lineHeight: 1.5, fontFamily: SANS, letterSpacing: 0.2 }}>Scan to verify this certificate at Teras Universal Database</div>
      )}
    </div>
  );
}

function TaglineFooter({ navy, gold }: { navy: string; gold: string }) {
  return (
    <div style={{ position: "absolute", left: CERTIFICATE_DESIGN.page.safeMarginPx, right: CERTIFICATE_DESIGN.page.safeMarginPx, bottom: 28, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: navy, fontSize: 8.2, fontWeight: 600, letterSpacing: 1.6, fontFamily: SANS, textAlign: "center", whiteSpace: "nowrap" }}>
      <span style={{ width: 28, height: 1, background: gold, opacity: 0.75 }} />
      <span>{TERAS_COMPANY_TAGLINE}</span>
      <span style={{ width: 28, height: 1, background: gold, opacity: 0.75 }} />
    </div>
  );
}

/**
 * Flat navy label plate ruled top and bottom in gold. Two earlier shapes were
 * rejected on the way here: a pointed-end "ribbon" (decorative award look) and
 * a navy block inside a fully offset gold rectangle — the offset ring reads
 * exactly like a focus ring around a UI button, which is the last thing a
 * printed credential should suggest. Hairlines on two edges only keep the
 * navy/gold emphasis while sitting flat in the page, like type printed into
 * the document rather than a control placed on top of it.
 */
function RibbonBanner({ children, navy, gold, style }: { children: ReactNode; navy: string; gold: string; style?: CSSProperties }) {
  return (
    <div style={{ display: "inline-block", background: navy, color: "#fff", padding: "5px 30px", borderTop: `1px solid ${gold}`, borderBottom: `1px solid ${gold}`, ...style }}>
      {children}
    </div>
  );
}

/**
 * Structural guidance shown only when there is no signature_url — makes the
 * empty well read as an intentionally-reserved attestation slot on an issued
 * document, not an unfinished form field. Never a substitute for the mark
 * itself: no initials/handwriting/graphic, just a label above the (still
 * empty) well. Mirrored in lib/certificate-html.ts's authorisedSignatureLabel.
 */
function AuthorisedSignatureLabel() {
  return (
    <div style={{ color: "#9aa3b2", fontSize: 6.5, letterSpacing: 1.3, fontFamily: SANS, textTransform: "uppercase", marginBottom: 3 }}>
      Authorised Signature
    </div>
  );
}

/** Template-editor preview only: stands in for the signature, which never reaches the browser there. Mirrored in certificate-html.ts. */
function SignaturePreviewNote() {
  return (
    <div data-certificate-signature="preview" style={{ color: "#9aa3b2", fontSize: 6.5, letterSpacing: 1.1, fontFamily: SANS, textTransform: "uppercase", textAlign: "center", paddingBottom: 4 }}>
      {RENDER_ASSET_PREVIEW_LABEL}
    </div>
  );
}

// Golden Reference Page 1 body-text budget: the layout has room for a short
// paragraph only, with no continuation-page mechanism on this master layout
// (CertificateRenderer.tsx's dispatch does not call one) -- text beyond the
// limit is bounded at a word boundary rather than mid-word, not continued.
const GOLDEN_REFERENCE_BODY_TEXT_LIMIT = 360;

function splitCertificateTextChunk(text: string, limit: number): [string, string] {
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

function splitCertificateBodyText(bodyText: string | null = ""): { pageOneText: string } {
  const safeBodyText = typeof bodyText === "string" ? bodyText : "";
  const [pageOneText] = splitCertificateTextChunk(safeBodyText, GOLDEN_REFERENCE_BODY_TEXT_LIMIT);
  return { pageOneText };
}

/** Avoids repeating the course name verbatim as its own "subtitle" directly beneath it. */
function resolveDistinctProgrammeSubtitle(primary: string | null | undefined, subtitle: string | null | undefined): string | null {
  if (typeof subtitle !== "string") return null;
  const candidate = subtitle.trim();
  if (!candidate) return null;
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalize(typeof primary === "string" ? primary : "") === normalize(candidate) ? null : candidate;
}

function isLongCertificateNumber(value: string): boolean {
  return (value || "").trim().length > 28;
}

function fitCertificateNumberSize(value: string, regularSize: number): number {
  const length = (value || "").trim().length;
  if (length > 40) return Math.min(regularSize, 8);
  if (length > 28) return Math.min(regularSize, 9);
  return regularSize;
}

function longCertificateNumberStyle(value: string, regularSize: number, maxWidth: CSSProperties["maxWidth"], display?: CSSProperties["display"]): CSSProperties {
  if (!isLongCertificateNumber(value)) return {};
  return {
    fontSize: fitCertificateNumberSize(value, regularSize),
    maxWidth,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    lineHeight: 1.1,
    ...(display ? { display } : {}),
  };
}

/**
 * Golden Reference Page 1 — the approved C4 Visual Master Option A layout.
 * Dispatched by CertificateDocument below only when isGoldenReferenceFamily
 * (certificate-design-system.ts) confirms the certificate's own frozen
 * golden_reference_family + certificate_title (set by certData.ts from an
 * immutable issuance snapshot, or left unset for legacy/non-C4 certificates)
 * match an approved family's contract. qaPreview is a QA-only opt-in, never
 * stored in a certificate template or issuance snapshot -- see
 * STAMP_ASSET_PENDING below. Mirrored in lib/certificate-html.ts's
 * renderGoldenReferencePageOne.
 */
function GoldenReferencePageOne({ data, config, navy, gold, qaPreview }: { data: CertData; config: TemplateConfig; navy: string; gold: string; qaPreview: boolean }) {
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  const { pageOneText } = splitCertificateBodyText(config.body_text);
  const assets = renderAssetSources(data.render_assets, { signature: true, seal: true });
  // The signatory frozen into this certificate's own snapshot (template_config.signature_name);
  // "Director" only when none was recorded.
  const directorName = (typeof config.signature_name === "string" && config.signature_name.trim()) || "Director";
  const programmeSubtitle = resolveDistinctProgrammeSubtitle(data.course_name, config.programme_title);
  const venue = formatAddressLines(data.venue);

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: CERTIFICATE_DESIGN.colors.white, boxSizing: "border-box", padding: CERTIFICATE_DESIGN.page.safeMarginPx, fontFamily: CERTIFICATE_DESIGN.typography.sans, color: CERTIFICATE_DESIGN.colors.ink, overflow: "hidden", pageBreakAfter: config.show_back_page !== false ? "always" : undefined }}>
      <CertificateWatermark config={config} goldenReferencePageOne />
      <CertificateFrame navy={navy} gold={gold} />
      <div style={{ position: "relative", zIndex: 2, height: "100%", boxSizing: "border-box", padding: "15px 8px 120px", display: "flex", flexDirection: "column", textAlign: "center" }}>
        <header style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <img src={config.logo_url || DEFAULT_LOGO_URL} alt="TERAS Universal" style={{ width: 124, height: 91, objectFit: "contain", objectPosition: "center", display: "block", mixBlendMode: "multiply" }} />
          <div style={{ color: navy, fontFamily: CERTIFICATE_DESIGN.typography.heading, fontSize: 13.5, fontWeight: 700, letterSpacing: 2.1, marginTop: 1 }}>{TERAS_COMPANY_NAME}</div>
          <div style={{ color: "#667085", fontFamily: SANS, fontSize: 6.5, letterSpacing: 0.65, marginTop: 3 }}>{TERAS_COMPANY_TAGLINE}</div>
          <div style={{ color: "#667085", fontFamily: SANS, fontSize: 7, letterSpacing: 0.65, marginTop: 3 }}>REG. NO. {TERAS_COMPANY_REGISTRATION}</div>
          <div style={{ width: "100%", height: 1, marginTop: 12, background: `linear-gradient(90deg, ${navy} 0 31%, ${gold} 31% 69%, ${navy} 69% 100%)` }} />
        </header>

        <h1 style={{ color: navy, fontFamily: CERTIFICATE_DESIGN.typography.heading, fontSize: 22, fontWeight: 700, letterSpacing: 2.3, lineHeight: 1.2, margin: "14px 0 0" }}>{config.certificate_title}</h1>
        <p style={{ color: "#8a94a6", fontFamily: SANS, fontSize: 9, letterSpacing: 1.55, lineHeight: 1.4, margin: "21px 0 9px", textTransform: "uppercase" }}>This certificate is proudly presented to</p>
        <div style={{ fontSize: Math.min(fitHolderNameSize(data.holder_name) + 8, CERTIFICATE_DESIGN.typography.participantNamePx), fontWeight: 700, color: navy, padding: "0 8px 12px", wordBreak: "break-word", lineHeight: 1.15, letterSpacing: 0.35, fontFamily: CERTIFICATE_DESIGN.typography.heading }}>{data.holder_name}</div>
        <div style={{ width: 210, maxWidth: "60%", height: 1, background: "#d3d9e2", margin: "0 auto" }}><span style={{ display: "block", width: 52, height: 2, margin: "0 auto", background: gold }} /></div>
        {data.ic_passport && <p style={{ fontSize: 9, color: "#667085", margin: "7px 0 0", letterSpacing: 0.35, fontFamily: SANS, overflowWrap: "anywhere" }}>IC / Passport No.: <strong style={{ color: navy, fontWeight: 700 }}>{data.ic_passport}</strong></p>}
        <p style={{ fontSize: 8.5, margin: "16px 0 6px", color: "#8a94a6", letterSpacing: 1.6, fontFamily: SANS, textTransform: "uppercase" }}>For successfully completing the</p>
        <div style={{ fontSize: 20, fontWeight: 700, color: navy, textTransform: "uppercase", lineHeight: 1.25, maxWidth: 610, margin: "0 auto", letterSpacing: 0.65, fontFamily: CERTIFICATE_DESIGN.typography.heading, overflowWrap: "anywhere" }}>{data.course_name}</div>
        {programmeSubtitle && <div style={{ color: "#536174", fontFamily: SANS, fontSize: 8, fontWeight: 600, letterSpacing: 1.05, marginTop: 6 }}>{programmeSubtitle}</div>}

        <div style={{ margin: "30px auto 0", color: navy, fontFamily: SANS, lineHeight: 1.5 }}>
          {dateRange && <><div style={{ color: "#8a94a6", fontSize: 7.5, letterSpacing: 1.4, textTransform: "uppercase" }}>Conducted from</div><div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 2 }}>{dateRange}</div></>}
          {/*
           * C4A-7B: Training Duration directly above Training Venue, both
           * using the same label/value pattern as "Conducted from" above --
           * owner-approved layout decision. data.venue is the frozen
           * training-location text captured at issuance (course_schedules.
           * venue -> certificates.venue -> certificate_issuance_snapshots.
           * venue), never the issuing branch address (that's
           * data.issuer_branch_address, rendered only on Page 2 and
           * untouched by this change). Omitted entirely when absent -- never
           * fabricated.
           */}
          {duration && <><div style={{ color: "#8a94a6", fontSize: 7.5, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 8 }}>Training Duration</div><div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 2 }}>{duration}</div></>}
          {venue.lines.length > 0 && <><div style={{ color: "#8a94a6", fontSize: 7.5, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 8 }}>Training Venue</div><div style={{ fontSize: 10, lineHeight: 1.45, maxWidth: 520, margin: "1px auto 0", overflowWrap: "anywhere" }}>{venue.lead && <span style={{ display: "block", fontWeight: 700, letterSpacing: 0.4 }}>{venue.lead}</span>}{venue.lines.map((line, i) => <span key={i} style={{ display: "block" }}>{line}</span>)}</div></>}
        </div>
        {pageOneText && <p style={{ fontSize: 9, lineHeight: 1.55, maxWidth: 520, margin: "11px auto 0", color: "#596273", overflowWrap: "anywhere" }}>{pageOneText}</p>}

        <div style={{ marginTop: "auto", paddingTop: 18, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, textAlign: "center" }}>
          <div style={{ flex: "0 0 165px", textAlign: "left", fontSize: 9 }}>
            <div style={{ color: "#8a94a6", fontSize: 7, letterSpacing: 1.1, fontFamily: SANS, textTransform: "uppercase", marginBottom: 4 }}>Certificate No.</div>
            <strong style={{ color: navy, fontFamily: "Georgia, serif", fontSize: isLongCertificateNumber(data.certificate_number) ? fitCertificateNumberSize(data.certificate_number, 10) : 10, overflowWrap: "anywhere", ...longCertificateNumberStyle(data.certificate_number, 10, 165, "block") }}>{data.certificate_number}</strong>
            {data.issue_date && <div style={{ color: "#667085", fontSize: 8, marginTop: 5 }}>Issued {formatHumanDate(data.issue_date)}</div>}
          </div>
          <div style={{ flex: "1 1 270px", maxWidth: 300, minWidth: 220, display: "flex", flexDirection: "column", alignItems: "center", fontSize: 9 }}>
            <div style={{ height: 68, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>{assets.preview ? <SignaturePreviewNote /> : <img src={assets.signature!} alt="" data-certificate-signature="director" style={{ maxHeight: C4_SIGNATURE_MAX_HEIGHT_PX, maxWidth: 180, objectFit: "contain" }} />}</div>
            <div style={{ width: "86%", borderTop: `1px solid ${navy}`, margin: "3px 0 4px" }} />
            <strong style={{ color: navy, fontFamily: CERTIFICATE_DESIGN.typography.heading, fontSize: 8.5, letterSpacing: 0.3, overflowWrap: "anywhere" }}>{directorName}</strong>
            <div style={{ color: navy, fontFamily: SANS, fontSize: 7.5, fontWeight: 700, letterSpacing: 1.1, marginTop: 2 }}>AUTHORIZED DIRECTOR</div>
            <div style={{ color: "#667085", fontFamily: SANS, fontSize: 7, letterSpacing: 0.45, marginTop: 2 }}>{TERAS_COMPANY_NAME}</div>
          </div>
          <div style={{ flex: "0 0 145px", display: "flex", flexDirection: "column", alignItems: "center" }}>
            {qaPreview ? (
              <>
                <div aria-label="STAMP_ASSET_PENDING — neutral seal placeholder for review only" style={{ width: 108, height: 108, border: "1.5px solid rgba(201,162,39,.72)", borderRadius: "50%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 9, color: "#8a94a6", fontFamily: SANS, fontSize: 7, letterSpacing: 0.8, lineHeight: 1.4, textAlign: "center" }}>
                  STAMP_ASSET_PENDING
                </div>
                <div style={{ color: "#8a94a6", fontFamily: SANS, fontSize: 6.5, letterSpacing: 0.65, marginTop: 3 }}>FOR REVIEW ONLY</div>
              </>
            ) : assets.preview ? (
              <div data-certificate-stamp-area="reserved" aria-hidden="true" style={{ width: 108, height: 108, border: "1.5px solid rgba(201,162,39,.72)", borderRadius: "50%", boxSizing: "border-box" }} />
            ) : (
              // The 34mm seal overflows the 108px box symmetrically; the box keeps its size so the row layout is unchanged.
              <div data-certificate-stamp-area="seal" style={{ width: 108, height: 108, position: "relative" }}>
                <img src={assets.seal!} alt="" data-certificate-seal="common-seal-3d" style={{ position: "absolute", left: "50%", top: "50%", width: COMMON_SEAL_IMAGE_PX, height: COMMON_SEAL_IMAGE_PX, maxWidth: "none", transform: "translate(-50%, -50%)" }} />
              </div>
            )}
          </div>
        </div>
      </div>
      <TaglineFooter navy={navy} gold={gold} />
    </div>
  );
}

/**
 * Generic certificate layout. C4 Golden Reference certificates (Erector,
 * Inspector, WAH) render GoldenReferencePageOne above instead, whose stamp
 * column is an empty, unbranded gold ring (data-certificate-stamp-area=
 * "reserved") left for a physical company stamp, because no approved stamp
 * asset exists; lib/certificate-html.ts mirrors it.
 */
export function CertificateDocument({ data, config, qaPreview = false }: { data: CertData; config: TemplateConfig; qaPreview?: boolean }) {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  // Standard Scaffold keeps the established TERAS Standard hierarchy: the
  // course name and date range are the focal content, without the banner that
  // belongs to the newer certificate families.
  const showDurationRibbon = config.design_variant !== "standard_scaffold_certificate";
  // +8 rather than +4: at +4 the holder name sat only ~4pt above the
  // programme title, so the eye had no single landing point. Scale is the
  // one lever that makes a centrepiece read as ceremonial.
  const nameSize = fitHolderNameSize(data.holder_name) + 8;
  // The attestation trio is centred rather than justified edge-to-edge, so the
  // gap has to come down when a second signatory is present — otherwise four
  // blocks at the single-signatory gap overrun the content width.
  // The Standard Scaffold family is formally issued by the Director only.
  // Keep that single-signatory rule even for legacy rows that predate the
  // signature_layout setting.
  const singleSig = config.signature_layout === "single" || config.design_variant === "standard_scaffold_certificate" || config.design_variant === "working_at_height_certificate";

  const useGoldenReferencePageOne = isGoldenReferenceFamily(config);
  if (useGoldenReferencePageOne) return <GoldenReferencePageOne data={data} config={config} navy={navy} gold={gold} qaPreview={qaPreview} />;

  // Same rule as requiredRenderAssets() in lib/certificate-render-asset-policy.ts.
  const needsSignature = singleSig || !!config.signature_url?.trim();
  const assets = renderAssetSources(data.render_assets, { signature: needsSignature, seal: false });
  const signatureUrl = needsSignature ? assets.signature : null;

  return (
    <div
      style={{
        width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: CERTIFICATE_DESIGN.colors.white,
        boxSizing: "border-box", padding: CERTIFICATE_DESIGN.page.safeMarginPx, fontFamily: CERTIFICATE_DESIGN.typography.sans, color: CERTIFICATE_DESIGN.colors.ink, overflow: "hidden",
        backgroundImage: config.background_url ? `url(${config.background_url})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}
    >
      {!config.background_url && <CertificateWatermark config={config} />}
      <CertificateFrame navy={navy} gold={gold} />

      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: "14px 0 0", display: "flex", flexDirection: "column", textAlign: "center" }}>
        {/* 105x74 is the asset's own 1144x806 aspect at the requested ~105px
            width — an explicit pair rather than a square box, because a square
            box with objectFit:contain padded ~15px of dead space above and
            below the mark and made the header rhythm read as loose. */}
        <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, textAlign: "left", minHeight: 110, padding: "0 8px 12px", borderBottom: `1px solid ${gold}` }}>
          <img src={config.logo_url || DEFAULT_LOGO_URL} alt="TERAS Universal" style={{ width: 228, height: 106, marginLeft: 52, objectFit: "contain", objectPosition: "left center", display: "block", mixBlendMode: "multiply", position: "relative", zIndex: 2 }} />
          <div style={{ paddingTop: 6, textAlign: "right", color: "#667085", fontFamily: SANS, fontSize: 7, letterSpacing: 1.1, lineHeight: 1.55 }}>
            <div style={{ color: navy, fontWeight: 700, letterSpacing: 1.6 }}>OFFICIAL TERAS UNIVERSAL CERTIFICATE</div>
            <div style={{ marginTop: 3, opacity: 0.82 }}>REG. NO. {TERAS_COMPANY_REGISTRATION}</div>
          </div>
          <div style={{ position: "absolute", left: -8, bottom: -2, width: 210, height: 3, background: `linear-gradient(90deg, ${navy} 0 78%, ${gold} 78% 100%)` }} />
        </div>
        <div style={{ letterSpacing: 2.5, fontSize: 11, color: navy, fontWeight: 700, fontFamily: CERTIFICATE_DESIGN.typography.heading, textAlign: "left", marginTop: 3 }}>{TERAS_COMPANY_NAME}</div>
        <div style={{ width: 52, height: 1, background: gold, margin: "11px auto 0" }} />

        <div style={{ fontSize: 8, color: navy, marginTop: 9, letterSpacing: 1.8, fontWeight: 700, fontFamily: SANS }}>{certificateFamilyLabel(config)}</div>
        <h1 style={{ fontSize: CERTIFICATE_DESIGN.typography.certificateTitlePx, margin: "12px 0 0", letterSpacing: 5, color: navy, fontWeight: 700, lineHeight: 1.1, fontFamily: CERTIFICATE_DESIGN.typography.heading }}>CERTIFICATE</h1>
        {config.certificate_subtitle && <div style={{ fontSize: 8.5, color: "#667085", letterSpacing: 3.5, fontWeight: 600, fontFamily: SANS, textIndent: 3.5, marginTop: 10 }}>{config.certificate_subtitle}</div>}

        <p style={{ fontSize: 9.5, margin: "24px 0 9px", color: "#8a94a6", letterSpacing: 1.8, fontFamily: SANS, textTransform: "uppercase", textIndent: 1.8 }}>This certificate is proudly presented to</p>
        <div style={{ position: "relative", display: "inline-block", margin: "0 auto", maxWidth: 660 }}>
          <div style={{ fontSize: Math.min(nameSize, CERTIFICATE_DESIGN.typography.participantNamePx), fontWeight: 700, color: navy, padding: "0 12px 14px", wordBreak: "break-word", lineHeight: 1.18, letterSpacing: 0.4, fontFamily: CERTIFICATE_DESIGN.typography.heading }}>
            {data.holder_name}
          </div>
          {/* Hairline rule with a short gold centre segment — replaces the
              rotated gold diamond, which read as award/wedding ornamentation. */}
          <div style={{ position: "relative", height: 1, background: "#d3d9e2" }}>
            <span style={{ position: "absolute", top: -0.5, left: "50%", transform: "translateX(-50%)", width: 130, height: 2, background: gold }} />
          </div>
          {/* Second, shorter hairline below the first — the same layered-rule
              device as the frame, giving the name a base with depth instead of
              a single flat line. */}
          <div style={{ height: 1, width: "46%", margin: "4px auto 0", background: "#d3d9e2", opacity: 0.55 }} />
        </div>
        {data.ic_passport && <p style={{ fontSize: 9.5, color: "#667085", margin: "10px 0 0", letterSpacing: 0.6, fontFamily: SANS, overflowWrap: "anywhere" }}>IC / Passport No.: <strong style={{ color: navy, fontWeight: 700 }}>{data.ic_passport}</strong></p>}

        <p style={{ fontSize: 9, margin: "18px 0 0", color: "#8a94a6", letterSpacing: 1.8, fontFamily: SANS, textTransform: "uppercase", textIndent: 1.8 }}>For successfully completing the</p>
        <div style={{ width: 30, height: 1, background: gold, margin: "8px auto 10px" }} />
        <div style={{ fontSize: CERTIFICATE_DESIGN.typography.courseNamePx, fontWeight: 700, color: navy, textTransform: "uppercase", lineHeight: 1.3, maxWidth: 600, margin: "0 auto", letterSpacing: 0.8, fontFamily: CERTIFICATE_DESIGN.typography.heading, overflowWrap: "anywhere" }}>
          {data.course_name}
        </div>
        <div style={{ width: 150, height: 1, background: navy, opacity: 0.22, margin: "11px auto 0" }} />
        {showDurationRibbon && duration && (
          <RibbonBanner navy={navy} gold={gold} style={{ margin: "19px auto 0" }}>
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 2.4, fontFamily: SANS, textIndent: 2.4 }}>{duration}</span>
          </RibbonBanner>
        )}
        {dateRange && (
          <p style={{ fontSize: 11, color: "#4b5563", margin: "16px 0 0", lineHeight: 1.45 }}>
            <span style={{ display: "block" }}><span style={{ color: "#667085", letterSpacing: 1.3, fontSize: 8.5, fontFamily: SANS, textTransform: "uppercase" }}>Conducted from </span>{dateRange}</span>
            {data.venue && <span style={{ display: "block", marginTop: 2 }}>at {data.venue}</span>}
          </p>
        )}

        {config.body_text && <p style={{ fontSize: 10.5, lineHeight: 1.85, maxWidth: 520, margin: "17px auto 0", color: "#6b7280" }}>{config.body_text}</p>}

        {/* Programme duration and venue remain on page 1. The date range is
            already communicated by Conducted from and is not duplicated as a
            separate Training Period field. */}
        <div style={{ margin: "auto 0 0", borderTop: `1px solid ${navy}`, borderBottom: "1px solid #e3e7ee", padding: "12px 4px 11px", display: "flex", gap: 18, textAlign: "left", alignItems: "flex-start" }}>
          <MetaTile icon="refresh" label="Programme Duration" value={duration || "—"} navy={navy} gold={gold} />
          <div style={{ width: 1, background: "#e3e7ee", alignSelf: "stretch" }} />
          <MetaTile icon="id" label="Venue" value={data.venue || "—"} navy={navy} gold={gold} />
        </div>

        {/* Attestation zone: signatory | stamp | verification, baseline-aligned on
            one row. The QR moved out of the record strip so signing and verifying
            sit together as one act of issuance, and so neither side is lopsided.
            "single" = one signatory (e.g. Director) beside the stamp only.
            "dual" (default) = Trainer + Training Manager. */}
        {/* A single hairline spanning the full content width, carrying the same
            short gold centre segment used under the participant name, binds the
            signatory, stamp and QR into one attestation band. Centring them
            (V5) grouped them; the shared rule is what makes them read as one
            official act of issuance rather than three neighbouring objects —
            the binding principle borrowed from Template A, expressed as a rule
            rather than its ceremonial crest. */}
        <div style={{ position: "relative", marginTop: 18, paddingTop: 18, borderTop: "1px solid #e3e7ee" }}>
          <span style={{ position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)", width: 48, height: 2, background: gold }} />
        {/* Three-zone attestation band -- Authorised Signature | Company Stamp |
            Certificate Verification. Signature column(s) are content-width
            (maxWidth caps them) rather than a fixed 186px, so an absent/short
            signature no longer leaves a stranded empty column. Hairlines
            (matching the record-strip dividers above) mark the zone
            boundaries instead of leaving the grouping to gap-spacing alone --
            there is no divider between Trainer/Training Manager since they're
            one signature zone, only around it. */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: singleSig ? 16 : 24 }}>
          <div style={{ textAlign: "left", fontSize: 9, width: 155, alignSelf: "center" }}>
            <div style={{ color: "#8a94a6", fontSize: 7, letterSpacing: 1.1, fontFamily: SANS, textTransform: "uppercase", marginBottom: 4 }}>Certificate No.</div>
            <strong style={{ color: navy, fontFamily: "Georgia, serif", fontSize: 10.5, whiteSpace: "nowrap" }}>{data.certificate_number}</strong>
            {data.issue_date && <div style={{ color: "#8a94a6", fontSize: 8, marginTop: 4, whiteSpace: "nowrap" }}>Date Issued · {data.issue_date}</div>}
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: "#e3e7ee" }} />
          <div style={{ textAlign: "center", fontSize: 11, width: "auto", maxWidth: 160 }}>
            {!needsSignature && <AuthorisedSignatureLabel />}
            {/* Fixed-height signature well: the image sits ON the rule rather than
                floating above it at whatever height the asset happens to be.
                The extra headroom over the rule keeps a tall signature from
                touching the metadata band above it. Left visibly empty (no
                fabricated mark) when there's no signature_url -- the label
                above is guidance, not a substitute signature. */}
            <div style={{ height: 92, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 2 }}>
              {needsSignature && assets.preview && <SignaturePreviewNote />}
              {signatureUrl && <img src={signatureUrl} alt="" data-certificate-signature="director" style={{ maxHeight: 92, maxWidth: 145, objectFit: "contain" }} />}
            </div>
            <div style={{ borderTop: `1px solid ${navy}`, margin: "4px 0 5px" }} />
            {singleSig ? (
              <strong style={{ color: navy, letterSpacing: 0.3 }}>AUTHORISED DIRECTOR</strong>
            ) : (
              <>
                <strong style={{ color: navy, letterSpacing: 0.3 }}>{config.signature_name || "Trainer"}</strong>
                <div style={{ color: "#8a94a6", fontSize: 8.5, letterSpacing: 1.3, fontFamily: SANS, textTransform: "uppercase", marginTop: 3 }}>Trainer Signature</div>
              </>
            )}

          </div>
          {!singleSig && (
            <div style={{ textAlign: "center", fontSize: 11, width: "auto", maxWidth: 160 }}>
              <AuthorisedSignatureLabel />
              <div style={{ height: 44 }} />
              <div style={{ borderTop: `1px solid ${navy}`, margin: "4px 0 5px" }} />
              <strong style={{ color: navy, letterSpacing: 0.3 }}>{config.signature_title || "Training Manager"}</strong>
              <div style={{ color: "#8a94a6", fontSize: 8.5, letterSpacing: 1.3, fontFamily: SANS, textTransform: "uppercase", marginTop: 3 }}>Training Manager</div>
            </div>
          )}
          <div style={{ width: 1, alignSelf: "stretch", background: "#e3e7ee" }} />
          {singleSig ? (
            <div aria-label="Gold Emboss Medallion Guide" style={{ position: "relative", transform: `translateY(-${EMBOSS_MEDALLION_LIFT_PX}px)`, flex: "0 0 auto", width: EMBOSS_MEDALLION_SIZE_PX, height: EMBOSS_MEDALLION_SIZE_PX, border: "1.5px solid rgba(201,162,39,.78)", borderRadius: "50%", boxSizing: "border-box", background: "radial-gradient(circle, transparent 0 62%, rgba(201,162,39,.045) 62% 63%, transparent 63%)" }}>
              <span style={{ position: "absolute", inset: 7, border: "1px solid rgba(201,162,39,.52)", borderRadius: "50%" }} />
            </div>
          ) : <div aria-hidden="true" style={{ width: 88, minHeight: 72 }} />}
          <div style={{ width: 1, alignSelf: "stretch", background: "#e3e7ee" }} />
        </div>
        </div>
      </div>
      <TaglineFooter navy={navy} gold={gold} />
    </div>
  );
}

/** Page 2 — "Programme Information" back page. Content is per-template, since it's programme-specific. */
export function CertificateBackPage({ data, config }: { data: CertData; config: TemplateConfig }) {
  if (config.show_back_page === false) return null;
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const coverage = config.coverage_items || [];
  const outcomes = config.learning_outcomes || [];
  const assessment = config.assessment_methods || [];
  const showSkillsRecord = config.show_skills_record !== false;
  const skillsRecord = data.skills?.length ? data.skills : DEFAULT_SKILLS_RECORD;
  const noticeParagraphs = config.important_notice?.split(/\n{2,}/).filter(Boolean) || [];
  const goldenReference = isGoldenReferenceFamily(config);
  /**
   * C4 Working at Height only. Its frozen programme (9 coverage items, a 9-line
   * objectives paragraph) with the real Poppins runs ~46px past the 57px safe
   * margin, which pushed the Issuing Branch Address into the footer tagline and
   * under the corner sweep. The Skills table, list and paragraph leading are
   * tightened to win that back; type sizes, wording and every other family are
   * untouched. Mirrored in certificate-html.ts.
   */
  const wahBack = config.golden_reference_family === "working_at_height";

  /**
   * Editorial section head: gold glyph, tracked navy label, and a two-tone rule
   * (a short gold segment running into a long hairline) rather than a single
   * full-width gold underline. The two-tone rule gives each column a defined
   * start point, which is what makes three stacked sections scan as a designed
   * grid instead of three same-weight bars.
   */
  /**
   * One head treatment for every block on this page. Previously the three
   * column sections carried a gold-into-hairline rule while IMPORTANT NOTICE
   * and VERIFICATION carried none, so the page announced its blocks three
   * different ways — the single biggest remaining inconsistency once the rest
   * of the system had been unified.
   */
  const SectionHead = ({ icon, title }: { icon: IconKind; title: string }) => (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Glyph kind={icon} color={gold} size={11} />
        <span style={{ fontSize: 9, fontWeight: 700, color: navy, letterSpacing: 1.6, fontFamily: SANS }}>{title}</span>
      </div>
      <div style={{ display: "flex", marginBottom: 8 }}>
        <span style={{ width: 22, height: 1.5, background: gold }} />
        <span style={{ flex: 1, height: 1, background: "#e3e7ee", alignSelf: "center" }} />
      </div>
    </>
  );
  const Section = ({ icon, title, children }: { icon: IconKind; title: string; children: ReactNode }) => (
    <div style={{ marginBottom: 10 }}>
      <SectionHead icon={icon} title={title} />
      {children}
    </div>
  );
  /**
   * One bullet treatment for every list on this page — a short gold dash.
   * Coverage/assessment previously used a "✓" glyph while learning outcomes
   * used browser disc bullets, so three adjacent columns each announced their
   * items differently. A dash sits quieter than a square at this size and
   * matches the rule language used by the section heads.
   *
   * line-height/margin (not font-size) were tightened for the full-length
   * real programme content (7 coverage items + a multi-line objectives
   * paragraph on every Erector level, not the shorter placeholder text this
   * was first tuned against) — see the Verification/footer clearance fix
   * this accompanies. Reclaims vertical budget without shrinking type.
   */
  const BulletList = ({ items }: { items: string[] }) => (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 10.5, lineHeight: wahBack ? 1.42 : 1.55, color: "#374151" }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: "flex", gap: 8, marginBottom: wahBack ? 2 : 3 }}>
          <span style={{ width: 6, height: 1, background: gold, marginTop: wahBack ? 7.5 : 8, flexShrink: 0 }} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
  const ColumnDivider = () => <div style={{ width: 1, alignSelf: "stretch", background: "#edf0f4" }} />;

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: CERTIFICATE_DESIGN.colors.white, boxSizing: "border-box", padding: CERTIFICATE_DESIGN.page.safeMarginPx, fontFamily: CERTIFICATE_DESIGN.typography.sans, color: CERTIFICATE_DESIGN.colors.ink, overflow: "hidden" }}>
      <CertificateWatermark config={config} corner />
      <CertificateFrame navy={navy} gold={gold} />
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: "14px 0 0", display: "flex", flexDirection: "column" }}>
        <RibbonBanner navy={navy} gold={gold} style={{ alignSelf: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2.2, fontFamily: SANS, textIndent: 2.2 }}>PARTICIPANT SKILLS RECORD</span>
        </RibbonBanner>
        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, color: navy, textTransform: "uppercase", margin: "13px 0 0", lineHeight: 1.3, letterSpacing: 0.8, fontFamily: CERTIFICATE_DESIGN.typography.heading, overflowWrap: "anywhere" }}>
          {config.programme_title || data.course_name}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap", margin: "8px 0 0", color: "#667085", fontFamily: SANS, fontSize: 8.5 }}>
          <span>Participant: <strong style={{ color: navy }}>{data.holder_name}</strong></span>
          {data.ic_passport && <span style={{ overflowWrap: "anywhere" }}>IC / Passport No.: <strong style={{ color: navy }}>{data.ic_passport}</strong></span>}
          <span>Certificate No.: <strong style={{ color: navy }}>{data.certificate_number}</strong></span>
          <span>Training period: <strong style={{ color: navy }}>{formatDateRange(data.training_date, data.training_end_date) || "—"}</strong></span>
        </div>
        {/* Masthead close: a full-width layered rule rather than a floating
            44px gold dash, so the title block terminates with the same
            gold-into-hairline device the sections below use. */}
        <div style={{ display: "flex", margin: wahBack ? "6px 0 8px" : "8px 0 10px" }}>
          <span style={{ width: 28, height: 1.5, background: gold }} />
          <span style={{ flex: 1, height: 1, background: "#e3e7ee", alignSelf: "center" }} />
        </div>

        {showSkillsRecord && (
          <div style={{ borderTop: `1px solid ${navy}`, borderBottom: "1px solid #e3e7ee", padding: wahBack ? "10px 14px 8px" : "12px 14px 10px", marginBottom: wahBack ? 8 : 10 }}>
            <SectionHead icon="doc" title="PARTICIPANT SKILLS RECORD" />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5 }}>
              <thead><tr>
                <th style={{ textAlign: "left", padding: wahBack ? "0 6px 5px 0" : "0 6px 7px 0", fontWeight: 700, color: "#8a94a6", fontFamily: SANS, fontSize: 8.2, letterSpacing: 1.1, textTransform: "uppercase", borderBottom: `1px solid ${gold}` }}>Assessment Area</th>
                <th style={{ textAlign: "left", padding: wahBack ? "0 0 5px 6px" : "0 0 7px 6px", fontWeight: 700, color: "#8a94a6", fontFamily: SANS, fontSize: 8.2, letterSpacing: 1.1, textTransform: "uppercase", borderBottom: `1px solid ${gold}` }}>Status</th>
              </tr></thead>
              <tbody>{skillsRecord.map((r, i) => {
                const affirmative = isAffirmativeStatus(r.status);
                return <tr key={i} style={{ borderBottom: "1px solid #eef1f5" }}>
                  <td style={{ padding: wahBack ? "5.5px 6px 5.5px 0" : "7px 6px 7px 0", color: "#374151" }}>{r.area}</td>
                  <td style={{ padding: wahBack ? "5.5px 0 5.5px 6px" : "7px 0 7px 6px", color: affirmative ? navy : "#8a94a6", fontWeight: affirmative ? 700 : 400 }}>{r.status}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", gap: 26, flex: 1 }}>
          <div style={{ flex: 1, paddingTop: wahBack ? 4 : 8 }}>
            {config.objectives_text && <Section icon="target" title="PROGRAMME OBJECTIVES">
              <p style={{ margin: 0, fontSize: 10, lineHeight: wahBack ? 1.45 : 1.55, color: "#374151" }}>{config.objectives_text}</p>
            </Section>}
            {coverage.length > 0 && <Section icon="book" title="PROGRAMME COVERAGE"><BulletList items={coverage} /></Section>}
          </div>
          <ColumnDivider />
          <div style={{ flex: 1, paddingTop: wahBack ? 4 : 8 }}>
            {outcomes.length > 0 && <Section icon="bulb" title="LEARNING OUTCOMES">
              <p style={{ margin: "0 0 8px", fontSize: 10.5, lineHeight: wahBack ? 1.45 : 1.55, color: "#6b7280" }}>Upon successful completion, participants should be able to:</p>
              <BulletList items={outcomes} />
            </Section>}
          </div>
          <ColumnDivider />
          <div style={{ flex: 1, paddingTop: wahBack ? 4 : 8 }}>
            {assessment.length > 0 && <Section icon="clipboard" title="ASSESSMENT METHOD"><BulletList items={assessment} /></Section>}

                      </div>
        </div>

        {noticeParagraphs.length > 0 && <div style={{ position: "relative", border: "1px solid #e3e7ee", padding: "13px 16px", marginTop: 8, overflow: "hidden", background: "#FCFDFE" }}>
          <SectionHead icon="warning" title="IMPORTANT NOTICE" />
          {noticeParagraphs.map((p, i) => (
            <p key={i} style={{ position: "relative", margin: i === 0 ? 0 : "6px 0 0", fontSize: 9.5, lineHeight: 1.65, color: "#6b7280" }}>
              {p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme")}
            </p>
          ))}
        </div>}

        <div style={{ marginTop: wahBack ? 6 : 10, paddingBottom: wahBack ? 4 : 8 }}>
          <SectionHead icon="shield" title="VERIFICATION" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 22 }}>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: wahBack ? 8 : 11, columnGap: 24, fontSize: 10, color: "#374151" }}>
              {[
                { label: "Certificate No.", value: data.certificate_number },
                { label: "Contact Number", value: config.contact_phone },
                { label: "Website", value: config.contact_website },
                { label: "Email", value: config.contact_email },
                { label: "Issuing Branch Address", value: data.issuer_branch_address },
              ].filter((row): row is { label: string; value: string } => Boolean(row.value)).map((row) => (
                <div key={row.label} style={{ borderLeft: "1px solid #e3e7ee", paddingLeft: 10, ...(row.label === "Issuing Branch Address" ? { gridColumn: "1 / -1" } : {}), ...(goldenReference ? { minWidth: 0, ...(row.label === "Issuing Branch Address" ? { paddingRight: 24 } : {}) } : {}) }}>
                  <div style={{ fontSize: 8, letterSpacing: 1.1, color: "#8a94a6", fontFamily: SANS, textTransform: "uppercase" }}>{row.label}</div>
                  {/* C4 only: the stored text is rendered verbatim, just allowed to wrap inside its cell, and the full-width address cell keeps 24px clear on the right because the QR caption overhangs ~13px left of its column -- so a long branch address can't run into the QR block. Legacy back pages keep their exact prior styling. */}
                  <div style={{ color: navy, fontWeight: 700, marginTop: 2, ...(goldenReference ? { overflowWrap: "anywhere", lineHeight: 1.4 } : {}) }}>{row.value}</div>
                </div>
              ))}
            </div>
            {config.show_qr !== false && data.qr_svg && (
              // WAH only: the safe-zone shift moves the QR caption over this divider, so the rule is hidden while its 1px width stays to keep every position unchanged.
              <div style={{ borderLeft: wahBack ? "1px solid transparent" : "1px solid #e3e7ee", paddingLeft: 20 }}>
                <QrBlock svg={data.qr_svg} navy={navy} gold={gold} size={CERTIFICATE_DESIGN.qr.sizePx - 34} caption safeZone />
              </div>
            )}
          </div>
        </div>
      </div>
      <TaglineFooter navy={navy} gold={gold} />
    </div>
  );
}
