import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import Footer from "../../components/Footer";
import VerifyForm from "./VerifyForm";

export const metadata = {
  title: "Certificate Verification",
  description: "Verify certificates officially issued by TERAS UNIVERSAL SDN. BHD.",
};

export default function VerifyPage() {
  return (
    <main className="verify-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <MegaNav />
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="verify-hero" aria-labelledby="verify-title">
        <div className="container verify-hero-grid">
          <div className="verify-copy"><span className="eyebrow">OFFICIAL CERTIFICATE CHECK</span><h1 id="verify-title">Certificate Verification</h1><p>Enter the unique certificate number to confirm that it was officially issued by TERAS UNIVERSAL SDN. BHD.</p></div>
          <div className="verify-card"><VerifyForm /><p className="verify-security" role="note"><span aria-hidden="true">&#128274;</span> For security, verification shows only the information needed to confirm the certificate.</p></div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
