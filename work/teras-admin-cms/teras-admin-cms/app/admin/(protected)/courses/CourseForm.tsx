"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Course } from "../../../../lib/supabase/database.types";
import type { CourseFormState } from "./actions";
import { Field } from "../../../../components/admin/ui";

const DELIVERY = [
  ["public", "Public"],
  ["in_house", "In-house"],
  ["onsite", "Onsite"],
  ["online", "Online"],
  ["hybrid", "Hybrid"],
] as const;

/**
 * Shared create/edit form. `action` is a bound server action (create or
 * update-with-id). Works with useActionState for inline field errors.
 */
export function CourseForm({
  action,
  course,
}: {
  action: (prev: CourseFormState, fd: FormData) => Promise<CourseFormState>;
  course?: Course;
}) {
  const [state, formAction, pending] = useActionState<CourseFormState, FormData>(action, {});
  const e = state.errors ?? {};

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 820 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}

      <div className="ta-field-row">
        <Field label="Title" name="title" error={e.title}>
          <input id="title" name="title" defaultValue={course?.title ?? ""} required />
        </Field>
        <Field label="Slug" name="slug" error={e.slug} hint="lowercase-with-hyphens">
          <input id="slug" name="slug" defaultValue={course?.slug ?? ""} required />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Category" name="category" error={e.category}>
          <input id="category" name="category" defaultValue={course?.category ?? ""} />
        </Field>
        <Field label="Duration" name="duration" error={e.duration}>
          <input id="duration" name="duration" defaultValue={course?.duration ?? ""} placeholder="e.g. 2 days" />
        </Field>
      </div>

      <Field label="Summary" name="summary" error={e.summary} hint="Short one-line description for cards">
        <textarea id="summary" name="summary" rows={2} defaultValue={course?.summary ?? ""} />
      </Field>

      <Field label="Overview" name="overview" error={e.overview}>
        <textarea id="overview" name="overview" rows={5} defaultValue={course?.overview ?? ""} />
      </Field>

      <div className="ta-field-row">
        <Field label="Objectives" name="objectives" hint="One per line">
          <textarea id="objectives" name="objectives" rows={4} defaultValue={(course?.objectives ?? []).join("\n")} />
        </Field>
        <Field label="Target Audience" name="target_audience" hint="One per line">
          <textarea id="target_audience" name="target_audience" rows={4} defaultValue={(course?.target_audience ?? []).join("\n")} />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Requirements" name="requirements" hint="One per line">
          <textarea id="requirements" name="requirements" rows={4} defaultValue={(course?.requirements ?? []).join("\n")} />
        </Field>
        <Field label="Modules" name="modules" hint="One module title per line">
          <textarea id="modules" name="modules" rows={4} defaultValue={(course?.modules ?? []).map((m) => m.title).join("\n")} />
        </Field>
      </div>

      <Field label="Delivery Modes" name="delivery_modes">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {DELIVERY.map(([val, label]) => (
            <label key={val} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 500 }}>
              <input
                type="checkbox"
                name="delivery_modes"
                value={val}
                defaultChecked={course?.delivery_modes?.includes(val as any)}
                style={{ width: "auto" }}
              />
              {label}
            </label>
          ))}
        </div>
      </Field>

      <div className="ta-field-row">
        <Field label="Fee (RM, optional)" name="fee" error={e.fee}>
          <input id="fee" name="fee" type="number" step="0.01" min="0" defaultValue={course?.fee ?? ""} />
        </Field>
        <Field label="Sort order" name="sort_order">
          <input id="sort_order" name="sort_order" type="number" defaultValue={course?.sort_order ?? 0} />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Status" name="status">
          <select id="status" name="status" defaultValue={course?.status ?? "draft"}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Featured" name="featured">
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500, paddingTop: 8 }}>
            <input type="checkbox" name="featured" defaultChecked={course?.featured} style={{ width: "auto" }} />
            Show in featured programmes
          </label>
        </Field>
      </div>

      <Field label="SEO Title" name="seo_title" error={e.seo_title}>
        <input id="seo_title" name="seo_title" defaultValue={course?.seo_title ?? ""} />
      </Field>
      <Field label="SEO Description" name="seo_description" error={e.seo_description}>
        <textarea id="seo_description" name="seo_description" rows={2} defaultValue={course?.seo_description ?? ""} />
      </Field>

      <div className="ta-form-actions">
        <Link href="/admin/courses" className="ta-btn ta-btn-outline">Cancel</Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
          {pending ? "Saving…" : course ? "Save changes" : "Create course"}
        </button>
      </div>
    </form>
  );
}
