import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import TrainingGallery from "../../components/TrainingGallery";
import Footer from "../../components/Footer";
import { trainingGallery } from "../../data/trainingGallery";

export default function GalleryPage() {
  return (
    <main className="gallery-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <MegaNav />
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
