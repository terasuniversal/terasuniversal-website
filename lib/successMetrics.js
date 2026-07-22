import { accreditations } from "../data/companyProfile";
import { industries } from "../data/industries";
import { comparableCourses } from "../data/courseCatalog";

// Module 24 — Success Metrics.
//
// Every number here is COMPUTED from data already verified against the
// official TERAS UNIVERSAL Corporate Profile 2026 / Training Course
// Catalogue 2026 documents (companyProfile.js, industries.js,
// courseCatalog.js) — nothing is hardcoded or estimated. This keeps the
// figures self-updating (e.g. years in operation) and prevents drift if
// those source files are edited later.
//
// Explicitly NOT included here: trainee/participant counts, satisfaction
// percentages, or any "10,000+ trained" style claim — none of those are
// stated in the verified source documents, so per the no-fabrication rule
// they are omitted entirely rather than estimated.

const ESTABLISHED_YEAR = 2012;

export function getSuccessMetrics() {
  const yearsInOperation = new Date().getFullYear() - ESTABLISHED_YEAR;

  const uniqueClients = new Set();
  industries.forEach((industry) => industry.clients.forEach((client) => uniqueClients.add(client)));

  return [
    { value: `${yearsInOperation}+`, label: "Years in Operation", detail: `Established ${ESTABLISHED_YEAR}` },
    { value: `${uniqueClients.size}`, label: "Organisations Served", detail: "Named clients across supported sectors" },
    { value: `${industries.length}`, label: "Industries Supported", detail: "Oil & Gas, Construction, Manufacturing and more" },
    { value: `${accreditations.length}`, label: "Regulatory Accreditations", detail: "JKKP, HRD Corp, CIDB, MOF, SSM" },
    { value: `${comparableCourses().length}`, label: "Verified Scaffolding Programmes", detail: "Full spec-sheet competency levels" },
  ];
}
