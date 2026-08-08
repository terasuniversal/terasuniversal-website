import type { CSSProperties, ReactNode } from "react";
import { fitHolderNameSize, formatDateRange, isAffirmativeStatus } from "../../lib/certificate-format";

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
}

export interface TemplateConfig {
  logo_url?: string;
  background_url?: string;
  accent_color?: string;
  primary_color?: string;
  signature_url?: string;
  signature_name?: string;
  signature_title?: string;
  body_text?: string;
  show_qr?: boolean;
  // Front page
  duration_label?: string;
  skills_update_recommendation?: string;
  // Back page ("Programme Information") — configurable per template because
  // it's programme-specific content, not per-certificate data.
  show_back_page?: boolean;
  programme_title?: string;
  objectives_text?: string;
  coverage_items?: string[];
  learning_outcomes?: string[];
  assessment_methods?: string[];
  skills_record?: { area: string; status: string }[];
  important_notice?: string;
  contact_phone?: string;
  contact_email?: string;
  contact_website?: string;
}

const PAGE_W = 794;
const PAGE_H = 1123;
const REG_NO = "202201038223 (1477529-X)";

const DEFAULT_BODY_TEXT =
  "This programme focuses on developing practical skills, safe work practices and industry best practices through structured theoretical and hands-on practical training.";
const DEFAULT_OBJECTIVES =
  "This programme is designed to enhance participants' practical knowledge and skills through structured classroom learning and intensive practical training.";
const DEFAULT_COVERAGE = ["Programme Orientation", "Core Skills & Procedures", "Safe Working Practices", "Practical Skills Assessment", "Industry Best Practices"];
const DEFAULT_OUTCOMES = ["Apply the core skills and procedures covered in this programme", "Recognise workplace hazards", "Apply safe working practices during work activities"];
const DEFAULT_ASSESSMENT = ["Attendance", "Theory Learning", "Practical Assessment", "Trainer Observation"];
const DEFAULT_NOTICE =
  "This certificate acknowledges the successful completion of a structured skills development programme and practical assessment conducted by TERAS UNIVERSAL SDN. BHD. It does not represent or replace any competency certification or licence that may be required under applicable laws, regulations or project-specific requirements. Participants are encouraged to attend periodic Skills Update Programmes as part of continuous professional development.";

/** Shared corner ornamentation — emphasis on top-left / bottom-right per brand direction. */
function OrnateBorder({ navy, gold }: { navy: string; gold: string }) {
  const wedge = (corner: "tl" | "br", size: number) => {
    const pos: CSSProperties =
      corner === "tl"
        ? { top: 0, left: 0, clipPath: "polygon(0 0, 100% 0, 0 100%)" }
        : { bottom: 0, right: 0, clipPath: "polygon(100% 100%, 0 100%, 100% 0)" };
    return <div style={{ position: "absolute", width: size, height: size, background: navy, opacity: 0.9, ...pos }} />;
  };
  const bracket = (corner: "tr" | "bl", size: number) => {
    const base: CSSProperties = { position: "absolute", background: gold };
    const h: CSSProperties =
      corner === "tr" ? { top: 10, right: 10, width: size, height: 2 } : { bottom: 10, left: 10, width: size, height: 2 };
    const v: CSSProperties =
      corner === "tr" ? { top: 10, right: 10, width: 2, height: size } : { bottom: 10, left: 10, width: 2, height: size };
    return (
      <>
        <div style={{ ...base, ...h }} />
        <div style={{ ...base, ...v }} />
      </>
    );
  };
  return (
    <>
      {wedge("tl", 56)}
      {wedge("br", 56)}
      {bracket("tr", 34)}
      {bracket("bl", 34)}
      <div style={{ position: "absolute", inset: 3, border: `2px solid ${navy}`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 9, border: `1px solid ${gold}`, pointerEvents: "none" }} />
    </>
  );
}

type IconKind = "calendar" | "refresh" | "doc" | "id";
function MetaIcon({ kind, color }: { kind: IconKind; color: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "calendar")
    return (
      <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
    );
  if (kind === "refresh")
    return (
      <svg {...common}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v5h-5" /></svg>
    );
  if (kind === "id")
    return (
      <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="12" r="2" /><path d="M14 10h4M14 14h4M6 17c.5-1.5 2-2 3-2s2.5.5 3 2" /></svg>
    );
  return (
    <svg {...common}><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></svg>
  );
}

function MetaTile({ icon, label, value, navy, gold }: { icon: IconKind; label: string; value: string; navy: string; gold: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ marginTop: 1 }}><MetaIcon kind={icon} color={gold} /></div>
      <div>
        <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.6, color: "#6b7280" }}>{label}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: navy, fontFamily: "Georgia, serif" }}>{value}</div>
      </div>
    </div>
  );
}

export function CertificateDocument({ data, config }: { data: CertData; config: TemplateConfig }) {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const qrSrc = config.show_qr !== false && data.verification_url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.verification_url)}`
    : "";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  const nameSize = fitHolderNameSize(data.holder_name);

  return (
    <div
      style={{
        width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#fff",
        boxSizing: "border-box", padding: 34, fontFamily: "Georgia, 'Times New Roman', serif", color: "#1F2937", overflow: "hidden",
        backgroundImage: config.background_url ? `url(${config.background_url})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}
    >
      <OrnateBorder navy={navy} gold={gold} />

      <div style={{ position: "relative", height: "100%", padding: "26px 30px", display: "flex", flexDirection: "column", textAlign: "center" }}>
        {config.logo_url && <img src={config.logo_url} alt="" style={{ width: 68, height: 68, objectFit: "contain", margin: "0 auto 4px" }} />}
        <div style={{ letterSpacing: 2, fontSize: 13, color: navy, fontWeight: 700 }}>TERAS UNIVERSAL SDN. BHD.</div>
        <div style={{ fontSize: 9.5, color: "#6b7280", marginTop: 1 }}>{REG_NO}</div>

        <h1 style={{ fontSize: 46, margin: "14px 0 0", letterSpacing: 3, color: gold, fontWeight: 700 }}>CERTIFICATE</h1>
        <div style={{ fontSize: 13, color: navy, letterSpacing: 3, fontWeight: 600, marginTop: 4 }}>
          <span style={{ color: gold }}>{"—— "}</span>OF SUCCESSFUL COMPLETION<span style={{ color: gold }}>{" ——"}</span>
        </div>

        <p style={{ fontSize: 12.5, margin: "18px 0 4px", color: "#4b5563" }}>This certificate is proudly presented to</p>
        <div style={{ fontSize: nameSize, fontWeight: 700, color: navy, borderBottom: `2px solid ${gold}`, display: "inline-block", margin: "0 auto", padding: "0 24px 6px", maxWidth: 640, wordBreak: "break-word" }}>
          {data.holder_name}
        </div>
        {data.ic_passport && <p style={{ fontSize: 11.5, color: "#6b7280", margin: "6px 0 0" }}>Passport / IC No: {data.ic_passport}</p>}

        <p style={{ fontSize: 12.5, margin: "16px 0 2px", color: "#4b5563" }}>For successfully completing the</p>
        <div style={{ fontSize: 17, fontWeight: 700, color: navy, textTransform: "uppercase", lineHeight: 1.3, maxWidth: 620, margin: "0 auto" }}>
          {data.course_name}
        </div>
        {duration && (
          <div style={{ display: "inline-block", margin: "10px auto 0", background: navy, color: "#fff", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, padding: "5px 18px", borderRadius: 2 }}>
            {duration}
          </div>
        )}
        {dateRange && <p style={{ fontSize: 11.5, color: "#4b5563", margin: "10px 0 0" }}><strong style={{ color: navy }}>Conducted from</strong> {dateRange}</p>}

        <p style={{ fontSize: 11.5, lineHeight: 1.6, maxWidth: 560, margin: "14px auto 0", color: "#4b5563" }}>
          {config.body_text || DEFAULT_BODY_TEXT}
        </p>

        {/* Metadata grid + QR */}
        <div style={{ display: "flex", gap: 18, margin: "auto 0 0", paddingTop: 20, textAlign: "left" }}>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 14, columnGap: 12, alignContent: "center" }}>
            <MetaTile icon="calendar" label="Date of Completion" value={data.issue_date || "—"} navy={navy} gold={gold} />
            <MetaTile icon="refresh" label="Recommended Skills Update" value={config.skills_update_recommendation || "Within Three (3) Years"} navy={navy} gold={gold} />
            <MetaTile icon="doc" label="Certificate No." value={data.certificate_number} navy={navy} gold={gold} />
            <MetaTile icon="id" label="Participant ID" value={data.participant_id || "—"} navy={navy} gold={gold} />
          </div>
          {qrSrc && (
            <div style={{ width: 130, border: `1px solid ${gold}`, borderRadius: 4, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: navy, letterSpacing: 0.5, marginBottom: 6 }}>QR VERIFICATION</div>
              <img src={qrSrc} alt="Verification QR" style={{ width: 100, height: 100, margin: "0 auto" }} />
              <div style={{ fontSize: 8, color: "#6b7280", marginTop: 6, lineHeight: 1.3 }}>Scan to verify this certificate at Teras Universal Database</div>
            </div>
          )}
        </div>

        {/* Signatures */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 24, paddingTop: 4 }}>
          <div style={{ textAlign: "center", fontSize: 10.5, width: 190 }}>
            {config.signature_url && <img src={config.signature_url} alt="" style={{ height: 36, objectFit: "contain" }} />}
            <div style={{ borderTop: `1px solid ${navy}`, margin: "4px 0 4px" }} />
            <strong style={{ color: navy }}>{config.signature_name || "Trainer"}</strong>
            <div style={{ color: "#6b7280" }}>Trainer Signature</div>
          </div>
          <div style={{ textAlign: "center", fontSize: 10.5, width: 60, height: 60, borderRadius: "50%", border: `1px dashed ${gold}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", padding: 4 }}>
            COMPANY STAMP
          </div>
          <div style={{ textAlign: "center", fontSize: 10.5, width: 190 }}>
            <div style={{ height: 36 }} />
            <div style={{ borderTop: `1px solid ${navy}`, margin: "4px 0 4px" }} />
            <strong style={{ color: navy }}>{config.signature_title || "Training Manager"}</strong>
            <div style={{ color: "#6b7280" }}>Training Manager</div>
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
  const skillsRecord = config.skills_record?.length ? config.skills_record : null;

  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: navy, letterSpacing: 0.5, borderBottom: `2px solid ${gold}`, paddingBottom: 4, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
  const CheckList = ({ items }: { items: string[] }) => (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 10.5, lineHeight: 1.8, color: "#374151" }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: "flex", gap: 6 }}><span style={{ color: gold, fontWeight: 700 }}>✓</span>{it}</li>
      ))}
    </ul>
  );

  return (
    <div style={{ width: PAGE_W, height: PAGE_H, margin: "0 auto", position: "relative", background: "#fff", boxSizing: "border-box", padding: 34, fontFamily: "Georgia, 'Times New Roman', serif", color: "#1F2937" }}>
      <OrnateBorder navy={navy} gold={gold} />
      <div style={{ position: "relative", height: "100%", padding: "26px 30px", display: "flex", flexDirection: "column" }}>
        <div style={{ textAlign: "center", background: navy, color: "#fff", padding: "8px 0", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>PROGRAMME INFORMATION</div>
        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, color: navy, textTransform: "uppercase", margin: "12px 0 20px" }}>
          {config.programme_title || data.course_name}
        </div>

        <div style={{ display: "flex", gap: 24, flex: 1 }}>
          <div style={{ flex: 1 }}>
            <Section title="PROGRAMME OBJECTIVES">
              <p style={{ margin: 0, fontSize: 10.5, lineHeight: 1.7, color: "#374151" }}>{config.objectives_text || DEFAULT_OBJECTIVES}</p>
            </Section>
            <Section title="PROGRAMME COVERAGE"><CheckList items={coverage} /></Section>
          </div>
          <div style={{ flex: 1 }}>
            <Section title="LEARNING OUTCOMES">
              <p style={{ margin: "0 0 6px", fontSize: 10.5, color: "#374151" }}>Upon successful completion, participants will be able to:</p>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10.5, lineHeight: 1.8, color: "#374151" }}>
                {outcomes.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </Section>
          </div>
          <div style={{ flex: 1 }}>
            <Section title="ASSESSMENT METHOD"><CheckList items={assessment} /></Section>
            {skillsRecord && (
              <Section title="PARTICIPANT SKILLS RECORD">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ background: navy, color: "#fff" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600 }}>Assessment Area</th>
                      <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skillsRecord.map((r, i) => {
                      const affirmative = isAffirmativeStatus(r.status);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                          <td style={{ padding: "4px 6px", color: "#374151" }}>{r.area}</td>
                          <td style={{ padding: "4px 6px", color: affirmative ? gold : "#6b7280", fontWeight: affirmative ? 700 : 400 }}>
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

        <div style={{ border: `1px solid ${gold}`, borderRadius: 4, padding: "10px 14px", marginTop: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: navy, marginBottom: 4 }}>⚠ IMPORTANT NOTICE</div>
          <p style={{ margin: 0, fontSize: 9.5, lineHeight: 1.6, color: "#4b5563" }}>
            {(config.important_notice || DEFAULT_NOTICE).replace("{{PROGRAMME_NAME}}", data.course_name || "this programme")}
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 9.5, color: "#4b5563", borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>
          <div><strong style={{ color: navy }}>Certificate No.</strong><br />{data.certificate_number}</div>
          <div><strong style={{ color: navy }}>Website</strong><br />{config.contact_website || "www.terasuniversal.com.my"}</div>
          <div><strong style={{ color: navy }}>Contact Number</strong><br />{config.contact_phone || "019-519 3834"}</div>
          <div><strong style={{ color: navy }}>Email</strong><br />{config.contact_email || "admin@terasuniversal.com.my"}</div>
        </div>
      </div>
    </div>
  );
}
