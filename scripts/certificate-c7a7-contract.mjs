import assert from "node:assert/strict";
import fs from "node:fs";
import { formatPublicVerificationDate, resolveTrainingPeriod } from "../lib/public-verification-training.ts";

const period = (input) => resolveTrainingPeriod(input)?.display ?? null;

assert.equal(period({ training_start_date: "2026-09-14", training_end_date: "2026-09-23", training_date: "2026-01-01" }), "14 September 2026 – 23 September 2026");
assert.equal(period({ training_start_date: "2026-09-14", training_end_date: "2026-09-14" }), "14 September 2026");
assert.equal(period({ training_start_date: "2026-09-14" }), "14 September 2026");
assert.equal(period({ training_end_date: "2026-09-23" }), "23 September 2026");
assert.equal(period({ training_date: "2026-09-01" }), "1 September 2026");
assert.equal(period({ training_start_date: "2026-09-14", training_end_date: "2026-09-23", training_date: "2026-01-01" }), "14 September 2026 – 23 September 2026");
assert.equal(period({}), null);
assert.equal(period({ training_start_date: "not-a-date", training_end_date: "2026-09-23" }), "23 September 2026");
assert.equal(period({ training_start_date: "2026-02-30", training_date: "2026-01-01" }), null);
assert.equal(period({ training_start_date: "not-a-date", training_end_date: "also-not-a-date" }), null);
assert.equal(formatPublicVerificationDate("2026-02-30"), null);

const source = fs.readFileSync("app/verify/VerificationResult.tsx", "utf8");
assert.match(source, /training_start_date\?: string \| null/);
assert.match(source, /training_end_date\?: string \| null/);
assert.match(source, /training_date\?: string \| null/);
assert.match(source, /Training Period/);
assert.match(source, /resolveTrainingPeriod\(result\)/);
for (const forbidden of ["identity_no", "phone", "email", "participant_id", "schedule_id", "user_agent", "ip_address"]) {
  assert.doesNotMatch(source, new RegExp(`result\\.${forbidden}`));
}

console.log("C7A7 application contract passed: date precedence, partial dates, legacy fallback, invalid-date safety, privacy lock, and public rendering wiring.");
