// A1 disposable Docker regression (local only, no network access to Supabase).
// Builds a throwaway postgres:17 container, reproduces the nine-table RLS surface from the pinned manifests (policies
// verbatim, helper functions verbatim from Staging, Supabase-like anon/authenticated roles and grants), proves the
// fixture fingerprint equals the live pinned fingerprint, then runs a six-persona read/write matrix:
//   pre-A1  ->  apply A1 migration  ->  post-A1  ->  apply rollback  ->  rolled-back (must equal pre-A1)
// and checks that the Staging A1 file fails closed on the Production (pre-R1) fixture.
// Usage: node --experimental-strip-types scripts/crm-anon-a1-docker/run.mts <repo-or-prep-root>
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const root = process.argv[2] ?? ".";
const IMAGE = "postgres:17";
const MIGRATION = join(root, "supabase/migrations/20261127120000_anon_content_staff_select_to_authenticated.sql");
const ROLLBACK = join(root, "docs/security/crm-anon-a1/20261127120000_anon_content_staff_select_to_authenticated.rollback.sql");
const STAGING = JSON.parse(readFileSync(join(root, "docs/security/crm-anon-a1/a1-staging-policy-manifest.json"), "utf8"));
const PRODUCTION = JSON.parse(readFileSync(join(root, "docs/security/crm-anon-a1/a1-production-policy-manifest.json"), "utf8"));

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

const GROUP_A = ["downloads", "faqs", "gallery_images", "media", "news_posts"];
const GROUP_B = ["faq_categories", "gallery_categories", "media_folders", "news_categories"];
const PERSONAS: Record<string, { uid: string | null; role?: string; ace?: boolean; level?: string }> = {
  anon:         { uid: null },
  nonstaff:     { uid: "00000000-0000-4000-8000-000000000001", role: "participant", ace: false },
  editor_view:  { uid: "00000000-0000-4000-8000-000000000002", role: "editor", ace: true, level: "view" },
  editor_edit:  { uid: "00000000-0000-4000-8000-000000000003", role: "editor", ace: true, level: "edit" },
  admin:        { uid: "00000000-0000-4000-8000-000000000004", role: "admin", ace: false },
  super_admin:  { uid: "00000000-0000-4000-8000-000000000005", role: "super_admin", ace: false },
};

const lit = (s: string | null) => (s === null ? "null" : `'${s.replace(/'/g, "''")}'`);
function policySql(p: any): string {
  const using = p.using === null ? "" : ` using (${p.using})`;
  const check = p.with_check === null ? "" : ` with check (${p.with_check})`;
  return `create policy ${p.policy} on public.${p.table} as permissive for ${p.cmd.toLowerCase()} to ${p.roles.join(", ")}${using}${check};`;
}

function fixture(manifest: any): string {
  const helpers = `
create role anon nologin; create role authenticated nologin;
create extension if not exists pgcrypto;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create type public.user_role as enum ('super_admin','admin','editor','trainer','client','participant');
create type public.content_status as enum ('draft','published','archived');
create table public.profiles (id uuid primary key, role public.user_role, is_active boolean, access_control_enabled boolean);
create table public.staff_module_catalog (module_key text primary key, min_role public.user_role, is_active boolean);
create table public.staff_module_access (user_id uuid, module_key text, access_level text);
create schema app;
create function app."current_role"() returns public.user_role language sql stable security definer set search_path to 'public'
  as $$ select role from public.profiles where id = (select auth.uid()); $$;
create function app.is_active() returns boolean language sql stable security definer set search_path to 'public'
  as $$ select coalesce((select is_active from public.profiles where id = (select auth.uid())), false); $$;
create function app.has_min_role(min_role public.user_role) returns boolean language sql stable security definer set search_path to 'public'
  as $$ select app.is_active() and array_position(enum_range(null::public.user_role), app.current_role())
        <= array_position(enum_range(null::public.user_role), min_role); $$;
create function app.is_admin() returns boolean language sql stable security definer set search_path to 'public'
  as $$ select app.has_min_role('admin'::public.user_role); $$;
create function app.is_editor() returns boolean language sql stable security definer set search_path to 'public'
  as $$ select app.has_min_role('editor'::public.user_role); $$;
create function app.is_super_admin() returns boolean language sql stable security definer set search_path to 'public'
  as $$ select app.current_role() = 'super_admin' and app.is_active(); $$;
create function public.module_access_rank(p_level text) returns integer language sql immutable set search_path to 'public'
  as $$ select case coalesce(p_level, 'none') when 'none' then 0 when 'view' then 1 when 'edit' then 2 when 'admin' then 3 else 0 end; $$;
create function public.has_module_access(p_module_key text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when not app.is_active() then false
    when app.current_role() = 'super_admin' then true
    when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false)
      then exists (select 1 from public.staff_module_catalog c where c.module_key = p_module_key and c.is_active and app.has_min_role(c.min_role))
    else exists (select 1 from public.staff_module_access a join public.staff_module_catalog c on c.module_key = a.module_key
                 where a.user_id = auth.uid() and a.module_key = p_module_key and c.is_active)
  end; $$;
create function public.has_module_access_level(p_module_key text, p_level text default 'view') returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when not public.has_module_access(p_module_key) then false
    when app.current_role() = 'super_admin' then true
    when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false) then true
    else exists (select 1 from public.staff_module_access a where a.user_id = auth.uid() and a.module_key = p_module_key
                 and public.module_access_rank(a.access_level) >= public.module_access_rank(p_level))
  end; $$;
-- Supabase-like privileges observed on Staging: anon has no USAGE on app and no EXECUTE on the helpers.
revoke all on schema app from public; grant usage on schema app to authenticated;
revoke execute on all functions in schema app from public; grant execute on all functions in schema app to authenticated;
revoke execute on function public.has_module_access(text), public.has_module_access_level(text, text) from public;
grant execute on function public.has_module_access(text), public.has_module_access_level(text, text) to authenticated;
grant usage on schema public to anon, authenticated;
insert into public.staff_module_catalog values ('downloads','editor',true),('faq','editor',true),('gallery','editor',true),('media','editor',true),('news','editor',true);
`;
  const tables = [
    ...GROUP_A.map((t) => `create table public.${t} (id uuid primary key default gen_random_uuid(), title text, status public.content_status, deleted_at timestamptz);`),
    ...GROUP_B.map((t) => `create table public.${t} (id uuid primary key default gen_random_uuid(), name text);`),
    ...[...GROUP_A, ...GROUP_B].map((t) => `alter table public.${t} enable row level security; grant select, insert, update, delete on public.${t} to anon, authenticated;`),
  ].join("\n");
  const seeds = [
    ...GROUP_A.map((t) => `insert into public.${t}(title, status, deleted_at) values ('pub','published',null),('draft','draft',null),('deleted','published',now());`),
    ...GROUP_B.map((t) => `insert into public.${t}(name) values ('c1'),('c2');`),
  ].join("\n");
  const people = Object.values(PERSONAS).filter((p) => p.uid).map((p) =>
    `insert into public.profiles values ('${p.uid}', '${p.role}', true, ${p.ace});` +
    (p.level ? ["downloads", "faq", "gallery", "media", "news"].map((m) => `insert into public.staff_module_access values ('${p.uid}', '${m}', '${p.level}');`).join("") : "")
  ).join("\n");
  return [helpers, tables, manifest.policies.map(policySql).join("\n"), seeds, people].join("\n");
}

const PROBE = `
create or replace function public.a1_probe() returns setof text language plpgsql as $f$
declare p record; t text; n bigint; cls text; seed text; tbl text;
begin
  for p in select * from (values ${Object.entries(PERSONAS).map(([k, v]) => `('${k}', ${lit(v.uid)})`).join(", ")}) x(label, uid) loop
    perform set_config('request.jwt.claims', case when p.uid is null then '{"role":"anon"}' else json_build_object('sub', p.uid, 'role', 'authenticated')::text end, true);
    execute format('set local role %I', case when p.uid is null then 'anon' else 'authenticated' end);
    foreach t in array array[${[...GROUP_A, ...GROUP_B].map((t) => `'${t}'`).join(",")}] loop
      begin execute format('select count(*) from public.%I', t) into n; cls := n::text;
      exception when others then cls := case when sqlerrm ~* 'permission denied for (function|schema)' then 'DENY_PRIV_HELPER' else 'ERR(' || sqlstate || ')' end; end;
      return next p.label || '|R:' || t || '|' || cls;
    end loop;
    foreach tbl in array array['news_posts','news_categories'] loop
      -- INSERT / UPDATE / DELETE, each in a subtransaction that is always rolled back (P0099).
      begin
        begin
          if tbl = 'news_posts' then execute 'insert into public.news_posts(title, status) values (''x'', ''draft'')';
          else execute 'insert into public.news_categories(name) values (''x'')'; end if;
          raise exception using errcode = 'P0099';
        exception when sqlstate 'P0099' then cls := 'ALLOW';
        end;
      exception when others then
        cls := case when sqlerrm ilike '%row-level security%' then 'DENY_RLS'
                    when sqlerrm ~* 'permission denied for (function|schema)' then 'DENY_PRIV_HELPER'
                    else 'ERR(' || sqlstate || ')' end;
      end;
      return next p.label || '|I:' || tbl || '|' || cls;
      foreach seed in array array['update','delete'] loop
        begin
          begin
            if seed = 'update' then
              execute format('update public.%I set %I = %I where %s', tbl, case when tbl = 'news_posts' then 'title' else 'name' end,
                             case when tbl = 'news_posts' then 'title' else 'name' end,
                             case when tbl = 'news_posts' then 'title = ''pub''' else 'name = ''c1''' end);
            else
              execute format('delete from public.%I where %s', tbl, case when tbl = 'news_posts' then 'title = ''pub''' else 'name = ''c1''' end);
            end if;
            get diagnostics n = row_count;
            raise exception using errcode = 'P0099';
          exception when sqlstate 'P0099' then cls := case when n = 1 then 'ALLOW' when n = 0 then 'DENY_RLS_0ROWS' else 'ERR(rows=' || n || ')' end;
          end;
        exception when others then
          cls := case when sqlerrm ilike '%row-level security%' then 'DENY_RLS'
                      when sqlerrm ~* 'permission denied for (function|schema)' then 'DENY_PRIV_HELPER'
                      else 'ERR(' || sqlstate || ')' end;
        end;
        return next p.label || '|' || upper(left(seed, 1)) || ':' || tbl || '|' || cls;
      end loop;
    end loop;
    reset role;
  end loop;
end; $f$;`;

function expected(phase: "pre" | "post"): Map<string, string> {
  const m = new Map<string, string>();
  for (const label of Object.keys(PERSONAS)) {
    const staff = ["editor_view", "editor_edit", "admin", "super_admin"].includes(label);
    for (const t of GROUP_A) m.set(`${label}|R:${t}`, label === "anon" && phase === "pre" ? "DENY_PRIV_HELPER" : staff ? "3" : "1");
    for (const t of GROUP_B) m.set(`${label}|R:${t}`, label === "anon" && phase === "pre" ? "DENY_PRIV_HELPER" : staff ? "2" : "0");
    for (const tbl of ["news_posts", "news_categories"]) {
      const canEdit = ["editor_edit", "admin", "super_admin"].includes(label);
      const canAdminDelete = ["admin", "super_admin"].includes(label);
      if (label === "anon") { for (const op of ["I", "U", "D"]) m.set(`${label}|${op}:${tbl}`, "DENY_PRIV_HELPER"); continue; }
      m.set(`${label}|I:${tbl}`, canEdit ? "ALLOW" : "DENY_RLS");
      m.set(`${label}|U:${tbl}`, canEdit ? "ALLOW" : "DENY_RLS_0ROWS");
      m.set(`${label}|D:${tbl}`, (tbl === "news_posts" ? canAdminDelete : canEdit) ? "ALLOW" : "DENY_RLS_0ROWS");
    }
  }
  return m;
}

const container = `a1-test-${randomBytes(4).toString("hex")}`;
const password = randomBytes(18).toString("hex");
// singleTx mirrors Supabase apply_migration (one transaction). The A1 file is a single DO block, so it must also be
// all-or-nothing WITHOUT an outer transaction; both modes are exercised below.
const psql = (sql: string, allowFail = false, singleTx = false): { ok: boolean; out: string } => {
  const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"];
  if (singleTx) args.push("-1");
  const r = spawnSync("docker", args, { input: sql, encoding: "utf8" });
  if (r.status !== 0 && !allowFail) throw new Error(`psql failed: ${r.stderr}`);
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const FP = (tables: string[], targetsOnly?: string[]) =>
  `select md5(string_agg(concat_ws('|',tablename,policyname,permissive,roles::text,cmd,qual,with_check), E'\\n' order by tablename,policyname))
   from pg_policies where schemaname='public' and tablename = any (array[${tables.map((t) => `'${t}'`).join(",")}])
   ${targetsOnly ? `and policyname = any (array[${targetsOnly.map((t) => `'${t}'`).join(",")}])` : ""};`;
const NINE = [...GROUP_A, ...GROUP_B];
const TARGETS = STAGING.policies.filter((p: any) => p.a1_target).map((p: any) => p.policy);

function runMatrix(phase: "pre" | "post", tag: string) {
  const out = psql(`select * from public.a1_probe();`).out.trim().split(/\r?\n/);
  const got = new Map(out.map((l) => { const i = l.lastIndexOf("|"); return [l.slice(0, i), l.slice(i + 1)]; }));
  const exp = expected(phase);
  let bad = 0;
  for (const [k, v] of exp) if (got.get(k) !== v) { bad++; console.log(`   mismatch ${tag} ${k}: expected ${v} got ${got.get(k)}`); }
  check(`${tag}: ${exp.size} persona results as expected`, bad === 0 && got.size === exp.size, `${got.size} results`);
  return got;
}

try {
  execFileSync("docker", ["run", "-d", "--rm", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, IMAGE], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"]).status === 0 && psql("select 1;", true).ok) break; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }

  // Staging fixture
  psql(fixture(STAGING));
  check("Staging fixture: 41 policies on nine tables equal pinned live fingerprint", psql(FP(NINE)).out.trim() === STAGING.pinned.nine_tables_41_pre);
  check("Staging fixture: nine targets equal pinned live fingerprint", psql(FP(NINE, TARGETS)).out.trim() === STAGING.pinned.targets_9_pre);
  psql(PROBE);
  const pre = runMatrix("pre", "pre-A1");
  // Atomicity under a lock timeout: another session holds ACCESS SHARE on news_posts (last target), so eight ALTERs
  // succeed and the ninth times out after 5s. Run WITHOUT an outer transaction: nothing may change.
  const holder = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt"], { stdio: ["pipe", "ignore", "ignore"] });
  holder.stdin.write("begin; lock table public.news_posts in access share mode; select pg_sleep(20); commit;\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  const locked = psql(readFileSync(MIGRATION, "utf8"), true, false);
  check("lock timeout aborts A1 (no outer transaction)", !locked.ok && /lock timeout/i.test(locked.out), locked.out.slice(0, 120));
  check("after the aborted run every policy is unchanged (atomic, 0 of 9 applied)", psql(FP(NINE)).out.trim() === STAGING.pinned.nine_tables_41_pre);
  holder.kill(); spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-qAt", "-c", "select pg_terminate_backend(pid) from pg_stat_activity where query like '%pg_sleep(20)%' and pid <> pg_backend_pid();"]);

  const mig = psql(readFileSync(MIGRATION, "utf8"), true, false);
  check("A1 migration applies without an outer transaction (single DO block)", mig.ok, mig.ok ? "" : mig.out.slice(0, 200));
  check("post-A1 nine-table fingerprint equals pinned expected", psql(FP(NINE)).out.trim() === STAGING.pinned.nine_tables_41_post_expected);
  const post = runMatrix("post", "post-A1");
  let same = 0, total = 0;
  for (const [k, v] of pre) if (!k.startsWith("anon|")) { total++; if (post.get(k) === v) same++; }
  check("non-anon personas: post-A1 results identical to pre-A1", same === total, `${same}/${total}`);
  const rerun = psql(readFileSync(MIGRATION, "utf8"), true, false);
  check("A1 re-run fails closed (idempotence guard)", !rerun.ok && /a1_precondition_failed/.test(rerun.out));
  check("refused re-run left the post-A1 state unchanged", psql(FP(NINE)).out.trim() === STAGING.pinned.nine_tables_41_post_expected);
  const rb = psql(readFileSync(ROLLBACK, "utf8"), true, true);
  check("rollback applies and restores the pinned pre-A1 fingerprint", rb.ok && psql(FP(NINE)).out.trim() === STAGING.pinned.nine_tables_41_pre, rb.ok ? "" : rb.out.slice(0, 200));
  const rolled = runMatrix("pre", "after rollback");
  let eq = 0; for (const [k, v] of pre) if (rolled.get(k) === v) eq++;
  check("after rollback: all results identical to pre-A1", eq === pre.size, `${eq}/${pre.size}`);

  // Production (pre-R1) fixture in a fresh database: the Staging file must fail closed.
  psql("drop schema if exists app cascade; drop schema if exists auth cascade; drop schema public cascade; create schema public; drop role if exists anon; drop role if exists authenticated;");
  psql(fixture(PRODUCTION));
  check("Production fixture: 29 policies on nine tables equal pinned live fingerprint", psql(FP(NINE)).out.trim() === PRODUCTION.pinned.nine_tables_29);
  const prodRun = psql(readFileSync(MIGRATION, "utf8"), true, true);
  check("Staging A1 file fails closed on the Production (pre-R1) fixture", !prodRun.ok && /a1_precondition_failed/.test(prodRun.out));
  check("Production fixture unchanged after the refused run", psql(FP(NINE)).out.trim() === PRODUCTION.pinned.nine_tables_29);
} finally {
  spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
}
console.log(`\n${failed ? `${failed} check(s) FAILED, ` : ""}${passed} check(s) passed.`);
process.exit(failed ? 1 : 0);
