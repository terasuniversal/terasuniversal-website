import type { CertData, TemplateConfig } from "../components/admin/CertificateDocument";

/**
 * Standalone HTML string renderer for a certificate — no React / no
 * `react-dom/server`. Next.js App Router forbids importing `react-dom/server`
 * into route handlers, so the Bulk Certificate Download (ZIP) builds each
 * certificate document as a plain string here. The markup mirrors
 * `CertificateDocument` (A4, inline styles) so print output looks identical.
 */

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render the certificate body (the A4 card) as an HTML string. */
export function renderCertificateBody(data: CertData, config: TemplateConfig, orientation = "landscape"): string {
  const navy = config.primary_color || "#0B2C56";
  const gold = config.accent_color || "#E1A925";
  const isLandscape = orientation !== "portrait";
  const w = isLandscape ? 1123 : 794;
  const h = isLandscape ? 794 : 1123;
  const qrTarget = data.verification_url || (data.verification_token ? `/verify/${data.verification_token}` : "");
  const qrSrc = qrTarget ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrTarget)}` : "";

  const bgImage = config.background_url ? `background-image:url('${esc(config.background_url)}');background-size:cover;background-position:center;` : "";

  const logo = config.logo_url
    ? `<img src="${esc(config.logo_url)}" alt="" style="width:96px;height:96px;object-fit:contain;margin:0 auto 6px;display:block;" />`
    : "";
  const ic = data.ic_passport ? `<p style="font-size:13px;color:#666;margin:4px 0 0;">IC / Passport: ${esc(data.ic_passport)}</p>` : "";

  const meta: string[] = [];
  if (data.training_date) meta.push(`<span><strong>Training Date:</strong> ${esc(data.training_date)}</span>`);
  if (data.venue) meta.push(`<span><strong>Venue:</strong> ${esc(data.venue)}</span>`);
  if (data.trainer) meta.push(`<span><strong>Trainer:</strong> ${esc(data.trainer)}</span>`);
  for (const f of config.custom_fields ?? []) meta.push(`<span><strong>${esc(f.label)}:</strong> ${esc(f.value)}</span>`);

  const issued = data.issue_date ? `<div style="margin-top:6px;">Issued: ${esc(data.issue_date)}</div>` : "";
  const signatureImg = config.signature_url ? `<img src="${esc(config.signature_url)}" alt="" style="height:44px;object-fit:contain;" />` : "";
  const qrBlock = config.show_qr !== false && qrSrc
    ? `<img src="${esc(qrSrc)}" alt="Verification QR" style="width:90px;height:90px;" /><div style="margin-top:2px;">Scan to verify</div>`
    : "";

  return `<div style="width:${w}px;height:${h}px;margin:0 auto;position:relative;background:#fff;border:2px solid ${gold};box-sizing:border-box;padding:${isLandscape ? 48 : 56}px;font-family:Georgia,'Times New Roman',serif;color:${navy};overflow:hidden;${bgImage}">
  <div style="position:absolute;inset:14px;border:1px solid ${navy};opacity:.35;pointer-events:none;"></div>
  <div style="text-align:center;position:relative;height:100%;display:flex;flex-direction:column;">
    ${logo}
    <div style="letter-spacing:3px;font-size:13px;color:${gold};font-weight:700;text-transform:uppercase;">TERAS UNIVERSAL SDN. BHD.</div>
    <h1 style="font-size:${isLandscape ? 42 : 36}px;margin:10px 0 2px;letter-spacing:2px;">Certificate of Competency</h1>
    <div style="width:120px;height:3px;background:${gold};margin:6px auto 18px;"></div>
    <p style="font-size:15px;margin:0 0 6px;color:#555;">This is to certify that</p>
    <div style="font-size:${isLandscape ? 38 : 30}px;font-weight:700;color:${navy};border-bottom:2px solid ${gold};display:inline-block;padding:0 30px 6px;margin:0 auto 6px;">${esc(data.holder_name)}</div>
    ${ic}
    <p style="font-size:15px;line-height:1.7;max-width:720px;margin:16px auto 0;color:#333;">${esc(config.body_text || "has successfully completed the training programme and is hereby certified as COMPETENT.")}</p>
    <div style="margin:14px auto 0;font-size:16px;font-weight:700;color:${navy};">${esc(data.course_name ?? "")}</div>
    <div style="display:flex;justify-content:center;gap:34px;margin:12px auto 0;font-size:12.5px;color:#555;flex-wrap:wrap;">${meta.join("")}</div>
    <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;padding-top:22px;">
      <div style="text-align:left;font-size:12px;color:#555;">
        <div><strong>Certificate No.</strong></div>
        <div style="font-family:monospace;color:${navy};">${esc(data.certificate_number)}</div>
        ${issued}
      </div>
      <div style="text-align:center;font-size:12px;">
        ${signatureImg}
        <div style="width:200px;border-top:1px solid ${navy};margin:4px auto 4px;"></div>
        <strong>${esc(config.signature_name || "Training Director")}</strong>
        <div style="color:#666;">${esc(config.signature_title || "TERAS UNIVERSAL SDN. BHD.")}</div>
      </div>
      <div style="text-align:center;font-size:10px;color:#777;width:130px;">${qrBlock}</div>
    </div>
  </div>
</div>`;
}

/** Full standalone, printable HTML document for one certificate. */
export function renderCertificateDocument(data: CertData, config: TemplateConfig, orientation = "landscape"): string {
  const isLandscape = orientation !== "portrait";
  const title = data.certificate_number || data.holder_name || "Certificate";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 ${isLandscape ? "landscape" : "portrait"}; margin: 0; }
  html,body { margin:0; padding:0; background:#fff; }
  @media screen { body { background:#eef1f6; padding:20px; } }
</style></head><body>${renderCertificateBody(data, config, orientation)}
<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},400)}</script>
</body></html>`;
}