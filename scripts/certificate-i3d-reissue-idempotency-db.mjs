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
CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT;
CREATE ROLE supabase_admin NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT;
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
GRANT ALL ON public.certificate_reissue_events TO service_role;
GRANT INSERT (certificate_id,reissued_by,event_type,reason,notes) ON public.certificate_reissue_events TO certificate_lifecycle_executor;
CREATE POLICY reissue_executor_read ON public.certificate_reissue_events FOR SELECT TO certificate_lifecycle_executor USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin') AND reissued_by=app.request_actor_id());
CREATE POLICY reissue_executor_insert ON public.certificate_reissue_events FOR INSERT TO certificate_lifecycle_executor WITH CHECK (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin') AND reissued_by=app.request_actor_id());
CREATE POLICY reissue_authenticated_read ON public.certificate_reissue_events FOR SELECT TO authenticated USING (app.is_active() AND app.is_admin() AND public.has_module_access_level('certificates','admin'));

CREATE FUNCTION app.reissue_certificate(p_certificate_id uuid,p_event_type text DEFAULT 'reissue',p_reason text DEFAULT NULL,p_notes jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(id uuid,certificate_id uuid,certificate_number text,event_type text,reissued_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::timestamptz WHERE false $$;
ALTER FUNCTION app.reissue_certificate(uuid,text,text,jsonb) OWNER TO certificate_lifecycle_executor;
GRANT EXECUTE ON FUNCTION app.reissue_certificate(uuid,text,text,jsonb) TO certificate_lifecycle_executor;

-- Reproduce staging's two independent grantors: the privileged grant is
-- administered by supabase_admin; postgres has a separate, non-admin self-row.
GRANT certificate_lifecycle_executor TO supabase_admin WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
SET SESSION AUTHORIZATION supabase_admin;
GRANT certificate_lifecycle_executor TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION postgres;
GRANT certificate_lifecycle_executor TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
RESET SESSION AUTHORIZATION;

ALTER SCHEMA app OWNER TO postgres;
ALTER SCHEMA public OWNER TO postgres;
ALTER TABLE public.certificates OWNER TO postgres;
ALTER TABLE public.certificate_issuance_snapshots OWNER TO postgres;
ALTER TABLE public.certificate_reissue_events OWNER TO postgres;

DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname='postgres')
     OR NOT (SELECT rolcreaterole FROM pg_roles WHERE rolname='postgres')
     OR NOT EXISTS (
       SELECT 1 FROM pg_auth_members m
       JOIN pg_roles target ON target.oid=m.roleid
       JOIN pg_roles member ON member.oid=m.member
       JOIN pg_roles grantor ON grantor.oid=m.grantor
       WHERE target.rolname='certificate_lifecycle_executor'
         AND member.rolname='postgres' AND grantor.rolname='supabase_admin'
         AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_auth_members m
       JOIN pg_roles target ON target.oid=m.roleid
       JOIN pg_roles member ON member.oid=m.member
       JOIN pg_roles grantor ON grantor.oid=m.grantor
       WHERE target.rolname='certificate_lifecycle_executor'
         AND member.rolname='postgres' AND grantor.rolname='postgres'
         AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option
     ) THEN
    RAISE EXCEPTION 'Local fixture did not reproduce hosted dual-grantor baseline';
  END IF;
  IF has_schema_privilege('certificate_lifecycle_executor','app','CREATE')
     OR (SELECT rolname FROM pg_roles WHERE oid=(SELECT proowner FROM pg_proc WHERE oid='app.reissue_certificate(uuid,text,text,jsonb)'::regprocedure)) <> 'certificate_lifecycle_executor' THEN
    RAISE EXCEPTION 'Local fixture does not match hosted function/schema ownership baseline';
  END IF;
END;
$$;
`;

const apiAclSnapshotSql = String.raw`
SELECT coalesce(
  jsonb_agg(
    jsonb_build_array(object_type,column_name,grantee,grantor,privilege_type,is_grantable)
    ORDER BY object_type,column_name,grantee,grantor,privilege_type,is_grantable
  ),
  '[]'::jsonb
)::text
FROM (
  SELECT 'table'::text AS object_type,
         NULL::text AS column_name,
         grantee.rolname::text AS grantee,
         grantor.rolname::text AS grantor,
         acl_entry.privilege_type,
         acl_entry.is_grantable
  FROM pg_catalog.pg_class c
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))
  ) acl_entry
  JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl_entry.grantee
  JOIN pg_catalog.pg_roles grantor ON grantor.oid=acl_entry.grantor
  WHERE c.oid='public.certificate_reissue_events'::pg_catalog.regclass
    AND grantee.rolname IN ('anon','authenticated','service_role')
  UNION ALL
  SELECT 'column'::text,
         a.attname::text,
         grantee.rolname::text,
         grantor.rolname::text,
         acl_entry.privilege_type,
         acl_entry.is_grantable
  FROM pg_catalog.pg_attribute a
  CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl_entry
  JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl_entry.grantee
  JOIN pg_catalog.pg_roles grantor ON grantor.oid=acl_entry.grantor
  WHERE a.attrelid='public.certificate_reissue_events'::pg_catalog.regclass
    AND a.attnum>0
    AND NOT a.attisdropped
    AND a.attacl IS NOT NULL
    AND grantee.rolname IN ('anon','authenticated','service_role')
) api_acl;
`;

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { cwd: repoRoot, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${(result.stderr || result.stdout || "").trim()}`);
  return (result.stdout || "").trim();
}

function psqlInput(sql) {
  const result = spawnSync("docker", ["exec", "-i", "-u", "postgres", containerName, "psql", "-U", "bootstrap", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t"], { cwd: repoRoot, input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Isolated reissue PostgreSQL contract failed: ${(result.stderr || result.stdout || "").trim()}`);
  return result.stdout.trim();
}

function readApiAclSnapshot() {
  return JSON.parse(psqlInput(apiAclSnapshotSql));
}

function launchPsql(sql) {
  const child = spawn("docker", ["exec", "-i", "-u", "postgres", containerName, "psql", "-U", "bootstrap", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t"], { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] });
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
  docker(["run", "--rm", "-d", "--network", "none", "--name", containerName, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_USER=bootstrap", "-e", "POSTGRES_DB=postgres", "postgres:17.6"]);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = spawnSync("docker", ["exec", "-u", "postgres", containerName, "pg_isready", "-U", "bootstrap", "-d", "postgres"], { cwd: repoRoot, stdio: "ignore" });
      if (result.status === 0) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, "isolated PostgreSQL test container must become ready");

    psqlInput(bootstrapSql);
    const apiAclBaseline = readApiAclSnapshot();
    assert.equal(apiAclBaseline.filter((row) => row[0] === "table" && row[2] === "anon").length, 0,
      "hosted API ACL baseline must have no direct anon table ACL");
    assert.deepEqual(
      apiAclBaseline.filter((row) => row[0] === "table" && row[2] === "authenticated").map((row) => row[4]).sort(),
      ["SELECT"],
      "authenticated must have SELECT-only table ACL",
    );
    assert.ok(
      !apiAclBaseline.some((row) => ["anon", "authenticated"].includes(row[2]) && ["INSERT", "UPDATE", "DELETE"].includes(row[4])),
      "anon/authenticated baseline must not have table- or column-level write ACLs",
    );
    const expectedServiceRolePrivileges = ["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"];
    const baselineServiceRolePrivileges = [...new Set(
      apiAclBaseline.filter((row) => row[0] === "table" && row[2] === "service_role").map((row) => row[4]),
    )].sort();
    for (const privilege of expectedServiceRolePrivileges) {
      assert.ok(baselineServiceRolePrivileges.includes(privilege), `service_role baseline is missing ${privilege}`);
    }
    console.log("API_ACL_BASELINE_REPRODUCED: PASS");

    psqlInput(`SET SESSION AUTHORIZATION postgres;\n${readFileSync(migrationPath, "utf8")}`);
    const apiAclAfter = readApiAclSnapshot();
    assert.deepEqual(apiAclAfter, apiAclBaseline, "migration must preserve table- and column-level API-role ACLs");
    assert.equal(psqlInput(`SELECT has_column_privilege(
      'certificate_lifecycle_executor',
      'public.certificate_reissue_events',
      'idempotency_key',
      'INSERT'
    );`), "t", "executor must receive INSERT on the new idempotency_key column");
    console.log("API_ACL_UNCHANGED_AFTER: PASS");

    psqlInput(String.raw`
      DO $$
      BEGIN
        IF (SELECT rolsuper FROM pg_roles WHERE rolname='postgres')
           OR pg_has_role('postgres','certificate_lifecycle_executor','SET')
           OR has_schema_privilege('certificate_lifecycle_executor','app','CREATE')
           OR NOT EXISTS (
             SELECT 1 FROM pg_auth_members m
             JOIN pg_roles target ON target.oid=m.roleid
             JOIN pg_roles member ON member.oid=m.member
             JOIN pg_roles grantor ON grantor.oid=m.grantor
             WHERE target.rolname='certificate_lifecycle_executor'
               AND member.rolname='postgres' AND grantor.rolname='supabase_admin'
               AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
           )
           OR NOT EXISTS (
             SELECT 1 FROM pg_auth_members m
             JOIN pg_roles target ON target.oid=m.roleid
             JOIN pg_roles member ON member.oid=m.member
             JOIN pg_roles grantor ON grantor.oid=m.grantor
             WHERE target.rolname='certificate_lifecycle_executor'
               AND member.rolname='postgres' AND grantor.rolname='postgres'
               AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option
           ) THEN
          RAISE EXCEPTION 'Hosted dual-grantor membership cleanup did not restore its baseline';
        END IF;
      END;
      $$;
    `);
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
