// Enquiry link builder shared by the homepage, the training calendar, the course pages and the training catalogue, so
// every enquiry URL has one format (/request-proposal?course=&session=&source=).
// Phase S4C: the file's former default export, the PrimaryCtaGroup button group, had no caller after the S4B course page
// moved to Premium V2 actions, so it was removed with its stylesheet (public-phase-one.module.css). The file keeps its
// name so the existing imports of enquiryHref stay unchanged.
export function enquiryHref({ course, source, session } = {}) {
  const params = new URLSearchParams();
  if (course) params.set("course", course);
  if (session) params.set("session", session);
  if (source) params.set("source", source);
  const query = params.toString();
  return query ? `/request-proposal?${query}` : "/request-proposal";
}
