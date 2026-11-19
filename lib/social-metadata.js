// Open Graph / Twitter metadata for public informational pages (S5B-1B Round 3).
// Without this, a page that sets no openGraph of its own inherited the homepage's og:url and og:title, and a page that
// set only part of openGraph lost the share image. Every page passes its own title, description and path; the URL
// is resolved against the root layout's metadataBase (the technically active canonical host, unchanged here; the
// owner's preferred www host is a separate open decision). The images are the app/ file-convention assets.
export const SOCIAL_SITE_NAME = "TERAS UNIVERSAL SDN. BHD.";
export const SOCIAL_IMAGE = { url: "/opengraph-image.png", width: 1200, height: 630, alt: "TERAS UNIVERSAL SDN. BHD. — Building Competence. Creating Opportunities." };
export const TWITTER_IMAGE = "/twitter-image.png";

export function socialMetadata({ title, description, path, type = "website" }) {
  return {
    openGraph: { type, locale: "en_MY", siteName: SOCIAL_SITE_NAME, url: path, title, description, images: [SOCIAL_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [TWITTER_IMAGE] },
  };
}
