/**
 * Reusable lead-generation call-to-action banner (Module 26).
 *
 * Several content pages (FAQ Centre, Training Calendar, News & Insights,
 * Search) had no path back into the enquiry funnel at all — a visitor could
 * read the content and then have nowhere obvious to go next. This banner
 * gives every one of those pages a consistent route into the existing
 * Request Proposal workflow and WhatsApp contact, without touching that
 * workflow itself.
 */
export default function LeadGenCta({ title = "Ready to discuss your training requirements?", text = "Speak with our team about your organisation's needs, or send a proposal request and we will follow up with a suitable recommendation." }) {
  return (
    <div className="leadgen-cta">
      <div className="leadgen-cta-copy">
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <div className="hero-actions">
        <a className="btn btn-primary" href="/request-proposal">Request Proposal</a>
        <a className="btn btn-outline" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us</a>
      </div>
    </div>
  );
}
