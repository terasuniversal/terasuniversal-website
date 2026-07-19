const resources = [
  { title: "Company Profile", text: "A concise overview of TERAS UNIVERSAL, our capabilities and the industries we support.", action: "Download PDF", href: "/downloads/TERAS-UNIVERSAL-Company-Profile.pdf", note: "PDF · Corporate profile" },
  { title: "Course Catalogue", text: "Explore industrial safety, technical competency and workforce development programmes.", action: "View training", href: "/training", note: "Online catalogue" },
  { title: "Training Calendar", text: "Browse scheduled public programmes and review current delivery windows.", action: "View calendar", href: "/calendar", note: "Upcoming sessions" },
  { title: "Corporate Enquiry Form", text: "Share your organisation's training needs and receive a suitable proposal pathway.", action: "Request proposal", href: "/request-proposal", note: "Guided enquiry" },
];

export const metadata = { title: "Resources", description: "TERAS UNIVERSAL corporate resources, course information and training materials.", alternates: { canonical: "/resources" } };

export default function ResourcesPage() {
  return <main className="utility-page"><div className="container utility-container"><span className="eyebrow">Resources Centre</span><h1>Useful information for better training decisions.</h1><p className="utility-lead">Access corporate information and training resources, or speak with our team when you need a tailored recommendation.</p><div className="resource-grid">{resources.map(({ title, text, action, href, note }, index) => <article className="resource-card" key={title}><span className="resource-number">{String(index + 1).padStart(2, "0")}</span><span className="resource-note">{note}</span><h2>{title}</h2><p>{text}</p><a href={href}>{action} <span aria-hidden="true">&rarr;</span></a></article>)}</div></div></main>;
}
