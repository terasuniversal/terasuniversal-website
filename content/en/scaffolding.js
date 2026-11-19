// English copy for the Scaffolding Training category page (/training/scaffolding-competency, Phase S4C-1, owner Option A).
// Category-level wording only: every course fact on the page (title, summary, duration, audience) comes from
// data/courseCatalog.js. Nothing here states a course level, prerequisite, progression, certification outcome, fee,
// schedule or regulatory recognition. Sentences reused from existing published pages are marked with their source.
// A Bahasa Melayu module (content/ms/scaffolding.js, same keys) can be added later without touching the page.
export const scaffoldingContent = {
  meta: {
    title: "Scaffolding Training | TERAS UNIVERSAL",
    description: "Scaffolding and scaffolding inspection courses from the TERAS UNIVERSAL training catalogue, each with its own course page, duration and delivery details.",
  },
  breadcrumb: { home: "Home", training: "Training", label: "Breadcrumb" },
  hero: {
    title: "Scaffolding Training",
    lead: "Scaffolding courses and scaffolding inspection courses from the TERAS training catalogue. Each course has its own page with its duration, delivery, assessment and entry requirements.",
    toCourses: { label: "See the scaffolding courses", href: "#scaffolding-courses" },
    toCatalogue: { label: "View all training courses", href: "/training" },
  },
  courses: {
    eyebrow: "Course Catalogue",
    title: "Scaffolding and inspection courses",
    count: (n) => `${n} courses in this category`,
    pathways: {
      scaffolding: { title: "Scaffolding courses", text: "Courses on erecting, modifying, inspecting and dismantling scaffolding, as described on each course page." },
      inspection: { title: "Scaffolding inspection courses", text: "Courses on inspecting scaffolding structures, as described on each course page." },
    },
    note: "Each course is a separate course with its own page. Entry requirements are listed on each course page.",
  },
  guidance: {
    eyebrow: "Choosing a course",
    title: "Find the details on each course page.",
    items: [
      "Each course page lists the duration, delivery, assessment, completion and entry requirements stated in the TERAS training catalogue.",
      // Source: the Training Calendar intro (content/en/calendar.js).
      "Where a session is open and priced, you can register online; otherwise, enquire about the next suitable date.",
      // Source: the Delivery Options on /training (content/en/training.js).
      "For a workforce group, TERAS can arrange in-house or onsite training.",
    ],
    calendar: { label: "View the training calendar", href: "/calendar" },
  },
  corporate: {
    // Source: the closing section of the pre-S4C-1 page (heading and text unchanged).
    eyebrow: "Corporate Training Solutions",
    title: "Planning Scaffolding Training for Your Workforce?",
    text: "Speak with TERAS UNIVERSAL about participant requirements, delivery arrangements and a customised corporate proposal.",
    primary: { label: "Request Proposal", href: "/request-proposal" },
    whatsapp: { label: "WhatsApp Our Team", href: "https://wa.me/60195193834" },
    corporate: { label: "Corporate training options", href: "/corporate-training" },
  },
};
