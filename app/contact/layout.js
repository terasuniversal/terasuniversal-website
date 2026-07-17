export const metadata = {
  title: { absolute: "Contact TERAS UNIVERSAL | Industrial Training & Consultancy" },
  description: "Contact TERAS UNIVERSAL to discuss industrial safety training, competency development, consultancy and customised workforce programmes.",
  keywords: "contact TERAS UNIVERSAL, industrial training enquiry Malaysia, safety consultancy contact".split(", "),
  alternates: { canonical: "/contact" },
  openGraph: {
    type: "website",
    locale: "en_MY",
    url: "https://terasuniversal.com.my/contact",
    siteName: "TERAS UNIVERSAL SDN. BHD.",
    title: "Contact TERAS UNIVERSAL | Industrial Training & Consultancy",
    description: "Contact TERAS UNIVERSAL to discuss industrial safety training, competency development, consultancy and customised workforce programmes.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "TERAS UNIVERSAL SDN. BHD." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact TERAS UNIVERSAL | Industrial Training & Consultancy",
    description: "Contact TERAS UNIVERSAL to discuss industrial safety training, competency development, consultancy and customised workforce programmes.",
    images: ["/twitter-image.png"],
  },
};

export default function RouteLayout({ children }) {
  return children;
}
