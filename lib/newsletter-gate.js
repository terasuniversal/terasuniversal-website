// Public-First launch: newsletter collection is OFF unless TERAS_NEWSLETTER=enabled is set explicitly (fail closed).
// Why off: it collects marketing contacts before a Privacy Notice is published, and /api/newsletter's in-memory
// throttle does not hold across serverless instances (CLAUDE.md section 7). Off hides the signup blocks and makes
// /api/newsletter answer 503 before anything is read or sent. Nothing is deleted: the component, the route, the
// Resend audience and existing subscribers are untouched, so setting the flag (and redeploying) restores it as it was.
export function newsletterEnabled() {
  return process.env.TERAS_NEWSLETTER === "enabled";
}
