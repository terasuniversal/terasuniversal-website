import Image from "next/image";
import { notFound } from "next/navigation";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import Footer from "../../components/Footer";
import PrivacyNoticeDraft from "../../components/public/PrivacyNoticeDraft";
import privacyNoticeAdapted from "../../data/privacyNoticeAdapted";
import { isEbookCaptureEnabled } from "../../lib/marketing/ebookFlag";

// DRAFT: NOT LEGALLY REVIEWED. NOT APPROVED FOR PUBLICATION.
// This page renders the Owner's privacy-notice draft, with only the eBook data row adapted to the form (data/privacyNoticeAdapted.js), only so the /ebook form can link to it during review. It returns 404
// unless EBOOK_LEAD_CAPTURE_ENABLED is exactly "true" (off by default), and it is excluded from search engines.
export const dynamic = "force-dynamic";
// When the feature is off the page is a 404, so its title must not be published either.
export function generateMetadata() {
  if (!isEbookCaptureEnabled()) return {};
  return { title: "Notis Privasi (DRAF)", robots: { index: false, follow: false } };
}

export default function PrivacyPage() {
  if (!isEbookCaptureEnabled()) notFound();

  return (
    <main className="privacy-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <MegaNav />
          <MobileNav basePath="/" />
        </div>
      </header>

      <div className="privacy-draft-banner" role="note">
        <div className="container">
          <strong>DRAFT — NOT LEGALLY REVIEWED — NOT APPROVED FOR PUBLICATION</strong>
          <span> Draf Notis Privasi untuk semakan. Ia belum disemak oleh penasihat undang-undang atau PDPA dan tidak boleh dianggap sebagai notis yang diluluskan. Item bertanda [dalam kurungan] masih perlu disahkan.</span>
          <span> VERSI DISESUAIKAN (menunggu kelulusan undang-undang): hanya baris eBook dalam jadual data diselaraskan dengan borang semasa. Draf asal Pemilik dikekalkan berasingan dan semua bahagian lain adalah teks draf Pemilik.</span>
        </div>
      </div>

      <section className="privacy-body">
        <div className="container">
          <PrivacyNoticeDraft sections={privacyNoticeAdapted} />
        </div>
      </section>

      <Footer />
    </main>
  );
}
