// English homepage copy for the Hybrid Premium V2 (R3) homepage. Phase S1: structure only; no page imports this yet, so the
// live homepage is unchanged. Visual components should read their text from here, so a Bahasa Melayu module
// (content/ms/home.js, same keys) can be added later without touching components.
//
// Sources, so nothing here is new or unverified:
// - tagline: data/companyProfile.js (brand.tagline)
// - course summaries, delivery wording: the copy already published by components/home/CoreProgrammes.js and DeliveryOptions.js
// - durations and course titles: data/courseCatalog.js (scripts/home-content-contract.mts checks they stay equal)
// - FAQ: questions are taken word for word from data/faq.js, which keeps the answers; this module only chooses which to show
// - contact email: data/companyProfile.js (companyProfile.contact.email)
// Not included until verified: international recognition or accreditation claims, certification eligibility, and the
// R3 "How do I register" answer (the online registration and payment steps need owner confirmation first).

export const homeContent = {
  locale: "en-MY",

  tagline: "Building Competence. Creating Opportunities.",

  hero: {
    title: ["Building Skills.", "Empowering Industry."],
    lead: "Practical industrial training and workforce development for individuals and organisations.",
    primaryCta: { label: "Explore Training Courses", href: "#programmes" },
    secondaryCta: { label: "Corporate Training", href: "/corporate-training" },
    sessionsLink: { label: "See upcoming public sessions", href: "#upcoming-training" },
  },

  header: {
    registerCta: { label: "Register for a Course", shortLabel: "Register", href: "#upcoming-training" },
    // Public-First F-1: shown instead while public online registration is switched off (lib/public-registration-gate.ts).
    registerCtaClosed: { label: "View Upcoming Training", shortLabel: "Sessions", href: "#upcoming-training" },
  },

  courses: {
    title: "Training courses",
    allLink: { label: "View all courses", href: "/training" },
    items: [
      {
        key: "scaffolding",
        title: "Scaffolding Training",
        summary: "Erect, modify, inspect and dismantle scaffolding to industry standards.",
        catalogSlugs: ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3"],
        duration: "10 Days",
        href: "/training/scaffolding-competency",
      },
      {
        key: "inspector",
        title: "Scaffolding Inspector Training",
        summary: "Inspect scaffold structures against standards and report defects and corrective actions.",
        catalogSlugs: ["scaffolding-inspector-basic", "scaffolding-inspector-intermediate", "scaffolding-inspector-advanced"],
        duration: "2 Days",
        href: "/training/scaffolding-inspector-basic",
      },
      {
        key: "working-at-height",
        title: "Working at Height Training",
        summary: "Identify hazards, apply fall prevention and protection, and check and use PPE.",
        catalogSlugs: ["working-at-height"],
        duration: "2 Days",
        href: "/training/working-at-height",
      },
    ],
    detailsLabel: "View Details",
  },

  // Labels around the session list. Per-session wording (Register / Full / Enquire, fees, venue) comes from lib/session-display.ts.
  sessions: {
    title: "Next public sessions",
    intro: "Public sessions are open to individuals and to employees from any organisation.",
    corporateLink: { label: "Training a whole team? See corporate training", href: "/corporate-training" },
    viewAll: { label: "View All Public Sessions", href: "/calendar" },
    askLink: { label: "Ask about a date that suits you", href: "/request-proposal?source=homepage-sessions" },
    dateLabel: "Date",
    venueLabel: "Location",
    feeLabel: "Fee",
    courseDetails: "Course details",
    empty: { title: "Upcoming dates are being confirmed.", text: "Share your preferred timing and we will propose a plan.", cta: { label: "Request a Proposal", href: "/request-proposal" } },
    unavailable: { title: "Training dates are temporarily unavailable.", text: "Please try again shortly or contact TERAS for assistance.", cta: { label: "Contact TERAS", href: "/contact" } },
  },

  corporate: {
    title: "Industrial training for your organisation",
    lead: "Public classes, or a programme built for your workforce, at our centre or at your site.",
    options: [
      { title: "Public programmes", text: "Scheduled programmes for individuals and employees from different organisations." },
      { title: "Corporate in-house training", text: "Customised programmes delivered exclusively for one organisation, department or workforce group." },
      { title: "Onsite training", text: "Training conducted at the client’s workplace, plant, project site or approved operational facility." },
    ],
    cta: { label: "Request a Proposal", href: "/request-proposal?source=homepage-corporate" },
  },

  faq: {
    title: "Frequently asked questions",
    intro: "Short answers to what visitors ask most.",
    // Exact question text from data/faq.js; the answer is read from there.
    questions: [
      "Do you provide in-house corporate training?",
      "Can training be conducted at our company site?",
      "Is accommodation available for participants travelling from outside the area?",
      "Are programmes suitable for beginners?",
      "Do participants receive a certificate?",
      "Can you assist with HRD Corp claims?",
    ],
    requirementsNote: "Entry requirements differ by course and are listed on each course page.",
    moreLink: { label: "All questions", href: "/faq" },
  },

  finalCta: {
    title: "Start with TERAS",
    individuals: { title: "For individuals", text: "Choose a public session that suits you, then register.", cta: { label: "See Public Sessions", href: "/calendar" } },
    organisations: { title: "For organisations", text: "Tell us the course, the number of participants and where you want the training.", cta: { label: "Request a Proposal", href: "/request-proposal" } },
  },

  contact: {
    phoneLabel: "Phone and WhatsApp",
    emailLabel: "Email",
    // Displayed address comes from companyProfile.contact.email; form recipients in app/api/** are separate and unchanged.
  },
};
