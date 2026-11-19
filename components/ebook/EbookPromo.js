import Image from "next/image";
import styles from "./ebook.module.css";
import { ebookPreviewEnabled, ebookRelease } from "../../lib/ebook-preview";

// Links to /ebook only in the local preview build (TERAS_EBOOK_PREVIEW=local). In every other build this renders
// nothing, so no page points at the gated route before the lead-capture flow is approved.
export default function EbookPromo() {
  if (!ebookPreviewEnabled) return null;
  return (
    <aside className={styles.promo} aria-labelledby="ebook-promo-title">
      <Image src={ebookRelease.cover.src} width={ebookRelease.cover.width} height={ebookRelease.cover.height} sizes="120px" alt="" />
      <div>
        <h2 id="ebook-promo-title">Free eBook: {ebookRelease.title}</h2>
        <p>A friendly introduction to scaffolding and the scaffold erector career for newcomers. PDF in {ebookRelease.language}.</p>
        <a href="/ebook">Find out more about the free eBook <span aria-hidden="true">&rarr;</span></a>
      </div>
    </aside>
  );
}
