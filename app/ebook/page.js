import Image from "next/image";
import { notFound } from "next/navigation";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import Footer from "../../components/Footer";
import EbookLeadForm from "../../components/public/EbookLeadForm";
import { EBOOK_CATALOG } from "../../lib/marketing/ebookCapture";
import { isEbookCaptureEnabled } from "../../lib/marketing/ebookFlag";

// /ebook landing page. The content below is taken from the Owner-approved eBook itself (its title page and its own
// "what you will get" list and important note); nothing here is invented. It returns 404 unless
// EBOOK_LEAD_CAPTURE_ENABLED is exactly "true" (off by default: launch plan gate G5, "form still switched off").
// The PDF is NOT in this repository and there is no download until storage and delivery are approved.
export const dynamic = "force-dynamic";
// When the feature is off the page is a 404, so its title and description must not be published either.
export function generateMetadata() {
  if (!isEbookCaptureEnabled()) return {};
  return {
    title: "eBook Percuma: Dari Zero Ke Dunia Industri",
    description: "Panduan santai untuk kenal scaffolding dan kerjaya Scaffold Erector.",
    robots: { index: false, follow: false },
  };
}

const benefits = [
  "Faham apa sebenarnya \"dunia industri\" dan siapa yang bekerja di dalamnya",
  "Kenal apa itu scaffolding dan kenapa ia sangat penting",
  "Tahu apa kerja Scaffold Erector dari pagi sampai petang",
  "Kenal PPE & peralatan asas seorang erector",
  "Nampak laluan Scaffold Erector dari zero sampai jadi tenaga mahir",
  "Tahu ke mana nak tanya kalau anda berminat",
];

export default function EbookPage() {
  if (!isEbookCaptureEnabled()) notFound();
  const ebook = EBOOK_CATALOG[0];

  return (
    <main className="ebook-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <MegaNav />
          <MobileNav basePath="/" />
        </div>
      </header>

      <div className="privacy-draft-banner" role="note">
        <div className="container">
          <strong>DRAF — belum disemak undang-undang</strong>
          <span> Teks borang dan Notis Privasi masih draf dan belum diluluskan untuk penerbitan.</span>
        </div>
      </div>

      <section className="ebook-hero">
        <div className="container ebook-hero-grid">
          <div className="ebook-hero-copy">
            <span className="eyebrow">{ebook.kicker}</span>
            <h1>{ebook.title}</h1>
            <p className="ebook-subtitle">{ebook.subtitle}</p>
            <p className="ebook-lead">Tak pernah kerja industri? Tak tahu apa itu scaffolding? Jom kenal dunia kemahiran dari asas!</p>
          </div>

          <div className="ebook-cover" aria-hidden="true">
            <span>eBook Percuma</span>
            <strong>Dari Zero Ke Dunia Industri</strong>
            <em>Building Competence. Creating Opportunities.</em>
          </div>

          <div className="ebook-form-card" id="borang">
            <h2>Dapatkan eBook</h2>
            <EbookLeadForm ebookId={ebook.id} />
          </div>
        </div>
      </section>

      <section className="ebook-benefits">
        <div className="container">
          <h2>Apa yang anda akan dapat dalam 10 minit</h2>
          <ul className="ebook-benefit-list">
            {benefits.map((text) => <li key={text}>{text}</li>)}
          </ul>
          <aside className="ebook-note" aria-label="Nota penting">
            <strong>Nota penting</strong>
            <p>eBook ini adalah pengenalan santai sahaja. Ia bukan latihan rasmi, bukan sijil, dan tidak menggantikan kursus sebenar. Kerja perancah hanya boleh dilakukan selepas latihan yang sesuai dan di bawah penyeliaan orang yang kompeten.</p>
          </aside>
        </div>
      </section>

      <section className="ebook-privacy-info">
        <div className="container">
          <h2>Privasi anda</h2>
          <p>Mengakui Notis Privasi diperlukan untuk meminta eBook. Permintaan ini tidak meminta persetujuan pemasaran, dan kami tidak menghantar pemasaran kepada anda hasil permintaan ini.</p>
          <p>Untuk meminta akses, pembetulan atau pemadaman data anda, hubungi <a href="mailto:admin@terasuniversal.com.my">admin@terasuniversal.com.my</a>. Baca <a href="/privacy">Notis Privasi (DRAF)</a>.</p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
