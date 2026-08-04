import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { createNews } from "../actions";
import { NewsForm } from "../NewsForm";

export default async function NewNewsPage() { await requireRole("editor"); const supabase = await createSupabaseServerClient(); const { data: categories } = await (supabase.from("news_categories") as any).select("id, name").order("sort_order"); return <><PageHead title="New Article" subtitle="Create a news or insight article." /><NewsForm action={createNews} categories={categories ?? []} /></>; }
