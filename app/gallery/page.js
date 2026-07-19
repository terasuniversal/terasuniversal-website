import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import TrainingGallery from "../../components/TrainingGallery";
import { trainingGallery } from "../../data/trainingGallery";

export default function GalleryPage() {
  return (
    <main className="gallery-page">
      <SiteHeader />

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

      <SiteFooter />
    </main>
  );
}
