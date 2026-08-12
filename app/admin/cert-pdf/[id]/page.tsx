import { notFound } from "next/navigation";
import { requireCertificate } from "../../../../lib/auth/session";
import { loadCertificateRender } from "../../(protected)/certificates/certData";
import { CertificateFront, CertificateBack } from "../../../../components/admin/CertificateRenderer";
import { PRINT_WHEN_READY_SCRIPT } from "../../../../lib/print-when-ready";

export const metadata = { title: "Certificate PDF — TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Print / PDF view — lives OUTSIDE the (protected) shell so there's no sidebar,
 * but still under /admin (middleware-protected) and role-gated. Renders the
 * certificate as two A4 portrait pages (front + Programme Information back)
 * and auto-opens the print dialog ("Save as PDF" → 2-page PDF).
 * Dependency-free PDF path; a server-side PDF lib can be swapped in later.
 */
export default async function CertPdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCertificate(false);
  const { id } = await params;
  const r = await loadCertificateRender(id);
  if (!r) notFound();
  const hasBack = r.config.show_back_page !== false;

  return (
    <div className="cert-pdf-shell" style={{ background: "#eef1f6", minHeight: "100vh", padding: 20 }}>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; }
          .teras-admin { background: #fff !important; }
          /* Each certificate page is exactly 297mm — the height of the @page
             box — so ANY offset above it pushes its tail past the page
             boundary. The screen-only 20px shell padding and the 20px grid
             gap did exactly that: Chrome fragmented the front page, moved the
             whole signature/stamp flex row onto a second physical sheet, and
             produced a 4-page PDF whose page 1 had no Director signature and
             no company stamp. Zeroing both here is what makes the printed
             page box and the certificate box line up 1:1. */
          .cert-pdf-shell { padding: 0 !important; min-height: 0 !important; background: #fff !important; }
          .cert-pdf-wrap { padding: 0 !important; background: #fff !important; display: block !important; gap: 0 !important; }
          .cert-pdf-page { page-break-after: always; break-after: page; }
          .cert-pdf-page:last-child { page-break-after: auto; break-after: auto; }
          /* Without this, some browsers' print defaults drop background-color
             (the navy corner wedges, banners, table headers) even though
             borders/text still print fine — the certificate would look broken. */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="cert-pdf-wrap" style={{ display: "grid", gap: 20 }}>
        <div className="cert-pdf-page"><CertificateFront data={r.data} config={r.config} /></div>
        {hasBack && <div className="cert-pdf-page"><CertificateBack data={r.data} config={r.config} /></div>}
      </div>
      <script dangerouslySetInnerHTML={{ __html: PRINT_WHEN_READY_SCRIPT }} />
    </div>
  );
}
