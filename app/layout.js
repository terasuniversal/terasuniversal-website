import "./globals.css";

export const metadata = {
  title: "TERAS UNIVERSAL SDN. BHD.",
  description: "Industrial Safety Training & Consultancy — Building Competence. Creating Opportunities.",
  openGraph: {
    title: "TERAS UNIVERSAL SDN. BHD.",
    description: "Industrial Safety Training & Consultancy — Building Competence. Creating Opportunities.",
    images: ["/teras-universal-logo.png"],
  },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
