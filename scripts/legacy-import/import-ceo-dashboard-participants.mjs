#!/usr/bin/env node
// Legacy Participant Migration, Phase 1 -- first supported source.
//
// Parses ceo-dashboard-audit/live/Participants.csv, normalizes it, and
// loads it into the STAGING-ONLY legacy_import_batches /
// legacy_participant_staging / legacy_course_map tables via
// legacy_import_create_batch() / legacy_import_ingest_rows(), then
// classifies each row (exact_match / probable_duplicate / new_participant /
// conflict) against public.participants and registers any unmapped course
// names in legacy_course_map as 'pending'.
//
// This script NEVER writes to participants / schedule_participants /
// certificates -- only to the three staging tables above. Merging staging
// rows into Participant Master is a separate, not-yet-built, explicitly
// human-approved phase.
//
// STAGING ONLY. REF is hardcoded to the staging project; there is no flag
// to point this at production.
//
// Usage: node scripts/legacy-import/import-ceo-dashboard-participants.mjs

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeIcPassport, normalizeName, normalizeCourseName } from "./normalize.mjs";

const REF = "pzgtyskhyhuxhzvyzzhe"; // staging only -- never change without an explicit, separate decision
const SOURCE_LABEL = "ceo_dashboard_participants_csv";
const CSV_PATH = new URL("../../ceo-dashboard-audit/live/Participants.csv", import.meta.url);
// Any active staging admin/super_admin profile works here -- this is not a
// specific person, just an actor satisfying app.is_admin() so the RPCs'
// internal guard passes and RLS-protected staging tables are reachable.
const ACTOR = "00000000-0000-0000-0000-0000000000a2";

function cli(sql) {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(
    cmd,
    ["supabase", "db", "query", "--linked", "--project-ref", REF, "--output-format", "json"],
    { input: sql, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`db query failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function asActor(sql) {
  return (
    `set request.jwt.claims = '{"sub":"${ACTOR}","role":"authenticated"}'; ` +
    `set request.jwt.claim.sub = '${ACTOR}'; ` +
    `set role authenticated; ${sql}`
  );
}

function sqlString(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseSource() {
  const content = readFileSync(CSV_PATH, "utf8");
  const hash = createHash("sha256").update(content).digest("hex");
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  const rows = lines.slice(1).map((line, i) => {
    const f = parseCsvLine(line);
    const raw = { name: f[0], ic: f[1], company: f[2], course: f[3], training_date: f[4], cert_no: f[5], cert_expiry: f[6], status: f[7] };
    return {
      source_row_number: i + 1,
      raw_data: raw,
      raw_name: raw.name || null,
      raw_ic_passport: raw.ic || null,
      normalized_ic_passport: normalizeIcPassport(raw.ic),
      raw_email: null,
      normalized_email: null,
      raw_phone: null,
      normalized_phone: null,
      raw_company: raw.company || null,
      raw_course_name: raw.course || null,
      normalized_course_name: normalizeCourseName(raw.course),
      training_start_date: raw.training_date || null,
      training_end_date: null,
      raw_certificate_number: raw.cert_no || null,
      raw_status: raw.status || null,
    };
  });
  return { hash, rows };
}

function main() {
  const { hash, rows } = parseSource();
  console.log(`Parsed ${rows.length} rows from ${CSV_PATH}. sha256=${hash}`);

  const createOut = cli(
    asActor(
      `select public.legacy_import_create_batch(${sqlString(SOURCE_LABEL)}, ${sqlString("Participants.csv")}, ${sqlString(hash)}) as batch_id;`,
    ),
  );
  const batchId = JSON.parse(createOut)[0].batch_id;
  console.log(`Batch: ${batchId}`);

  const ingestOut = cli(
    asActor(
      `select public.legacy_import_ingest_rows(${sqlString(batchId)}, '${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb) as inserted_count;`,
    ),
  );
  console.log(`Ingested: ${JSON.parse(ingestOut)[0].inserted_count} rows`);

  // Classification + course mapping. Kept as plain RLS-protected UPDATE/
  // INSERT statements (not a new RPC) -- app.is_admin() on the staging
  // tables' own policies is the enforcement boundary here, matching how
  // other admin CRUD in this codebase edits RLS-protected rows directly.
  cli(
    asActor(`
update public.legacy_participant_staging
set validation_error = 'missing_name'
where batch_id = ${sqlString(batchId)} and (raw_name is null or trim(raw_name) = '');

update public.legacy_participant_staging
set validation_error = coalesce(validation_error || '; ', '') || 'missing_ic_passport'
where batch_id = ${sqlString(batchId)} and (normalized_ic_passport is null or normalized_ic_passport = '');

update public.legacy_participant_staging s
set matched_participant_id = m.id,
    match_status = case
      when upper(regexp_replace(trim(m.full_name), '\\s+', ' ', 'g')) = upper(regexp_replace(trim(s.raw_name), '\\s+', ' ', 'g'))
        then 'exact_match'
      else 'conflict'
    end,
    duplicate_conflict_reason = case
      when upper(regexp_replace(trim(m.full_name), '\\s+', ' ', 'g')) <> upper(regexp_replace(trim(s.raw_name), '\\s+', ' ', 'g'))
        then format('IC/passport %s matches existing participant %s (%s) but staging row name is %s', s.normalized_ic_passport, m.id, m.full_name, s.raw_name)
      else null
    end
from public.participants m
where s.batch_id = ${sqlString(batchId)}
  and s.validation_error is null
  and (
    regexp_replace(coalesce(m.identity_no,''), '[^A-Za-z0-9]', '', 'g') = s.normalized_ic_passport
    or regexp_replace(coalesce(m.ic_passport_no,''), '[^A-Za-z0-9]', '', 'g') = s.normalized_ic_passport
  );

-- Supporting-evidence-only match (email/phone) for sources that carry
-- them; this source has neither, so this never fires for this batch, but
-- the classification enum stays correct for future sources.
update public.legacy_participant_staging
set match_status = 'new_participant'
where batch_id = ${sqlString(batchId)} and match_status is null and validation_error is null;

-- Never auto-approves a mapping. A normalized course name with no
-- existing 'mapped' legacy_course_map row is registered as 'pending' and
-- stays unmapped until a human approves it.
insert into public.legacy_course_map (source_label, raw_course_name, normalized_course_name, created_by)
select distinct ${sqlString(SOURCE_LABEL)}, s.raw_course_name, s.normalized_course_name, ${sqlString(ACTOR)}::uuid
from public.legacy_participant_staging s
where s.batch_id = ${sqlString(batchId)} and s.normalized_course_name is not null
on conflict (source_label, normalized_course_name) do nothing;

update public.legacy_participant_staging s
set mapped_course_id = cm.course_id
from public.legacy_course_map cm
where s.batch_id = ${sqlString(batchId)}
  and cm.source_label = ${sqlString(SOURCE_LABEL)}
  and cm.normalized_course_name = s.normalized_course_name
  and cm.status = 'mapped';

update public.legacy_import_batches
set status = 'review',
    valid_count = (select count(*) from public.legacy_participant_staging where batch_id = ${sqlString(batchId)} and validation_error is null),
    invalid_count = (select count(*) from public.legacy_participant_staging where batch_id = ${sqlString(batchId)} and validation_error is not null)
where id = ${sqlString(batchId)};
`),
  );

  console.log(`Batch ${batchId} classified and marked 'review'. No participants/schedule_participants/certificates rows were written.`);
}

main();
