"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { fieldErrors, newsSchema } from "../../../../lib/validation/schemas";

export type NewsFormState = { errors?: Record<string, string>; message?: string };

function readForm(formData: FormData) {
  return { title: String(formData.get("title") ?? ""), slug: String(formData.get("slug") ?? ""), excerpt: String(formData.get("excerpt") ?? ""), body: String(formData.get("body") ?? ""), category_id: String(formData.get("category_id") ?? ""), featured_image_url: String(formData.get("featured_image_url") ?? ""), featured: formData.get("featured") === "on", status: String(formData.get("status") ?? "draft"), seo_title: String(formData.get("seo_title") ?? ""), seo_description: String(formData.get("seo_description") ?? "") };
}

async function save(id: string | null, _prev: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const profile = await requireRole("editor");
  const parsed = newsSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const payload: any = { ...parsed.data, category_id: parsed.data.category_id || null, featured_image_url: parsed.data.featured_image_url || null, published_at: parsed.data.status === "published" ? new Date().toISOString() : null, author_id: profile.id };
  const supabase = await createSupabaseServerClient();
  const query = id ? (supabase.from("news_posts") as any).update(payload).eq("id", id) : (supabase.from("news_posts") as any).insert(payload);
  const { error } = await query;
  if (error) return { errors: error.code === "23505" ? { slug: "This slug is already in use." } : undefined, message: error.code === "23505" ? undefined : error.message };
  revalidatePath("/admin/news"); revalidatePath("/insights");
  redirect("/admin/news");
}

export async function createNews(prev: NewsFormState, formData: FormData) {
  return save(null, prev, formData);
}

export async function updateNews(id: string, prev: NewsFormState, formData: FormData) {
  return save(id, prev, formData);
}

export async function archiveNews(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase.from("news_posts") as any).update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Unable to archive article.");
  revalidatePath("/admin/news"); revalidatePath("/insights");
}
