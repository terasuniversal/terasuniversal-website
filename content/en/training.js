// English interface copy for the Hybrid Premium V2 training catalogue (/training, Phase S4C). Components read their text
// from here so a Bahasa Melayu module (content/ms/training.js, same keys) can be added later without touching them.
// Every string is the wording /training already published before S4C, plus the official TERAS slogan (brand.tagline in
// data/companyProfile.js) and an "AI-generated illustration" caption on the existing hero image (the gallery page already
// identifies it as an AI illustration). Course facts are not here: they come from data/courseCatalog.js.
export const trainingContent = {
  slogan: "Building Competence. Creating Opportunities.",
  hero: {
    eyebrow: "Training Programmes",
    title: "Practical Training for Safer and More Competent Workforces",
    lead: "Explore TERAS public course pages, then review available sessions or discuss an arrangement for your workforce.",
    primary: { label: "View Training", href: "#course-catalogue" },
    secondary: { label: "Request Corporate Training", href: "/request-proposal?source=training-hero" },
    featuresLabel: "Training strengths",
    features: ["Practical Delivery", "Industry Focused", "Competency Based", "Custom Programmes"],
    image: { src: "/images/v2/delivery-instructor-led-male-branded.webp", alt: "An instructor holds up a scaffold coupler to a classroom of eight trainees taking notes", caption: "AI-generated illustration" },
  },
  catalogue: {
    eyebrow: "Course Catalogue",
    title: "Find a verified public course page.",
    text: "Each course below has its own public detail page. Other workforce requirements can be discussed directly with TERAS.",
    allCategories: "All Programmes",
    filterLabel: "Filter training courses",
    count: (n) => `${n} public course${n === 1 ? "" : "s"} available`,
    duration: "Duration",
    audience: "Suitable for",
    more: "View Course",
    custom: {
      category: "Custom solution",
      title: "Custom Corporate Training",
      summary: "Tell us about your workforce, site requirements and intended outcomes, and our team will propose a suitable arrangement.",
      more: "Enquire About Training",
      source: "training-catalogue",
    },
  },
  delivery: {
    eyebrow: "Delivery Options",
    title: "A flexible arrangement for every organisation.",
    text: "Public course details and calendar entries are published separately from custom, in-house and onsite arrangements.",
    options: [
      ["01", "Public Programme", "Scheduled learning for individuals and employees from different organisations."],
      ["02", "In-House Training", "A focused programme delivered exclusively for one organisation or workforce group."],
      ["03", "Onsite Training", "Practical learning arranged at a client workplace, plant, project site or approved facility."],
      ["04", "Competency Assessment", "Structured theoretical and practical evaluation against defined requirements."],
    ],
  },
  corporate: {
    eyebrow: "Corporate & Custom Solutions",
    title: "Need a Programme Built Around Your Workforce?",
    text: "Discuss a customised training solution aligned with your operational requirements, participant profile and delivery arrangement.",
    primary: { label: "Request Corporate Training", href: "/request-proposal?source=training-corporate" },
    whatsapp: { label: "WhatsApp TERAS", href: "https://wa.me/60195193834?text=Hi%20TERAS%2C%20saya%20ingin%20bertanya%20tentang%20latihan%20korporat." },
  },
};
