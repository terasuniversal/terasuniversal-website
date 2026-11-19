import { privacyPublished } from "../../lib/privacy-publication";

// Public-First W2 Phase 1: the "Read our Privacy Notice." sentence appended to the privacy notes of the three public
// enquiry forms (homepage, /contact, Request Proposal). It is driven by the same build-time switch as /privacy itself,
// so it renders nothing while the notice is unpublished and can never point at a 404. No hooks, so it works inside the
// client form components. newTab keeps the visitor's half-filled form (and the Proposal wizard's step state) intact;
// the visually hidden suffix tells screen reader users that a new tab opens.
export default function PrivacyNoticeLink({ newTab = false }) {
  if (!privacyPublished) return null;
  return (
    <>
      {" "}Read our{" "}
      {newTab ? (
        <a href="/privacy" target="_blank" rel="noopener noreferrer">
          Privacy Notice<span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <a href="/privacy">Privacy Notice</a>
      )}
      .
    </>
  );
}
