import "./globals.css";

export const metadata = {
  title: "TERAS UNIVERSAL SDN. BHD.",
  description:
    "Industrial Safety Training & Consultancy — Building Competence. Creating Opportunities.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ms">
      <body>{children}</body>
    </html>
  );
}
