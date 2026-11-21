// FT-1B (owner-approved, 21 Nov 2026): interface copy for the three-step Request a Proposal wizard
// (components/ProposalWizard.js). Labels only; a Bahasa Melayu module (content/ms/proposal.js, same keys) can follow.
// The consent sentence and the privacy note are NOT here: scripts/s5b1b-round2-contract.mts, w2-privacy-approved.mts and
// privacy-publication-contract.mts pin that exact wording inside ProposalWizard.js. Nothing here promises a response time
// or names a certification, accreditation or regulator.
export const proposalContent = {
  steps: [
    { key: "organisation", label: "Organisation", title: "About your organisation", lead: "We use these details only to prepare and follow up on this proposal." },
    { key: "training", label: "Training need", title: "Your training need", lead: "Choose a course from the TERAS catalogue, or describe what you need." },
    { key: "review", label: "Review", title: "Review and send", lead: "Check your details. You can edit any section before sending." },
  ],
  stepOf: (current, total) => `Step ${current} of ${total}`,
  optional: "(optional)",
  fields: {
    companyName: "Company name",
    industry: "Industry",
    industryPlaceholder: "Select an industry",
    contactPerson: "Contact person",
    jobTitle: "Job title",
    email: "Business email",
    phone: "Phone number",
    category: "Training category",
    categoryPlaceholder: "Select a category",
    course: "Course",
    coursePlaceholder: "Select a course",
    courseOther: "Not sure yet / other",
    courseHint: "From the published TERAS course catalogue.",
    programmeOther: "Describe the programme you need",
    participants: "Number of participants",
    month: "Preferred month",
    monthHint: "An initial preference only; TERAS confirms availability with you.",
    location: "Training location",
    locationOptions: ["At our site", "TERAS training centre", "To be discussed"],
    locationDetail: "Location details",
    locationDetailHint: "For example the city, site or facility.",
    budget: "Budget range",
    budgetHint: "Helps us shape the proposal. Leave blank if not yet known.",
    objectives: "What should the training achieve?",
    notes: "Other requirements",
  },
  errors: {
    required: (label) => `${label} is required.`,
    email: "Enter a valid business email address.",
    participants: "Enter a whole number of at least 1.",
    month: "Choose a month, or leave this blank.",
    consent: "Please confirm before submitting.",
    summary: "Please check the following before continuing:",
  },
  review: {
    edit: "Edit",
    notProvided: "Not provided",
    sections: { organisation: "Organisation", training: "Training need" },
    labels: {
      companyName: "Company", industry: "Industry", contactPerson: "Contact person", jobTitle: "Job title", email: "Email", phone: "Phone",
      category: "Category", programme: "Course / programme", participants: "Participants", location: "Location", month: "Preferred month",
      budget: "Budget", objectives: "Objectives", notes: "Other requirements",
    },
  },
  actions: { back: "Back", next: "Continue", review: "Review request", submit: "Submit Proposal Request", sending: "Sending..." },
  status: { sending: "Sending your request securely...", failed: "We could not send your request. Please try again.", retry: "You can correct any detail and submit again." },
  aside: {
    title: "How it works",
    steps: ["Tell us about your organisation.", "Describe your training need.", "Review and send."],
    contact: "Prefer to talk first?",
    whatsapp: { label: "WhatsApp TERAS", href: "https://wa.me/60195193834" },
    email: "admin@terasuniversal.com.my",
  },
  honeypot: "Leave this field empty",
};
