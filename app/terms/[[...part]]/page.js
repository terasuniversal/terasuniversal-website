import PremiumHeader from "../../../components/premium/PremiumHeader";
import PremiumFooter from "../../../components/premium/PremiumFooter";
import LegalDocument from "../../../components/legal/LegalDocument";
import { termsPartAEn } from "../../../content/en/terms";
import { legalDraftsEnabled, legalDraftStatus } from "../../../lib/legal-drafts";

// INTERNAL DRAFT (S5B-1B Round 2), Part A (website use) only: training terms (Part B) depend on open owner decisions
// and are not drafted. The route only exists when TERAS_LEGAL_DRAFTS=preview at build time; otherwise the router
// answers a real HTTP 404 (generateStaticParams returns nothing and dynamicParams = false). noindex, not linked.
export const dynamicParams = false;

export function generateStaticParams() {
  return legalDraftsEnabled ? [{ part: [] }] : [];
}

export const metadata = { title: { absolute: "Terms & Conditions (Internal Draft) | TERAS UNIVERSAL" }, robots: { index: false, follow: false } };

export default function TermsDraftPage() {
  return (
    <>
      <PremiumHeader />
      <main>
        <LegalDocument doc={termsPartAEn} status={legalDraftStatus.en} />
      </main>
      <PremiumFooter />
    </>
  );
}
