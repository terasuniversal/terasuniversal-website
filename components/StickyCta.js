"use client";

export default function StickyCta() {
  return (
    <aside className="sticky-cta" aria-label="Quick contact options">
      <a className="sticky-cta-proposal" href="/request-proposal">Request Proposal</a>
      <div className="sticky-cta-mobile">
        <a href="https://wa.me/60195193834" target="_blank" rel="noreferrer" aria-label="WhatsApp TERAS UNIVERSAL">WhatsApp</a>
        <a href="tel:+60195193834" aria-label="Call TERAS UNIVERSAL">Call</a>
        <a href="mailto:training@terasuniversal.com.my" aria-label="Email TERAS UNIVERSAL">Email</a>
      </div>
    </aside>
  );
}
