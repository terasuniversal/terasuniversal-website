import { redirect } from "next/navigation";

/** Compatibility route for the singular URL used by the CRM mockup. */
export default function SchedulePage() {
  redirect("/admin/schedules");
}
