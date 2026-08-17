import Link from "next/link";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { getAutomationSettings } from "../actions";
import { SettingsForm } from "./SettingsForm";

export const metadata = { title: "Automation Settings — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function AutomationSettingsPage() {
  await requireRole("admin");
  await requireModuleAccess("automation");
  const values = await getAutomationSettings();

  return (
    <>
      <PageHead
        title="System Settings"
        subtitle="Configure ID prefixes, timezone and default formats used across the platform."
        action={<Link href="/admin/automation" className="ta-btn ta-btn-outline">← Automation Centre</Link>}
      />
      <SettingsForm values={values} />
    </>
  );
}
