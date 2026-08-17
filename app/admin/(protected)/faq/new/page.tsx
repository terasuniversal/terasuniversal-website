import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { createFaq } from "../actions";
import { FaqForm } from "../FaqForm";
export default async function NewFaqPage() { await requireRole("editor"); await requireModuleAccess("faq"); const supabase = await createSupabaseServerClient(); const { data } = await (supabase.from("faq_categories") as any).select("id,name").order("sort_order"); return <><PageHead title="New FAQ" subtitle="Add an answer for website visitors." /><FaqForm action={createFaq} categories={data ?? []} /></>; }
