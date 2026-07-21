import AdminCertificatesClient from "./AdminCertificatesClient";

export const metadata = {
  title: "Certificate Admin",
  robots: { index: false, follow: false },
};

export default function CertificateAdminPage() {
  return <AdminCertificatesClient />;
}
