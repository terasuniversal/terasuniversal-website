export const metadata = {
  title: "Industrial Safety, Technical Competency & Workforce Solutions | TERAS UNIVERSAL",
  description: "Explore TERAS UNIVERSAL industrial safety, technical competency, consultancy and workforce development services for organisations in Malaysia.",
  keywords: "industrial safety services Malaysia, technical competency, HSE consultancy, workforce development".split(", "),
  alternates: { canonical: "/services" },
  openGraph: {
    type: "website",
    locale: "en_MY",
    url: "https://terasuniversal.com.my/services",
    siteName: "TERAS UNIVERSAL SDN. BHD.",
    title: "Industrial Safety, Technical Competency & Workforce Solutions | TERAS UNIVERSAL",
    description: "Explore TERAS UNIVERSAL industrial safety, technical competency, consultancy and workforce development services for organisations in Malaysia.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "TERAS UNIVERSAL SDN. BHD." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Industrial Safety, Technical Competency & Workforce Solutions | TERAS UNIVERSAL",
    description: "Explore TERAS UNIVERSAL industrial safety, technical competency, consultancy and workforce development services for organisations in Malaysia.",
    images: ["/twitter-image.png"],
  },
};

export default function RouteLayout({ children }) {
  return children;
}