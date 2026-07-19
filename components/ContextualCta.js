const VARIANTS = {
  proposal: { eyebrow: "Corporate & Custom Solutions", title: "Ready to strengthen your workforce competency?", text: "Speak with our team about a training or consultancy solution aligned with your operational requirements.", label: "Request a Proposal", href: "/request-proposal" },
  advisor: { eyebrow: "Talk to a Training Advisor", title: "Not sure which programme fits your team?", text: "Share your workforce profile and operational requirements and we will recommend a suitable training pathway.", label: "Contact a Training Advisor", href: "/contact" },
  whatsapp: { eyebrow: "Quick Response", title: "Prefer to talk it through directly?", text: "Message our team on WhatsApp for a fast response to your training or consultancy enquiry.", label: "WhatsApp Our Team", href: "https://wa.me/60195193834", external: true },
  "download-profile": { eyebrow: "Company Profile", title: "Want the full TERAS UNIVERSAL overview?", text: "Download our company profile for a concise summary of our capabilities and the industries we support.", label: "Download Company Profile", href: "/downloads/TERAS-UNIVERSAL-Company-Profile.pdf" },
  register: { eyebrow: "Training Calendar", title: "Ready to register for training?", text: "Browse scheduled public programmes or request a customised in-house or onsite arrangement.", label: "View Training Calendar", href: "/calendar" },
};

export default function ContextualCta({ variant = "proposal", className = "" }) {
  const content = VARIANTS[variant] || VARIANTS.proposal;
  return (
    <section className={`premium-cta-section contextual-cta ${className}`}>
      <div className="container premium-cta">
        <div><span>{content.eyebrow}</span><h2>{content.title}</h2><p>{content.text}</p></div>
        <a className="btn btn-light" href={content.href} target={content.external ? "_blank" : undefined} rel={content.external ? "noreferrer" : undefined}>{content.label}</a>
      </div>
    </section>
  );
}
