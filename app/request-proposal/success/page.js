import Image from "next/image";
import MobileNav from "../../../components/MobileNav";

export const metadata = { title: { absolute: "Proposal Request Received | TERAS UNIVERSAL" }, description: "Your TERAS UNIVERSAL proposal request has been received." };

export default function ProposalSuccessPage() {
  return (
    <main className="proposal-success-page"><header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><nav className="desktop-nav" aria-label="Main navigation"><a href="/about">About</a><a href="/services">Services</a><a href="/training">Training</a><a href="/contact">Contact</a><a className="nav-proposal" href="/request-proposal">Request Proposal</a><a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a></nav><MobileNav basePath="/" /></div></header><section className="proposal-success-section"><div className="container"><span className="proposal-success-icon" aria-hidden="true">✓</span><span className="eyebrow">Request Received</span><h1>Thank You for Sharing Your Requirements</h1><p>Your proposal request has been sent to our team. A confirmation email is on its way to you. We will review your requirements and follow up shortly.</p><div className="hero-actions"><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a><a className="btn btn-outline" href="/">Return Home</a></div></div></section><footer><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></span></div></footer></main>
  );
}
