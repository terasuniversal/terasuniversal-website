/**
 * Template-driven certificate renderer (server component, no client JS).
 * Given the certificate row + its template config + related data, renders the
 * visual certificate. Used by the preview and the A4 print/PDF page. Styling is
 * inline so it renders identically in a standalone print document.
 */
export interface CertData {
  certificate_number: string;
  holder_name: string;
  course_name?: string | null;
  ic_passport?: string | null;
  training_date?: string | null;
  venue?: string | null;
  trainer?: string | null;
  issue_date?: string | null;
  verification_url?: string | null;
  verification_token?: string | null;
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
  custom_fields?: { label: string; value: string }[];
  border_style?: string;
}

export function CertificateDocument({
  data,
  config,
  orientation = "landscape",
}: {
  data: CertData;
  config: TemplateConfig;
  orientation?: string;
}) {
  const navy = config.primary_color || "#0B2C56";
  const gold = config.accent_color || "#E1A925";
  const isLandscape = orientation !== "portrait";
  // A4 at 96dpi: 1123×794 (landscape) / 794×1123 (portrait).
  const w = isLandscape ? 1123 : 794;
  const h = isLandscape ? 794 : 1123;
  const qrTarget = data.verification_url || (data.verification_token ? `/verify/${data.verification_token}` : "");
  const qrSrc = qrTarget ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrTarget)}` : "";

  return (
    <div
      style={{
        width: w, height: h, margin: "0 auto", position: "relative", background: "#fff",
        border: `2px solid ${gold}`, boxSizing: "border-box", padding: isLandscape ? 48 : 56,
        fontFamily: "Georgia, 'Times New Roman', serif", color: navy, overflow: "hidden",
        backgroundImage: config.background_url ? `url(${config.background_url})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}
    >
      {/* Inner ornamental border */}
      <div style={{ position: "absolute", inset: 14, border: `1px solid ${navy}`, opacity: 0.35, pointerEvents: "none" }} />

      <div style={{ textAlign: "center", position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
        {config.logo_url && (
          <img src={config.logo_url} alt="" style={{ width: 96, height: 96, objectFit: "contain", margin: "0 auto 6px" }} />
        )}
        <div style={{ letterSpacing: 3, fontSize: 13, color: gold, fontWeight: 700, textTransform: "uppercase" }}>
          TERAS UNIVERSAL SDN. BHD.
        </div>
        <h1 style={{ fontSize: isLandscape ? 42 : 36, margin: "10px 0 2px", letterSpacing: 2 }}>Certificate of Competency</h1>
        <div style={{ width: 120, height: 3, background: gold, margin: "6px auto 18px" }} />

        <p style={{ fontSize: 15, margin: "0 0 6px", color: "#555" }}>This is to certify that</p>
        <div style={{ fontSize: isLandscape ? 38 : 30, fontWeight: 700, color: navy, borderBottom: `2px solid ${gold}`, display: "inline-block", padding: "0 30px 6px", margin: "0 auto 6px" }}>
          {data.holder_name}
        </div>
        {data.ic_passport && <p style={{ fontSize: 13, color: "#666", margin: "4px 0 0" }}>IC / Passport: {data.ic_passport}</p>}

        <p style={{ fontSize: 15, lineHeight: 1.7, maxWidth: 720, margin: "16px auto 0", color: "#333" }}>
          {config.body_text || "has successfully completed the training programme and is hereby certified as COMPETENT."}
        </p>

        <div style={{ margin: "14px auto 0", fontSize: 16, fontWeight: 700, color: navy }}>{data.course_name}</div>

        <div style={{ display: "flex", justifyContent: "center", gap: 34, margin: "12px auto 0", fontSize: 12.5, color: "#555", flexWrap: "wrap" }}>
          {data.training_date && <span><strong>Training Date:</strong> {data.training_date}</span>}
          {data.venue && <span><strong>Venue:</strong> {data.venue}</span>}
          {data.trainer && <span><strong>Trainer:</strong> {data.trainer}</span>}
          {(config.custom_fields ?? []).map((f, i) => <span key={i}><strong>{f.label}:</strong> {f.value}</span>)}
        </div>

        {/* Footer: cert no + signature + QR */}
        <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 22 }}>
          <div style={{ textAlign: "left", fontSize: 12, color: "#555" }}>
            <div><strong>Certificate No.</strong></div>
            <div style={{ fontFamily: "monospace", color: navy }}>{data.certificate_number}</div>
            {data.issue_date && <div style={{ marginTop: 6 }}>Issued: {data.issue_date}</div>}
          </div>

          <div style={{ textAlign: "center", fontSize: 12 }}>
            {config.signature_url && <img src={config.signature_url} alt="" style={{ height: 44, objectFit: "contain" }} />}
            <div style={{ width: 200, borderTop: `1px solid ${navy}`, margin: "4px auto 4px" }} />
            <strong>{config.signature_name || "Training Director"}</strong>
            <div style={{ color: "#666" }}>{config.signature_title || "TERAS UNIVERSAL SDN. BHD."}</div>
          </div>

          <div style={{ textAlign: "center", fontSize: 10, color: "#777", width: 130 }}>
            {config.show_qr !== false && qrSrc && (
              <>
                <img src={qrSrc} alt="Verification QR" style={{ width: 90, height: 90 }} />
                <div style={{ marginTop: 2 }}>Scan to verify</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
