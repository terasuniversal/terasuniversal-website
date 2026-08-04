"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { TemplateFormState } from "./actions";
import { Field } from "../../../../../components/admin/ui";
import { CertificateDocument } from "../../../../../components/admin/CertificateDocument";

export function TemplateForm({
  action,
  template,
  mode,
}: {
  action: (prev: TemplateFormState, fd: FormData) => Promise<TemplateFormState>;
  template?: any;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState<TemplateFormState, FormData>(action, {});
  const c = template?.config ?? {};
  const [preview, setPreview] = useState({
    logo_url: c.logo_url ?? "/teras-universal-logo.png",
    primary_color: c.primary_color ?? "#0B2C56",
    accent_color: c.accent_color ?? "#E1A925",
    signature_name: c.signature_name ?? "Training Director",
    signature_title: c.signature_title ?? "TERAS UNIVERSAL SDN. BHD.",
    body_text: c.body_text ?? "has successfully completed the training programme and is hereby certified as COMPETENT.",
    show_qr: c.show_qr !== false,
    orientation: template?.orientation ?? "landscape",
  });
  const upd = (k: string, v: any) => setPreview((p) => ({ ...p, [k]: v }));

  return (
    <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
      <form action={formAction} className="ta-form">
        {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
        <div className="ta-field-row">
          <Field label="Template name *" name="name" error={state.errors?.name}>
            <input id="name" name="name" defaultValue={template?.name ?? ""} required />
          </Field>
          <Field label="Orientation" name="orientation">
            <select id="orientation" name="orientation" defaultValue={preview.orientation} onChange={(e) => upd("orientation", e.target.value)}>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </Field>
        </div>
        <Field label="Description" name="description">
          <input id="description" name="description" defaultValue={template?.description ?? ""} />
        </Field>
        <div className="ta-field-row">
          <Field label="Logo URL" name="logo_url">
            <input id="logo_url" name="logo_url" defaultValue={preview.logo_url} onChange={(e) => upd("logo_url", e.target.value)} />
          </Field>
          <Field label="Background URL (optional)" name="background_url">
            <input id="background_url" name="background_url" defaultValue={c.background_url ?? ""} />
          </Field>
        </div>
        <div className="ta-field-row">
          <Field label="Primary colour" name="primary_color">
            <input id="primary_color" name="primary_color" type="color" defaultValue={preview.primary_color} onChange={(e) => upd("primary_color", e.target.value)} />
          </Field>
          <Field label="Accent colour" name="accent_color">
            <input id="accent_color" name="accent_color" type="color" defaultValue={preview.accent_color} onChange={(e) => upd("accent_color", e.target.value)} />
          </Field>
        </div>
        <Field label="Body text" name="body_text">
          <textarea id="body_text" name="body_text" rows={2} defaultValue={preview.body_text} onChange={(e) => upd("body_text", e.target.value)} />
        </Field>
        <div className="ta-field-row">
          <Field label="Signature name" name="signature_name">
            <input id="signature_name" name="signature_name" defaultValue={preview.signature_name} onChange={(e) => upd("signature_name", e.target.value)} />
          </Field>
          <Field label="Signature title" name="signature_title">
            <input id="signature_title" name="signature_title" defaultValue={preview.signature_title} onChange={(e) => upd("signature_title", e.target.value)} />
          </Field>
        </div>
        <Field label="Signature image URL (optional)" name="signature_url">
          <input id="signature_url" name="signature_url" defaultValue={c.signature_url ?? ""} />
        </Field>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" name="show_qr" defaultChecked={preview.show_qr} onChange={(e) => upd("show_qr", e.target.checked)} style={{ width: "auto" }} /> Show QR code
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" name="is_active" defaultChecked={template ? template.is_active : true} style={{ width: "auto" }} /> Active
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" name="is_default" defaultChecked={template?.is_default ?? false} style={{ width: "auto" }} /> Default
          </label>
        </div>
        <div className="ta-form-actions">
          <Link href="/admin/certificates/templates" className="ta-btn ta-btn-outline">Cancel</Link>
          <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>{pending ? "Saving…" : mode === "edit" ? "Save template" : "Create template"}</button>
        </div>
      </form>

      {/* Live preview (scaled) */}
      <div>
        <div style={{ fontWeight: 700, color: "var(--ta-navy)", marginBottom: 8 }}>Live preview</div>
        <div style={{ overflow: "hidden", border: "1px solid var(--ta-line)", borderRadius: 10, background: "#eef1f6", padding: 10 }}>
          <div style={{ transform: preview.orientation === "portrait" ? "scale(0.42)" : "scale(0.5)", transformOrigin: "top left", height: preview.orientation === "portrait" ? 480 : 400 }}>
            <CertificateDocument
              orientation={preview.orientation}
              config={preview}
              data={{ certificate_number: "CERT-2026-000123", holder_name: "Ahmad Bin Ali", course_name: "Scaffolding Competency", ic_passport: "900101-01-5523", training_date: "12 July 2026", venue: "TERAS Training Centre", trainer: "En. Ali", issue_date: "15 July 2026", verification_token: "sampletoken" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
