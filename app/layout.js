import "./globals.css";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B2C56",
};

export const metadata = {
  metadataBase: new URL("https://terasuniversal.com.my"),
  title: { default: "TERAS UNIVERSAL SDN. BHD. | Industrial Safety Training & Technical Competency Malaysia", template: "%s | TERAS UNIVERSAL" },
  description: "Official website of TERAS UNIVERSAL SDN. BHD. Industrial safety training, scaffolding, Working at Height, technical competency, consultancy and workforce development solutions in Malaysia.",
  keywords: ["industrial safety training Malaysia", "safety training Kedah", "scaffolding training", "working at height training", "competency development", "corporate training Malaysia", "industrial safety consultancy", "HSE consultancy Malaysia", "workforce development Malaysia", "TERAS UNIVERSAL"],
  authors: [{ name: "TERAS UNIVERSAL SDN. BHD." }],
  creator: "TERAS UNIVERSAL SDN. BHD.",
  publisher: "TERAS UNIVERSAL SDN. BHD.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "en_MY", url: "https://terasuniversal.com.my", siteName: "TERAS UNIVERSAL SDN. BHD.", title: "TERAS UNIVERSAL | Building Competence. Creating Opportunities.", description: "Industrial Safety Training & Consultancy for a competent, disciplined and industry-ready workforce.", images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "TERAS UNIVERSAL SDN. BHD." }] },
  twitter: { card: "summary_large_image", title: "TERAS UNIVERSAL | Industrial Safety Training & Consultancy", description: "Building Competence. Creating Opportunities.", images: ["/twitter-image.png"] },
  icons: { icon: [{ url: "/favicon.png", sizes: "64x64", type: "image/png" }], apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }] },
  manifest: "/manifest.webmanifest",
  category: "education",
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://terasuniversal.com.my/#organization",
  name: "TERAS UNIVERSAL SDN. BHD.",
  url: "https://terasuniversal.com.my",
  logo: "https://terasuniversal.com.my/teras-universal-logo.png",
  email: "training@terasuniversal.com.my",
  telephone: "+60 19-519 3834",
  address: { "@type": "PostalAddress", streetAddress: "Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam", addressLocality: "Jitra", addressRegion: "Kedah", postalCode: "06000", addressCountry: "MY" },
};
const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": "https://terasuniversal.com.my/#localbusiness",
  name: "TERAS UNIVERSAL SDN. BHD.",
  url: "https://terasuniversal.com.my",
  image: "https://terasuniversal.com.my/opengraph-image.png",
  email: "training@terasuniversal.com.my",
  telephone: "+60 19-519 3834",
  address: { "@type": "PostalAddress", streetAddress: "Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam", addressLocality: "Jitra", addressRegion: "Kedah", postalCode: "06000", addressCountry: "MY" },
  openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:30", closes: "17:30" }],
};
const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://terasuniversal.com.my/#website",
  name: "TERAS UNIVERSAL SDN. BHD.",
  url: "https://terasuniversal.com.my",
  publisher: { "@id": "https://terasuniversal.com.my/#organization" },
  inLanguage: "en-MY",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="prefetch" href="/about" />
        <link rel="prefetch" href="/services" />
        <link rel="prefetch" href="/training" />
        <link rel="prefetch" href="/contact" />
      </head>
      <body>
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([organizationSchema, localBusinessSchema, websiteSchema]) }} />
      </body>
    </html>
  );
}