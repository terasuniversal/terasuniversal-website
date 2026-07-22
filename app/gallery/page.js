import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import TrainingGallery from "../../components/TrainingGallery";
import Footer from "../../components/Footer";
import { trainingGallery } from "../../data/trainingGallery";

export default function GalleryPage() {
  return (
    <main className="gallery-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="/#about">About</a><a href="/services">Services</a><a href="/training">Training</a><a href="/#industries">Industries</a><a href="/#faq">FAQ</a><a href="/#contact">Contact</a><a href="/verify">Verify Certificate</a>
            <a className="nav-proposal" href="/request-proposal">Request Proposal</a>
            <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="gallery-page-hero" aria-labelledby="gallery-page-title">
        <div className="container">
          <span className="eyebrow">Training Gallery</span>
          <h1 id="gallery-page-title">A closer look at training in action.</h1>
          <p>Explore visual representations of industrial safety training, technical development and practical competency activities.</p>
        </div>
      </section>
      <section className="gallery-page-content" aria-label="Complete training gallery">
        <div className="container">
          <TrainingGallery items={trainingGallery} showFullGalleryLink={false} />
        </div>
      </section>

      <Footer />
    </main>
  );
}
