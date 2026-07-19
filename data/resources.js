// Only list resources that genuinely exist and are reachable. Add a new
// download only after the file is uploaded to public/downloads; add a new
// category label here and it will appear automatically in the filter once at
// least one resource uses it.
export const resources = [
  { title: "Company Profile", category: "Company Information", text: "A concise overview of TERAS UNIVERSAL, our capabilities and the industries we support.", action: "Download PDF", href: "/downloads/TERAS-UNIVERSAL-Company-Profile.pdf", note: "PDF · Corporate profile" },
  { title: "Course Catalogue", category: "Training", text: "Explore industrial safety, technical competency and workforce development programmes.", action: "View training", href: "/training", note: "Online catalogue" },
  { title: "Compare Training Programmes", category: "Training", text: "Compare target audience, delivery mode, assessment and completion requirements side by side.", action: "Compare programmes", href: "/training/compare", note: "Comparison tool" },
  { title: "Training Calendar", category: "Training", text: "Browse scheduled public programmes and review current delivery windows.", action: "View calendar", href: "/calendar", note: "Upcoming sessions" },
  { title: "Corporate Enquiry Form", category: "Forms", text: "Share your organisation's training needs and receive a suitable proposal pathway.", action: "Request proposal", href: "/request-proposal", note: "Guided enquiry" },
  { title: "Verify a Certificate", category: "Certification", text: "Confirm the status and validity of a TERAS UNIVERSAL training certificate.", action: "Verify certificate", href: "/verify", note: "Certificate lookup" },
  { title: "FAQ Centre", category: "Guides", text: "Answers to common questions on corporate training, certification, payments and scheduling.", action: "View FAQ", href: "/faq", note: "Searchable FAQ" },
  { title: "Industry Solutions", category: "Corporate Solutions", text: "See recommended services and training for your industry, from Oil & Gas to Government & GLC.", action: "Explore industries", href: "/industries", note: "By industry" },
];
