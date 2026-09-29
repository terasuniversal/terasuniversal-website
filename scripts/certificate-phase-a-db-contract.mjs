import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const externalDatabaseVariables = [
  "DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
if (externalDatabaseVariables.some((name) => process.env[name])) {
  throw new Error("Refusing Phase A DB contract: external database/Supabase environment variables are set");
}

const root = new URL("../", import.meta.url);
const container = `teras-phase-a-${process.pid}-${randomUUID().slice(0, 8)}`;
const password = `phase_a_disposable_${randomUUID()}`;
const migration = await readFile(new URL("../supabase/migrations/20260929120001_certificate_issuing_branch_binding.sql", import.meta.url), "utf8");
const fixture = await readFile(new URL("./fixtures/certificate-phase-a-postgres.sql", import.meta.url), "utf8");

function docker(args, input) {
  return execFileSync("docker", args, {
    cwd: root,
    input,
    encoding: "utf8",
    timeout: 8_000,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function psql(sql) {
  try {
    return docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], sql);
  } catch (error) {
    const details = error;
    throw new Error(`${details.stdout ?? ""}${details.stderr ?? details.message ?? "Disposable PostgreSQL command failed"}`);
  }
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      docker(["exec", container, "pg_isready", "-U", "postgres"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error("Disposable PostgreSQL 17 did not become ready");
}

function cleanup() {
  try {
    docker(["rm", "-f", container]);
  } catch {
    // The exact unique test container may already have exited or Docker may be unavailable.
  }
}

function validateResult(sql) {
  psql(sql);
}

async function main() {
  try {
    try {
      docker(["info", "--format", "{{.ServerVersion}}"]);
    } catch (error) {
      throw new Error(`BLOCKED_ENVIRONMENT: Docker engine is unavailable (${error?.code ?? "connection failure"})`);
    }
    const engine = docker(["run", "-d", "--rm", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=postgres", "postgres:17"]);
    assert.ok(engine.trim(), "Docker must return the created disposable container ID");
    await waitForPostgres();
    const serverVersion = psql("select current_setting('server_version_num')::int >= 170000 as pg17;");
    assert.match(serverVersion, /t\s*$/m, "real disposable PostgreSQL 17 is required");
    psql(fixture);
    psql(migration);

    validateResult(`
do $$
declare
  v_hq uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.certificate_branches where branch_code='HQ') <> 1 then raise exception 'HQ must be unique'; end if;
  if (select branch_id from public.course_schedules where id='b0000000-0000-4000-8000-000000000001') <> v_hq then raise exception 'live NULL schedule was not backfilled to HQ'; end if;
  if (select branch_id from public.course_schedules where id='b0000000-0000-4000-8000-000000000002') <> 'a0000000-0000-4000-8000-000000000002'::uuid then raise exception 'valid existing branch assignment was overwritten'; end if;
  if (select branch_id from public.course_schedules where id='b0000000-0000-4000-8000-000000000003') is not null then raise exception 'soft-deleted schedule was modified'; end if;
  if not has_function_privilege('authenticated', 'app.default_schedule_branch_id()', 'execute') then raise exception 'authenticated cannot use branch default'; end if;
  if not has_function_privilege('service_role', 'app.default_schedule_branch_id()', 'execute') then raise exception 'service_role cannot use branch default'; end if;
  if has_function_privilege('anon', 'app.default_schedule_branch_id()', 'execute') then raise exception 'anon can execute resolver'; end if;
  if has_function_privilege('authenticated', 'app.set_schedule_default_branch()', 'execute') then raise exception 'authenticated can directly execute trigger function'; end if;
  if (select proowner::regrole::text from pg_proc where oid='app.default_schedule_branch_id()'::regprocedure) <> 'postgres' then raise exception 'resolver owner is not postgres'; end if;
  if (select not prosecdef from pg_proc where oid='app.default_schedule_branch_id()'::regprocedure) then raise exception 'resolver is not SECURITY DEFINER'; end if;
  if (select proconfig from pg_proc where oid='app.default_schedule_branch_id()'::regprocedure) <> array['search_path=pg_catalog'] then raise exception 'resolver search_path is not pinned'; end if;
end $$;
`);

validateResult(`
set role authenticated;
insert into public.course_schedules (id, notes) values ('b0000000-0000-4000-8000-000000000004', 'default omitted');
insert into public.course_schedules (id, branch_id, notes) values ('b0000000-0000-4000-8000-000000000005', null, 'explicit null');
reset role;
do $$ begin
  if (select count(*) from public.course_schedules where id in ('b0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000005') and branch_id='a0000000-0000-4000-8000-000000000001') <> 2 then raise exception 'new schedule default/NULL path did not bind HQ'; end if;
end $$;
`);

    validateResult(`
do $$ declare v_rejected boolean; begin
  v_rejected := false;
  begin
    insert into public.course_schedules (id, branch_id) values ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000002');
  exception when sqlstate 'P0001' then v_rejected := true; end;
  if not v_rejected then raise exception 'noncanonical new branch unexpectedly accepted'; end if;
  update public.certificate_branches set is_active=false where branch_code='HQ';
  v_rejected := false;
  begin
    insert into public.course_schedules (id, notes) values ('b0000000-0000-4000-8000-000000000007', 'must reject while HQ inactive');
  exception when sqlstate 'P0001' then v_rejected := true; end;
  if not v_rejected then raise exception 'inactive canonical branch unexpectedly accepted for a new schedule'; end if;
  update public.certificate_branches set is_active=true where branch_code='HQ';
  if (select branch_id from public.course_schedules where id='b0000000-0000-4000-8000-000000000002') <> 'a0000000-0000-4000-8000-000000000002'::uuid then raise exception 'existing regional branch changed'; end if;
end $$;
`);

    // A second application proves the seed, trigger, default, and backfill are idempotent.
    psql(migration);
    validateResult(`
do $$ begin
  if (select count(*) from public.certificate_branches where branch_code='HQ') <> 1 then raise exception 'second migration created duplicate HQ'; end if;
  if (select count(*) from public.course_schedules where branch_id is null and deleted_at is null) <> 0 then raise exception 'second migration left a live NULL schedule'; end if;
  if (select count(*) from pg_trigger where tgrelid='public.course_schedules'::regclass and tgname='trg_course_schedules_default_branch' and not tgisinternal) <> 1 then raise exception 'trigger not idempotent'; end if;
end $$;
`);
  } finally {
    cleanup();
  }
}

try {
  await main();
  console.log("Certificate Phase A PostgreSQL contract (migration/default/backfill/schedule branch constraints): PASS");
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exitCode = 1;
}
