import { redirect } from "next/navigation";

/** Default protected admin destination. */
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
