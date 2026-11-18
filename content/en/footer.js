// English copy for the Premium footer (Phase S4D-2D). Every link points at a route that exists today (checked by
// scripts/premium-footer-contract.mts); no policy page is linked because none exists yet, and /ebook is not published.
// Display email comes from data/publicContact.js and the tel: number from its phone value; form delivery is separate.
// A Bahasa Melayu module (content/ms/footer.js, same keys) can be added later without touching the component.
export const footerContent = {
  homeLabel: "TERAS UNIVERSAL home",
  logoAlt: "TERAS UNIVERSAL",
  company: "TERAS UNIVERSAL SDN. BHD.",
  // Same wording as data/companyProfile.js brand.tagline (official slogan).
  slogan: "Building Competence. Creating Opportunities.",
  actions: {
    whatsapp: { label: "WhatsApp Our Team", href: "https://wa.me/60195193834", newTab: "(opens in a new tab)" },
    email: { label: "Send an Email" },
  },
  groups: [
    {
      id: "footer-training",
      title: "Training",
      links: [
        ["Training Catalogue", "/training"],
        ["Training Calendar", "/calendar"],
        ["Scaffolding Training", "/training/scaffolding-competency"],
        ["Verify Certificate", "/verify"],
      ],
    },
    {
      id: "footer-services",
      title: "Services",
      links: [
        ["Industrial Safety", "/services#safety"],
        ["Technical Competency", "/services#technical"],
        ["Industrial Consultancy", "/services#consultancy"],
        ["Workforce Development", "/services#workforce"],
        ["Corporate Training", "/corporate-training"],
      ],
    },
    {
      id: "footer-company",
      title: "Company",
      links: [
        ["About TERAS", "/about"],
        ["Industries", "/industries"],
        ["News & Articles", "/insights"],
        ["Resources", "/resources"],
        ["FAQ", "/faq"],
        ["Request a Proposal", "/request-proposal"],
        ["Contact", "/contact"],
      ],
    },
  ],
  contact: {
    id: "footer-contact",
    title: "Contact",
    emailLabel: "Email",
    phoneLabel: "Phone",
    // Owner-confirmed display format; the tel: link uses the international number from data/publicContact.js.
    phoneDisplay: "019-519 3834",
    websiteLabel: "Website",
    website: "www.terasuniversal.com.my",
    // Unchanged from the existing site footer (components/Footer.js).
    address: ["Lot 1961, Jalan Tanah Merah,", "Kg Tanah Merah Dalam,", "06000 Jitra, Kedah, Malaysia"],
  },
  // Same wording as the existing site footer; the year is supplied at render time (S5B-1B Round 1) instead of
  // being hard-coded, so it never goes stale. PremiumFooter passes the current year in Malaysia time.
  copyright: (year) => `© ${year} TERAS UNIVERSAL SDN. BHD. All rights reserved.`,
  aiNote: "Imagery on this website includes AI-generated illustrations. The people shown are not TERAS personnel.",
};
