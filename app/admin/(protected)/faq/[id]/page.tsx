import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { archiveFaq, updateFaq } from "../actions";
import { FaqForm } from "../FaqForm";
export default async function EditFaqPage({ params }: { params: Promise<{ id: string }> }) { await requireRole("editor"); const { id } = await params; const supabase = await createSupabaseServerClient(); const [{ data: item }, { data: categories }] = await Promise.all([(supabase.from("faqs") as any).select("*").eq("id", id).maybeSingle(), (supabase.from("faq_categories") as any).select("id,name").order("sort_order")]); if (!item) notFound(); return <><PageHead title="Edit FAQ" /><FaqForm action={updateFaq.bind(null, id)} categories={categories ?? []} item={item} /><form action={archiveFaq.bind(null, id)} style={{ marginTop: 24 }}><button className="ta-btn ta-btn-outline" type="submit">Archive FAQ</button></form></>; }
