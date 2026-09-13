export const CERTIFICATE_SKILL_AREAS = [
  "theory_session",
  "practical_training",
  "safety_awareness",
  "practical_assessment",
  "attendance_requirement",
] as const;

export type CertificateSkillArea = (typeof CERTIFICATE_SKILL_AREAS)[number];
export type CertificateSkillsProvenance =
  | "MODERN_SNAPSHOT"
  | "LEGACY_DEFENSIBLE_SKILLS"
  | "LEGACY_FALLBACK"
  | "PARTIAL_SKILL_RECORD";
export type CertificateSkillsCompleteness = "FULL" | "PARTIAL" | "NONE";

export interface CertificateSkillRow {
  area: string;
  status: string;
}

export interface CertificateSkillsResolution {
  provenance: CertificateSkillsProvenance;
  completeness: CertificateSkillsCompleteness;
  skills: CertificateSkillRow[];
}

export const CERTIFICATE_SKILL_AREA_LABELS: Record<string, string> = {
  theory_session: "Theory Session",
  practical_training: "Practical Training",
  safety_awareness: "Safety Awareness",
  practical_assessment: "Practical Assessment",
  attendance_requirement: "Attendance Requirement",
};

export const CERTIFICATE_SKILL_STATUS_LABELS: Record<string, string> = {
  not_recorded: "Not Recorded",
  completed: "Completed",
  passed: "Passed",
  failed: "Failed",
  met: "Met",
  not_met: "Not Met",
};

const NEUTRAL_SKILLS: CertificateSkillRow[] = CERTIFICATE_SKILL_AREAS.map((area) => ({
  area: CERTIFICATE_SKILL_AREA_LABELS[area],
  status: CERTIFICATE_SKILL_STATUS_LABELS.not_recorded,
}));

function displayRow(row: CertificateSkillRow): CertificateSkillRow {
  return {
    area: CERTIFICATE_SKILL_AREA_LABELS[row.area] ?? row.area,
    status: CERTIFICATE_SKILL_STATUS_LABELS[row.status] ?? row.status,
  };
}

/**
 * Resolves certificate historical skills without consulting mutable training
 * state. A missing row is neutral, never an inferred competency outcome.
 */
export function resolveCertificateSkills(
  hasIssuanceSnapshot: boolean,
  capturedRows: CertificateSkillRow[] | null | undefined,
): CertificateSkillsResolution {
  const rows = capturedRows ?? [];
  const capturedAreas = new Set(rows.map((row) => row.area));
  const complete = rows.length === CERTIFICATE_SKILL_AREAS.length
    && CERTIFICATE_SKILL_AREAS.every((area) => capturedAreas.has(area));

  const provenance: CertificateSkillsProvenance = hasIssuanceSnapshot
    ? complete ? "MODERN_SNAPSHOT" : "PARTIAL_SKILL_RECORD"
    : complete ? "LEGACY_DEFENSIBLE_SKILLS" : rows.length ? "PARTIAL_SKILL_RECORD" : "LEGACY_FALLBACK";
  const completeness: CertificateSkillsCompleteness = complete ? "FULL" : rows.length ? "PARTIAL" : "NONE";
  const captured = new Map(rows.map((row) => [row.area, displayRow(row)]));
  const skills = provenance === "LEGACY_FALLBACK"
    ? NEUTRAL_SKILLS.map((row) => ({ ...row }))
    : CERTIFICATE_SKILL_AREAS.map((area) => captured.get(area) ?? NEUTRAL_SKILLS.find((row) => row.area === CERTIFICATE_SKILL_AREA_LABELS[area])!);

  return { provenance, completeness, skills };
}

export const CERTIFICATE_PROVENANCE_META: Record<CertificateSkillsProvenance, { label: string; help: string }> = {
  MODERN_SNAPSHOT: {
    label: "Modern Snapshot",
    help: "Captured when this certificate was issued.",
  },
  LEGACY_DEFENSIBLE_SKILLS: {
    label: "Legacy Skills Evidence",
    help: "Certificate-level skills record captured under the earlier certificate workflow.",
  },
  LEGACY_FALLBACK: {
    label: "Legacy Certificate",
    help: "No certificate-level historical skills record is stored.",
  },
  PARTIAL_SKILL_RECORD: {
    label: "Partial Skills Record",
    help: "Only part of the historical skills record is stored.",
  },
};