"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
export type GalleryFormState = { message?: string };
async function save(id: string | null, _p: GalleryFormState, form: FormData): Promise<GalleryFormState> {
  await requireRole("editor"); const image_url = String(form.get("image_url") ?? "").trim();
  if (!/^https?:\/\//.test(image_url)) return { message: "A valid image URL is required." };
  const data = { title: String(form.get("title") ?? "").trim().slice(0, 250) || null, alt_text: String(form.get("alt_text") ?? "").trim().slice(0, 500), image_url, category_id: String(form.get("category_id") ?? "") || null, status: String(form.get("status") ?? "draft"), sort_order: Number(form.get("sort_order") ?? 0) || 0, featured: form.get("featured") === "on" };
  const supabase = await createSupabaseServerClient(); const { error } = id ? await (supabase.from("gallery_images") as any).update(data).eq("id", id) : await (supabase.from("gallery_images") as any).insert(data);
  if (error) return { message: error.message }; revalidatePath("/admin/gallery"); redirect("/admin/gallery");
}
export async function createGalleryItem(p: GalleryFormState, f: FormData) { return save(null, p, f); }
export async function updateGalleryItem(id: string, p: GalleryFormState, f: FormData) { return save(id, p, f); }
export async function archiveGalleryItem(id: string) { await requireRole("admin"); const s = await createSupabaseServerClient(); const { error } = await (s.from("gallery_images") as any).update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw new Error("Unable to archive image."); revalidatePath("/admin/gallery"); }
