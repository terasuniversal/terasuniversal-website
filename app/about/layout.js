export const metadata = {
  title: "About TERAS UNIVERSAL | Building Industrial Workforce Competence",
  description: "Learn about TERAS UNIVERSAL SDN. BHD., our values, practical approach and commitment to safer, more competent industrial workforces in Malaysia.",
  keywords: "TERAS UNIVERSAL about, industrial training company Malaysia, workforce competency Malaysia".split(", "),
  alternates: { canonical: "/about" },
  openGraph: {
    type: "website",
    locale: "en_MY",
    url: "https://terasuniversal.com.my/about",
    siteName: "TERAS UNIVERSAL SDN. BHD.",
    title: "About TERAS UNIVERSAL | Building Industrial Workforce Competence",
    description: "Learn about TERAS UNIVERSAL SDN. BHD., our values, practical approach and commitment to safer, more competent industrial workforces in Malaysia.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "TERAS UNIVERSAL SDN. BHD." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "About TERAS UNIVERSAL | Building Industrial Workforce Competence",
    description: "Learn about TERAS UNIVERSAL SDN. BHD., our values, practical approach and commitment to safer, more competent industrial workforces in Malaysia.",
    images: ["/twitter-image.png"],
  },
};

export default function RouteLayout({ children }) {
  return children;
}