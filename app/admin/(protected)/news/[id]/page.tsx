import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { archiveNews, updateNews } from "../actions";
import { NewsForm } from "../NewsForm";

export default async function EditNewsPage({ params }: { params: Promise<{ id: string }> }) { await requireRole("editor"); const { id } = await params; const supabase = await createSupabaseServerClient(); const [{ data: post }, { data: categories }] = await Promise.all([(supabase.from("news_posts") as any).select("*").eq("id", id).is("deleted_at", null).single(), (supabase.from("news_categories") as any).select("id, name").order("sort_order")]); if (!post) notFound(); return <><PageHead title="Edit Article" subtitle="Update the website article." /><NewsForm action={updateNews.bind(null, id)} categories={categories ?? []} post={post} /><form action={archiveNews.bind(null, id)} style={{ marginTop: 24 }}><button className="ta-btn ta-btn-outline" type="submit">Archive article</button></form></>; }
