export interface ProgrammePage2Config {
  objectives_text?: string;
  coverage_items?: string[];
  learning_outcomes?: string[];
  assessment_methods?: string[];
}

export interface SnapshotPageVisibility {
  show_back_page?: boolean;
  show_qr?: boolean;
}

const PAGE2_FIELDS = [
  "objectives_text",
  "coverage_items",
  "learning_outcomes",
  "assessment_methods",
] as const;

/**
 * Resolves only values captured with a modern issuance. Captured
 * `template_config` values win; `render_payload` fills fields absent from that
 * config. Current programme maps are intentionally not an input to this function.
 */
export function resolveSnapshotProgrammePage2<T extends ProgrammePage2Config>(
  templateConfig: T,
  renderPayload: Record<string, unknown> | null | undefined,
): T {
  const resolved = { ...templateConfig };
  if (!renderPayload) return resolved;

  for (const field of PAGE2_FIELDS) {
    const configValue = resolved[field];
    if (configValue !== undefined && configValue !== null) continue;
    if (!Object.prototype.hasOwnProperty.call(renderPayload, field)) continue;
    const capturedValue = renderPayload[field];
    if (field === "objectives_text") {
      resolved.objectives_text = typeof capturedValue === "string" ? capturedValue : "";
    } else {
      const items = Array.isArray(capturedValue)
        ? capturedValue.filter((item): item is string => typeof item === "string")
        : [];
      if (field === "coverage_items") resolved.coverage_items = items;
      if (field === "learning_outcomes") resolved.learning_outcomes = items;
      if (field === "assessment_methods") resolved.assessment_methods = items;
    }
  }

  return resolved;
}

/**
 * Preserves the legacy-only programme-map fallback. Snapshot render paths must
 * never call this function; their source is resolveSnapshotProgrammePage2.
 */
export function applyLegacyProgrammePage2<T extends ProgrammePage2Config>(
  templateConfig: T,
  programmeConfig: ProgrammePage2Config,
): T {
  const resolved = { ...templateConfig };
  resolved.objectives_text ??= programmeConfig.objectives_text;
  resolved.coverage_items ??= programmeConfig.coverage_items;
  resolved.learning_outcomes ??= programmeConfig.learning_outcomes;
  resolved.assessment_methods ??= programmeConfig.assessment_methods;
  return resolved;
}
export function resolveSnapshotPageVisibility<T extends SnapshotPageVisibility>(
  templateConfig: T,
  renderPayload: Record<string, unknown> | null | undefined,
): T {
  const resolved = { ...templateConfig };
  for (const field of ["show_back_page", "show_qr"] as const) {
    if (typeof resolved[field] === "boolean") continue;
    if (typeof renderPayload?.[field] === "boolean") resolved[field] = renderPayload[field] as boolean;
  }
  return resolved;
}
