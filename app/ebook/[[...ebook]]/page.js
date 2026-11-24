import Image from "next/image";
import PremiumHeader from "../../../components/premium/PremiumHeader";
import PremiumFooter from "../../../components/premium/PremiumFooter";
import { publicBody } from "../../../components/premium/fonts";
import kit from "../../../components/premium/premium.module.css";
import styles from "../../../components/ebook/ebook.module.css";
import EbookRequestDemo from "../../../components/ebook/EbookRequestDemo";
import EbookRequestForm from "../../../components/ebook/EbookRequestForm";
import { ebookPreviewEnabled, ebookRelease } from "../../../lib/ebook-preview";
import { ebookPublicEnabled } from "../../../lib/ebook-lead";

// LOCAL PREVIEW (Phase S6): /ebook only exists when TERAS_EBOOK_PREVIEW=local at build time. Otherwise
// generateStaticParams returns no paths and dynamicParams = false makes the router answer a real HTTP 404 (a notFound()
// inside the page would be a "soft 404" with HTTP 200 under app/loading.js). Always noindex and never in the sitemap
// until the lead-capture flow, Privacy Notice and delivery are approved. The copy summarises the approved v1.5.1 eBook.
export const dynamicParams = false;

// W9-G3: the page also exists when TERAS_EBOOK_PUBLIC is "on" at build time (launch needs a rebuild, which an env change
// on Vercel triggers anyway). Live mode renders the real request form; the local preview keeps the network-free demo.
export function generateStaticParams() {
  return ebookPreviewEnabled || ebookPublicEnabled() ? [{ ebook: [] }] : [];
}

const description = "A free introductory eBook in Bahasa Melayu about scaffolding and the scaffold erector career, for school leavers and newcomers to industry.";

export const metadata = {
  title: { absolute: "Free eBook: Dari Zero ke Dunia Industri | TERAS UNIVERSAL" },
  description,
  alternates: { canonical: "/ebook" },
  robots: { index: false, follow: false },
};

// Summarised from pages 2–10 of the approved eBook (12 pages, Bahasa Melayu).
const learn = [
  ["What “industry” really means", "Who works in industrial sites and how the work is organised."],
  ["What scaffolding is", "What a scaffold does and why it matters for safe work at height."],
  ["What a scaffold erector does", "A plain-language look at a typical working day."],
  ["Basic PPE and tools", "The protective equipment and hand tools an erector uses."],
  ["A learning path from zero", "A general route from a first basic course to more experience. A map, not a guarantee."],
  ["Skills employers value", "Habits and skills that make a trainee easier to trust on site."],
];

export default function EbookPage() {
  const live = ebookPublicEnabled();
  return (
    <>
      <PremiumHeader />
      <main className={`${publicBody.variable} ${kit.px} ${styles.page}`}>
        {!live && <p className={styles.previewBanner} role="note"><strong>Local preview, not live.</strong> This page and its request form are a demonstration for owner review. No details are sent or stored, and the eBook is not delivered here.</p>}

        <section className={styles.hero} aria-labelledby="ebook-title">
          <div className={`${kit.wrap} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Free eBook · PDF in {ebookRelease.language}</p>
              <h1 id="ebook-title">{ebookRelease.title}</h1>
              <p className={styles.subtitle} lang="ms">{ebookRelease.subtitle}</p>
              <p className={styles.lead}>A friendly, {ebookRelease.pages}-page introduction to scaffolding and the scaffold erector career, written for people who have never worked in industry.</p>
              <p className={styles.language}><span aria-hidden="true">BM</span> The eBook is written in Bahasa Melayu. This page is in English.</p>
              <a className={kit.btn} href="#ebook-request">Get the free eBook</a>
            </div>
            <figure className={styles.cover}>
              <Image src={ebookRelease.cover.src} width={ebookRelease.cover.width} height={ebookRelease.cover.height} priority sizes="(max-width: 900px) 70vw, 360px" alt="Cover of the eBook Dari Zero ke Dunia Industri: a young worker in a hard hat and full-body harness standing on a guarded scaffold platform at sunset, with the TERAS UNIVERSAL logo" />
              <figcaption>Cover artwork includes an AI-generated illustration.</figcaption>
            </figure>
          </div>
        </section>

        <section className={`${kit.wrap} ${styles.section}`} aria-labelledby="ebook-audience">
          <h2 id="ebook-audience">Who it is for</h2>
          <ul className={styles.audience}>
            <li>School leavers after SPM who are deciding what to do next</li>
            <li>Young adults, roughly 18 to 30, curious about a skilled trade</li>
            <li>Anyone with no industry experience who wants a simple first look</li>
          </ul>
        </section>

        <section className={`${kit.wrap} ${styles.section}`} aria-labelledby="ebook-learn">
          <h2 id="ebook-learn">What you will learn</h2>
          <ul className={styles.learn}>
            {learn.map(([title, text]) => <li key={title}><h3>{title}</h3><p>{text}</p></li>)}
          </ul>
          <p className={styles.honest}><strong>Good to know:</strong> this eBook is a light introduction. It is not formal training, it does not lead to a certificate and it does not replace a real course. Scaffolding work may only be carried out after suitable training and under competent supervision. Completing a course does not guarantee employment.</p>
        </section>

        <section className={styles.requestBand} id="ebook-request" aria-labelledby="ebook-request-title">
          <div className={`${kit.wrap} ${styles.requestGrid}`}>
            <div>
              <h2 id="ebook-request-title">Request your free copy</h2>
              <p>Tell us who you are and where to send the eBook. We only ask for what is needed to provide it and handle your request.</p>
              <h3>How your details would be used</h3>
              <ul className={styles.privacy}>
                <li>Your full name, WhatsApp/phone number and email are used to provide this eBook and handle your request. Your number is not used for promotional calls or WhatsApp messages.</li>
                <li>Hearing from TERAS about courses by email is a separate, optional choice. You get the eBook either way.</li>
                <li>TERAS UNIVERSAL’s Privacy Notice is being finalised and will be published before this form goes live.</li>
              </ul>
            </div>
            {live ? <EbookRequestForm /> : <EbookRequestDemo />}
          </div>
        </section>

        <section className={`${kit.wrap} ${styles.section}`} aria-labelledby="ebook-next">
          <h2 id="ebook-next">Ready for the next step?</h2>
          <p>When you are ready for real training, explore the scaffolding courses or ask our team which course suits you.</p>
          <div className={styles.links}>
            <a className={`${kit.btn} ${kit.btnNavy}`} href="/training/scaffolding-competency">Explore scaffolding training</a>
            <a href="/training/basic-scaffolder-level-1">Basic Scaffolder (Level 1)</a>
            <a href="/calendar">Training calendar</a>
            <a href="/contact">Contact TERAS</a>
          </div>
        </section>
      </main>
      <PremiumFooter />
    </>
  );
}
