"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";

export type FaqFormState = { message?: string };

function payload(formData: FormData) {
  return {
    question: String(formData.get("question") ?? "").trim().slice(0, 500),
    answer: String(formData.get("answer") ?? "").trim().slice(0, 10000),
    category_id: String(formData.get("category_id") ?? "") || null,
    status: String(formData.get("status") ?? "draft"),
    sort_order: Number(formData.get("sort_order") ?? 0) || 0,
  };
}

async function save(id: string | null, _previous: FaqFormState, formData: FormData): Promise<FaqFormState> {
  await requireRole("editor");
  const data = payload(formData);
  if (data.question.length < 2 || data.answer.length < 2) return { message: "Question and answer are required." };
  const supabase = await createSupabaseServerClient();
  const { error } = id ? await (supabase.from("faqs") as any).update(data).eq("id", id) : await (supabase.from("faqs") as any).insert(data);
  if (error) return { message: error.message };
  revalidatePath("/admin/faq");
  redirect("/admin/faq");
}

export async function createFaq(previous: FaqFormState, formData: FormData) {
  return save(null, previous, formData);
}

export async function updateFaq(id: string, previous: FaqFormState, formData: FormData) {
  return save(id, previous, formData);
}

export async function archiveFaq(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase.from("faqs") as any).update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Unable to archive FAQ.");
  revalidatePath("/admin/faq");
}
