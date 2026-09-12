import { requireModuleAccess, requireRole } from "../../../../../lib/auth/session";
import { NewDownloadForm } from "./NewDownloadForm";

export default async function NewDownloadPage() {
  await requireRole("editor");
  await requireModuleAccess("downloads");
  return <NewDownloadForm />;
}
