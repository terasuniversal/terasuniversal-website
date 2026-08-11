/**
 * Top TERAS icon mark used exclusively by Certificate Template A
 * (`professional_scaffold_erection_skills`). Single source of truth for
 * both the React preview (ProfessionalScaffoldCertificateDocument.tsx) and
 * the standalone print/PDF renderer (professional-scaffold-certificate-html.ts)
 * — both import this constant rather than hardcoding a path, so repointing
 * it here is enough to update the artwork in both renderers at once.
 *
 * Extracted once from the official public/teras-universal-logo.png lockup
 * (1144x806) — icon-only content bounding box (223,3)-(907,608), measured
 * directly against the source pixels — with real alpha transparency
 * (un-matted from the source's flat white background, not `mix-blend-mode`)
 * and 20px of safe padding on every side. Symbol only: no "TERAS UNIVERSAL"
 * wordmark and no tagline row from the source lockup are included in the
 * crop — those render as separate live text directly in the certificate
 * templates instead, so the two are never duplicated.
 *
 * `mix-blend-mode: multiply` against a near-zero-margin CSS background-image
 * crop was an earlier approach; it visibly clipped the gold swoosh's
 * anti-aliased tapering tips because a near-white pixel disappears under
 * multiply blending, and there was almost no source-pixel margin between
 * the coded crop box and the artwork's true edges to absorb that. A real
 * transparent PNG with generous padding has no such failure mode — replace
 * this file's contents (or bump the version suffix) to update the artwork;
 * no code change needed for an artwork-only update.
 *
 * v1 (teras-symbol-v1.png): same validated icon-only crop as the prior
 * teras-logo-v1.png asset (pixel-verified: real 0-255 alpha range, fully
 * transparent at every image edge, no semi-transparent whitish halo
 * pixels, no embedded text) — renamed to make the "symbol only, no
 * wordmark" intent explicit in the filename itself.
 *
 * v2 (teras-symbol-v2.png): byte-identical re-verification of v1's content
 * — v1 was re-inspected pixel-by-pixel (full-resolution crop of every edge,
 * 2x upscale render, decoded alpha channel) after a report that the admin
 * template-editor's live preview showed "TERAS UNIVERSAL" wordmark text
 * under the icon. That text is not in this asset in either version; the
 * cause was `TemplateForm.tsx`'s preview default (`logo_url: c.logo_url ??
 * "/teras-universal-logo.png"`), which feeds a truthy fallback into
 * `config.logo_url` and wins over this constant in
 * `config.logo_url || TEMPLATE_A_LOGO_SRC` — seeing the *full* lockup
 * (icon + wordmark + tagline) squeezed into the icon-sized box via
 * object-fit:contain, not this file. Bumped the version suffix anyway per
 * this repo's own cache-busting convention (see the note above) since a
 * template-editor preview or CDN could otherwise hold a stale reference.
 */
export const TEMPLATE_A_LOGO_SRC = "/certificates/template-a/teras-symbol-v2.png";
