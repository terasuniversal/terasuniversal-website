"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field } from "../../../../components/admin/ui";
import type { FaqFormState } from "./actions";

export function FaqForm({ action, categories, item }: { action: (state: FaqFormState, formData: FormData) => Promise<FaqFormState>; categories: any[]; item?: any }) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="ta-form" style={{ maxWidth: 820 }}>{state.message ? <div className="ta-alert ta-alert-error">{state.message}</div> : null}
    <Field label="Question" name="question"><input id="question" name="question" defaultValue={item?.question ?? ""} required /></Field>
    <Field label="Answer" name="answer"><textarea id="answer" name="answer" rows={8} defaultValue={item?.answer ?? ""} required /></Field>
    <div className="ta-field-row"><Field label="Category" name="category_id"><select id="category_id" name="category_id" defaultValue={item?.category_id ?? ""}><option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Status" name="status"><select id="status" name="status" defaultValue={item?.status ?? "draft"}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></Field><Field label="Order" name="sort_order"><input id="sort_order" name="sort_order" type="number" defaultValue={item?.sort_order ?? 0} /></Field></div>
    <div className="ta-form-actions"><Link href="/admin/faq" className="ta-btn ta-btn-outline">Cancel</Link><button className="ta-btn ta-btn-primary" disabled={pending}>{pending ? "Saving..." : "Save FAQ"}</button></div>
  </form>;
}
