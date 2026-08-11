/**
 * Approved crest used exclusively by Certificate Template A
 * (`professional_scaffold_erection_skills`). Single source of truth for
 * both the React preview (ProfessionalScaffoldCertificateDocument.tsx) and
 * the standalone print/PDF renderer (professional-scaffold-certificate-html.ts)
 * so they always render the exact same artwork.
 *
 * A static file under /public, not code that regenerates a picture at
 * render time — replacing this file's contents (or bumping the version
 * suffix and updating this constant) is enough to change the crest; no
 * code change is needed for an artwork-only update. The version suffix is
 * deliberate cache-busting: browsers/CDNs cache static assets aggressively,
 * so overwriting a same-named file risks a stale crest persisting for
 * visitors with a cached copy. Bump the suffix on every future artwork
 * change instead of overwriting a filename in place.
 *
 * v3: replaced the v2 artwork (which carried over the old procedurally
 * generated design's 7-star arc and hanging ribbon tails) with the
 * approved navy/gold "TU" seal — double gold ring, "BUILDING COMPETENCE" /
 * "CREATING OPPORTUNITIES" arced tagline, TU monogram, EST. 2012, no stars,
 * no ribbon tails — matching the approved reference design. It is a true
 * circle (200x200 viewBox) rather than v2's 200x210 (which reserved extra
 * height for the removed ribbon tails).
 */
export const TEMPLATE_A_CREST_SRC = "/certificates/template-a/teras-crest-v3.svg";
