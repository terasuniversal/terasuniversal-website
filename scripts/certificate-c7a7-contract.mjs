import assert from "node:assert/strict";
import fs from "node:fs";
import { formatPublicVerificationDate, resolveTrainingPeriod } from "../lib/public-verification-training.ts";
import { formatMalaysiaDateTime } from "../lib/date-time.ts";

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
// The verified-at timestamp is shown in Malaysia time whatever the server's own timezone is.
assert.match(source, /formatMalaysiaDateTime\(result\.verified_at\)/);
assert.doesNotMatch(source, /toLocaleString/);
assert.equal(formatMalaysiaDateTime("2026-11-03T01:33:59Z"), "03/11/2026, 9:33:59 am");
assert.equal(formatMalaysiaDateTime("2026-11-02T16:30:00Z"), "03/11/2026, 12:30:00 am"); // previous UTC day
assert.equal(formatMalaysiaDateTime("2026-11-03T15:59:59Z"), "03/11/2026, 11:59:59 pm"); // last second of the Malaysian day
assert.equal(formatMalaysiaDateTime("2026-12-31T16:00:00Z"), "01/01/2027, 12:00:00 am"); // crosses the year
assert.equal(formatMalaysiaDateTime("2026-11-03T01:33:59.123456+00:00"), "03/11/2026, 9:33:59 am"); // Postgres timestamptz shape
assert.equal(formatMalaysiaDateTime("not-a-date"), "—");
for (const forbidden of ["identity_no", "phone", "email", "participant_id", "schedule_id", "user_agent", "ip_address"]) {
  assert.doesNotMatch(source, new RegExp(`result\\.${forbidden}`));
}

console.log("C7A7 application contract passed: date precedence, partial dates, legacy fallback, invalid-date safety, privacy lock, Malaysia-time verified-at, and public rendering wiring.");
