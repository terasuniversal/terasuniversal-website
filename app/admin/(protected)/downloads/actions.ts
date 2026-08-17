"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";

export async function createDownload(_: { message?: string }, form: FormData): Promise<{ message?: string }> {
  await requireRole("editor");
  await requireModuleAccess("downloads");
  const title = String(form.get("title") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim();
  const file_url = String(form.get("file_url") ?? "").trim();
  if (title.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^https?:\/\//.test(file_url)) return { message: "Enter a title, lowercase slug and valid file URL." };
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase.from("downloads") as any).insert({ title, slug, file_url, description: String(form.get("description") ?? "").trim() || null, category: String(form.get("category") ?? "").trim() || null, status: String(form.get("status") ?? "draft"), sort_order: Number(form.get("sort_order") ?? 0) || 0 });
  if (error) return { message: error.code === "23505" ? "This slug already exists." : error.message };
  revalidatePath("/admin/downloads"); redirect("/admin/downloads");
}

export async function updateDownload(id: string, _: { message?: string }, form: FormData): Promise<{ message?: string }> {
  await requireRole("editor");
  await requireModuleAccess("downloads");
  const title = String(form.get("title") ?? "").trim();
  const file_url = String(form.get("file_url") ?? "").trim();
  if (title.length < 2 || !/^https?:\/\//.test(file_url)) return { message: "A title and valid file URL are required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase.from("downloads") as any).update({ title, file_url, description: String(form.get("description") ?? "").trim() || null, category: String(form.get("category") ?? "").trim() || null, status: String(form.get("status") ?? "draft") }).eq("id", id);
  if (error) return { message: error.message };
  revalidatePath("/admin/downloads"); redirect("/admin/downloads");
}

export async function archiveDownload(id: string) {
  await requireRole("admin");
  await requireModuleAccess("downloads");
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase.from("downloads") as any).update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Unable to archive document.");
  revalidatePath("/admin/downloads");
}
