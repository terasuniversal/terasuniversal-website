import type { CertData, TemplateConfig } from "../components/admin/CertificateDocument";
import { fitHolderNameSize, formatDateRange, isAffirmativeStatus } from "./certificate-format";

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
  "This programme focuses on developing practical skills, safe work practices and industry best practices through structured theoretical and hands-on practical training.";
const DEFAULT_OBJECTIVES =
  "This programme is designed to enhance participants' practical knowledge and skills through structured classroom learning and intensive practical training.";
const DEFAULT_COVERAGE = ["Programme Orientation", "Core Skills & Procedures", "Safe Working Practices", "Practical Skills Assessment", "Industry Best Practices"];
const DEFAULT_OUTCOMES = ["Apply the core skills and procedures covered in this programme", "Recognise workplace hazards", "Apply safe working practices during work activities"];
const DEFAULT_ASSESSMENT = ["Attendance", "Theory Learning", "Practical Assessment", "Trainer Observation"];
const DEFAULT_NOTICE =
  "This certificate acknowledges the successful completion of a structured skills development programme and practical assessment conducted by TERAS UNIVERSAL SDN. BHD. It does not represent or replace any competency certification or licence that may be required under applicable laws, regulations or project-specific requirements. Participants are encouraged to attend periodic Skills Update Programmes as part of continuous professional development.";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ornateBorder(navy: string, gold: string): string {
  return `
  <div style="position:absolute;top:0;left:0;width:56px;height:56px;background:${navy};opacity:.9;clip-path:polygon(0 0,100% 0,0 100%);"></div>
  <div style="position:absolute;bottom:0;right:0;width:56px;height:56px;background:${navy};opacity:.9;clip-path:polygon(100% 100%,0 100%,100% 0);"></div>
  <div style="position:absolute;top:10px;right:10px;width:34px;height:2px;background:${gold};"></div>
  <div style="position:absolute;top:10px;right:10px;width:2px;height:34px;background:${gold};"></div>
  <div style="position:absolute;bottom:10px;left:10px;width:34px;height:2px;background:${gold};"></div>
  <div style="position:absolute;bottom:10px;left:10px;width:2px;height:34px;background:${gold};"></div>
  <div style="position:absolute;inset:3px;border:2px solid ${navy};pointer-events:none;"></div>
  <div style="position:absolute;inset:9px;border:1px solid ${gold};pointer-events:none;"></div>`;
}

type IconKind = "calendar" | "refresh" | "doc" | "id";
function metaIconSvg(kind: IconKind, color: string): string {
  const attrs = `width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;
  if (kind === "calendar") return `<svg ${attrs}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
  if (kind === "refresh") return `<svg ${attrs}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>`;
  if (kind === "id") return `<svg ${attrs}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4M6 17c.5-1.5 2-2 3-2s2.5.5 3 2"/></svg>`;
  return `<svg ${attrs}><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M9 12h6M9 16h6"/></svg>`;
}

function metaTile(icon: IconKind, label: string, value: string, navy: string, gold: string): string {
  return `<div style="display:flex;gap:8px;align-items:flex-start;">
    <div style="margin-top:1px;">${metaIconSvg(icon, gold)}</div>
    <div>
      <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;">${esc(label)}</div>
      <div style="font-size:12.5px;font-weight:700;color:${navy};font-family:Georgia,serif;">${esc(value)}</div>
    </div>
  </div>`;
}

/** Render the certificate front (page 1, the A4 card) as an HTML string. */
export function renderCertificateFront(data: CertData, config: TemplateConfig): string {
  const navy = config.primary_color || "#0B3A63";
  const gold = config.accent_color || "#D4AF37";
  const qrSrc = config.show_qr !== false && data.verification_url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.verification_url)}`
    : "";
  const dateRange = formatDateRange(data.training_date, data.training_end_date);
  const duration = data.programme_duration || config.duration_label;
  const nameSize = fitHolderNameSize(data.holder_name);
  const bgImage = config.background_url ? `background-image:url('${esc(config.background_url)}');background-size:cover;background-position:center;` : "";

  const logo = config.logo_url ? `<img src="${esc(config.logo_url)}" alt="" style="width:68px;height:68px;object-fit:contain;margin:0 auto 4px;display:block;"/>` : "";
  const icBlock = data.ic_passport ? `<p style="font-size:11.5px;color:#6b7280;margin:6px 0 0;">Passport / IC No: ${esc(data.ic_passport)}</p>` : "";
  const durationBlock = duration
    ? `<div style="display:inline-block;margin:10px auto 0;background:${navy};color:#fff;font-size:11px;font-weight:600;letter-spacing:.5px;padding:5px 18px;border-radius:2px;">${esc(duration)}</div>`
    : "";
  const dateBlock = dateRange ? `<p style="font-size:11.5px;color:#4b5563;margin:10px 0 0;"><strong style="color:${navy};">Conducted from</strong> ${esc(dateRange)}</p>` : "";
  const qrBlock = qrSrc
    ? `<div style="width:130px;border:1px solid ${gold};border-radius:4px;padding:10px 8px;text-align:center;">
        <div style="font-size:9.5px;font-weight:700;color:${navy};letter-spacing:.5px;margin-bottom:6px;">QR VERIFICATION</div>
        <img src="${esc(qrSrc)}" alt="Verification QR" style="width:100px;height:100px;margin:0 auto;display:block;"/>
        <div style="font-size:8px;color:#6b7280;margin-top:6px;line-height:1.3;">Scan to verify this certificate at Teras Universal Database</div>
      </div>`
    : "";
  const signatureImg = config.signature_url ? `<img src="${esc(config.signature_url)}" alt="" style="height:36px;object-fit:contain;"/>` : "";

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:34px;font-family:Georgia,'Times New Roman',serif;color:#1F2937;overflow:hidden;${bgImage}">
  ${ornateBorder(navy, gold)}
  <div style="position:relative;height:100%;padding:26px 30px;display:flex;flex-direction:column;text-align:center;">
    ${logo}
    <div style="letter-spacing:2px;font-size:13px;color:${navy};font-weight:700;">TERAS UNIVERSAL SDN. BHD.</div>
    <div style="font-size:9.5px;color:#6b7280;margin-top:1px;">${REG_NO}</div>
    <h1 style="font-size:46px;margin:14px 0 0;letter-spacing:3px;color:${gold};font-weight:700;">CERTIFICATE</h1>
    <div style="font-size:13px;color:${navy};letter-spacing:3px;font-weight:600;margin-top:4px;">
      <span style="color:${gold};">&mdash;&mdash; </span>OF SUCCESSFUL COMPLETION<span style="color:${gold};"> &mdash;&mdash;</span>
    </div>
    <p style="font-size:12.5px;margin:18px 0 4px;color:#4b5563;">This certificate is proudly presented to</p>
    <div style="font-size:${nameSize}px;font-weight:700;color:${navy};border-bottom:2px solid ${gold};display:inline-block;margin:0 auto;padding:0 24px 6px;max-width:640px;word-break:break-word;">${esc(data.holder_name)}</div>
    ${icBlock}
    <p style="font-size:12.5px;margin:16px 0 2px;color:#4b5563;">For successfully completing the</p>
    <div style="font-size:17px;font-weight:700;color:${navy};text-transform:uppercase;line-height:1.3;max-width:620px;margin:0 auto;">${esc(data.course_name ?? "")}</div>
    ${durationBlock}
    ${dateBlock}
    <p style="font-size:11.5px;line-height:1.6;max-width:560px;margin:14px auto 0;color:#4b5563;">${esc(config.body_text || DEFAULT_BODY_TEXT)}</p>
    <div style="display:flex;gap:18px;margin:auto 0 0;padding-top:20px;text-align:left;">
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;row-gap:14px;column-gap:12px;align-content:center;">
        ${metaTile("calendar", "Date of Completion", data.issue_date || "—", navy, gold)}
        ${metaTile("refresh", "Recommended Skills Update", config.skills_update_recommendation || "Within Three (3) Years", navy, gold)}
        ${metaTile("doc", "Certificate No.", data.certificate_number, navy, gold)}
        ${metaTile("id", "Participant ID", data.participant_id || "—", navy, gold)}
      </div>
      ${qrBlock}
    </div>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:24px;padding-top:4px;">
      <div style="text-align:center;font-size:10.5px;width:190px;">
        ${signatureImg}
        <div style="border-top:1px solid ${navy};margin:4px 0;"></div>
        <strong style="color:${navy};">${esc(config.signature_name || "Trainer")}</strong>
        <div style="color:#6b7280;">Trainer Signature</div>
      </div>
      <div style="text-align:center;font-size:10.5px;width:60px;height:60px;border-radius:50%;border:1px dashed ${gold};display:flex;align-items:center;justify-content:center;color:#9ca3af;padding:4px;">COMPANY STAMP</div>
      <div style="text-align:center;font-size:10.5px;width:190px;">
        <div style="height:36px;"></div>
        <div style="border-top:1px solid ${navy};margin:4px 0;"></div>
        <strong style="color:${navy};">${esc(config.signature_title || "Training Manager")}</strong>
        <div style="color:#6b7280;">Training Manager</div>
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
  const coverage = config.coverage_items?.length ? config.coverage_items : DEFAULT_COVERAGE;
  const outcomes = config.learning_outcomes?.length ? config.learning_outcomes : DEFAULT_OUTCOMES;
  const assessment = config.assessment_methods?.length ? config.assessment_methods : DEFAULT_ASSESSMENT;
  const skillsRecord = config.skills_record?.length ? config.skills_record : null;

  const section = (title: string, body: string) =>
    `<div style="margin-bottom:16px;"><div style="font-size:11.5px;font-weight:700;color:${navy};letter-spacing:.5px;border-bottom:2px solid ${gold};padding-bottom:4px;margin-bottom:8px;">${esc(title)}</div>${body}</div>`;
  const checklist = (items: string[]) =>
    `<ul style="margin:0;padding:0;list-style:none;font-size:10.5px;line-height:1.8;color:#374151;">${items.map((it) => `<li style="display:flex;gap:6px;"><span style="color:${gold};font-weight:700;">✓</span>${esc(it)}</li>`).join("")}</ul>`;

  const skillsTable = skillsRecord
    ? section(
        "PARTICIPANT SKILLS RECORD",
        `<table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr style="background:${navy};color:#fff;"><th style="text-align:left;padding:4px 6px;font-weight:600;">Assessment Area</th><th style="text-align:left;padding:4px 6px;font-weight:600;">Status</th></tr></thead>
          <tbody>${skillsRecord.map((r) => {
            const affirmative = isAffirmativeStatus(r.status);
            const color = affirmative ? gold : "#6b7280";
            const weight = affirmative ? 700 : 400;
            const mark = affirmative ? "✓ " : "";
            return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:4px 6px;color:#374151;">${esc(r.area)}</td><td style="padding:4px 6px;color:${color};font-weight:${weight};">${mark}${esc(r.status)}</td></tr>`;
          }).join("")}</tbody>
        </table>`
      )
    : "";

  const notice = (config.important_notice || DEFAULT_NOTICE).replace("{{PROGRAMME_NAME}}", data.course_name || "this programme");

  return `<div style="width:${PAGE_W}px;height:${PAGE_H}px;margin:0 auto;position:relative;background:#fff;box-sizing:border-box;padding:34px;font-family:Georgia,'Times New Roman',serif;color:#1F2937;">
  ${ornateBorder(navy, gold)}
  <div style="position:relative;height:100%;padding:26px 30px;display:flex;flex-direction:column;">
    <div style="text-align:center;background:${navy};color:#fff;padding:8px 0;font-size:12px;font-weight:700;letter-spacing:2px;">PROGRAMME INFORMATION</div>
    <div style="text-align:center;font-size:16px;font-weight:700;color:${navy};text-transform:uppercase;margin:12px 0 20px;">${esc(config.programme_title || data.course_name || "")}</div>
    <div style="display:flex;gap:24px;flex:1;">
      <div style="flex:1;">
        ${section("PROGRAMME OBJECTIVES", `<p style="margin:0;font-size:10.5px;line-height:1.7;color:#374151;">${esc(config.objectives_text || DEFAULT_OBJECTIVES)}</p>`)}
        ${section("PROGRAMME COVERAGE", checklist(coverage))}
      </div>
      <div style="flex:1;">
        ${section(
          "LEARNING OUTCOMES",
          `<p style="margin:0 0 6px;font-size:10.5px;color:#374151;">Upon successful completion, participants will be able to:</p>
           <ul style="margin:0;padding-left:16px;font-size:10.5px;line-height:1.8;color:#374151;">${outcomes.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`
        )}
      </div>
      <div style="flex:1;">
        ${section("ASSESSMENT METHOD", checklist(assessment))}
        ${skillsTable}
      </div>
    </div>
    <div style="border:1px solid ${gold};border-radius:4px;padding:10px 14px;margin-top:8px;">
      <div style="font-size:10.5px;font-weight:700;color:${navy};margin-bottom:4px;">⚠ IMPORTANT NOTICE</div>
      <p style="margin:0;font-size:9.5px;line-height:1.6;color:#4b5563;">${esc(notice)}</p>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:9.5px;color:#4b5563;border-top:1px solid #e5e7eb;padding-top:10px;">
      <div><strong style="color:${navy};">Certificate No.</strong><br/>${esc(data.certificate_number)}</div>
      <div><strong style="color:${navy};">Website</strong><br/>${esc(config.contact_website || "www.terasuniversal.com.my")}</div>
      <div><strong style="color:${navy};">Contact Number</strong><br/>${esc(config.contact_phone || "019-519 3834")}</div>
      <div><strong style="color:${navy};">Email</strong><br/>${esc(config.contact_email || "admin@terasuniversal.com.my")}</div>
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

/** Full standalone, printable HTML document for one certificate (front + back, A4 portrait). */
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
