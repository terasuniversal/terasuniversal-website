import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const flow = fs.readFileSync(path.join(root, "components", "public", "PublicRegistrationFlow.tsx"), "utf8");

assert.match(flow, /const nextSession = \{ \.\.\.current, reference: registration\.registration_reference \};/);
assert.match(flow, /setSession\(nextSession\);/);
assert.match(flow, /writeSession\(schedule\.schedule_id, nextSession\);/);
assert.match(flow, /if \(!session\?\.reference \|\| !session\.secret\) return;/);
assert.match(flow, /fetch\("\/api\/registration\/payment"/);
assert.match(flow, /setBusy\(true\)/);
assert.match(flow, /disabled=\{busy\}/);

console.log("Phase 3 payment dispatch checker: PASS");
