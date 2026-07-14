import "./globals.css";


export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  metadataBase: new URL("https://terasuniversal.com.my"),
  title: {
    default: "TERAS UNIVERSAL SDN. BHD. | Industrial Safety Training & Technical Competency Malaysia",
    template: "%s | TERAS UNIVERSAL",
  },
  description:
    "Official website of TERAS UNIVERSAL SDN. BHD. Industrial safety training, scaffolding, Working at Height, technical competency, consultancy and workforce development solutions in Malaysia.",
  keywords: [
    "industrial safety training Malaysia",
    "safety training Kedah",
    "scaffolding training",
    "working at height training",
    "competency development",
    "corporate training Malaysia",
    "industrial safety consultancy",
    "HSE consultancy Malaysia",
    "workforce development Malaysia",
    "TERAS UNIVERSAL",
  ],
  authors: [{ name: "TERAS UNIVERSAL SDN. BHD." }],
  creator: "TERAS UNIVERSAL SDN. BHD.",
  publisher: "TERAS UNIVERSAL SDN. BHD.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_MY",
    url: "https://terasuniversal.com.my",
    siteName: "TERAS UNIVERSAL SDN. BHD.",
    title: "TERAS UNIVERSAL | Building Competence. Creating Opportunities.",
    description:
      "Industrial Safety Training & Consultancy for a competent, disciplined and industry-ready workforce.",
    images: [{
      url: "/opengraph-image.png",
      width: 1200,
      height: 630,
      alt: "TERAS UNIVERSAL SDN. BHD.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TERAS UNIVERSAL | Industrial Safety Training & Consultancy",
    description: "Building Competence. Creating Opportunities.",
    images: ["/twitter-image.png"],
  },
  icons: {
    icon: [{ url: "/favicon.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  category: "education",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
