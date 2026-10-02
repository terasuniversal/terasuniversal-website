import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const ui = await read("../components/admin/ui/index.tsx");
const css = await read("../app/admin/admin.css");
const leads = await read("../app/admin/(protected)/sales/leads/page.tsx");
const tasks = await read("../app/admin/(protected)/sales/tasks/page.tsx");
const followUpBadge = await read("../components/admin/sales/FollowUpBadge.tsx");

assert.match(ui, /secondaryAction\?/);
assert.match(ui, /export function ReadErrorState/);
assert.match(ui, /export function LoadingState/);
assert.match(ui, /export function ListToolbar/);
assert.match(ui, /aria-invalid/);
assert.match(ui, /aria-describedby/);
assert.match(ui, /role="alert"/);
assert.match(ui, /aria-current="page"/);
assert.match(followUpBadge, /aria-label|role="status"/);
assert.match(leads, /<ListToolbar/);
assert.match(leads, /<ReadErrorState/);
assert.match(tasks, /<ListToolbar/);
assert.match(tasks, /<ReadErrorState/);
assert.match(css, /ta-page-head-actions/);
assert.match(css, /ta-list-toolbar/);
assert.match(css, /ta-loading-skeleton/);
assert.match(css, /@media \(max-width: 900px\)/);

console.log("Sales shared UI foundation contract: PASS");
