"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field } from "../../../../components/admin/ui";
import type { NewsFormState } from "./actions";

export function NewsForm({ action, categories, post }: { action: (state: NewsFormState, formData: FormData) => Promise<NewsFormState>; categories: any[]; post?: any }) {
  const [state, formAction, pending] = useActionState(action, {}); const errors = state.errors ?? {};
  return <form action={formAction} className="ta-form" style={{ maxWidth: 820 }}>
    {state.message ? <div className="ta-alert ta-alert-error">{state.message}</div> : null}
    <div className="ta-field-row"><Field label="Title" name="title" error={errors.title}><input id="title" name="title" defaultValue={post?.title ?? ""} required /></Field><Field label="Slug" name="slug" error={errors.slug} hint="lowercase-with-hyphens"><input id="slug" name="slug" defaultValue={post?.slug ?? ""} required /></Field></div>
    <Field label="Excerpt" name="excerpt" error={errors.excerpt}><textarea id="excerpt" name="excerpt" rows={3} defaultValue={post?.excerpt ?? ""} /></Field>
    <Field label="Article content" name="body" error={errors.body}><textarea id="body" name="body" rows={12} defaultValue={post?.body ?? ""} /></Field>
    <div className="ta-field-row"><Field label="Category" name="category_id"><select id="category_id" name="category_id" defaultValue={post?.category_id ?? ""}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="Status" name="status"><select id="status" name="status" defaultValue={post?.status ?? "draft"}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></Field></div>
    <Field label="Featured image URL" name="featured_image_url" error={errors.featured_image_url}><input id="featured_image_url" name="featured_image_url" type="url" defaultValue={post?.featured_image_url ?? ""} placeholder="https://…" /></Field>
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="featured" defaultChecked={post?.featured} style={{ width: "auto" }} /> Feature this article</label>
    <Field label="SEO title" name="seo_title" error={errors.seo_title}><input id="seo_title" name="seo_title" defaultValue={post?.seo_title ?? ""} /></Field>
    <Field label="SEO description" name="seo_description" error={errors.seo_description}><textarea id="seo_description" name="seo_description" rows={3} defaultValue={post?.seo_description ?? ""} /></Field>
    <div className="ta-form-actions"><Link href="/admin/news" className="ta-btn ta-btn-outline">Cancel</Link><button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>{pending ? "Saving…" : post ? "Save changes" : "Create article"}</button></div>
  </form>;
}
