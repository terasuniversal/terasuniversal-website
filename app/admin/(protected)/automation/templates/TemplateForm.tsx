"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, Field } from "../../../../../components/admin/ui";
import { createAutomationTemplate, updateAutomationTemplate, type FormState } from "../actions";

const initial: FormState = {};

const TYPE_HINTS: Record<string, string> = {
  import: 'Column mapping for CSV/Excel import, e.g. {"Full Name":"full_name","IC":"ic_passport_no"}',
  attendance: "Default attendance sheet layout / columns.",
  assessment: "Default assessment rubric or score bands.",
  report: "Saved report configuration (columns, filters).",
  email: "Email body template (placeholders like {{name}}, {{course}}).",
};

export function TemplateForm({
  mode,
  id,
  initialValues,
}: {
  mode: "create" | "edit";
  id?: string;
  initialValues?: {
    template_type: string;
    name: string;
    description: string;
    content: string;
    is_active: boolean;
    is_default: boolean;
  };
}) {
  const boundUpdate = updateAutomationTemplate.bind(null, id ?? "");
  const [state, action, pending] = useActionState(mode === "create" ? createAutomationTemplate : boundUpdate, initial);
  const v = initialValues;

  return (
    <form action={action}>
      <Card title={mode === "create" ? "New template" : "Edit template"}>
        <div className="ta-card-pad">
          <Field label="Template type" name="template_type">
            <select id="template_type" name="template_type" defaultValue={v?.template_type ?? "import"}>
              <option value="import">Import mapping</option>
              <option value="attendance">Attendance</option>
              <option value="assessment">Assessment</option>
              <option value="report">Report</option>
              <option value="email">Email</option>
            </select>
          </Field>
          <Field label="Name" name="name" error={state.errors?.name}>
            <input id="name" name="name" defaultValue={v?.name ?? ""} required maxLength={120} />
          </Field>
          <Field label="Description" name="description">
            <input id="description" name="description" defaultValue={v?.description ?? ""} maxLength={500} />
          </Field>
          <Field label="Content (JSON or plain text)" name="content" hint="Enter JSON for structured config, or plain text. Stored as-is for the automation to consume.">
            <textarea id="content" name="content" rows={6} defaultValue={v?.content ?? ""} style={{ fontFamily: "monospace", fontSize: 13 }} placeholder={TYPE_HINTS.import} />
          </Field>
          <div style={{ display: "flex", gap: 20, marginTop: 6 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" name="is_active" defaultChecked={v?.is_active ?? true} /> Active
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" name="is_default" defaultChecked={v?.is_default ?? false} /> Default for this type
            </label>
          </div>
          {state.message && <p style={{ color: "var(--ta-danger)", fontSize: 13, marginTop: 10 }}>{state.message}</p>}
        </div>
      </Card>

      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <button className="ta-btn ta-btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save template"}</button>
        <Link href="/admin/automation/templates" className="ta-btn ta-btn-outline">Cancel</Link>
      </div>
    </form>
  );
}
