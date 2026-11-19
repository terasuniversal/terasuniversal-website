// English copy for the Hybrid Premium V2 Training Calendar (Phase S4A). Components read their text from here so a Bahasa
// Melayu module (content/ms/calendar.js, same keys) can be added later without touching them.
// Every string is the wording the calendar page and TrainingCalendar already published before S4A, except: the status
// filter's "Session status" label is now visible (it was screen-reader only), and the closing section links to corporate
// training with the approved R3 wording "Corporate training options".
// Per-session wording (dates, fees, venue, Register / Full / Enquire) is not here: it comes from lib/session-display.ts.
export const calendarContent = {
  meta: {
    title: "Training Calendar",
    description: "Browse TERAS UNIVERSAL training programme dates and delivery options in Malaysia.",
  },
  intro: {
    eyebrow: "Programme Schedule",
    title: "Training Calendar",
    lead: "Browse public sessions arranged through the TERAS training schedule. Where a session is open and priced, you can register online; otherwise, enquire about the next suitable date.",
    // Public-First F-1: shown instead while public online registration is switched off (lib/public-registration-gate.ts).
    leadClosed: "Browse public sessions arranged through the TERAS training schedule and enquire with TERAS about the next suitable date.",
  },
  tool: {
    eyebrow: "Training Calendar",
    title: "Plan the right learning window.",
    textAll: "Browse scheduled public programmes and use the list as a starting point for corporate planning.",
    textCourse: "Showing sessions for your selected course.",
    filterLabel: "Session status",
    filters: ["Upcoming", "Completed", "All"],
    viewsName: "Calendar view",
    views: ["Month", "Week", "List"],
    monthNote: "Scheduled sessions are shown below.",
    weekPrefix: "Week of",
    weekNote: "Review the next scheduled delivery windows.",
    noSession: "No session",
    more: (count) => `+${count} more`,
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    trainingSession: "Training session",
    venueLabel: "Location",
    feeLabel: "Fee",
  },
  states: {
    unavailable: { title: "Training dates are temporarily unavailable.", text: "Please try again shortly or contact TERAS for assistance with upcoming programmes.", cta: { label: "Contact TERAS", href: "/request-proposal" } },
    none: { title: "No training dates published yet.", text: "Public programme dates are confirmed as courses are arranged. Check back soon, or tell us your preferred timing and we will propose a plan.", cta: { label: "Request a Proposal", href: "/request-proposal" } },
    noMatch: { title: "No sessions match this view yet.", text: "Public programme dates are confirmed as courses are arranged. Check back soon, or tell us your preferred timing and we will propose a plan.", cta: { label: "Request a Proposal", href: "/request-proposal" } },
  },
  cta: {
    title: "Don't see a suitable date?",
    text: "We also arrange in-house and customised training windows. Let us know your preferred timing and we'll propose a plan.",
    primary: { label: "Request Proposal", href: "/request-proposal" },
    whatsapp: { label: "WhatsApp Us", href: "https://wa.me/60195193834" },
    corporate: { label: "Corporate training options", href: "/corporate-training" },
  },
};
