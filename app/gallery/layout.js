export const metadata = {
  title: "Industrial Training Gallery | TERAS UNIVERSAL",
  description: "View visual representations of industrial safety training, technical development and practical competency activities by TERAS UNIVERSAL.",
  keywords: "industrial training gallery, safety training visuals, technical competency Malaysia".split(", "),
  alternates: { canonical: "/gallery" },
  openGraph: {
    type: "website",
    locale: "en_MY",
    url: "https://terasuniversal.com.my/gallery",
    siteName: "TERAS UNIVERSAL SDN. BHD.",
    title: "Industrial Training Gallery | TERAS UNIVERSAL",
    description: "View visual representations of industrial safety training, technical development and practical competency activities by TERAS UNIVERSAL.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "TERAS UNIVERSAL SDN. BHD." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Industrial Training Gallery | TERAS UNIVERSAL",
    description: "View visual representations of industrial safety training, technical development and practical competency activities by TERAS UNIVERSAL.",
    images: ["/twitter-image.png"],
  },
};

export default function RouteLayout({ children }) {
  return children;
}