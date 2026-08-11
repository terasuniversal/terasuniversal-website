/**
 * Top TERAS icon mark used exclusively by Certificate Template A
 * (`professional_scaffold_erection_skills`). Single source of truth for
 * both the React preview (ProfessionalScaffoldCertificateDocument.tsx) and
 * the standalone print/PDF renderer (professional-scaffold-certificate-html.ts).
 *
 * Extracted once from the official public/teras-universal-logo.png lockup
 * (1144x806) — icon-only content bounding box (223,3)-(907,608), measured
 * directly against the source pixels — with real alpha transparency
 * (un-matted from the source's flat white background, not `mix-blend-mode`)
 * and 20px of safe padding on every side.
 *
 * `mix-blend-mode: multiply` against a near-zero-margin CSS background-image
 * crop was the previous approach; it visibly clipped the gold swoosh's
 * anti-aliased tapering tips because a near-white pixel disappears under
 * multiply blending, and there was almost no source-pixel margin between
 * the coded crop box and the artwork's true edges to absorb that. A real
 * transparent PNG with generous padding has no such failure mode — replace
 * this file's contents (or bump the version suffix) to update the artwork;
 * no code change needed for an artwork-only update.
 */
export const TEMPLATE_A_LOGO_SRC = "/certificates/template-a/teras-logo-v1.png";
