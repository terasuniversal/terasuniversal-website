export const metadata = {
  title: { absolute: "Scaffolding Rental & Installation | TERAS UNIVERSAL" },
  description: "Scaffolding rental, erection, dismantling, inspection and maintenance solutions for construction and industrial projects by TERAS UNIVERSAL.",
  keywords: "scaffolding rental Malaysia, scaffolding installation, scaffolding erection, scaffolding dismantling, scaffolding inspection".split(", "),
  alternates: { canonical: "/services/scaffolding" },
  openGraph: {
    type: "website",
    locale: "en_MY",
    url: "https://terasuniversal.com.my/services/scaffolding",
    siteName: "TERAS UNIVERSAL SDN. BHD.",
    title: "Scaffolding Rental & Installation | TERAS UNIVERSAL",
    description: "Scaffolding rental, erection, dismantling, inspection and maintenance solutions for construction and industrial projects by TERAS UNIVERSAL.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "TERAS UNIVERSAL SDN. BHD." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scaffolding Rental & Installation | TERAS UNIVERSAL",
    description: "Scaffolding rental, erection, dismantling, inspection and maintenance solutions for construction and industrial projects by TERAS UNIVERSAL.",
    images: ["/twitter-image.png"],
  },
};

export default function ScaffoldingServiceLayout({ children }) {
  return children;
}
