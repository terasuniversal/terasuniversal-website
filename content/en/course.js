// English interface copy for the Hybrid Premium V2 course-detail pages (Phase S4B). Only labels live here; the verified
// course content itself (title, summary, duration, delivery, assessment, completion, audience, entry requirements,
// objectives, modules) stays in data/courseCatalog.js and is shown as written, never rewritten or translated here.
// A Bahasa Melayu module (content/ms/course.js, same keys) can be added later without touching the components.
// Every string is the wording the course page already published before S4B (headings, eyebrows, buttons, the WhatsApp
// greeting and the session-section copy); only the order of sections changed.
export const courseContent = {
  breadcrumb: { home: "Home", training: "Training", label: "Breadcrumb" },
  facts: [["Duration", "duration"], ["Delivery", "deliveryMode"], ["Assessment", "assessment"], ["Completion", "completion"]],
  actions: {
    register: "Register Now",
    upcoming: "View Upcoming Training",
    // FT-1A-2: the button now opens the page's own enquiry section, which separates individual and company routes.
    enquire: "Enquire Now",
    whatsapp: "WhatsApp TERAS",
    whatsappHref: (courseTitle) => `https://wa.me/60195193834?text=${encodeURIComponent(`Hi TERAS, saya berminat dengan ${courseTitle}.`)}`,
  },
  overview: { eyebrow: "Course Overview", title: "Course details" },
  audience: { eyebrow: "Who Should Attend" },
  objectives: { eyebrow: "Learning Objectives", title: "What participants will build." },
  entry: { eyebrow: "Entry Requirements", title: "Before attending." },
  modules: { eyebrow: "Course Outline", title: "Learning modules" },
  sessions: {
    eyebrow: "Public Sessions",
    title: "Choose a training date.",
    text: "Review the available sessions below. Registration availability is checked from TERAS training records.",
    venueLabel: "Location",
    feeLabel: "Fee",
    unavailable: { eyebrow: "Upcoming Training", title: "Training dates are temporarily unavailable.", text: "Please try again shortly or contact TERAS for assistance.", cta: { label: "Contact TERAS", href: "/request-proposal" } },
  },
  final: {
    eyebrow: "Upcoming Training",
    title: (courseTitle) => `Looking for a date for ${courseTitle}?`,
    text: "Review confirmed public sessions or send an enquiry for your workforce. Registration is arranged with the TERAS team.",
  },
  industries: {
    eyebrow: "Industry Context",
    title: "Explore relevant industry solutions.",
    text: "See how TERAS connects this programme to the operating needs of the sectors it supports.",
    cardEyebrow: "Industry",
    more: "Explore solutions",
  },
  related: { eyebrow: "Related Courses", title: "Continue your competency pathway.", audience: "Suitable for", more: "View Course" },
  // FT-1A-2 (owner-approved): photo credit, the published-FAQ selection (exact questions from data/faq.js; no answer is
  // written here) and the three enquiry routes. The /contact note states that form's existing email requirement.
  photoCredit: "Photograph: TERAS UNIVERSAL training, Kedah, Malaysia.",
  faq: {
    eyebrow: "Frequently Asked Questions",
    title: "Questions about this course.",
    all: "View all FAQs",
    questions: [
      "Do participants receive a certificate?",
      "Are programmes suitable for beginners?",
      "Do you provide practical training?",
      "Can training dates be arranged according to our schedule?",
      "Can training be conducted at our company site?",
      "How can we request a quotation?",
    ],
  },
  paths: {
    eyebrow: "Enquire Now",
    title: "Choose how to contact TERAS.",
    individual: {
      title: "Individual enquiry",
      text: "Ask about dates, fees and entry requirements for yourself.",
      note: "Uses the TERAS contact form. An email address is required there; choose the course in the form.",
      cta: "Send an Enquiry",
      href: "/contact",
    },
    company: {
      title: "Company or group training",
      text: "Request a quotation for in-house or group training for your organisation.",
      note: "Uses the TERAS corporate proposal form.",
      cta: "Request a Quotation",
    },
    registration: {
      title: "Online registration",
      open: { text: "Choose a confirmed public session and register online.", cta: "Register Now" },
      closed: { text: "Online registration is not open at the moment. View upcoming sessions or use the options here.", cta: "View Upcoming Training" },
    },
    sticky: { label: "Quick enquiry", enquire: "Enquire Now", whatsapp: "WhatsApp" },
  },
  // S6: articles from News & Articles that name this course in their relatedCourses (full articles only).
  reading: { eyebrow: "Related Reading", title: "Articles on this topic.", more: "Read article", all: "All news & articles" },
};
