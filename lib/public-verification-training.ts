export type TrainingPeriodInput = {
  training_date?: string | null;
  training_start_date?: string | null;
  training_end_date?: string | null;
};

export type TrainingPeriod = {
  start: string;
  end: string | null;
  display: string;
};

const PUBLIC_DATE_FORMATTER = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== Number(value.slice(0, 4)) ||
    date.getUTCMonth() + 1 !== Number(value.slice(5, 7)) ||
    date.getUTCDate() !== Number(value.slice(8, 10))
  ) {
    return null;
  }
  return date;
}

export function formatPublicVerificationDate(value: string | null | undefined): string | null {
  const date = parseIsoDate(value);
  return date ? PUBLIC_DATE_FORMATTER.format(date) : null;
}

/**
 * Resolves only authoritative verification dates. The legacy training_date
 * fallback is retained for Production, which still exposes the old RPC shape.
 * Invalid endpoints are omitted rather than coerced or replaced.
 */
export function resolveTrainingPeriod(input: TrainingPeriodInput): TrainingPeriod | null {
  const hasNewStart = input.training_start_date != null;
  const hasNewEnd = input.training_end_date != null;
  const hasNewFields = hasNewStart || hasNewEnd;

  const start = formatPublicVerificationDate(input.training_start_date);
  const end = formatPublicVerificationDate(input.training_end_date);
  if (start || end || hasNewFields) {
    if (!start && !end) return null;
    return {
      start: start ?? end!,
      end: start && end && start !== end ? end : null,
      display: start && end && start !== end ? `${start} – ${end}` : start ?? end!,
    };
  }

  const legacy = formatPublicVerificationDate(input.training_date);
  return legacy ? { start: legacy, end: null, display: legacy } : null;
}
