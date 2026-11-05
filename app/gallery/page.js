import TrainingGallery from "../../components/TrainingGallery";
import Footer from "../../components/Footer";
import PremiumHeader from "../../components/premium/PremiumHeader";
import { trainingGallery } from "../../data/trainingGallery";

export const metadata = {
  title: "Training Gallery",
  description: "Visual representations of industrial safety training, technical development and practical competency activities from TERAS UNIVERSAL.",
  alternates: { canonical: "/gallery" },
  robots: { index: false, follow: true },
};

export default function GalleryPage() {
  return (
    <main className="gallery-page">
      <PremiumHeader />

      <section className="gallery-page-hero" aria-labelledby="gallery-page-title">
        <div className="container">
          <span className="eyebrow">Training Gallery</span>
          <h1 id="gallery-page-title">A closer look at training in action.</h1>
          <p>Explore visual representations of industrial safety training, technical development and practical competency activities. These are AI-generated illustrations; the people shown are not TERAS personnel.</p>
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
