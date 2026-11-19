import PremiumHeader from "../../components/premium/PremiumHeader";
import TrainingGallery from "../../components/TrainingGallery";
import PremiumFooter from "../../components/premium/PremiumFooter";
import { trainingGallery } from "../../data/trainingGallery";
import { publicBody } from "../../components/premium/fonts";
import bridge from "../../components/premium/legacy-bridge.module.css";

export const metadata = {
  title: "Training Gallery",
  description: "Visual representations of industrial safety training, technical development and practical competency activities from TERAS UNIVERSAL.",
  alternates: { canonical: "/gallery" },
  robots: { index: false, follow: true },
};

// Phase S4D-2B: the shared Premium header replaces the page's own legacy header and, as on the other Premium
// pages, sits before <main> rather than inside it. Everything inside <main> is unchanged.
export default function GalleryPage() {
  return (
    <>
    <PremiumHeader />
    <main className={`gallery-page ${bridge.page} ${publicBody.variable}`}>

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
    </main>

      <PremiumFooter />
    </>
  );
}
