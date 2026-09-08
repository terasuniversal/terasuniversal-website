import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const actions = await readFile(new URL("../app/admin/(protected)/schedules/actions.ts", import.meta.url), "utf8");
const publicContent = await readFile(new URL("../lib/public-content.ts", import.meta.url), "utf8");
const calendar = await readFile(new URL("../components/TrainingCalendar.js", import.meta.url), "utf8");

assert.match(actions, /courseCatalog/);
assert.match(actions, /revalidatePublicScheduleViews/);
assert.match(actions, /revalidateTag\("schedules"\)/);
assert.match(actions, /revalidatePath\("\/calendar"\)/);
assert.match(actions, /revalidatePath\(`\/training\/\$\{slug\}`\)/);
assert.match(actions, /select\("id, slug"\)\.in\("id", ids\)/);

assert.match(publicContent, /getUpcomingSchedules/);
assert.match(publicContent, /fee: context\?\.fee \?\? null/);
assert.match(publicContent, /registration_available: context\?\.registration_available === true/);

assert.match(calendar, /session\.fee/);
assert.match(calendar, /RM\$\{new Intl\.NumberFormat/);
assert.doesNotMatch(calendar, /courses\.fee/);

console.log("Phase 3 schedule cache checks passed: mapped course paths are invalidated and calendar fees use session fee data.");
