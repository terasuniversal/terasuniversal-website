import { notFound } from "next/navigation";
import { requireCertificate } from "../../../../lib/auth/session";
import { loadCertificateRender } from "../../(protected)/certificates/certData";
import { CertificateDocument } from "../../../../components/admin/CertificateDocument";

export const metadata = { title: "Certificate PDF — TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Print / PDF view — lives OUTSIDE the (protected) shell so there's no sidebar,
 * but still under /admin (middleware-protected) and role-gated. Renders the
 * certificate at A4 size and auto-opens the print dialog ("Save as PDF").
 * Dependency-free PDF path; a server-side PDF lib can be swapped in later.
 */
export default async function CertPdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCertificate(false);
  const { id } = await params;
  const r = await loadCertificateRender(id);
  if (!r) notFound();
  const isLandscape = r.orientation !== "portrait";

  return (
    <div style={{ background: "#eef1f6", minHeight: "100vh", padding: 20 }}>
      <style>{`
        @page { size: A4 ${isLandscape ? "landscape" : "portrait"}; margin: 0; }
        @media print {
          .teras-admin { background: #fff !important; }
          .cert-pdf-wrap { padding: 0 !important; background: #fff !important; }
        }
      `}</style>
      <div className="cert-pdf-wrap">
        <CertificateDocument data={r.data} config={r.config} orientation={r.orientation} />
      </div>
      <script dangerouslySetInnerHTML={{ __html: "window.onload=function(){setTimeout(function(){window.print()},400)}" }} />
    </div>
  );
}
