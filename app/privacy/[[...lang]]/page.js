import PremiumHeader from "../../../components/premium/PremiumHeader";
import PremiumFooter from "../../../components/premium/PremiumFooter";
import LegalDocument from "../../../components/legal/LegalDocument";
import AnalyticsSettings from "../../../components/AnalyticsSettings";
import { privacyNoticeEn } from "../../../content/en/privacy";
import { privacyNoticeMs } from "../../../content/ms/privacy";
import { legalDraftsEnabled, legalDraftStatus } from "../../../lib/legal-drafts";
import { privacyPublished, privacyEffectiveDateText } from "../../../lib/privacy-publication";

// Privacy Notice: /privacy (English) and /privacy/ms (Bahasa Melayu; Act 709 s.7(3) requires both).
// Public-First F-6: the notice has its OWN fail-closed publication switch (lib/privacy-publication.js). It is published
// only when PRIVACY_EFFECTIVE_DATE holds a valid date -- set in the release commit on the Production publication day.
// Until then the route exists only for internal review with TERAS_LEGAL_DRAFTS=preview (marked as a draft); otherwise
// generateStaticParams returns no paths and dynamicParams = false makes the router answer a real HTTP 404 (a notFound()
// call inside the page would only give a "soft 404" with HTTP 200 under the root app/loading.js boundary).
// TERAS_LEGAL_DRAFTS is never needed to publish this notice, and publishing it never opens /terms.
export const dynamicParams = false;

export function generateStaticParams() {
  return privacyPublished || legalDraftsEnabled ? [{ lang: [] }, { lang: ["ms"] }] : [];
}

const isMalay = (lang) => Array.isArray(lang) && lang[0] === "ms";

export async function generateMetadata({ params }) {
  const { lang } = await params;
  const malay = isMalay(lang);
  if (!privacyPublished) {
    return {
      title: { absolute: malay ? "Notis Privasi (Draf Dalaman) | TERAS UNIVERSAL" : "Privacy Notice (Internal Draft) | TERAS UNIVERSAL" },
      robots: { index: false, follow: false },
    };
  }
  return {
    title: { absolute: malay ? "Notis Privasi | TERAS UNIVERSAL" : "Privacy Notice | TERAS UNIVERSAL" },
    description: malay
      ? "Cara TERAS UNIVERSAL SDN. BHD. mengumpul, menggunakan dan berkongsi data peribadi melalui laman web ini."
      : "How TERAS UNIVERSAL SDN. BHD. collects, uses and shares personal data through this website.",
    alternates: { canonical: malay ? "/privacy/ms" : "/privacy", languages: { en: "/privacy", ms: "/privacy/ms" } },
    robots: { index: true, follow: true },
  };
}

export default async function PrivacyNoticePage({ params }) {
  const { lang } = await params;
  const malay = isMalay(lang);
  const content = malay ? privacyNoticeMs : privacyNoticeEn;
  const effective = privacyEffectiveDateText(malay ? "ms" : "en");
  const doc = { ...content, version: effective ? `${content.effectiveLabel}: ${effective}` : content.unpublishedVersion };
  const status = privacyPublished ? null : malay ? legalDraftStatus.ms : legalDraftStatus.en;
  return (
    <>
      <PremiumHeader />
      <main>
        <LegalDocument doc={doc} status={status} />
        {/* W5-a (D-07): give, change or withdraw analytics consent; renders nothing while GA4 is not configured. */}
        <AnalyticsSettings lang={malay ? "ms" : "en"} />
      </main>
      <PremiumFooter />
    </>
  );
}
