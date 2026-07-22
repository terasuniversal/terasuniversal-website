export const brand = {
  navy: "#0B2C56",
  white: "#FFFFFF",
  gold: "#E1A925",
  tagline: "Building Competence. Creating Opportunities.",
};

// Verified against: TERAS UNIVERSAL Corporate Profile 2026 (official PDF).
export const companyProfile = {
  name: "TERAS UNIVERSAL SDN. BHD.",
  description: "A Malaysian industrial safety training and consultancy company dedicated to developing competent, safety-conscious and industry-ready professionals across the Oil & Gas, Construction, Petrochemical, Manufacturing, Marine and Heavy Industries sectors.",
  established: 2012,
  contact: {
    email: "training@terasuniversal.com.my",
    phone: "+60 19-519 3834",
    address: "Lot 1961 Kg Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah Darul Aman, Malaysia",
  },
  vision: "To become a leading industrial safety training and competency assessment provider recognised by local and international industries for developing competent, skilled and safety-focused professionals.",
  mission: [
    "To deliver high-quality industrial safety training, competency assessment and consultancy services that meet industry standards and regulatory requirements.",
    "To develop skilled, competent and industry-ready personnel through practical, innovative and outcome-based learning.",
    "To promote workplace safety, professionalism and continuous learning across all industries.",
    "To support organisations in enhancing workforce capability, operational excellence and sustainable business growth.",
    "To build long-term strategic partnerships by providing reliable training solutions that create lasting value for our clients and stakeholders.",
  ],
};

// Verified — official TERAS acronym, Corporate Profile 2026 "Vision, Mission & Core Values".
export const coreValues = [
  { letter: "T", title: "Teamwork", text: "We believe collaboration, mutual respect and strong partnerships are essential to achieving shared success." },
  { letter: "E", title: "Excellence", text: "We continuously strive for the highest standards in training quality, service delivery and customer satisfaction." },
  { letter: "R", title: "Responsibility", subtitle: "Safety & Integrity", text: "We place safety at the heart of everything we do while upholding honesty, transparency, accountability and ethical conduct." },
  { letter: "A", title: "Advancement", subtitle: "Continuous Improvement", text: "We embrace innovation, lifelong learning and continuous enhancement to remain relevant in an ever-evolving industry." },
  { letter: "S", title: "Skill & Competency", text: "We are committed to developing knowledgeable, skilled and competent professionals who meet industry expectations." },
  { letter: "I", title: "Integrity", text: "We uphold honesty, transparency, accountability and ethical conduct in every relationship and business decision." },
];

// Verified — Corporate Profile 2026 "Recognition & Accreditations".
export const accreditations = [
  { org: "JKKP (DOSH)", label: "Approved Training Provider", text: "Registered with the Department of Occupational Safety and Health Malaysia (JKKP) as an approved training provider to conduct occupational safety and health training programmes in accordance with the latest regulations and industry standards." },
  { org: "HRD Corp", label: "Registered Training Provider", text: "Registered with HRD Corp and approved to deliver training programmes under the Human Resources Development Fund (SBL / HRD Corp Claimable) for eligible courses." },
  { org: "CIDB Malaysia", label: "Registered Training Provider", text: "Registered with the Construction Industry Development Board Malaysia (CIDB) as an approved training provider to deliver construction industry-related training programmes." },
  { org: "MOF", label: "Registered Supplier", text: "Registered with the Ministry of Finance Malaysia (MOF) as an approved supplier for training, courses and development programmes for government agencies and departments." },
  { org: "SSM", label: "Company Registration", text: "Incorporated under the Companies Commission of Malaysia (SSM) as TERAS UNIVERSAL Sdn. Bhd. since 2012." },
];

// Verified — Corporate Profile 2026 leadership pages. Approved personnel only.
export const leadership = [
  {
    name: "Mohd Latifi Amir Bin Abu Bakar",
    role: "Director",
    credential: "DOSH Registration No. JKKP: KD/17/PP/03/2",
    bio: "Began his career in the scaffolding industry in 1991, working across maintenance, construction, petrochemical and offshore projects throughout Malaysia. Progressed from Scaffolder and Scaffolding Foreman to instructor at Akademi Binaan Malaysia (ABM) Wilayah Utara (2001–2006), and served as a guest trainer and assessor for government and private training institutions. Founded TERAS UNIVERSAL in 2012 to provide quality industrial safety training, competency development and consultancy services.",
  },
  {
    name: "Nor Zalikha binti Mohd Latifi Amir",
    role: "Manager",
    bio: "Leads the overall management and daily operations of TERAS UNIVERSAL, ensuring the efficient delivery of industrial safety training programmes and corporate services. Responsible for business development, corporate partnerships, marketing strategy, client relationship management and operational planning across the Oil & Gas, Construction and Industrial sectors.",
    focusAreas: ["Business Development", "Corporate Sales & Marketing", "Client Relationship Management", "Operations & Training Management"],
  },
];

// Verified — Director's career milestones, Corporate Profile 2026 "Our Leadership".
export const timeline = [
  { year: "1991", text: "Started career as a Scaffolder (Maintenance Industry)." },
  { year: "1993–1995", text: "Scaffolding Foreman, Aiman Construction." },
  { year: "1996–1999", text: "Manjamas Construction." },
  { year: "1999", text: "Offshore Projects, Kerteh, Terengganu." },
  { year: "2001", text: "Bechtel Bina." },
  { year: "2001–2006", text: "Instructor, Akademi Binaan Malaysia (ABM) Wilayah Utara." },
  { year: "—", text: "Guest Trainer & Assessor, Government & Private Training Centres." },
  { year: "2012", text: "Founded TERAS UNIVERSAL Sdn. Bhd." },
];

// Verified — Corporate Profile 2026 "Training Facilities & Participant Support" (Module 29).
export const trainingFacilities = [
  { title: "Modern Training Classroom", text: "Equipped with presentation equipment and modern learning resources to support structured theory sessions and knowledge development." },
  { title: "Practical Training Yard", text: "A dedicated yard with industry-relevant equipment that simulates real workplace conditions for hands-on practical training." },
  { title: "Comfortable Accommodation", text: "Hostel accommodation is available for participants travelling from outside the local area." },
  { title: "Meals & Refreshments", text: "Meals and refreshments are provided daily throughout the training programme." },
  { title: "Personal Protective Equipment", text: "PPE is provided for all practical training sessions to ensure participant safety." },
  { title: "Participant Support", text: "Our team provides registration assistance, course administration and guidance before, during and after training." },
];

// Verified — Corporate Profile 2026 "Valued Clients" section, listed there under
// "Other Valued Partners" (distinct from the industry client lists used on
// /industries/[slug]). Module 31.
export const partners = [
  { name: "Universiti Kuala Lumpur (UniKL)", text: "Academic and training collaboration supporting industrial competency development." },
  { name: "Lembaga Kemajuan Wilayah Kedah (KEDA)", text: "Regional development partnership supporting workforce and industrial capability in Kedah." },
];

// Confirmed facts only — safe to publish as-is, sourced from the 2026 Corporate Profile
// and Training Course Catalogue. Do not add anything here that isn't directly stated
// in an official TERAS UNIVERSAL document.
export const confirmedFacts = [
  "Established 2012",
  "JKKP (DOSH) Approved Training Provider",
  "HRD Corp Registered Training Provider",
  "CIDB Malaysia Registered Training Provider",
  "MOF Registered Supplier",
  "SSM Registered Company (since 2012)",
];

// Still NOT verified by any official TERAS UNIVERSAL document as of the 2026 profile
// and course catalogue. Per Module 24, these must stay hidden or shown only as
// placeholders — never published as real numbers until the client confirms them.
export const pendingClaims = [
  "25+ professionals",
  "G3 CIDB licence or registration",
  "70% practical / 30% theory methodology",
  "4 assessors",
  "10,000+ workers trained",
  "200+ corporate clients",
  "ISO-aligned or ISO certification claims",
];
