import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationPath = `${repoRoot}supabase/migrations/20260927182751_certificate_reissue_request_idempotency.sql`;
const runtimePath = `${repoRoot}supabase/tests/certificate_i3d_reissue_idempotency_runtime.sql`;
const containerName = `teras-certificate-i3d-${process.pid}`;

const bootstrapSql = String.raw`
CREATE ROLE certificate_lifecycle_executor NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE ON SCHEMA app TO certificate_lifecycle_executor;
GRANT USAGE ON SCHEMA public TO authenticated, certificate_lifecycle_executor;

CREATE FUNCTION app.request_actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT nullif(current_setting('app.actor_id',true),'')::uuid $$;
CREATE FUNCTION app.is_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT coalesce(current_setting('app.active',true)='true',false) $$;
CREATE FUNCTION app.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT coalesce(current_setting('app.admin',true)='true',false) $$;
CREATE FUNCTION public.has_module_access_level(p_module text,p_level text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT p_module='certificates' AND p_level='admin' AND coalesce(current_setting('app.certificates_admin',true)='true',false) $$;
GRANT EXECUTE ON FUNCTION app.request_actor_id(),app.is_active(),app.is_admin(),public.has_module_access_level(text,text) TO certificate_lifecycle_executor,authenticated;

CREATE TABLE public.certificates (
  id uuid PRIMARY KEY,
  certificate_number text NOT NULL,
  certificate_no text NOT NULL,
  verification_token text NOT NULL,
  issue_date date NOT NULL,
  status text NOT NULL,
  deleted_at timestamptz
);
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.certificates TO authenticated,certificate_lifecycle_executor;
GRANT UPDATE (id) ON public.certificates TO certificate_lifecycle_executor;
CREATE POLICY certificates_executor_read ON public.certificates FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));
CREATE POLICY certificates_executor_lock ON public.certificates FOR UPDATE TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin')) WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));
CREATE POLICY certificates_authenticated_read ON public.certificates FOR SELECT TO authenticated USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));

CREATE TABLE public.certificate_issuance_snapshots (
  certificate_id uuid PRIMARY KEY REFERENCES public.certificates(id),
  snapshot_payload jsonb NOT NULL
);
GRANT SELECT ON public.certificate_issuance_snapshots TO authenticated;

CREATE TABLE public.certificate_reissue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id uuid NOT NULL REFERENCES public.certificates(id),
  reissued_at timestamptz NOT NULL DEFAULT now(),
  reissued_by uuid NOT NULL,
  reason text,
  event_type text NOT NULL DEFAULT 'reissue' CHECK (event_type IN ('reprint','reissue')),
  notes jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.certificate_reissue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_reissue_events FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.certificate_reissue_events TO authenticated,certificate_lifecycle_executor;
GRANT INSERT (certificate_id,reissued_by,event_type,reason,notes) ON public.certificate_reissue_events TO certificate_lifecycle_executor;
CREATE POLICY reissue_executor_read ON public.certificate_reissue_events FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin') AND reissued_by=app.request_actor_id());
CREATE POLICY reissue_executor_insert ON public.certificate_reissue_events FOR INSERT TO certificate_lifecycle_executor WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin') AND reissued_by=app.request_actor_id());
CREATE POLICY reissue_authenticated_read ON public.certificate_reissue_events FOR SELECT TO authenticated USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));

CREATE FUNCTION app.reissue_certificate(p_certificate_id uuid,p_event_type text DEFAULT 'reissue',p_reason text DEFAULT NULL,p_notes jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(id uuid,certificate_id uuid,certificate_number text,event_type text,reissued_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::timestamptz WHERE false $$;
ALTER FUNCTION app.reissue_certificate(uuid,text,text,jsonb) OWNER TO certificate_lifecycle_executor;
GRANT EXECUTE ON FUNCTION app.reissue_certificate(uuid,text,text,jsonb) TO certificate_lifecycle_executor;
`;

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { cwd: repoRoot, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${(result.stderr || result.stdout || "").trim()}`);
  return (result.stdout || "").trim();
}

function psqlInput(sql) {
  const result = spawnSync("docker", ["exec", "-i", "-u", "postgres", containerName, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t"], { cwd: repoRoot, input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Isolated reissue PostgreSQL contract failed: ${(result.stderr || result.stdout || "").trim()}`);
  return result.stdout.trim();
}

function launchPsql(sql) {
  const child = spawn("docker", ["exec", "-i", "-u", "postgres", containerName, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t"], { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let errorOutput = "";
  let firstUuidResolve;
  const firstUuid = new Promise((resolve) => { firstUuidResolve = resolve; });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    const uuid = output.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0];
    if (uuid) firstUuidResolve(uuid);
  });
  child.stderr.on("data", (chunk) => { errorOutput += chunk; });
  child.stdin.end(sql);
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Concurrent psql failed (${code}): ${errorOutput.trim()}`)));
  });
  return { firstUuid, exited, getOutput: () => output };
}

async function main() {
  execFileSync("docker", ["image", "inspect", "postgres:17.6"], { cwd: repoRoot, stdio: "ignore" });
  docker(["run", "--rm", "-d", "--network", "none", "--name", containerName, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_DB=postgres", "postgres:17.6"]);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = spawnSync("docker", ["exec", "-u", "postgres", containerName, "pg_isready", "-U", "postgres", "-d", "postgres"], { cwd: repoRoot, stdio: "ignore" });
      if (result.status === 0) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, "isolated PostgreSQL test container must become ready");

    psqlInput(bootstrapSql);
    psqlInput(readFileSync(migrationPath, "utf8"));
    psqlInput(String.raw`
      CREATE FUNCTION public.reissue_certificate(p_certificate_id uuid,p_event_type text DEFAULT 'reissue',p_reason text DEFAULT NULL,p_notes jsonb DEFAULT '{}'::jsonb)
      RETURNS TABLE(id uuid,certificate_id uuid,certificate_number text,event_type text,reissued_at timestamptz)
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM app.reissue_certificate(p_certificate_id,p_event_type,p_reason,p_notes) $$;
      ALTER FUNCTION public.reissue_certificate(uuid,text,text,jsonb) OWNER TO certificate_lifecycle_executor;
      REVOKE ALL ON FUNCTION public.reissue_certificate(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION public.reissue_certificate(uuid,text,text,jsonb) TO authenticated;
    `);
    psqlInput(readFileSync(runtimePath, "utf8"));

    const actor = "d3000000-0000-4000-8000-000000000010";
    const certificate = "d3000000-0000-4000-8000-000000000001";
    const concurrentKey = "d3000000-0000-4000-8000-000000000103";
    const concurrentRequest = `BEGIN; SET ROLE authenticated; SET app.actor_id='${actor}'; SET app.active='true'; SET app.admin='true'; SET app.certificates_admin='true'; SELECT id FROM public.reissue_certificate('${certificate}','reprint','I3D concurrent retry','{"idempotency_key":"${concurrentKey}"}'::jsonb); SELECT pg_sleep(1.5); COMMIT;`;
    const first = launchPsql(concurrentRequest);
    const firstId = await first.firstUuid;
    const second = launchPsql(concurrentRequest.replace("SELECT pg_sleep(1.5); ", ""));
    const secondId = await second.firstUuid;
    await Promise.all([first.exited, second.exited]);
    assert.equal(secondId, firstId, "concurrent duplicate requests must resolve to one event id");

    const count = psqlInput(`SELECT count(*) FROM public.certificate_reissue_events WHERE certificate_id='${certificate}' AND idempotency_key='${concurrentKey}';`);
    assert.equal(count, "1", "concurrent same-key requests must persist exactly one event");
    assert.ok(first.getOutput().includes(firstId) && second.getOutput().includes(secondId));
    console.log("I3D PostgreSQL runtime: same key, distinct key, mismatched payload, unauthorized role, immutable certificate/snapshot, concurrent retry: PASS");
  } finally {
    const stopped = spawnSync("docker", ["stop", containerName], { cwd: repoRoot, encoding: "utf8", stdio: "ignore" });
    if (stopped.status !== 0) spawnSync("docker", ["rm", "-f", containerName], { cwd: repoRoot, encoding: "utf8", stdio: "ignore" });
  }
}

await main();
