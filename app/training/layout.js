export const metadata = {
  title: { absolute: "Industrial Safety & Technical Training Programmes | TERAS UNIVERSAL" },
  description: "Explore competency-based industrial safety, technical competency, assessment and workforce development training programmes from TERAS UNIVERSAL.",
  keywords: "industrial safety training Malaysia, scaffolding training, working at height, competency assessment".split(", "),
  alternates: { canonical: "/training" },
  openGraph: {
    type: "website",
    locale: "en_MY",
    url: "https://terasuniversal.com.my/training",
    siteName: "TERAS UNIVERSAL SDN. BHD.",
    title: "Industrial Safety & Technical Training Programmes | TERAS UNIVERSAL",
    description: "Explore competency-based industrial safety, technical competency, assessment and workforce development training programmes from TERAS UNIVERSAL.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "TERAS UNIVERSAL SDN. BHD." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Industrial Safety & Technical Training Programmes | TERAS UNIVERSAL",
    description: "Explore competency-based industrial safety, technical competency, assessment and workforce development training programmes from TERAS UNIVERSAL.",
    images: ["/twitter-image.png"],
  },
};

export default function RouteLayout({ children }) {
  return children;
}
