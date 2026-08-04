"use client";

import { useActionState } from "react";
import { Card, Field } from "../../../../../components/admin/ui";
import { saveAutomationSettings, type FormState } from "../actions";

const initial: FormState = {};

export function SettingsForm({ values }: { values: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveAutomationSettings, initial);

  return (
    <form action={action}>
      <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
        <Card title="Auto-numbering">
          <div className="ta-card-pad">
            <Field label="Participant ID prefix" name="participant_prefix" error={state.errors?.participant_prefix} hint="New participant IDs use this prefix, e.g. TU- → TU-000123.">
              <input id="participant_prefix" name="participant_prefix" defaultValue={values.participant_prefix} maxLength={12} />
            </Field>
            <Field label="Certificate number prefix" name="certificate_prefix" error={state.errors?.certificate_prefix} hint="Cert numbers become <prefix><year>-<seq>, e.g. CERT- → CERT-2026-000045.">
              <input id="certificate_prefix" name="certificate_prefix" defaultValue={values.certificate_prefix} maxLength={12} />
            </Field>
            <p style={{ fontSize: 12, color: "var(--ta-muted)", margin: "6px 0 0" }}>
              Changing a prefix only affects records created afterwards. Existing IDs are never renumbered.
            </p>
          </div>
        </Card>

        <Card title="Regional & Export defaults">
          <div className="ta-card-pad">
            <Field label="Default timezone" name="timezone" error={state.errors?.timezone}>
              <select id="timezone" name="timezone" defaultValue={values.timezone}>
                <option value="Asia/Kuala_Lumpur">Asia/Kuala_Lumpur (MYT)</option>
                <option value="Asia/Singapore">Asia/Singapore</option>
                <option value="Asia/Jakarta">Asia/Jakarta (WIB)</option>
                <option value="Asia/Bangkok">Asia/Bangkok</option>
                <option value="UTC">UTC</option>
              </select>
            </Field>
            <Field label="Default date format" name="date_format" error={state.errors?.date_format}>
              <select id="date_format" name="date_format" defaultValue={values.date_format}>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="D MMM YYYY">D MMM YYYY</option>
              </select>
            </Field>
            <Field label="Default export format" name="export_format" error={state.errors?.export_format}>
              <select id="export_format" name="export_format" defaultValue={values.export_format}>
                <option value="csv">CSV</option>
                <option value="excel">Excel (.xls)</option>
              </select>
            </Field>
            <Field label="Default training mode" name="default_training_mode" error={state.errors?.default_training_mode} hint="Used as the operational default when creating a new training schedule.">
              <select id="default_training_mode" name="default_training_mode" defaultValue={values.default_training_mode}>
                <option value="Public">Public</option>
                <option value="In-house">In-house</option>
                <option value="Onsite">Onsite</option>
                <option value="Online">Online</option>
                <option value="Hybrid">Hybrid</option>
              </select>
            </Field>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button className="ta-btn ta-btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
        {state.ok && <span style={{ color: "var(--ta-success)", fontSize: 13 }}>✓ {state.message}</span>}
        {state.message && !state.ok && <span style={{ color: "var(--ta-danger)", fontSize: 13 }}>{state.message}</span>}
      </div>
    </form>
  );
}
