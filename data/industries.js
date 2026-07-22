// Verified against "TERAS UNIVERSAL Corporate Profile 2026" (Sectors Served, Section 1;
// Valued Clients, Section 11). Client names are shown ONLY for the sectors that have a
// verified, named client list in that document. Sectors without a named client list still
// get a landing page (they are explicitly listed as sectors TERAS UNIVERSAL serves), but the
// clients array is left empty so the page hides that section rather than inventing names.
//
// This list intentionally matches the 8 industry cards already shown on the homepage
// (`app/page.js`, `#industries` section) so both places stay in sync from one source of truth.

export const industries = [
  {
    slug: "oil-gas",
    name: "Oil & Gas",
    fullName: "Oil & Gas, Energy & Offshore",
    summary: "Competency-based safety training for maintenance, construction and offshore work in high-risk oil & gas environments.",
    focus: "Scaffolding access, working at height, confined space entry and lifting operations are everyday realities on oil & gas and offshore sites. Our programmes are built around the practical, regulatory and safety demands of this sector.",
    relevantCourseSlugs: ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3", "working-at-height", "confined-space-safety", "lifting-awareness"],
    clients: ["Dayang Enterprise Sdn. Bhd.", "Omni Offshore Terminals", "PGEO Prai", "Trident Quantum Sdn. Bhd.", "Vesstech Synergy", "Veestech Sdn. Bhd."],
  },
  {
    slug: "construction",
    name: "Construction",
    fullName: "Construction & Engineering",
    summary: "Scaffolding competency, working at height and site safety training aligned with CIDB-registered construction requirements.",
    focus: "From scaffolders to site supervisors, construction teams need structured, verifiable competency at every level. Our CIDB-registered programmes support crews from first entry through to inspection-level responsibility.",
    relevantCourseSlugs: ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3", "scaffolding-inspector-basic", "scaffolding-inspector-intermediate", "scaffolding-inspector-advanced", "working-at-height", "safety-passport"],
    clients: ["HSL Ground Engineering", "Kerjaya Prospek (M) Sdn. Bhd.", "Kok Construction (M) Sdn. Bhd.", "CKK Construction", "SBAR Bina Sdn. Bhd.", "UCM Construction Sdn. Bhd.", "Teraju Construction Sdn. Bhd.", "Daya Kencana Engineering", "Trucomp Engineering Sdn. Bhd.", "Teknik Mudah Sdn. Bhd.", "Asiatech Scaffold", "PMG Access"],
  },
  {
    slug: "petrochemical",
    name: "Petrochemical",
    fullName: "Petrochemical",
    summary: "Safety-critical scaffolding, confined space and working-at-height competency for petrochemical facility environments.",
    focus: "Petrochemical facilities demand disciplined, verifiable safety competency across contractors and maintenance teams. Our scaffolding and OSH programmes are built to support that standard.",
    relevantCourseSlugs: ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "confined-space-safety", "working-at-height", "safety-passport"],
    clients: [],
  },
  {
    slug: "power-utilities",
    name: "Power & Utilities",
    fullName: "Power & Utilities",
    summary: "Working at height, confined space and safety passport training for personnel operating in power and utilities environments.",
    focus: "Utilities work often combines elevated access, confined spaces and lifting operations. Our programmes build the competency and hazard awareness this environment requires.",
    relevantCourseSlugs: ["working-at-height", "confined-space-safety", "safety-passport", "lifting-awareness"],
    clients: [],
  },
  {
    slug: "manufacturing",
    name: "Manufacturing",
    fullName: "Industrial, Manufacturing & Technical Services",
    summary: "Practical, competency-based safety and technical training for manufacturing and industrial technical service teams.",
    focus: "Manufacturing and technical service teams rely on consistent, practical safety discipline. Our programmes connect classroom understanding with hands-on, workplace-relevant practice.",
    relevantCourseSlugs: ["safety-passport", "working-at-height", "confined-space-safety", "lifting-awareness", "basic-scaffolder-level-1"],
    clients: ["HSE Venture Sdn. Bhd.", "KN Global (M) Sdn. Bhd.", "INAZUME (M) Sdn. Bhd.", "Meccilent Sdn. Bhd.", "DY MNG Sdn. Bhd.", "RM Leopard Sdn. Bhd.", "Paradigma Cemerlang", "Evolusi Bersatu", "Asian Kaliber Sdn. Bhd.", "Budi Prima Resources", "Solid Ventura Resources (SVR)", "Primala"],
  },
  {
    slug: "marine-offshore",
    name: "Marine & Offshore",
    fullName: "Marine & Offshore",
    summary: "Scaffolding, working at height and confined space competency for marine and offshore work environments.",
    focus: "Marine and offshore projects share many of the same access, confined-space and lifting risks as oil & gas work. Our programmes are built around those same practical safety demands.",
    relevantCourseSlugs: ["basic-scaffolder-level-1", "working-at-height", "confined-space-safety", "lifting-awareness"],
    clients: [],
  },
  {
    slug: "heavy-industry",
    name: "Heavy Industry",
    fullName: "Heavy Industry",
    summary: "Scaffolding, lifting awareness and safety passport training for heavy industrial work environments.",
    focus: "Heavy industrial sites combine complex access, lifting and equipment risks. Our programmes build the layered competency this environment requires, from entry-level awareness to inspection responsibility.",
    relevantCourseSlugs: ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "lifting-awareness", "safety-passport"],
    clients: [],
  },
  {
    slug: "government-glc",
    name: "Government & GLC",
    fullName: "Government & Government-Linked Companies",
    summary: "MOF-registered, HRD Corp claimable training and consultancy support for government agencies and GLCs.",
    focus: "As an MOF-registered supplier and HRD Corp registered training provider, we support government agencies, GLCs and their contractors with structured training and consultancy engagements.",
    relevantCourseSlugs: ["safety-passport", "working-at-height", "basic-scaffolder-level-1"],
    clients: ["Universiti Kuala Lumpur (UniKL)", "Lembaga Kemajuan Wilayah Kedah (KEDA)"],
  },
];

export const findIndustry = (slug) => industries.find((industry) => industry.slug === slug);
