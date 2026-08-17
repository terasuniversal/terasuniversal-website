import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { EditDownloadForm } from "./EditDownloadForm";
import { archiveDownload } from "../actions";

export default async function EditDownloadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor"); await requireModuleAccess("downloads"); const { id } = await params; const supabase = await createSupabaseServerClient();
  const { data } = await (supabase.from("downloads") as any).select("*").eq("id", id).maybeSingle(); if (!data) notFound();
  return <><PageHead title="Edit Download" subtitle="Update a document without creating a duplicate record." /><EditDownloadForm item={data} /><form action={archiveDownload.bind(null, id)} style={{ marginTop: 24 }}><button className="ta-btn ta-btn-outline" type="submit">Archive document</button></form></>;
}
