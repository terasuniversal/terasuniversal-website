import type { CSSProperties, ReactNode } from "react";
import { fitHolderNameSize, formatDateRange, isAffirmativeStatus } from "../../lib/certificate-format";
import { scaffoldWatermarkLines, type ScaffoldWatermarkLevel } from "../../lib/certificate-watermarks";

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
  /** Absolute URL already resolved by certData.ts — encodes /verify/{certificate_number}. */
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
  certificate_skills_record?: { area: string; status: string }[] | null;
  /**
   * Participant-specific LIVE fallback (Phase 1), populated by certData.ts
   * only for the areas actually provable from live data (currently:
   * Attendance Requirement, from v_certificate_eligibility.attendance_satisfied).
   * Absent/null whenever the certificate has no schedule_id/participant_id
   * or the eligibility lookup fails — never fabricated. Only reached when
   * certificate_skills_record is absent — i.e. schedule-linked certificates
   * issued before Phase 2C; see ProfessionalScaffoldCertificateDocument.tsx /
   * professional-scaffold-certificate-html.ts for the full fallback chain.
   */
  participant_skills_record?: { area: string; status: string }[] | null;
}

export interface TemplateConfig {
  /** Selects a dedicated renderer component in CertificateRenderer.tsx instead of this generic one. Routed by exact key match, never by course-name/title matching. */
  design_variant?: string;
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
  show_qr?: boolean;
  /** Swaps the generic scaffold-pole background watermark for a level-specific density (Standard Scaffold Erector only, resolved per-course by certData.ts's merge — see lib/certificate-watermarks.ts). Unset everywhere else, which renders the same generic watermark this template always had. */
  watermark_level?: ScaffoldWatermarkLevel;
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
const DEFAULT_NOTICE_PARAGRAPHS = [
  "This certificate acknowledges successful completion of the programme conducted by Teras Universal Sdn. Bhd.",
  "It records participation in a structured learning and skills-development programme.",
  "It does not represent or replace any statutory competency certification, licence, registration or authorisation that may be required under applicable laws, regulations or project-specific requirements.",
];

/** A rotated-band corner ribbon (the standard CSS "corner ribbon" technique) plus a thin gold trim and parallel accent line. */
function CornerRibbon({ corner, navy, gold }: { corner: "tl" | "br"; navy: string; gold: string }) {
  const isTl = corner === "tl";
  const place: CSSProperties = isTl ? { top: 26, left: -54 } : { bottom: 26, right: -54 };
  const rotate = "rotate(-45deg)";
  return (
    <>
      <div style={{ position: "absolute", width: 200, height: 25, background: navy, transform: rotate, transformOrigin: "center", ...place }} />
      <div style={{ position: "absolute", width: 200, height: 3, background: gold, transform: rotate, transformOrigin: "center", ...(isTl ? { top: 26 + 11, left: -54 } : { bottom: 26 + 11, right: -54 }) }} />
      <div style={{ position: "absolute", width: 200, height: 1, background: gold, opacity: 0.55, transform: rotate, transformOrigin: "center", ...(isTl ? { top: 26 - 8, left: -54 } : { bottom: 26 - 8, right: -54 }) }} />
    </>
  );
}

/** Shared corner ornamentation — folded-ribbon emphasis on top-left / bottom-right, fine line-work on the other two. */
function OrnateBorder({ navy, gold }: { navy: string; gold: string }) {
  const bracket = (corner: "tr" | "bl", size: number) => {
    const base: CSSProperties = { position: "absolute", background: gold };
    const h: CSSProperties =
      corner === "tr" ? { top: 12, right: 12, width: size, height: 2 } : { bottom: 12, left: 12, width: size, height: 2 };
    const v: CSSProperties =
      corner === "tr" ? { top: 12, right: 12, width: 2, height: size } : { bottom: 12, left: 12, width: 2, height: size };
    const h2: CSSProperties =
      corner === "tr" ? { top: 18, right: 18, width: size * 0.6, height: 1 } : { bottom: 18, left: 18, width: size * 0.6, height: 1 };
    const v2: CSSProperties =
      corner === "tr" ? { top: 18, right: 18, width: 1, height: size * 0.6 } : { bottom: 18, left: 18, width: 1, height: size * 0.6 };
    return (
      <>
        <div style={{ ...base, ...h }} />
        <div style={{ ...base, ...v }} />
        <div style={{ ...base, ...h2, opacity: 0.6 }} />
        <div style={{ ...base, ...v2, opacity: 0.6 }} />
      </>
    );
  };
  return (
    <>
      <CornerRibbon corner="tl" navy={navy} gold={gold} />
      <CornerRibbon corner="br" navy={navy} gold={gold} />
      {bracket("tr", 38)}
      {bracket("bl", 38)}
      <div style={{ position: "absolute", inset: 4, border: `2px solid ${navy}`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 9, border: `1px solid ${gold}`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 13, border: `1px solid ${navy}`, opacity: 0.25, pointerEvents: "none" }} />
    </>
  );
}

/**
 * Minimal, original scaffold-pole motif — plain SVG lines, not a photo or
 * third-party asset — used as a very low-opacity watermark so the page
 * doesn't read as unfinished in its whitespace. `corner` shifts it for page
 * 2's lower-right placement (larger, spanning behind the notice panel too).
 * `level` (Standard Scaffold Erector only, via config.watermark_level; see
 * lib/certificate-watermarks.ts) swaps in a denser/sparser line set for
 * Basic/Intermediate/Advanced -- "intermediate" is the same geometry this
 * component always rendered, so every certificate without a level (every
 * other template, including Standard Scaffold Inspector and Working at
 * Height) renders byte-for-byte as before.
 */
function ScaffoldMotif({ color, corner = false, level }: { color: string; corner?: boolean; level?: ScaffoldWatermarkLevel }) {
  const size = corner ? { width: 460, height: 340, style: { bottom: -10, right: -30 } } : { width: 460, height: 320, style: { bottom: 150, left: "50%", transform: "translateX(-50%)" } };
  const lines = scaffoldWatermarkLines(level ?? "intermediate");
  return (
    <svg viewBox="0 0 320 240" style={{ position: "absolute", width: size.width, height: size.height, opacity: 0.055, pointerEvents: "none", ...size.style }}>
      <g stroke={color} strokeWidth="2.5" fill="none">
        {lines.verticals.map(([x, y1, y2], i) => <line key={`v${i}`} x1={x} y1={y1} x2={x} y2={y2} />)}
        {lines.horizontals.map(([x1, x2, y], i) => <line key={`h${i}`} x1={x1} y1={y} x2={x2} y2={y} />)}
        {lines.braces.map(([x1, y1, x2, y2], i) => <line key={`b${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />)}
      </g>
    </svg>
  );
}

type IconKind = "calendar" | "refresh" | "doc" | "id" | "target" | "book" | "bulb" | "clipboard" | "warning" | "shield" | "globe" | "phone" | "mail" | "qrMini";
function iconGlyph(kind: IconKind, color: string, strokeWidth = 1.7) {
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
    default: return <svg {...common}><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="2.5" height="2.5" fill={color} stroke="none" /><rect x="17.5" y="17.5" width="2.5" height="2.5" fill={color} stroke="none" /></svg>;
  }
}

/** Circular navy badge with a white icon and a thin gold ring accent — the reference's icon style, used on both pages. */
function CircleIcon({ kind, navy, gold, size = 30 }: { kind: IconKind; navy: string; gold: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, minWidth: size, borderRadius: "50%", background: navy, border: `1.5px solid ${gold}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {iconGlyph(kind, "#fff")}
    </div>
  );
}

function MetaTile({ icon, label, value, navy, gold }: { icon: IconKind; label: string; value: string; navy: string; gold: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <CircleIcon kind={icon} navy={navy} gold={gold} size={34} />
      <div>
        <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.6, color: "#6b7280" }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: navy, fontFamily: "Georgia, serif" }}>{value}</div>
      </div>
    </div>
  );
}

/** Inline QR — see generateQrSvg's comment for why this isn't an <img src="https://..."> anymore. */
function QrBlock({ svg, navy, gold, size, caption }: { svg: string; navy: string; gold: string; size: number; caption: boolean }) {
  return (
    <div style={{ width: size + 34, border: `1.5px solid ${gold}`, borderRadius: 6, padding: "12px 9px", textAlign: "center", background: "#fff" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: navy, letterSpacing: 0.6, marginBottom: 7 }}>QR VERIFICATION</div>
      <div style={{ width: size, height: size, margin: "0 auto", padding: 4, background: "#fff", border: "1px solid #eee" }} dangerouslySetInnerHTML={{ __html: svg }} />
      {caption && <div style={{ fontSize: 8.5, color: "#6b7280", marginTop: 7, lineHeight: 1.35 }}>Scan to verify this certificate at Teras Universal Database</div>}
    </div>
  );
}

/** Ribbon-shaped banner (pointed ends, like the reference's duration/section banners). */
function RibbonBanner({ children, navy, gold, style }: { children: ReactNode; navy: string; gold: string; style?: CSSProperties }) {
  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <div style={{ position: "absolute", inset: -3, background: gold, clipPath: "polygon(2% 0%, 98% 0%, 100% 50%, 98% 100%, 2% 100%, 0% 50%)" }} />
      <div style={{ position: "relative", background: navy, color: "#fff", clipPath: "polygon(2% 0%, 98% 0%, 100% 50%, 98% 100%, 2% 100%, 0% 50%)", padding: "8px 34px" }}>
        {children}
      </div>
    </div>
  );
}

export function CertificateDocument({ data, config }: { data: CertData; config: TemplateConfig }) {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  const nameSize = fitHolderNameSize(data.holder_name) + 4;

  return (
    <div
      style={{
        width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#fff",
        boxSizing: "border-box", padding: 34, fontFamily: "Georgia, 'Times New Roman', serif", color: "#1F2937", overflow: "hidden",
        backgroundImage: config.background_url ? `url(${config.background_url})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}
    >
      {!config.background_url && <ScaffoldMotif color={navy} level={config.watermark_level} />}
      <OrnateBorder navy={navy} gold={gold} />

      <div style={{ position: "relative", height: "100%", padding: "26px 34px", display: "flex", flexDirection: "column", textAlign: "center" }}>
        {config.logo_url && <img src={config.logo_url} alt="" style={{ width: 104, height: 104, objectFit: "contain", margin: "0 auto 6px" }} />}
        <div style={{ letterSpacing: 2, fontSize: 15, color: navy, fontWeight: 700 }}>TERAS UNIVERSAL SDN. BHD.</div>
        <div style={{ fontSize: 9.5, color: "#6b7280", marginTop: 2 }}>{REG_NO}</div>

        <h1 style={{ fontSize: 56, margin: "18px 0 0", letterSpacing: 2, color: gold, fontWeight: 700, lineHeight: 1 }}>CERTIFICATE</h1>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8 }}>
          <span style={{ width: 46, height: 1.5, background: gold, display: "inline-block" }} />
          <span style={{ fontSize: 14, color: navy, letterSpacing: 3, fontWeight: 600 }}>OF SUCCESSFUL COMPLETION</span>
          <span style={{ width: 46, height: 1.5, background: gold, display: "inline-block" }} />
        </div>

        <p style={{ fontSize: 13.5, margin: "22px 0 6px", color: "#4b5563" }}>This certificate is proudly presented to</p>
        <div style={{ position: "relative", display: "inline-block", margin: "0 auto" }}>
          <div style={{ fontSize: nameSize, fontWeight: 700, color: navy, display: "inline-block", padding: "0 24px 8px", maxWidth: 660, wordBreak: "break-word" }}>
            {data.holder_name}
          </div>
          <div style={{ borderTop: `2px solid ${gold}`, position: "relative" }}>
            <span style={{ position: "absolute", top: -4, left: "50%", transform: "translateX(-50%) rotate(45deg)", width: 7, height: 7, background: gold }} />
          </div>
        </div>
        {data.ic_passport && <p style={{ fontSize: 12.5, color: "#6b7280", margin: "10px 0 0" }}>Passport / IC No: {data.ic_passport}</p>}

        <p style={{ fontSize: 13.5, margin: "20px 0 4px", color: "#4b5563" }}>For successfully completing the</p>
        <div style={{ fontSize: 20, fontWeight: 700, color: navy, textTransform: "uppercase", lineHeight: 1.35, maxWidth: 640, margin: "0 auto" }}>
          {data.course_name}
        </div>
        {duration && (
          <RibbonBanner navy={navy} gold={gold} style={{ margin: "14px auto 0" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 0.5 }}>{duration}</span>
          </RibbonBanner>
        )}
        {dateRange && <p style={{ fontSize: 12.5, color: "#4b5563", margin: "13px 0 0" }}><strong style={{ color: navy }}>Conducted from</strong> {dateRange}</p>}

        <p style={{ fontSize: 12.5, lineHeight: 1.65, maxWidth: 590, margin: "16px auto 0", color: "#4b5563" }}>
          {config.body_text || DEFAULT_BODY_TEXT}
        </p>

        {/* Metadata grid + QR */}
        <div style={{ display: "flex", gap: 20, margin: "auto 0 0", paddingTop: 20, textAlign: "left", position: "relative" }}>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 20, columnGap: 14, alignContent: "center" }}>
            <MetaTile icon="calendar" label="Date of Completion" value={data.issue_date || "—"} navy={navy} gold={gold} />
            <MetaTile icon="refresh" label="Recommended Skills Update" value={config.skills_update_recommendation || "Within Three (3) Years"} navy={navy} gold={gold} />
            <MetaTile icon="doc" label="Certificate No." value={data.certificate_number} navy={navy} gold={gold} />
            <MetaTile icon="id" label="Participant ID" value={data.participant_id || "—"} navy={navy} gold={gold} />
          </div>
          {config.show_qr !== false && data.qr_svg && <QrBlock svg={data.qr_svg} navy={navy} gold={gold} size={104} caption />}
        </div>

        {/* Signatures. "single" = one signatory (e.g. Director) beside the stamp only.
            "dual" (default) = Trainer (left), Training Manager (middle), Company Stamp (right). */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 28, paddingTop: 4 }}>
          <div style={{ textAlign: "center", fontSize: 11.5, width: 180 }}>
            {config.signature_url && <img src={config.signature_url} alt="" style={{ height: 38, objectFit: "contain" }} />}
            <div style={{ borderTop: `1px solid ${navy}`, margin: "4px 0 4px" }} />
            {config.signature_layout === "single" ? (
              <strong style={{ color: navy }}>{config.signature_name || config.signature_title || "Director"}</strong>
            ) : (
              <>
                <strong style={{ color: navy }}>{config.signature_name || "Trainer"}</strong>
                <div style={{ color: "#6b7280" }}>Trainer Signature</div>
              </>
            )}
            {config.signature_layout === "single" && config.signature_name && (
              <div style={{ color: "#6b7280" }}>{config.signature_title || "Director"}</div>
            )}
          </div>
          {config.signature_layout !== "single" && (
            <div style={{ textAlign: "center", fontSize: 11.5, width: 180 }}>
              <div style={{ height: 38 }} />
              <div style={{ borderTop: `1px solid ${navy}`, margin: "4px 0 4px" }} />
              <strong style={{ color: navy }}>{config.signature_title || "Training Manager"}</strong>
              <div style={{ color: "#6b7280" }}>Training Manager</div>
            </div>
          )}
          <div style={{ textAlign: "center", fontSize: 10.5, width: 66, height: 66, borderRadius: "50%", border: `1px dashed ${gold}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", padding: 4 }}>
            COMPANY STAMP
          </div>
        </div>
      </div>
    </div>
  );
}

/** Page 2 — "Programme Information" back page. Content is per-template, since it's programme-specific. */
export function CertificateBackPage({ data, config }: { data: CertData; config: TemplateConfig }) {
  if (config.show_back_page === false) return null;
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const coverage = config.coverage_items?.length ? config.coverage_items : DEFAULT_COVERAGE;
  const outcomes = config.learning_outcomes?.length ? config.learning_outcomes : DEFAULT_OUTCOMES;
  const assessment = config.assessment_methods?.length ? config.assessment_methods : DEFAULT_ASSESSMENT;
  const showSkillsRecord = config.show_skills_record !== false;
  const skillsRecord = config.skills_record?.length ? config.skills_record : DEFAULT_SKILLS_RECORD;
  const noticeParagraphs = config.important_notice
    ? config.important_notice.split(/\n{2,}/).filter(Boolean)
    : DEFAULT_NOTICE_PARAGRAPHS;

  const Section = ({ icon, title, children }: { icon: IconKind; title: string; children: ReactNode }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: `2px solid ${gold}`, paddingBottom: 6, marginBottom: 9 }}>
        <CircleIcon kind={icon} navy={navy} gold={gold} size={24} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: navy, letterSpacing: 0.4 }}>{title}</span>
      </div>
      {children}
    </div>
  );
  const CheckList = ({ items }: { items: string[] }) => (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11.5, lineHeight: 1.9, color: "#374151" }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: "flex", gap: 6 }}><span style={{ color: gold, fontWeight: 700 }}>✓</span>{it}</li>
      ))}
    </ul>
  );
  const ColumnDivider = () => <div style={{ width: 1, alignSelf: "stretch", background: `linear-gradient(${gold}, ${gold})`, backgroundSize: "1px 6px", backgroundRepeat: "repeat-y", opacity: 0.55 }} />;

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#fff", boxSizing: "border-box", padding: 34, fontFamily: "Georgia, 'Times New Roman', serif", color: "#1F2937", overflow: "hidden" }}>
      <ScaffoldMotif color={navy} corner level={config.watermark_level} />
      <OrnateBorder navy={navy} gold={gold} />
      <div style={{ position: "relative", height: "100%", padding: "28px 34px", display: "flex", flexDirection: "column" }}>
        <RibbonBanner navy={navy} gold={gold} style={{ alignSelf: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2 }}>PROGRAMME INFORMATION</span>
        </RibbonBanner>
        <div style={{ textAlign: "center", fontSize: 20, fontWeight: 700, color: navy, textTransform: "uppercase", margin: "16px 0 6px", lineHeight: 1.3 }}>
          {config.programme_title || data.course_name}
        </div>
        <div style={{ display: "flex", justifyContent: "center", margin: "0 0 20px" }}>
          <span style={{ width: 6, height: 6, background: gold, transform: "rotate(45deg)", display: "inline-block" }} />
        </div>

        <div style={{ display: "flex", gap: 22, flex: 1 }}>
          <div style={{ flex: 1 }}>
            <Section icon="target" title="PROGRAMME OBJECTIVES">
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.75, color: "#374151" }}>{config.objectives_text || DEFAULT_OBJECTIVES}</p>
            </Section>
            <Section icon="book" title="PROGRAMME COVERAGE"><CheckList items={coverage} /></Section>
          </div>
          <ColumnDivider />
          <div style={{ flex: 1 }}>
            <Section icon="bulb" title="LEARNING OUTCOMES">
              <p style={{ margin: "0 0 8px", fontSize: 11.5, color: "#374151" }}>Upon successful completion, participants should be able to:</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, lineHeight: 1.9, color: "#374151" }}>
                {outcomes.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </Section>
          </div>
          <ColumnDivider />
          <div style={{ flex: 1 }}>
            <Section icon="clipboard" title="ASSESSMENT METHOD"><CheckList items={assessment} /></Section>
            {showSkillsRecord && (
              <Section icon="doc" title="PARTICIPANT SKILLS RECORD">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: navy, color: "#fff" }}>
                      <th style={{ textAlign: "left", padding: "5px 6px", fontWeight: 600 }}>Assessment Area</th>
                      <th style={{ textAlign: "left", padding: "5px 6px", fontWeight: 600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skillsRecord.map((r, i) => {
                      const affirmative = isAffirmativeStatus(r.status);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                          <td style={{ padding: "5px 6px", color: "#374151" }}>{r.area}</td>
                          <td style={{ padding: "5px 6px", color: affirmative ? gold : "#6b7280", fontWeight: affirmative ? 700 : 400 }}>
                            {affirmative ? "✓ " : ""}{r.status}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Section>
            )}
          </div>
        </div>

        <div style={{ position: "relative", border: `1.5px solid ${gold}`, borderRadius: 6, padding: "14px 18px", marginTop: 10, overflow: "hidden" }}>
          <ScaffoldMotif color={navy} corner level={config.watermark_level} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <CircleIcon kind="warning" navy={navy} gold={gold} size={24} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: navy }}>IMPORTANT NOTICE</span>
          </div>
          {noticeParagraphs.map((p, i) => (
            <p key={i} style={{ position: "relative", margin: i === 0 ? 0 : "7px 0 0", fontSize: 10.5, lineHeight: 1.7, color: "#4b5563" }}>
              {p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme")}
            </p>
          ))}
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1.5px solid ${gold}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <CircleIcon kind="shield" navy={navy} gold={gold} size={24} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: navy, letterSpacing: 0.5 }}>VERIFICATION</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 8, columnGap: 28, fontSize: 10.5, color: "#374151" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><CircleIcon kind="doc" navy={navy} gold={gold} size={20} /><span><strong style={{ color: navy }}>Certificate No.</strong> {data.certificate_number}</span></div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><CircleIcon kind="phone" navy={navy} gold={gold} size={20} /><span><strong style={{ color: navy }}>Contact Number</strong> {config.contact_phone || "019-519 3834"}</span></div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><CircleIcon kind="globe" navy={navy} gold={gold} size={20} /><span><strong style={{ color: navy }}>Website</strong> {config.contact_website || "www.terasuniversal.com.my"}</span></div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><CircleIcon kind="mail" navy={navy} gold={gold} size={20} /><span><strong style={{ color: navy }}>Email</strong> {config.contact_email || "admin@terasuniversal.com.my"}</span></div>
            </div>
            {config.show_qr !== false && data.qr_svg && <QrBlock svg={data.qr_svg} navy={navy} gold={gold} size={58} caption={false} />}
          </div>
        </div>
      </div>
    </div>
  );
}
