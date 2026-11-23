/**
 * W7-a (owner-approved W7-a-G1, local only): the exact, named edits of the calendar reliability change.
 *   lib/public-content.ts
 *     NE-1 PublicScheduleLoadError and loadErrorCode(): a failed schedule RPC is thrown, carrying only a short code.
 *     NE-2 getPublishedSchedulesWithState (calendar, course pages): the cached loader (key "public-schedules-v2") throws
 *          on failure; the uncached wrapper returns the unchanged { schedules, error } result, so a transient failure is
 *          never cached as a normal schedule result.
 *     NE-3 getUpcomingSchedules (homepage): the same pattern (key "public-upcoming-schedules-v2"); still [] on failure.
 * revertW7(path, text) undoes ONLY these edits and fails closed when an edit is not found exactly once.
 * revertPublicFirst() applies it first (latest change first), so every earlier contract that pins this file to HEAD, to
 * a hash or to the pre-Public-First bytes keeps proving that nothing else in it moved. Generated from the exact text at
 * main 5a353965; strings are JSON-escaped verbatim.
 */
const EDITS: Record<string, [string, string][]> = {
  "lib/public-content.ts": [
    [
      "/**\n * W7-a (owner-approved): a failed schedule read is thrown inside the cached loaders below and turned into the public\n * error state outside them. unstable_cache stores only results that resolve, so a transient RPC failure is never cached\n * as a normal (empty) schedule result, and a failed background refresh of a stale entry does not replace that entry.\n * Only a short error code (SQLSTATE / PostgREST code) is logged: never the message, rows or request data.\n */\nclass PublicScheduleLoadError extends Error {\n  readonly code: string;\n  constructor(code: unknown) {\n    super(\"public schedule RPC failed\");\n    this.name = \"PublicScheduleLoadError\";\n    this.code = typeof code === \"string\" && /^[A-Z0-9]{1,12}$/.test(code) ? code : \"unknown\";\n  }\n}\nconst loadErrorCode = (error: unknown) => (error instanceof PublicScheduleLoadError ? error.code : \"exception\");\n\n/**\n * All published, non-deleted schedules (past included) via the public-safe\n",
      "/**\n * All published, non-deleted schedules (past included) via the public-safe\n"
    ],
    [
      " * professional empty state.\n */\nconst loadPublishedSchedules = unstable_cache(\n  async (): Promise<PublicSchedule[]> => {\n    const supabase = getSupabaseClient();\n    const { data, error } = await supabase.rpc(\"get_public_upcoming_schedules\", { p_include_past: true });\n    if (error) throw new PublicScheduleLoadError(error.code);\n    const schedules = (data ?? []).map(mapSchedule);\n    return Promise.all(schedules.map(async (schedule: PublicSchedule) => {\n      const context = await getPublicRegistrationSchedule(schedule.id);\n      return { ...schedule, fee: context?.fee ?? null, registration_available: context?.registration_available === true };\n    }));\n  },\n  // W7-a: versioned key, because the cached value changed from the result object to the schedule list.\n  [\"public-schedules-v2\"],\n  { tags: [\"schedules\"], revalidate: 60 }\n);\n\nexport async function getPublishedSchedulesWithState(): Promise<{ schedules: PublicSchedule[]; error: boolean }> {\n  try {\n    return { schedules: await loadPublishedSchedules(), error: false };\n  } catch (error) {\n    console.error(\"public-content: published schedules unavailable\", { code: loadErrorCode(error) });\n    return { schedules: [], error: true };\n  }\n}\n",
      " * professional empty state.\n */\nexport const getPublishedSchedulesWithState = unstable_cache(\n  async (): Promise<{ schedules: PublicSchedule[]; error: boolean }> => {\n    const supabase = getSupabaseClient();\n    try {\n      const { data, error } = await supabase.rpc(\"get_public_upcoming_schedules\", { p_include_past: true });\n      if (error) return { schedules: [], error: true };\n      const schedules = (data ?? []).map(mapSchedule);\n      const withRegistration = await Promise.all(schedules.map(async (schedule: PublicSchedule) => {\n        const context = await getPublicRegistrationSchedule(schedule.id);\n        return { ...schedule, fee: context?.fee ?? null, registration_available: context?.registration_available === true };\n      }));\n      return { schedules: withRegistration, error: false };\n    } catch {\n      return { schedules: [], error: true };\n    }\n  },\n  [\"public-schedules\"],\n  { tags: [\"schedules\"], revalidate: 60 }\n);\n"
    ],
    [
      " * getPublishedSchedulesWithState — nested unstable_cache calls are not supported.\n * W7-a: the cached loader throws on failure and getUpcomingSchedules() still degrades to an empty list (fail-closed).\n */\nconst loadUpcomingSchedules = unstable_cache(\n  async (): Promise<PublicSchedule[]> => {\n    const supabase = getSupabaseClient();\n    const { data, error } = await supabase.rpc(\"get_public_upcoming_schedules\", { p_include_past: false });\n    if (error) throw new PublicScheduleLoadError(error.code);\n    const schedules = (data ?? []).map(mapSchedule).slice(0, 3);\n    return Promise.all(schedules.map(async (schedule: PublicSchedule) => {\n      const context = await getPublicRegistrationSchedule(schedule.id);\n      return {\n        ...schedule,\n        fee: context?.fee ?? null,\n        registration_available: context?.registration_available === true,\n      };\n    }));\n  },\n  [\"public-upcoming-schedules-v2\"],\n  { tags: [\"schedules\"], revalidate: 60 }\n);\n\nexport async function getUpcomingSchedules(): Promise<PublicSchedule[]> {\n  try {\n    return await loadUpcomingSchedules();\n  } catch (error) {\n    console.error(\"public-content: upcoming schedules unavailable\", { code: loadErrorCode(error) });\n    return [];\n  }\n}\n",
      " * getPublishedSchedulesWithState — nested unstable_cache calls are not supported.\n */\nexport const getUpcomingSchedules = unstable_cache(\n  async (): Promise<PublicSchedule[]> => {\n    const supabase = getSupabaseClient();\n    try {\n      const { data, error } = await supabase.rpc(\"get_public_upcoming_schedules\", { p_include_past: false });\n      if (error) return [];\n      const schedules = (data ?? []).map(mapSchedule).slice(0, 3);\n      return Promise.all(schedules.map(async (schedule: PublicSchedule) => {\n        const context = await getPublicRegistrationSchedule(schedule.id);\n        return {\n          ...schedule,\n          fee: context?.fee ?? null,\n          registration_available: context?.registration_available === true,\n        };\n      }));\n    } catch {\n      return [];\n    }\n  },\n  [\"public-upcoming-schedules\"],\n  { tags: [\"schedules\"], revalidate: 60 }\n);\n"
    ]
  ]
};

export const W7_CHANGED = Object.keys(EDITS).sort();
export const W7_ADDED = ["scripts/fixtures/w7-next-cache-fakes.mjs", "scripts/w7-approved.mts", "scripts/w7-calendar-reliability.test.mts"];

export function revertW7(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (out.split(from).length !== 2) throw new Error(`W7: expected edit not found exactly once in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
