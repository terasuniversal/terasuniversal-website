/**
 * Shared post-login / post-password-change landing selection.
 *
 * Picks the best admin route from the caller's accessible module keys
 * (get_my_module_access). Priority: dashboard (super/admin/general staff) >
 * attendance (trainers) > sales > sales_leads > reports > news > courses.
 * Falls back to /admin/no-access. Pure function — safe to import from server
 * actions on both the login and change-password flows.
 */
export function resolveLandingRoute(allowed: string[]): string {
  if (allowed.includes("dashboard")) return "/admin/dashboard";
  if (allowed.includes("attendance")) return "/admin/attendance";
  if (allowed.includes("sales")) return "/admin/sales";
  if (allowed.includes("sales_leads")) return "/admin/sales/leads";
  if (allowed.includes("reports")) return "/admin/reports";
  if (allowed.includes("news")) return "/admin/news";
  if (allowed.includes("courses")) return "/admin/courses";
  return "/admin/no-access";
}
