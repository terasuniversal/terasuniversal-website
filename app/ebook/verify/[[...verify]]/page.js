import PremiumHeader from "../../../../components/premium/PremiumHeader";
import PremiumFooter from "../../../../components/premium/PremiumFooter";
import { publicBody } from "../../../../components/premium/fonts";
import kit from "../../../../components/premium/premium.module.css";
import styles from "../../../../components/ebook/ebook.module.css";
import EbookVerify from "../../../../components/ebook/EbookVerify";
import { ebookPublicEnabled } from "../../../../lib/ebook-lead";

// W9-G3 /ebook/verify: the page an email verification link opens (W9-EBOOK-RPC-CONTRACT v1.0 §4). It exists only when
// TERAS_EBOOK_PUBLIC is "on" at build time; otherwise generateStaticParams returns no paths and dynamicParams = false
// gives a real HTTP 404 (same pattern as /ebook). The page is static: the client component reads the token from the URL
// fragment (#t=…, erratum v1.0.2; never sent to the server), removes it
// from the URL and history, and consumes nothing until the visitor presses the confirm button (POST). noindex,
// no-referrer, never in the sitemap.
export const dynamicParams = false;

export function generateStaticParams() {
  return ebookPublicEnabled() ? [{ verify: [] }] : [];
}

export const metadata = {
  title: { absolute: "Confirm your email | TERAS UNIVERSAL eBook" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function EbookVerifyPage() {
  return (
    <>
      <PremiumHeader />
      <main className={`${publicBody.variable} ${kit.px} ${styles.page}`}>
        <section className={`${kit.wrap} ${styles.section} ${styles.verifySection}`} aria-labelledby="ebook-verify-heading">
          <p className={styles.eyebrow}>Free eBook · Dari Zero ke Dunia Industri</p>
          <h1 id="ebook-verify-heading" className={styles.verifyHeading}>Get your free eBook</h1>
          <EbookVerify />
          {/* W9-G3.1: without JavaScript the fragment token is never read or sent anywhere; say so plainly. */}
          <noscript><p className={styles.hint}>This page needs JavaScript to confirm your email. Your link has not been used: enable JavaScript and open the link again, or request a new link from the eBook page (/ebook).</p></noscript>
        </section>
      </main>
      <PremiumFooter />
    </>
  );
}
