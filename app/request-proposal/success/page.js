import PremiumHeader from "../../../components/premium/PremiumHeader";
import PremiumFooter from "../../../components/premium/PremiumFooter";
import { publicBody } from "../../../components/premium/fonts";
import bridge from "../../../components/premium/legacy-bridge.module.css";

export const metadata = { title: { absolute: "Proposal Request Received | TERAS UNIVERSAL" }, description: "Your TERAS UNIVERSAL proposal request has been received." };

// Phase S4D-2C: the shared Premium header replaces the page's own legacy header and, as on the other Premium
// pages, sits before <main> rather than inside it. S5B-1B Round 1: the page-local legacy footer (inside <main>,
// with a hard-coded year and the old training@ address) is replaced by the Premium footer after <main>.
export default function ProposalSuccessPage() {
  return (
    <>
    <PremiumHeader />
    <main className={`proposal-success-page ${bridge.page} ${publicBody.variable}`}><section className="proposal-success-section"><div className="container"><span className="proposal-success-icon" aria-hidden="true">✓</span><span className="eyebrow">Request Received</span><h1>Thank You for Sharing Your Requirements</h1><p>Your proposal request has been received by our team. We will review your requirements and follow up shortly.</p><div className="hero-actions"><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a><a className="btn btn-outline" href="/">Return Home</a></div></div></section></main>
    <PremiumFooter />
    </>
  );
}
