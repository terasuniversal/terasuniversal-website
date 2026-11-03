/**
 * Shown instead of a certificate when its private signature or seal cannot be
 * loaded or verified (lib/certificate-render-assets.ts). Never a fallback
 * rendering: no certificate content, no public image, nothing to print.
 */
export function CertificateAssetsUnavailable({ message }: { message: string }) {
  return (
    <div role="alert" style={{ maxWidth: 560, margin: "40px auto", padding: "20px 24px", border: "1px solid #f1c0c0", borderRadius: 8, background: "#fff6f6", color: "#7a1f1f", fontSize: 14, lineHeight: 1.55 }}>
      <strong style={{ display: "block", fontSize: 15, marginBottom: 6 }}>This certificate cannot be displayed</strong>
      {message}. Do not print or issue it. Ask a Super Admin to check the certificate signature and seal assets.
    </div>
  );
}
