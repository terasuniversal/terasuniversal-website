// The /ebook landing page is a LOCAL PREVIEW (Phase S6). The eBook content is approved for publication (2 Nov 2026),
// but the website page, lead capture, consent records and delivery are NOT approved (09_release/ADENDUM and
// REKOD_KELULUSAN_PENERBITAN.md). Unless this flag is set explicitly at build time the route answers a real HTTP 404
// and every link or promotion to it renders nothing, so a normal build or deployment cannot publish it by accident.
// Local review builds set TERAS_EBOOK_PREVIEW=local. Enabling it anywhere shared or public needs a separate owner
// decision, together with an approved lead-capture backend, a published Privacy Notice and delivery QA.
export const ebookPreviewEnabled = process.env.TERAS_EBOOK_PREVIEW === "local";

// Facts about the approved release, verified in S6 against the publication record. The PDF itself is deliberately not
// part of the website: it must only be delivered through the approved lead-capture flow.
export const ebookRelease = {
  title: "Dari Zero ke Dunia Industri",
  subtitle: "Panduan Santai Untuk Kenal Scaffolding & Kerjaya Scaffold Erector",
  version: "v1.5.1",
  language: "Bahasa Melayu",
  pages: 12,
  fileName: "TERAS_eBook_DariZeroKeDuniaIndustri.pdf",
  sha256: "fbf19c283c534e0638bfd91816e7e5b708ee3a8b69a6946612c53a4d570a04dc",
  cover: { src: "/images/ebook/dari-zero-ke-dunia-industri-cover.webp", width: 640, height: 907 },
};
