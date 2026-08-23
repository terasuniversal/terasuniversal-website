import type { CSSProperties, ReactNode } from "react";
import { fitHolderNameSize, formatDateRange, isAffirmativeStatus } from "../../lib/certificate-format";
import {
  scaffoldWatermarkLines,
  type ScaffoldWatermarkLevel,
  inspectorWatermarkShapes,
  type InspectorWatermarkLevel,
  workingAtHeightWatermarkShapes,
  type LayeredWatermark,
  BLUEPRINT_GRID,
  REGISTRATION_TICKS,
} from "../../lib/certificate-watermarks";

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
  /** Swaps the background watermark for the distinct clipboard/magnifier Inspector motif (Standard Scaffold Inspector only, resolved per-course by certData.ts's merge — see lib/certificate-watermarks.ts). Takes precedence over watermark_level if both were somehow set, but the two are never set on the same programme. */
  inspector_watermark_level?: InspectorWatermarkLevel;
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

const PAGE_W = 794;
const PAGE_H = 1123;
const REG_NO = "202201038223 (1477529-X)";
/**
 * Micro-typography stack for eyebrows/labels/table headers. The display type
 * stays Georgia (serif) — pairing it with a tracked-out sans for the small
 * supporting type is what separates a corporate competency document from a
 * single-serif "template default" look. Mirrored in lib/certificate-html.ts.
 */
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

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

/**
 * Restrained corporate frame: one thin navy rule, one inset gold hairline,
 * and fine L-brackets at all four corners. Replaces the previous
 * folded-ribbon + triple-border treatment — two heavy rotated navy/gold
 * bands across opposite corners plus three stacked borders is the single
 * strongest "decorative certificate template" signal on the page, and it
 * competes with the content for attention. Symmetric corner brackets read
 * as deliberate technical framing instead.
 */
function CertificateFrame({ navy, gold }: { navy: string; gold: string }) {
  const corners: { key: string; box: CSSProperties }[] = [
    { key: "tl", box: { top: 18, left: 18 } },
    { key: "tr", box: { top: 18, right: 18 } },
    { key: "bl", box: { bottom: 18, left: 18 } },
    { key: "br", box: { bottom: 18, right: 18 } },
  ];
  return (
    <>
      <div style={{ position: "absolute", inset: 10, border: `1px solid ${navy}`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 14, border: `1px solid ${gold}`, opacity: 0.4, pointerEvents: "none" }} />
      {corners.map(({ key, box }) => {
        const vy: CSSProperties = key[0] === "t" ? { top: 0 } : { bottom: 0 };
        const hx: CSSProperties = key[1] === "l" ? { left: 0 } : { right: 0 };
        return (
          <div key={key} style={{ position: "absolute", width: 34, height: 34, pointerEvents: "none", ...box }}>
            <div style={{ position: "absolute", width: 34, height: 1.5, background: gold, ...vy, ...hx }} />
            <div style={{ position: "absolute", width: 1.5, height: 34, background: gold, ...vy, ...hx }} />
          </div>
        );
      })}
    </>
  );
}

/**
 * Shared renderer for every certificate-watermark family (see
 * lib/certificate-watermarks.ts) — plain SVG lines/rects/circles, not a
 * photo or third-party asset. Renders the `primary` shape set at a higher
 * weight/opacity and, when `showSecondary` is true, layers the lighter
 * `secondary` set on top — the "primary motif + supporting detail"
 * hierarchy the geometry functions are designed around. `corner` shifts and
 * shrinks it for the single back-page placement, which passes
 * `showSecondary={false}` so the back mark reads as a genuinely smaller,
 * partial version of the front motif rather than a second full copy.
 */
function WatermarkLayer({ shapes, color, corner = false, showSecondary = true }: { shapes: LayeredWatermark; color: string; corner?: boolean; showSecondary?: boolean }) {
  // Both placements deliberately bleed past the page edge so the page's own
  // `overflow: hidden` crops them. A fully-contained, centred drawing reads
  // as a separate illustration floating on the page; a cropped one reads as
  // a blueprint underlay the layout sits on top of.
  const size = corner
    ? { width: 320, height: 230, style: { bottom: -28, right: -44 } }
    : { width: 560, height: 390, style: { bottom: 86, right: -70 } };
  const renderSet = (set: LayeredWatermark["primary"], keyPrefix: string) => (
    <>
      {set.lines.map(([x1, y1, x2, y2], i) => <line key={`${keyPrefix}l${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />)}
      {set.rects.map(([x, y, w, h], i) => <rect key={`${keyPrefix}r${i}`} x={x} y={y} width={w} height={h} />)}
      {set.circles.map(([cx, cy, r], i) => <circle key={`${keyPrefix}c${i}`} cx={cx} cy={cy} r={r} />)}
    </>
  );
  return (
    <svg viewBox="0 0 320 240" style={{ position: "absolute", width: size.width, height: size.height, pointerEvents: "none", ...size.style }}>
      {/* Drafting-grid + corner registration ticks, front placement only. This
          is what turns the motif from "a drawing placed on the page" into a
          blueprint underlay the layout sits on — the motif geometry itself is
          untouched, so each family keeps its own identity. */}
      {showSecondary && (
        <g stroke={color} strokeWidth="0.6" fill="none" opacity={0.032}>
          {BLUEPRINT_GRID.map(([x1, y1, x2, y2], i) => <line key={`g${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />)}
        </g>
      )}
      {showSecondary && (
        <g stroke={color} strokeWidth="0.9" fill="none" opacity={0.055}>
          {REGISTRATION_TICKS.map(([x1, y1, x2, y2], i) => <line key={`t${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />)}
        </g>
      )}
      {/* Primary sits a clear step above the grid so the family motif still
          reads as the subject and the grid stays background — raising both by
          the same amount would have kept it flat and muddy. */}
      <g stroke={color} strokeWidth="1.8" fill="none" opacity={0.06}>{renderSet(shapes.primary, "p")}</g>
      {showSecondary && (
        <g stroke={color} strokeWidth="1.1" fill="none" opacity={0.04}>{renderSet(shapes.secondary, "s")}</g>
      )}
    </svg>
  );
}

/**
 * Resolves which watermark family a template renders and dispatches to
 * WatermarkLayer. inspector_watermark_level takes precedence over
 * wah_watermark, which takes precedence over the Scaffold Erector
 * geometry (config.watermark_level, defaulting to "intermediate") — the
 * same precedence every certificate using this generic renderer has always
 * had, now expressed once instead of duplicated at each of the 2 call
 * sites below.
 */
function CertificateWatermark({ config, color, corner = false }: { config: TemplateConfig; color: string; corner?: boolean }) {
  const shapes = config.inspector_watermark_level
    ? inspectorWatermarkShapes(config.inspector_watermark_level)
    : config.wah_watermark
    ? workingAtHeightWatermarkShapes()
    : scaffoldWatermarkLines(config.watermark_level ?? "intermediate");
  return <WatermarkLayer shapes={shapes} color={color} corner={corner} showSecondary={!corner} />;
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
      <div style={{ fontSize: 11.5, fontWeight: 700, color: navy, fontFamily: "Georgia, serif", lineHeight: 1.35, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

/**
 * Inline QR — see generateQrSvg's comment for why this isn't an
 * <img src="https://..."> anymore. Presented as a bordered plate with a
 * tracked-out caption rather than the previous rounded gold-outlined card,
 * which read as a utility widget bolted onto the layout.
 */
function QrBlock({ svg, navy, gold, size, caption }: { svg: string; navy: string; gold: string; size: number; caption: boolean }) {
  return (
    <div style={{ width: size + 22, textAlign: "center" }}>
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
        <div style={{ fontSize: 7, color: "#8a94a6", marginTop: 8, lineHeight: 1.5, fontFamily: SANS, letterSpacing: 0.2 }}>Scan to verify this certificate at Teras Universal Database</div>
      )}
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
      {!config.background_url && <CertificateWatermark config={config} color={navy} />}
      <CertificateFrame navy={navy} gold={gold} />

      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: "30px 40px", display: "flex", flexDirection: "column", textAlign: "center" }}>
        {/* 105x74 is the asset's own 1144x806 aspect at the requested ~105px
            width — an explicit pair rather than a square box, because a square
            box with objectFit:contain padded ~15px of dead space above and
            below the mark and made the header rhythm read as loose. */}
        {config.logo_url && <img src={config.logo_url} alt="" style={{ width: 105, height: 74, objectFit: "contain", display: "block", margin: "0 auto 11px" }} />}
        <div style={{ letterSpacing: 3.4, fontSize: 13, color: navy, fontWeight: 700 }}>TERAS UNIVERSAL SDN. BHD.</div>
        <div style={{ fontSize: 8, color: "#8a94a6", marginTop: 4, letterSpacing: 1, fontFamily: SANS }}>{REG_NO}</div>
        <div style={{ width: 44, height: 1, background: gold, margin: "12px auto 0" }} />

        <h1 style={{ fontSize: 44, margin: "16px 0 0", letterSpacing: 14, color: navy, fontWeight: 700, lineHeight: 1, textIndent: 14 }}>CERTIFICATE</h1>
        <div style={{ fontSize: 8.5, color: "#8a94a6", letterSpacing: 5, fontWeight: 600, fontFamily: SANS, textIndent: 5, marginTop: 10 }}>OF SUCCESSFUL COMPLETION</div>

        <p style={{ fontSize: 9.5, margin: "26px 0 10px", color: "#8a94a6", letterSpacing: 1.8, fontFamily: SANS, textTransform: "uppercase", textIndent: 1.8 }}>This certificate is proudly presented to</p>
        <div style={{ position: "relative", display: "inline-block", margin: "0 auto", maxWidth: 660 }}>
          <div style={{ fontSize: nameSize, fontWeight: 700, color: navy, padding: "0 24px 13px", wordBreak: "break-word", lineHeight: 1.25, letterSpacing: 0.5 }}>
            {data.holder_name}
          </div>
          {/* Hairline rule with a short gold centre segment — replaces the
              rotated gold diamond, which read as award/wedding ornamentation. */}
          <div style={{ position: "relative", height: 1, background: "#d3d9e2" }}>
            <span style={{ position: "absolute", top: -0.5, left: "50%", transform: "translateX(-50%)", width: 92, height: 1.5, background: gold }} />
          </div>
        </div>
        {data.ic_passport && <p style={{ fontSize: 9.5, color: "#8a94a6", margin: "11px 0 0", letterSpacing: 0.6, fontFamily: SANS }}>Passport / IC No: {data.ic_passport}</p>}

        <p style={{ fontSize: 9, margin: "22px 0 0", color: "#8a94a6", letterSpacing: 1.8, fontFamily: SANS, textTransform: "uppercase", textIndent: 1.8 }}>For successfully completing the</p>
        <div style={{ width: 26, height: 1, background: gold, margin: "9px auto 11px" }} />
        <div style={{ fontSize: 23, fontWeight: 700, color: navy, textTransform: "uppercase", lineHeight: 1.38, maxWidth: 600, margin: "0 auto", letterSpacing: 1.4 }}>
          {data.course_name}
        </div>
        {duration && (
          <RibbonBanner navy={navy} gold={gold} style={{ margin: "16px auto 0" }}>
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 2.4, fontFamily: SANS, textIndent: 2.4 }}>{duration}</span>
          </RibbonBanner>
        )}
        {dateRange && (
          <p style={{ fontSize: 11, color: "#4b5563", margin: "16px 0 0" }}>
            <span style={{ color: "#8a94a6", letterSpacing: 1.3, fontSize: 8.5, fontFamily: SANS, textTransform: "uppercase" }}>Conducted from </span>
            {dateRange}
          </p>
        )}

        <p style={{ fontSize: 10.5, lineHeight: 1.85, maxWidth: 520, margin: "17px auto 0", color: "#6b7280" }}>
          {config.body_text || DEFAULT_BODY_TEXT}
        </p>

        {/* Record strip: four data cells across a tinted band, hairline-separated.
            A single horizontal strip on its own ground reads as the data block of
            an issued document; the previous 2x2 icon-badge grid read as a form. */}
        <div style={{ margin: "auto 0 0", background: "#F7F9FB", borderTop: "1px solid #e3e7ee", borderBottom: "1px solid #e3e7ee", padding: "15px 20px", display: "flex", gap: 20, textAlign: "left", alignItems: "flex-start" }}>
          <MetaTile icon="calendar" label="Date of Completion" value={data.issue_date || "—"} navy={navy} gold={gold} />
          <div style={{ width: 1, background: "#e3e7ee", alignSelf: "stretch" }} />
          <MetaTile icon="refresh" label="Skills Update" value={config.skills_update_recommendation || "Within Three (3) Years"} navy={navy} gold={gold} />
          <div style={{ width: 1, background: "#e3e7ee", alignSelf: "stretch" }} />
          <MetaTile icon="doc" label="Certificate No." value={data.certificate_number} navy={navy} gold={gold} />
          <div style={{ width: 1, background: "#e3e7ee", alignSelf: "stretch" }} />
          <MetaTile icon="id" label="Participant ID" value={data.participant_id || "—"} navy={navy} gold={gold} />
        </div>

        {/* Attestation zone: signatory | stamp | verification, baseline-aligned on
            one row. The QR moved out of the record strip so signing and verifying
            sit together as one act of issuance, and so neither side is lopsided.
            "single" = one signatory (e.g. Director) beside the stamp only.
            "dual" (default) = Trainer + Training Manager. */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 26, marginTop: 26 }}>
          <div style={{ textAlign: "center", fontSize: 11, width: 196 }}>
            {/* Fixed-height signature well: the image sits ON the rule rather than
                floating above it at whatever height the asset happens to be.
                The extra headroom over the rule keeps a tall signature from
                touching the metadata band above it. */}
            <div style={{ height: 46, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 2 }}>
              {config.signature_url && <img src={config.signature_url} alt="" style={{ maxHeight: 44, maxWidth: 168, objectFit: "contain" }} />}
            </div>
            <div style={{ borderTop: `1px solid ${navy}`, margin: "5px 0 6px" }} />
            {config.signature_layout === "single" ? (
              <strong style={{ color: navy, letterSpacing: 0.3 }}>{config.signature_name || config.signature_title || "Director"}</strong>
            ) : (
              <>
                <strong style={{ color: navy, letterSpacing: 0.3 }}>{config.signature_name || "Trainer"}</strong>
                <div style={{ color: "#8a94a6", fontSize: 8.5, letterSpacing: 1.3, fontFamily: SANS, textTransform: "uppercase", marginTop: 3 }}>Trainer Signature</div>
              </>
            )}
            {config.signature_layout === "single" && config.signature_name && (
              <div style={{ color: "#8a94a6", fontSize: 8.5, letterSpacing: 1.3, fontFamily: SANS, textTransform: "uppercase", marginTop: 3 }}>{config.signature_title || "Director"}</div>
            )}
          </div>
          {config.signature_layout !== "single" && (
            <div style={{ textAlign: "center", fontSize: 11, width: 196 }}>
              <div style={{ height: 46 }} />
              <div style={{ borderTop: `1px solid ${navy}`, margin: "5px 0 6px" }} />
              <strong style={{ color: navy, letterSpacing: 0.3 }}>{config.signature_title || "Training Manager"}</strong>
              <div style={{ color: "#8a94a6", fontSize: 8.5, letterSpacing: 1.3, fontFamily: SANS, textTransform: "uppercase", marginTop: 3 }}>Training Manager</div>
            </div>
          )}
          <div style={{ textAlign: "center", fontSize: 7, letterSpacing: 1.2, fontFamily: SANS, width: 66, height: 66, borderRadius: "50%", border: `1px dashed ${gold}`, opacity: 0.95, display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa3b2", padding: 4, marginBottom: 6 }}>
            COMPANY STAMP
          </div>
          {config.show_qr !== false && data.qr_svg && <QrBlock svg={data.qr_svg} navy={navy} gold={gold} size={82} caption />}
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

  /**
   * Editorial section head: gold glyph, tracked navy label, and a two-tone rule
   * (a short gold segment running into a long hairline) rather than a single
   * full-width gold underline. The two-tone rule gives each column a defined
   * start point, which is what makes three stacked sections scan as a designed
   * grid instead of three same-weight bars.
   */
  const Section = ({ icon, title, children }: { icon: IconKind; title: string; children: ReactNode }) => (
    <div style={{ marginBottom: 15 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
        <Glyph kind={icon} color={gold} size={11} />
        <span style={{ fontSize: 8.5, fontWeight: 700, color: navy, letterSpacing: 1.6, fontFamily: SANS }}>{title}</span>
      </div>
      <div style={{ display: "flex", marginBottom: 8 }}>
        <span style={{ width: 22, height: 1.5, background: gold }} />
        <span style={{ flex: 1, height: 1, background: "#e3e7ee", alignSelf: "center" }} />
      </div>
      {children}
    </div>
  );
  /**
   * One bullet treatment for every list on this page — a short gold dash.
   * Coverage/assessment previously used a "✓" glyph while learning outcomes
   * used browser disc bullets, so three adjacent columns each announced their
   * items differently. A dash sits quieter than a square at this size and
   * matches the rule language used by the section heads.
   */
  const BulletList = ({ items }: { items: string[] }) => (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 10, lineHeight: 1.7, color: "#374151" }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: "flex", gap: 8, marginBottom: 5 }}>
          <span style={{ width: 6, height: 1, background: gold, marginTop: 8, flexShrink: 0 }} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
  const ColumnDivider = () => <div style={{ width: 1, alignSelf: "stretch", background: "#edf0f4" }} />;

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#fff", boxSizing: "border-box", padding: 34, fontFamily: "Georgia, 'Times New Roman', serif", color: "#1F2937", overflow: "hidden" }}>
      <CertificateWatermark config={config} color={navy} corner />
      <CertificateFrame navy={navy} gold={gold} />
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: "30px 40px", display: "flex", flexDirection: "column" }}>
        <RibbonBanner navy={navy} gold={gold} style={{ alignSelf: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2.8, fontFamily: SANS, textIndent: 2.8 }}>PROGRAMME INFORMATION</span>
        </RibbonBanner>
        <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, color: navy, textTransform: "uppercase", margin: "15px 0 0", lineHeight: 1.3, letterSpacing: 1 }}>
          {config.programme_title || data.course_name}
        </div>
        <div style={{ width: 44, height: 1, background: gold, margin: "10px auto 17px" }} />

        <div style={{ display: "flex", gap: 26, flex: 1 }}>
          <div style={{ flex: 1 }}>
            <Section icon="target" title="PROGRAMME OBJECTIVES">
              <p style={{ margin: 0, fontSize: 10, lineHeight: 1.75, color: "#374151" }}>{config.objectives_text || DEFAULT_OBJECTIVES}</p>
            </Section>
            <Section icon="book" title="PROGRAMME COVERAGE"><BulletList items={coverage} /></Section>
          </div>
          <ColumnDivider />
          <div style={{ flex: 1 }}>
            <Section icon="bulb" title="LEARNING OUTCOMES">
              <p style={{ margin: "0 0 9px", fontSize: 10, lineHeight: 1.65, color: "#6b7280" }}>Upon successful completion, participants should be able to:</p>
              <BulletList items={outcomes} />
            </Section>
          </div>
          <ColumnDivider />
          <div style={{ flex: 1 }}>
            <Section icon="clipboard" title="ASSESSMENT METHOD"><BulletList items={assessment} /></Section>
            {showSkillsRecord && (
              <Section icon="doc" title="PARTICIPANT SKILLS RECORD">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "0 6px 5px 0", fontWeight: 700, color: "#8a94a6", fontFamily: SANS, fontSize: 7.5, letterSpacing: 1.1, textTransform: "uppercase", borderBottom: `1px solid ${gold}` }}>Assessment Area</th>
                      <th style={{ textAlign: "left", padding: "0 0 5px 6px", fontWeight: 700, color: "#8a94a6", fontFamily: SANS, fontSize: 7.5, letterSpacing: 1.1, textTransform: "uppercase", borderBottom: `1px solid ${gold}` }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skillsRecord.map((r, i) => {
                      const affirmative = isAffirmativeStatus(r.status);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #eef1f5" }}>
                          <td style={{ padding: "5px 6px 5px 0", color: "#374151" }}>{r.area}</td>
                          <td style={{ padding: "5px 0 5px 6px", color: affirmative ? navy : "#8a94a6", fontWeight: affirmative ? 700 : 400 }}>{r.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Section>
            )}
          </div>
        </div>

        <div style={{ position: "relative", border: "1px solid #e3e7ee", borderLeft: `2px solid ${gold}`, padding: "13px 16px", marginTop: 8, overflow: "hidden" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Glyph kind="warning" color={gold} size={11} />
            <span style={{ fontSize: 9, fontWeight: 700, color: navy, letterSpacing: 1.5, fontFamily: SANS }}>IMPORTANT NOTICE</span>
          </div>
          {noticeParagraphs.map((p, i) => (
            <p key={i} style={{ position: "relative", margin: i === 0 ? 0 : "6px 0 0", fontSize: 9.5, lineHeight: 1.65, color: "#6b7280" }}>
              {p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme")}
            </p>
          ))}
        </div>

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e3e7ee" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
            <Glyph kind="shield" color={gold} size={11} />
            <span style={{ fontSize: 9, fontWeight: 700, color: navy, letterSpacing: 1.5, fontFamily: SANS }}>VERIFICATION</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 22 }}>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 9, columnGap: 24, fontSize: 9.5, color: "#374151" }}>
              {[
                { label: "Certificate No.", value: data.certificate_number },
                { label: "Contact Number", value: config.contact_phone || "019-519 3834" },
                { label: "Website", value: config.contact_website || "www.terasuniversal.com.my" },
                { label: "Email", value: config.contact_email || "admin@terasuniversal.com.my" },
              ].map((row) => (
                <div key={row.label} style={{ borderLeft: "1px solid #e3e7ee", paddingLeft: 10 }}>
                  <div style={{ fontSize: 7.5, letterSpacing: 1.1, color: "#8a94a6", fontFamily: SANS, textTransform: "uppercase" }}>{row.label}</div>
                  <div style={{ color: navy, fontWeight: 700, marginTop: 2 }}>{row.value}</div>
                </div>
              ))}
            </div>
            {config.show_qr !== false && data.qr_svg && (
              <div style={{ borderLeft: "1px solid #e3e7ee", paddingLeft: 20 }}>
                <QrBlock svg={data.qr_svg} navy={navy} gold={gold} size={56} caption={false} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
