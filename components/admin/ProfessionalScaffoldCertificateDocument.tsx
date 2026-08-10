import type { CSSProperties, ReactNode } from "react";
import type { CertData, TemplateConfig } from "./CertificateDocument";
import { fitHolderNameSize, formatDateRange, isAffirmativeStatus } from "../../lib/certificate-format";

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

/** Layered navy/gold triangular wedge anchored to a corner — navy base with a smaller gold inner triangle and a gold edge line along the hypotenuse. */
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
  return (
    <>
      <div style={{ position: "absolute", width: size, height: size, background: navy, clipPath: clip[corner], ...pos[corner] }} />
      <div style={{ position: "absolute", width: size * 0.56, height: size * 0.56, background: gold, clipPath: clip[corner], ...inner[corner] }} />
      <div style={{ position: "absolute", background: gold, ...edge[corner] }} />
    </>
  );
}

/** Layered navy/gold/navy/gold/gold rule around the full page — substantial rather than a single thin line. */
function OuterFrame({ navy, gold }: { navy: string; gold: string }) {
  return (
    <>
      <div style={{ position: "absolute", inset: 5, border: `5px solid ${navy}`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 10, border: `2.5px solid ${gold}`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 15, border: `1px solid ${navy}`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 19, border: `1px solid ${gold}`, opacity: 0.7, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 22, border: `1px solid ${gold}`, opacity: 0.85, pointerEvents: "none" }} />
    </>
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

/** Small L-bracket corner ornament (bottom corners of the front, both lower corners of the back). */
function CornerBracket({ corner, gold }: { corner: "tr" | "bl" | "br"; gold: string }) {
  const size = 30;
  const h: CSSProperties =
    corner === "tr" ? { top: 20, right: 20, width: size, height: 2 } : corner === "br" ? { bottom: 20, right: 20, width: size, height: 2 } : { bottom: 20, left: 20, width: size, height: 2 };
  const v: CSSProperties =
    corner === "tr" ? { top: 20, right: 20, width: 2, height: size } : corner === "br" ? { bottom: 20, right: 20, width: 2, height: size } : { bottom: 20, left: 20, width: 2, height: size };
  return (
    <>
      <div style={{ position: "absolute", background: gold, ...h }} />
      <div style={{ position: "absolute", background: gold, ...v }} />
    </>
  );
}

/**
 * Angular navy/gold panel spanning the bottom of the front page — a centre
 * peak (which the seal sits on top of) flanked by two lower angled side
 * sections, so the treatment reads as one balanced structure rather than a
 * plain bar with a triangle poking out of it.
 */
function BottomGeoPanel({ navy, gold }: { navy: string; gold: string }) {
  return (
    <div style={{ position: "absolute", left: -2, right: -2, bottom: -2, height: 130 }}>
      <div
        style={{
          position: "absolute", inset: 0, background: navy,
          clipPath: "polygon(0% 62%, 16% 40%, 34% 55%, 50% 8%, 66% 55%, 84% 40%, 100% 62%, 100% 100%, 0% 100%)",
        }}
      />
      {/* Gold edge trim tracing the same silhouette, with a second inner line for a layered double-trim look. */}
      <svg viewBox="0 0 100 130" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <polyline
          points="0,80.6 16,52 34,71.5 50,10.4 66,71.5 84,52 100,80.6"
          fill="none" stroke={gold} strokeWidth="2.2" vectorEffect="non-scaling-stroke"
        />
        <polyline
          points="0,80.6 16,52 34,71.5 50,10.4 66,71.5 84,52 100,80.6"
          fill="none" stroke={gold} strokeWidth="1" opacity="0.6" transform="translate(0,-4)" vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** Circular navy/gold seal with curved ribbon text top and bottom — decorative only, no accreditation claim. */
function PremiumSeal({ navy, gold, size = 116 }: { navy: string; gold: string; size?: number }) {
  const uid = "pssSeal";
  return (
    <svg viewBox="0 0 200 200" width={size} height={size}>
      <defs>
        <path id={`${uid}-top`} d="M 26,108 A 74,74 0 0 1 174,108" fill="none" />
        <path id={`${uid}-bottom`} d="M 34,132 A 74,74 0 0 0 166,132" fill="none" />
      </defs>
      <circle cx="100" cy="100" r="92" fill={navy} stroke={gold} strokeWidth="3" />
      <circle cx="100" cy="100" r="80" fill="none" stroke={gold} strokeWidth="1" opacity={0.8} />
      <circle cx="100" cy="100" r="74" fill="none" stroke={gold} strokeWidth="0.75" opacity={0.5} />
      {[...Array(5)].map((_, i) => {
        const a = (-90 + i * 15) * (Math.PI / 180);
        const r = 68;
        return <circle key={i} cx={100 + r * Math.cos(a)} cy={100 + r * Math.sin(a) - 4} r="1.6" fill={gold} opacity={0.9} />;
      })}
      <text fontSize="12.5" fontWeight={700} fill={gold} letterSpacing="2.2">
        <textPath href={`#${uid}-top`} startOffset="50%" textAnchor="middle">BUILDING COMPETENCE</textPath>
      </text>
      <text fontSize="12.5" fontWeight={700} fill={gold} letterSpacing="2.2">
        <textPath href={`#${uid}-bottom`} startOffset="50%" textAnchor="middle">CREATING OPPORTUNITIES</textPath>
      </text>
      <text x="100" y="94" textAnchor="middle" fontSize="30" fontWeight={700} fill="#fff" fontFamily="Georgia, serif">TU</text>
      <text x="100" y="114" textAnchor="middle" fontSize="8.5" fill={gold} letterSpacing="1.5">EST. 2012</text>
      <line x1="70" y1="122" x2="130" y2="122" stroke={gold} strokeWidth="0.75" opacity={0.7} />
    </svg>
  );
}

/**
 * Original, hand-drawn scaffold structure line-art (not a photo/third-party
 * asset) — deliberately irregular bracing and a small worker silhouette so it
 * reads as scaffolding rather than a plain lattice grid. Anchored to one
 * side of the page at very low opacity, no visible bounding box.
 */
function ScaffoldSideArt({ side, color, top = 70, height = 540 }: { side: "left" | "right"; color: string; top?: number; height?: number }) {
  const flip = side === "right" ? "scaleX(-1)" : undefined;
  // Three offset poles, ledgers, deck edges and sparse braces make this read
  // as scaffold line-art rather than rectangular construction guides.
  return (
    <svg
      viewBox="0 0 130 620"
      style={{
        position: "absolute", top, [side]: -28, width: 140, height,
        opacity: 0.1, pointerEvents: "none", transform: flip,
      } as CSSProperties}
    >
      <g stroke={color} strokeWidth="2.7" fill="none" strokeLinecap="round">
        <line x1="24" y1="600" x2="24" y2="15" />
        <line x1="76" y1="600" x2="76" y2="55" />
        <line x1="108" y1="600" x2="108" y2="95" />
        <line x1="24" y1="55" x2="76" y2="55" />
        <line x1="24" y1="180" x2="76" y2="180" />
        <line x1="24" y1="305" x2="76" y2="305" />
        <line x1="24" y1="311" x2="108" y2="311" />
        <line x1="24" y1="430" x2="76" y2="430" />
        <line x1="24" y1="555" x2="76" y2="555" />
        <line x1="24" y1="561" x2="108" y2="561" />
        <line x1="76" y1="180" x2="108" y2="180" />
        <line x1="76" y1="305" x2="108" y2="305" />
        <line x1="76" y1="430" x2="108" y2="430" />
        <line x1="76" y1="555" x2="108" y2="555" />
        <line x1="24" y1="55" x2="76" y2="180" />
        <line x1="24" y1="430" x2="76" y2="555" />
        <line x1="76" y1="180" x2="108" y2="305" />
        <line x1="76" y1="430" x2="108" y2="555" />
        <line x1="15" y1="609" x2="33" y2="609" />
        <line x1="67" y1="609" x2="85" y2="609" />
        <line x1="99" y1="609" x2="117" y2="609" />
      </g>
      {/* small standing worker silhouette on the mid platform */}
      <g stroke={color} strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="50" cy="255" r="6.5" />
        <path d="M50,262 L50,288 M50,269 L38,280 M50,269 L62,262 M50,288 L41,308 M50,288 L60,308" />
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
    <div style={{ width: size + 40, border: `1.5px solid ${gold}`, borderRadius: 10, padding: caption ? "14px 12px" : "10px 12px", textAlign: "center", background: "#fff", boxShadow: "0 1px 3px rgba(11,58,99,.08)" }}>
      <div style={{ fontSize: caption ? 11 : 9.5, fontWeight: 700, color: navy, letterSpacing: caption ? 0.8 : 0.5, marginBottom: caption ? 9 : 6 }}>QR VERIFICATION</div>
      <div style={{ width: size, height: size, margin: "0 auto", padding: 5, background: "#fff", border: "1px solid #eee" }} dangerouslySetInnerHTML={{ __html: svg }} />
      {caption && <div style={{ fontSize: 9, color: "#6b7280", marginTop: 8, lineHeight: 1.4 }}>Scan to verify this certificate<br />at Teras Universal Database</div>}
    </div>
  );
}

function RibbonBanner({ children, navy, gold, style }: { children: ReactNode; navy: string; gold: string; style?: CSSProperties }) {
  const clip = "polygon(2% 0%, 98% 0%, 100% 50%, 98% 100%, 2% 100%, 0% 50%)";
  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <div style={{ position: "absolute", inset: -5, background: gold, clipPath: clip }} />
      <div style={{ position: "relative", background: navy, color: "#fff", clipPath: clip, padding: "13px 52px" }}>{children}</div>
    </div>
  );
}

export function ProfessionalScaffoldCertificateDocument({ data, config }: { data: CertData; config: TemplateConfig }) {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label || "10-Day Intensive Practical Training";
  // Dedicated template's own scale (~+26-30% over the generic renderer's
  // formula) so the holder name reads as one of the page's dominant
  // elements, per the approved reference — still shrinks for long names.
  const nameSize = fitHolderNameSize(data.holder_name) + 16;
  // Front headline must show the programme's own title, not whatever
  // `data.course_name` happens to be (e.g. a template-editor preview's
  // generic sample data) — same fallback pattern the back page already uses.
  const programmeName = config.programme_title || data.course_name;

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#fff", boxSizing: "border-box", fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: 1.65, color: "#1F2937", overflow: "hidden" }}>
      <OuterFrame navy={navy} gold={gold} />
      <CornerWedge corner="tl" navy={navy} gold={gold} />
      <CornerWedge corner="tr" navy={navy} gold={gold} />
      <ScaffoldSideArt side="left" color={navy} top={140} />
      <ScaffoldSideArt side="right" color={navy} top={140} />
      <BottomGeoPanel navy={navy} gold={gold} />
      {/* Rendered after the bottom panel so the gold brackets sit on top of the navy. */}
      <CornerBracket corner="bl" gold={gold} />
      <CornerBracket corner="br" gold={gold} />
      <CornerDiamonds gold={gold} />

      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: `${PAD + 6}px ${PAD + 30}px ${PAD + 170}px`, display: "flex", flexDirection: "column", textAlign: "center" }}>
        <img src={config.logo_url || "/teras-universal-logo.png"} alt="" style={{ width: 172, height: 172, objectFit: "contain", margin: "0 auto 2px" }} />
        <div style={{ letterSpacing: 2.4, fontSize: 19, color: navy, fontWeight: 700 }}>TERAS UNIVERSAL SDN. BHD.</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{REG_NO}</div>

        <h1 style={{ fontSize: 88, margin: "3px 0 0", letterSpacing: 3, color: gold, fontWeight: 700, lineHeight: 1, textShadow: "0 2px 0 rgba(11,58,99,.12), 0 1px 0 rgba(212,175,55,.35)" }}>CERTIFICATE</h1>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 2 }}>
          <span style={{ width: 85, height: 2, background: gold, display: "inline-block" }} />
          <span style={{ fontSize: 16, color: navy, letterSpacing: 4, fontWeight: 600 }}>OF SUCCESSFUL COMPLETION</span>
          <span style={{ width: 85, height: 2, background: gold, display: "inline-block" }} />
        </div>

        <p style={{ fontSize: 13.5, margin: "7px 0 3px", color: "#4b5563" }}>This certificate is proudly presented to</p>
        <div style={{ position: "relative", display: "inline-block", margin: "0 auto" }}>
          <div style={{ fontSize: nameSize, fontWeight: 700, color: navy, display: "inline-block", padding: "0 26px 5px", maxWidth: 700, wordBreak: "break-word", fontFamily: "Georgia, serif" }}>
            {data.holder_name}
          </div>
          <div style={{ borderTop: `2.5px solid ${gold}`, position: "relative" }}>
            <span style={{ position: "absolute", top: -4.5, left: "50%", transform: "translateX(-50%) rotate(45deg)", width: 8, height: 8, background: gold }} />
          </div>
        </div>
        {data.ic_passport && <p style={{ fontSize: 12.5, color: "#6b7280", margin: "5px 0 0" }}>Passport / IC No: {data.ic_passport}</p>}

        <p style={{ fontSize: 13.5, margin: "7px 0 2px", color: "#4b5563" }}>For successfully completing the</p>
        <div style={{ fontSize: 24, fontWeight: 700, color: navy, textTransform: "uppercase", lineHeight: 1.2, maxWidth: 600, margin: "0 auto" }}>
          {programmeName}
        </div>
        <RibbonBanner navy={navy} gold={gold} style={{ margin: "6px auto 0" }}>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.6 }}>{duration}</span>
        </RibbonBanner>
        {dateRange && <p style={{ fontSize: 12.5, color: "#4b5563", margin: "5px 0 0" }}><strong style={{ color: navy }}>Conducted from</strong> {dateRange}</p>}

        <p style={{ fontSize: 12, lineHeight: 1.45, maxWidth: 580, margin: "5px auto 0", color: "#4b5563" }}>
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
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 11, columnGap: 16, alignContent: "center", position: "relative" }}>
              <div style={{ position: "absolute", left: "50%", top: 4, bottom: 4, width: 1, background: gold, opacity: 0.4 }} />
              <div style={{ position: "absolute", top: "50%", left: 4, right: 4, height: 1, background: gold, opacity: 0.4 }} />
              <MetaTile icon="calendar" label="Date of Completion" value={data.issue_date || "—"} navy={navy} gold={gold} />
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
              <img src={config.signature_url || DEFAULT_SIGNATURE_URL} alt="" style={{ height: 58, maxWidth: 236, objectFit: "contain" }} />
              <div style={{ borderTop: `1px solid ${navy}`, margin: "4px 0 5px" }} />
              <strong style={{ color: navy, fontSize: 12.5, whiteSpace: "nowrap", display: "block" }}>Muhammad Azri Bin Mohd Latifi Amir</strong>
              <div style={{ color: "#6b7280", marginTop: 2 }}>Director</div>
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
      {/* size=140, not the larger 162 tried earlier: with a 248px-wide
          left-anchored signature block and a page-centered seal, live
          measurement showed only a 4px horizontal gap at 162px (a real,
          fragile near-collision — different print/PDF engines round
          differently and this would eventually overlap "Muhammad Azri...").
          140px restores a ~15px safety margin, verified by the same
          measurement. Shrinking the signature block instead was rejected:
          it would force the Director's name onto two lines, which reopens
          the vertical A4-overflow bug this file's own history documents. */}
      <div style={{ position: "absolute", left: "50%", bottom: 40, transform: "translateX(-50%)", zIndex: 2 }}>
        <PremiumSeal navy={navy} gold={gold} size={140} />
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
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: `2px solid ${gold}`, paddingBottom: 5, marginBottom: 6 }}>
        <CircleIcon kind={icon} navy={navy} gold={gold} size={28} />
        <span style={{ fontSize: 14, fontWeight: 700, color: navy, letterSpacing: 0.5 }}>{title}</span>
      </div>
      {children}
    </div>
  );
  const CheckList = ({ items }: { items: string[] }) => (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13.5, lineHeight: 1.52, color: "#374151" }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: "flex", gap: 9 }}><span style={{ color: gold, fontWeight: 700 }}>✓</span>{it}</li>
      ))}
    </ul>
  );
  const ColumnDivider = () => <div style={{ width: 1, alignSelf: "stretch", background: `linear-gradient(${gold},${gold})`, backgroundSize: "1px 7px", backgroundRepeat: "repeat-y", opacity: 0.55 }} />;

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#fff", boxSizing: "border-box", fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: 1.65, color: "#1F2937", overflow: "hidden" }}>
      <OuterFrame navy={navy} gold={gold} />
      <CornerBracket corner="tr" gold={gold} />
      <CornerBracket corner="bl" gold={gold} />
      {/* Lower half only, behind the Important Notice / Verification
          sections — matches the reference's weighting (not a top banner). */}
      <ScaffoldSideArt side="right" color={navy} top={620} height={480} />
      <CornerDiamonds gold={gold} />

      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: `${PAD + 6}px ${PAD + 20}px ${PAD + 4}px`, display: "flex", flexDirection: "column" }}>
        <RibbonBanner navy={navy} gold={gold} style={{ alignSelf: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 2.2 }}>PROGRAMME INFORMATION</span>
        </RibbonBanner>
        <div style={{ textAlign: "center", fontSize: 24, fontWeight: 700, color: navy, textTransform: "uppercase", margin: "8px 0 4px", lineHeight: 1.22 }}>
          {config.programme_title || data.course_name}
        </div>
        <div style={{ display: "flex", justifyContent: "center", margin: "0 0 7px" }}>
          <span style={{ width: 7, height: 7, background: gold, transform: "rotate(45deg)", display: "inline-block" }} />
        </div>

        <div style={{ display: "flex", gap: 22, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <Section icon="target" title="PROGRAMME OBJECTIVES">
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#374151" }}>{config.objectives_text || DEFAULT_OBJECTIVES}</p>
            </Section>
            <Section icon="book" title="PROGRAMME COVERAGE"><CheckList items={coverage} /></Section>
          </div>
          <ColumnDivider />
          <div style={{ flex: 1 }}>
            <Section icon="bulb" title="LEARNING OUTCOMES">
              <p style={{ margin: "0 0 6px", fontSize: 13.5, lineHeight: 1.45, color: "#374151" }}>Upon successful completion, participants should be able to:</p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.58, color: "#374151" }}>
                {outcomes.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </Section>
          </div>
          <ColumnDivider />
          <div style={{ flex: 1 }}>
            <Section icon="clipboard" title="ASSESSMENT METHOD"><CheckList items={assessment} /></Section>
            <Section icon="doc" title="PARTICIPANT SKILLS RECORD">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, border: `1px solid ${gold}` }}>
                <thead>
                  <tr style={{ background: navy, color: "#fff" }}>
                    <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 600 }}>Assessment Area</th>
                    <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {skillsRecord.map((r, i) => {
                    const affirmative = isAffirmativeStatus(r.status);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <td style={{ padding: "5px 8px", color: "#374151" }}>{r.area}</td>
                        <td style={{ padding: "5px 8px", color: affirmative ? gold : "#6b7280", fontWeight: affirmative ? 700 : 400 }}>
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

        <div style={{ position: "relative", border: `1.5px solid ${gold}`, borderRadius: 8, padding: "8px 16px", marginTop: 3, flexShrink: 0, background: "#fff" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
            <CircleIcon kind="warning" navy={navy} gold={gold} size={26} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: navy }}>IMPORTANT NOTICE</span>
          </div>
          {noticeParagraphs.map((p, i) => (
            <p key={i} style={{ position: "relative", margin: i === 0 ? 0 : "3px 0 0", fontSize: 12, lineHeight: 1.46, color: "#4b5563" }}>
              {p.replace("{{PROGRAMME_NAME}}", data.course_name || "this programme")}
            </p>
          ))}
        </div>

        <div style={{ marginTop: 4, paddingTop: 5, borderTop: `1.5px solid ${gold}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
            <CircleIcon kind="shield" navy={navy} gold={gold} size={26} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: navy, letterSpacing: 0.6 }}>VERIFICATION</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 6, columnGap: 22, fontSize: 12.5, lineHeight: 1.35, color: "#374151" }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}><CircleIcon kind="doc" navy={navy} gold={gold} size={26} /><span><strong style={{ color: navy }}>Certificate No.</strong> {data.certificate_number}</span></div>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}><CircleIcon kind="phone" navy={navy} gold={gold} size={26} /><span><strong style={{ color: navy }}>Contact Number</strong> {config.contact_phone || "019-519 3834"}</span></div>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}><CircleIcon kind="globe" navy={navy} gold={gold} size={26} /><span><strong style={{ color: navy }}>Website</strong> {config.contact_website || "www.terasuniversal.com.my"}</span></div>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}><CircleIcon kind="mail" navy={navy} gold={gold} size={26} /><span><strong style={{ color: navy }}>Email</strong> {config.contact_email || "admin@terasuniversal.com.my"}</span></div>
            </div>
            {config.show_qr !== false && data.qr_svg && <QrCard svg={data.qr_svg} navy={navy} gold={gold} size={60} caption={false} />}
          </div>
        </div>
      </div>
    </div>
  );
}
