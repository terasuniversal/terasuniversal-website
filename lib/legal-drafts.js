// Draft legal pages (/privacy, /privacy/ms, /terms) are INTERNAL DRAFTS (S5B-1B Round 2). They are not approved,
// not legally reviewed and must never be published by accident: unless this flag is set explicitly at build time
// the routes call notFound(), so a normal build or deployment serves a 404 instead of the draft. The pages also set
// noindex and are left out of the sitemap, but noindex is not access control, so this gate is the real safeguard.
// Local review builds set TERAS_LEGAL_DRAFTS=preview. Setting it on any shared or public environment requires a
// separate owner publication decision.
export const legalDraftsEnabled = process.env.TERAS_LEGAL_DRAFTS === "preview";

// Shared, explicit draft status shown at the top of every draft legal page.
export const legalDraftStatus = {
  en: "INTERNAL DRAFT — NOT APPROVED FOR PUBLICATION — LEGAL REVIEW PENDING. This text is not in effect and has not been approved by TERAS UNIVERSAL or reviewed by a legal adviser. Items marked “Pending” still need an owner or legal decision.",
  ms: "DRAF DALAMAN — TIDAK DILULUSKAN UNTUK PENERBITAN — SEMAKAN UNDANG-UNDANG BELUM SELESAI. Teks ini belum berkuat kuasa dan belum diluluskan oleh TERAS UNIVERSAL atau disemak oleh penasihat undang-undang. Perkara bertanda “Belum diputuskan” masih memerlukan keputusan pemilik atau undang-undang.",
};
