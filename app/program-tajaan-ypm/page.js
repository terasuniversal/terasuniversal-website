import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import Footer from "../../components/Footer";

const whatsappHref = "https://wa.me/60195193834?text=Assalamualaikum%20Ms%20Piqa%2C%20saya%20ingin%20semak%20kelayakan%20program%20SCAFFOLD-X%202026.";
const benefits = [
  ["01", "Latihan profesional", "Latihan untuk membina tenaga kerja berkemahiran dalam bidang scaffolding."],
  ["02", "Penginapan", "Penginapan disediakan sepanjang bekerja, seperti dinyatakan pada poster."],
  ["03", "Pengangkutan", "Pengangkutan disediakan sepanjang bekerja, seperti dinyatakan pada poster."],
  ["04", "Elaun", "Elaun akan diberikan selepas tamat kursus, tertakluk kepada terma program."],
];
const checks = [
  ["01", "Umur pemohon", "Kelayakan umur rasmi ialah 18 hingga 32 tahun."],
  ["02", "Minat program", "Minat anda terhadap kursus Scaffolding Competency."],
  ["03", "Syarat rasmi", "Kelayakan lain dan dokumen yang diperlukan."],
  ["04", "Kapasiti program", "Dokumen rasmi menetapkan 25 peserta."],
];
const faqs = [
  ["Apakah program SCAFFOLD-X?", "SCAFFOLD-X ialah Program Latihan Kerjaya untuk laluan kerjaya anak muda dalam bidang scaffolding. Poster program menyatakan ia mendapat tajaan Yayasan Pelajaran MARA dan dianjurkan oleh TERAS UNIVERSAL."],
  ["Berapakah had umur peserta?", "Kelayakan umur rasmi ialah 18 hingga 32 tahun. Syarat kelayakan lain dan dokumen sokongan akan disahkan oleh pasukan TERAS UNIVERSAL semasa semakan."],
  ["Apakah syarat kelayakan?", "Syarat kelayakan dan dokumen sokongan bergantung pada ketetapan rasmi program. Pasukan TERAS akan mengesahkan perkara ini semasa semakan."],
  ["Apakah manfaat yang dinyatakan pada poster?", "Poster menyatakan penginapan dan pengangkutan disediakan sepanjang bekerja, serta elaun diberikan selepas tamat kursus. Sahkan syarat dan terma semasa semakan kelayakan."],
  ["Di manakah program ini dijalankan?", "Dokumen rasmi menyatakan program ini adalah untuk Negeri Kedah. Lokasi tepat akan disahkan oleh pasukan TERAS melalui WhatsApp."],
  ["Berapakah anggaran gaji?", "Poster menyatakan anggaran gaji bermula RM2,500.00 ke atas untuk peluang kerjaya dalam industri pembinaan, minyak dan gas serta perancah. Angka sebenar tertakluk kepada pekerjaan dan majikan."],
  ["Bagaimana cara menyemak kelayakan?", "Klik butang WhatsApp, kemudian hantar pertanyaan anda kepada Ms Piqa. Nyatakan nama, umur, lokasi dan minat terhadap program SCAFFOLD-X."],
];

const ctaProps = { target: "_blank", rel: "noreferrer", "data-cta": "ypm-whatsapp", "data-program": "tajaan-ypm", "data-event": "whatsapp_click" };

export const metadata = {
  title: "SCAFFOLD-X Laluan Kerjaya Anak Muda 2026",
  description: "Program Latihan Kerjaya SCAFFOLD-X dengan tajaan Yayasan Pelajaran MARA dan anjuran TERAS UNIVERSAL.",
  alternates: { canonical: "/program-tajaan-ypm" },
  openGraph: { title: "SCAFFOLD-X Laluan Kerjaya Anak Muda 2026 | TERAS UNIVERSAL", description: "Program Latihan Kerjaya SCAFFOLD-X dengan tajaan Yayasan Pelajaran MARA dan anjuran TERAS UNIVERSAL.", url: "/program-tajaan-ypm" },
};

function NumberedCards({ items }) {
  return <div className="ypm-check-grid">{items.map(([number, title, text]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div>;
}

export default function ProgramTajaanYpmPage() {
  return <main className="ypm-page">
    <header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><MegaNav /><MobileNav basePath="/" /></div></header>

    <section className="ypm-hero" aria-labelledby="ypm-hero-title"><div className="container ypm-hero-grid"><div className="ypm-hero-copy"><span className="eyebrow">Program Tajaan YPM</span><h1 id="ypm-hero-title">SCAFFOLD-X: Laluan Kerjaya Anak Muda</h1><p>Program Latihan Kerjaya untuk membina kemahiran scaffolding, membuka peluang kerjaya dan melangkah daripada zero menjadi tenaga kerja berkemahiran.</p><div className="hero-actions"><a className="btn btn-primary" href={whatsappHref} {...ctaProps} data-cta-placement="hero">Semak Kelayakan di WhatsApp</a></div><div className="ypm-hero-facts" aria-label="Maklumat asas program"><span><strong>18-32 tahun</strong><small>Kelayakan umur rasmi</small></span><span><strong>25 peserta</strong><small>Kapasiti rasmi PLKK</small></span><span><strong>Negeri Kedah</strong><small>Skop lokasi rasmi</small></span><span><strong>RM2,500 ke atas</strong><small>Anggaran gaji pada poster</small></span></div></div><figure className="ypm-hero-media"><Image src="/images/ypm-scaffold-poster.jpg" alt="Poster Program Latihan Kerjaya Scaffolding anjuran TERAS UNIVERSAL dengan tajaan Yayasan Pelajaran MARA." width={1200} height={1600} priority sizes="(max-width: 920px) 100vw, 45vw" /></figure></div></section>

    <section className="ypm-brief-section" aria-labelledby="ypm-brief-title"><div className="container ypm-brief-grid"><div><span className="eyebrow">Program Latihan Kerjaya</span><h2 id="ypm-brief-title">Dari zero, melangkah jadi bravo.</h2></div><p>SCAFFOLD-X ialah laluan kerjaya anak muda untuk kursus Scaffolding Competency. Program ini terbuka kepada pemohon berumur 18 hingga 32 tahun dan dokumen rasmi mengesahkan PLKK ini untuk 25 peserta di Negeri Kedah bagi tahun 2026.</p></div></section>
    <section className="ypm-benefits-section" aria-labelledby="ypm-benefits-title"><div className="container"><div className="section-heading ypm-heading"><span className="eyebrow">Apa Yang Dinyatakan Pada Poster</span><h2 id="ypm-benefits-title">Bina kemahiran, bina masa depan.</h2></div><NumberedCards items={benefits} /></div></section>
    <section className="ypm-check-section" aria-labelledby="ypm-check-title"><div className="container"><div className="section-heading ypm-heading"><span className="eyebrow">Semakan Awal</span><h2 id="ypm-check-title">Perkara yang akan disahkan</h2><p>Sediakan maklumat asas anda supaya pasukan TERAS boleh memberikan jawapan yang sesuai.</p></div><NumberedCards items={checks} /></div></section>
    <section className="ypm-note-section" aria-labelledby="ypm-note-title"><div className="container ypm-note-grid"><div><span className="eyebrow">Peluang Kerjaya</span><h2 id="ypm-note-title">Kemahiran bernilai tinggi untuk masa depan.</h2></div><div className="ypm-note-copy"><p>Poster menyatakan peluang kerjaya dalam industri pembinaan, minyak dan gas serta perancah, dengan anggaran gaji bermula RM2,500.00 ke atas. Anggaran ini bukan jaminan pendapatan dan perlu disahkan mengikut pekerjaan serta majikan.</p><a className="btn btn-outline" href={whatsappHref} {...ctaProps} data-cta-placement="note">Tanya Ms Piqa</a></div></div></section>
    <section className="ypm-faq-section" aria-labelledby="ypm-faq-title"><div className="container"><div className="section-heading ypm-heading"><span className="eyebrow">Soalan Lazim</span><h2 id="ypm-faq-title">Jawapan ringkas sebelum anda bertanya.</h2></div><div className="ypm-faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></div></section>
    <section className="ypm-final-cta" aria-labelledby="ypm-final-title"><div className="container"><span className="eyebrow">Daftar Sekarang</span><h2 id="ypm-final-title">Semak kelayakan anda dengan Ms Piqa.</h2><p>25 tempat peserta dinyatakan dalam dokumen rasmi. Hubungi TERAS UNIVERSAL untuk mendapatkan syarat, terma dan maklumat kemasukan SCAFFOLD-X.</p><a className="btn btn-gold" href={whatsappHref} {...ctaProps} data-cta-placement="final">Semak Kelayakan di WhatsApp</a><small>019-519 3834 · admin@terasuniversal.com.my</small></div></section>
    <Footer />
  </main>;
}
