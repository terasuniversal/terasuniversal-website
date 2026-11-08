#!/usr/bin/env node
// External evidence worker (PROTOTYPE). Zero npm dependencies: uses psql, git and node:crypto only.
//   node evidence-worker.mjs run           read the database with the READ-ONLY credential, recompute the guard fingerprint itself, compare
//                                          with the stored evidence, append signed records to the sink, mail the head, optional bundle backup
//   node evidence-worker.mjs verify-chain  verify a sink working copy offline (hash chain, signatures, timestamps, pinned genesis/known heads)
// It never writes to the database. Acknowledgements are a separate program with a separate credential (ack.mjs).
// Exit codes: 0 ok | 2 alert (a tamper or integrity finding) | 3 sink delivery failure | 4 database unreachable.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildRecord, canonical, compareWithDatabase, prohibitedData, sha256hex, verifyChain, ZERO_HASH } from "./evidence-lib.mjs";
import { sendMail, tsaStamp, tsaVerify } from "./mocks.mjs";

const E = process.env;
const need = (k) => { if (!E[k]) { console.error(`missing configuration: ${k}`); process.exit(64); } return E[k]; };
const nowIso = () => E.EVIDENCE_NOW || new Date().toISOString();
// No shell: the configured command is split on whitespace into program + arguments, so a configuration value cannot inject shell syntax.
// (Put credentials in PGPASSFILE / PGPASSWORD, never in the command line.)
const words = (cmd) => [...cmd.trim().matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);  // whitespace-separated words, "double quotes" keep spaces
const sh = (cmd, input) => { const [file, ...args] = words(cmd); return spawnSync(file, args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); };
// The credential in use must be exactly the intended least-privilege role: a member of its one group role and nothing else, and no
// superuser / createrole / createdb / bypassrls attribute. Checked at run time, because later GRANTs are not stopped by the migration.
export function roleScopeOk(cmd, group) {
  const r = sh(cmd, `select ((select count(*) from pg_roles r where pg_has_role(current_user, r.oid, 'member') and r.rolname not in (current_user, '${group}'))
    + (select count(*) from pg_roles where rolname = current_user and (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls)))::text || '|' || pg_has_role(current_user, '${group}', 'member')::text;\n`);
  return r.status === 0 && r.stdout.trim().split("\n").at(-1) === "0|true";
}
const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8" });
const read = (p) => readFileSync(p, "utf8");

export function loadCfg(requirePin = true) {
  if (requirePin && !E.PINNED_GENESIS_HASH) { console.error("missing configuration: PINNED_GENESIS_HASH (the genesis hash must be pinned out of band)"); process.exit(64); }
  return {
    env: E.ENV_NAME || "test", workerId: E.WORKER_ID || "worker-1",
    sinkRemote: need("SINK_REMOTE"), sinkWork: need("SINK_WORK"),
    pinnedOwner: read(need("PINNED_OWNER_PUB_FILE")), pinnedGenesis: E.PINNED_GENESIS_HASH || null,
    knownHeads: E.KNOWN_GOOD_HEADS_FILE && existsSync(E.KNOWN_GOOD_HEADS_FILE) ? JSON.parse(read(E.KNOWN_GOOD_HEADS_FILE)) : [],
    canaries: (E.CANARIES || "").split("|").filter(Boolean),
    tsaGraceS: Number(E.TSA_GRACE_SECONDS || 86400),
  };
}

// ---- sink (local git clone of the evidence repository) ---------------------------------------------------------------
export function ensureClone(cfg) {
  if (!existsSync(join(cfg.sinkWork, ".git"))) {
    const r = spawnSync("git", ["clone", "--quiet", cfg.sinkRemote, cfg.sinkWork], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("SINK_UNAVAILABLE");
    git(cfg.sinkWork, ["config", "user.name", "evidence-worker"]); git(cfg.sinkWork, ["config", "user.email", "evidence-worker@invalid"]);
    git(cfg.sinkWork, ["config", "commit.gpgsign", "false"]);
  }
  return cfg.sinkWork;
}
export function recordsDir(cfg, work = cfg.sinkWork) { return join(work, "env", cfg.env, "records"); }
export function readRecords(cfg, work = cfg.sinkWork) {
  const dir = recordsDir(cfg, work);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(read(join(dir, f))));
}
export function readTokens(cfg, work = cfg.sinkWork) {
  const dir = join(work, "env", cfg.env, "tsa"); const m = new Map();
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) m.set(Number(f.slice(0, 8)), JSON.parse(read(join(dir, f))));
  return m;
}
function atomicWrite(path, text) { mkdirSync(join(path, ".."), { recursive: true }); const tmp = `${path}.tmp`; writeFileSync(tmp, text); renameSync(tmp, path); }
const pad = (n) => String(n).padStart(8, "0");

function commitAll(cfg, message) {
  git(cfg.sinkWork, ["add", "-A"]);
  const r = git(cfg.sinkWork, ["commit", "--quiet", "-m", message]);
  if (r.status !== 0) throw new Error("SINK_COMMIT_FAILED");
}
function pushSink(cfg) {
  const r = git(cfg.sinkWork, ["push", "--quiet", "origin", "HEAD:main"]);
  if (r.status !== 0) throw new Error("SINK_PUSH_FAILED");
}
function pullSink(cfg) {
  const hasRemoteCommits = git(cfg.sinkWork, ["ls-remote", "--heads", "origin", "main"]).stdout.trim() !== "";
  if (!hasRemoteCommits) return;
  const f = git(cfg.sinkWork, ["fetch", "--quiet", "origin", "main"]);
  if (f.status !== 0) throw new Error("SINK_UNAVAILABLE");
  const hasLocal = git(cfg.sinkWork, ["rev-parse", "--verify", "-q", "HEAD"]).status === 0;
  if (!hasLocal) { git(cfg.sinkWork, ["checkout", "--quiet", "-B", "main", "origin/main"]); return; }
  const ancestor = git(cfg.sinkWork, ["merge-base", "--is-ancestor", "HEAD", "origin/main"]).status === 0;
  const behind = git(cfg.sinkWork, ["merge-base", "--is-ancestor", "origin/main", "HEAD"]).status === 0;
  if (ancestor) git(cfg.sinkWork, ["merge", "--quiet", "--ff-only", "origin/main"]);
  else if (!behind) throw new Error("SINK_HISTORY_DIVERGED");
}

// ---- verification of the sink on its own (also used by restore tests) -----------------------------------------------------
export function verifySink(cfg, work = cfg.sinkWork, now = nowIso()) {
  const records = readRecords(cfg, work);
  const res = verifyChain(records, { pinnedGenesisHash: cfg.pinnedGenesis, pinnedOwnerPem: cfg.pinnedOwner });
  const findings = [...res.findings]; const warnings = [];
  if (res.ok) {
    for (const kh of cfg.knownHeads) {
      const r = records.find((x) => x.evidence_seq === kh.evidence_seq);
      if (!r || r.record_hash !== kh.record_hash) { if (!findings.includes("EVIDENCE_REWRITTEN_VS_KNOWN_HEAD")) findings.push("EVIDENCE_REWRITTEN_VS_KNOWN_HEAD"); }
    }
    const genesis = records[0]; const tsaKey = genesis?.payload.keys.find((k) => k.role === "tsa");
    const tokens = readTokens(cfg, work);
    for (const r of records) {
      const t = tokens.get(r.evidence_seq);
      if (!t) {
        const late = (Date.parse(now) - Date.parse(r.observed_at)) / 1000 > cfg.tsaGraceS;
        if (late && !findings.includes("TSA_TOKEN_MISSING")) findings.push("TSA_TOKEN_MISSING");
        if (!late && !warnings.includes("WARN_TSA_PENDING")) warnings.push("WARN_TSA_PENDING");
        continue;
      }
      const skew = 300_000;
      if (!tsaKey || !tsaVerify(t, r.record_hash, tsaKey.public_pem) || Date.parse(t.time) < Date.parse(r.observed_at) - skew || Date.parse(t.time) > Date.parse(now) + skew) {
        if (!findings.includes("TSA_TOKEN_INVALID")) findings.push("TSA_TOKEN_INVALID");
      }
    }
  }
  return { ok: findings.length === 0, findings, warnings, state: res.state, records };
}

// ---- appending records --------------------------------------------------------------------------------------------------
function appendRecord(cfg, state, type, payload, workerKeyId, workerPem, tsaPem) {
  const rec = buildRecord({ env: cfg.env, type, evidence_seq: state.lastSeq + 1, prev_hash: state.lastHash, observed_at: nowIso(),
    key_id: workerKeyId, worker_id: cfg.workerId, payload }, workerPem);
  const bad = prohibitedData(rec, cfg.canaries);
  if (bad) throw new Error(bad);
  let token = null;
  try { token = tsaStamp(rec.record_hash, nowIso(), tsaPem); } catch { token = null; }
  atomicWrite(join(recordsDir(cfg), `${pad(rec.evidence_seq)}.json`), JSON.stringify(rec, null, 2) + "\n");
  if (token) atomicWrite(join(cfg.sinkWork, "env", cfg.env, "tsa", `${pad(rec.evidence_seq)}.json`), JSON.stringify(token, null, 2) + "\n");
  if (E.CRASH_AFTER_WRITE === "1") process.exit(137);  // test hook: simulate a crash after the file is written, before it is committed
  commitAll(cfg, `evidence ${rec.evidence_seq} ${type}`);
  state.lastSeq = rec.evidence_seq; state.lastHash = rec.record_hash;
  return { rec, tsa: !!token };
}

function alertMail(cfg, subject, body) { try { sendMail(E.MAIL_DIR || join(cfg.sinkWork, "..", "mail"), { to: E.MAIL_TO || "owner@example.invalid", subject, body }); return true; } catch { return false; } }

// ---- run ---------------------------------------------------------------------------------------------------------------------
async function run() {
  const cfg = loadCfg();
  const out = { status: "ok", critical: [], warnings: [], delivered: [], head: null, tsa_missing: 0 };
  const workerKeyId = need("WORKER_KEY_ID"); const workerPem = read(need("WORKER_KEY_FILE")); const tsaPem = read(need("TSA_KEY_FILE"));
  const finish = (code) => { console.log(JSON.stringify(out)); process.exit(code); };
  try { ensureClone(cfg); } catch { out.status = "sink_failure"; out.critical.push("SINK_UNAVAILABLE"); alertMail(cfg, "[TERAS audit anchor] ALERT SINK_UNAVAILABLE", "The evidence sink cannot be reached."); finish(3); }

  for (const sub of ["records", "tsa"]) {  // temp files can only come from an interrupted atomic write
    const d = join(cfg.sinkWork, "env", cfg.env, sub);
    if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith(".tmp")) rmSync(join(d, f));
  }
  // crash recovery: a record written (atomically) but not yet committed is kept only if it extends a valid chain
  const dirty = git(cfg.sinkWork, ["status", "--porcelain"]).stdout.trim();
  if (dirty) {
    const check = verifySink(cfg);
    if (check.ok) { commitAll(cfg, "evidence recovery commit"); out.warnings.push("WARN_RECOVERED_UNCOMMITTED_RECORD"); }
    else { out.critical.push("EVIDENCE_DIRTY_TREE_INVALID"); }
  }
  try { pullSink(cfg); } catch (e) { out.critical.push(e.message === "SINK_HISTORY_DIVERGED" ? "SINK_HISTORY_DIVERGED" : "SINK_UNAVAILABLE"); }

  let sink = verifySink(cfg);
  if (!sink.ok && sink.findings.every((f) => f === "TSA_TOKEN_MISSING")) {  // repairable: stamp what is missing, then verify again
    const tokens = readTokens(cfg); let any = false;
    for (const r of sink.records) {
      if (tokens.has(r.evidence_seq)) continue;
      try { atomicWrite(join(cfg.sinkWork, "env", cfg.env, "tsa", `${pad(r.evidence_seq)}.json`), JSON.stringify(tsaStamp(r.record_hash, nowIso(), tsaPem), null, 2) + "\n"); any = true; } catch { /* TSA still unavailable */ }
    }
    if (any) { commitAll(cfg, "evidence timestamp retry"); sink = verifySink(cfg); }
  }
  out.critical.push(...sink.findings); out.warnings.push(...sink.warnings);
  // A missing timestamp after the grace period is an incident, but the chain STRUCTURE is intact, so the alert can still be recorded in it.
  if (!sink.ok && sink.findings.some((f) => f !== "TSA_TOKEN_MISSING")) {  // never extend a chain that does not verify
    out.status = "alert"; alertMail(cfg, `[TERAS audit anchor] ALERT ${out.critical.join(",")}`, "The stored evidence does not verify; nothing was appended.");
    finish(2);
  }
  if (sink.records.length === 0) { out.status = "alert"; out.critical.push("EVIDENCE_GENESIS_MISSING"); finish(2); }
  const state = sink.state;
  const wk = state.keys.get(workerKeyId);  // a retired or unknown worker key must not append anything
  if (!wk || !wk.active || wk.role !== "worker") { out.status = "alert"; out.critical.push("WORKER_KEY_NOT_ACTIVE"); finish(2); }
  {  // timestamps still inside the grace period are retried too (so a recovered service heals the chain before it turns critical)
    const tokens = readTokens(cfg); let any = false;
    for (const r of sink.records) {
      if (tokens.has(r.evidence_seq)) continue;
      try { atomicWrite(join(cfg.sinkWork, "env", cfg.env, "tsa", `${pad(r.evidence_seq)}.json`), JSON.stringify(tsaStamp(r.record_hash, nowIso(), tsaPem), null, 2) + "\n"); any = true; } catch { /* still unavailable */ }
    }
    if (any) commitAll(cfg, "evidence timestamp retry");
  }

  // 1. retry delivery of anything committed locally but not pushed (previous interrupted or failed run)
  let pushFailed = false;
  try { pushSink(cfg); } catch { pushFailed = true; }

  // 2. read the database (read-only credential) and recompute the fingerprint independently
  const readerCmd = need("PSQL_READER");
  const s1 = sh(readerCmd, "select public.identity_evidence_snapshot();\n");
  const s2 = sh(readerCmd, read(need("EXTERNAL_VERIFY_SQL")));
  let snap = null; let extFp = null;
  try { snap = JSON.parse(s1.stdout.trim()); extFp = s2.stdout.trim().split("\n").at(-1); if (s1.status !== 0 || s2.status !== 0 || !/^[0-9a-f]{64}$/.test(extFp)) throw new Error("bad"); } catch { snap = null; }
  if (snap && !roleScopeOk(readerCmd, "idc_evidence_reader")) { out.critical.push("READER_ROLE_TOO_BROAD"); out.status = "alert"; }
  if (!snap) {
    out.status = "db_unreachable"; out.critical.push("DATABASE_UNREACHABLE");
    try { appendRecord(cfg, state, "verification", { status: "alert", anchors_checked: 0, db_latest_anchor_seq: 0, external_guard_fingerprint: ZERO_HASH, ledger_rows: 0, findings: ["DATABASE_UNREACHABLE"] }, workerKeyId, workerPem, tsaPem); pushSink(cfg); } catch { /* sink failure is reported below */ }
    alertMail(cfg, "[TERAS audit anchor] ALERT DATABASE_UNREACHABLE", "The read-only database check failed.");
    finish(4);
  }

  // 3. compare
  const cmp = compareWithDatabase(state, snap, extFp);
  out.critical.push(...cmp.critical.filter((c) => !out.critical.includes(c)));
  out.warnings.push(...cmp.warnings);

  // 4. deliver anchors that have not been exported yet -- never while a critical finding exists (do not bless a tampered state)
  if (out.critical.length === 0) {
    const sorted = [...cmp.pending].sort((a, b) => a.seq - b.seq);
    for (const a of sorted) {
      const isLatest = a.seq === snap.anchors.at(-1).seq;
      const verified = isLatest && a.guard_fingerprint === extFp;
      const { tsa } = appendRecord(cfg, state, "anchor", { anchor: { seq: a.seq, ledger_rows: a.ledger_rows, ledger_head: a.ledger_head, guard_fingerprint_db: a.guard_fingerprint, created_at: new Date(a.created_at).toISOString() },
        epoch: state.epoch ?? 0, external: { guard_fingerprint: extFp, verified } }, workerKeyId, workerPem, tsaPem);
      out.delivered.push(a.seq); if (!tsa) out.tsa_missing += 1;
    }
  }
  // epoch is tracked by verifyChain; recompute it from the sink state for anchors written above
  // (appendRecord uses state.epoch, which verifyChain exposes)

  // 5. mail the head digest (new anchors or alerts); a failure is a warning, or an alert if the owner chose to block on it
  let mailFailed = false;
  if (out.delivered.length || out.critical.length || E.MAIL_ALWAYS === "1") {
    const head = `evidence_seq=${state.lastSeq} head=${state.lastHash}`;
    const ok = alertMail(cfg, out.critical.length ? `[TERAS audit anchor] ALERT ${out.critical.join(",")}` : `[TERAS audit anchor] head ${state.lastSeq}`, `${head}\nenv=${cfg.env}\nanchors_delivered=${out.delivered.join(",") || "none"}`);
    if (!ok) { mailFailed = true; out.warnings.push("WARN_MAIL_FAILED"); }
  }
  if (pushFailed) out.warnings.push("WARN_SINK_PUSH_RETRY");
  if (mailFailed && E.MAIL_FAILURE_BLOCKS === "1") out.critical.push("MAIL_FAILURE_BLOCKING");

  // 6. verification record
  const findings = [...new Set([...out.critical, ...out.warnings])];
  out.status = out.critical.length ? "alert" : "ok";
  appendRecord(cfg, state, "verification", { status: out.status, anchors_checked: snap.anchors.length, db_latest_anchor_seq: snap.anchors.at(-1)?.seq ?? 0,
    external_guard_fingerprint: extFp, ledger_rows: snap.ledger.rows, findings: findings.slice(0, 20) }, workerKeyId, workerPem, tsaPem);

  // 7. push; failure leaves local commits that the next run retries (the ack step reads the REMOTE, so nothing unpushed is acknowledged)
  let sinkFailed = false;
  try { pushSink(cfg); } catch { sinkFailed = true; out.critical.push("SINK_PUSH_FAILED"); out.status = "sink_failure"; alertMail(cfg, "[TERAS audit anchor] ALERT SINK_PUSH_FAILED", "Evidence could not be pushed; it will be retried."); }
  out.head = { evidence_seq: state.lastSeq, record_hash: state.lastHash };

  // 8. offline backup bundle
  if (E.BACKUP_DIR && !sinkFailed) {
    mkdirSync(E.BACKUP_DIR, { recursive: true });
    const f = join(E.BACKUP_DIR, `evidence-${pad(state.lastSeq)}.bundle`);
    const r = git(cfg.sinkWork, ["bundle", "create", f, "--all"]);
    if (r.status === 0) writeFileSync(`${f}.sha256`, sha256hex(readFileSync(f)) + "\n"); else out.warnings.push("WARN_BACKUP_FAILED");
  }
  finish(sinkFailed ? 3 : out.status === "alert" ? 2 : 0);
}

async function verifyOnly() {
  const cfg = loadCfg(); const dir = E.VERIFY_DIR || cfg.sinkWork;
  const r = verifySink(cfg, dir);
  console.log(JSON.stringify({ ok: r.ok, findings: r.findings, warnings: r.warnings, head: r.state.head, records: r.records.length }));
  process.exit(r.ok ? 0 : 2);
}

export { atomicWrite, commitAll, pushSink, pullSink, pad, git, read, nowIso, sh };

const cmd = process.argv[2];
if (cmd === "run") await run();
else if (cmd === "verify-chain") await verifyOnly();
else if (process.argv[1]?.endsWith("evidence-worker.mjs")) { console.error("usage: evidence-worker.mjs run|verify-chain"); process.exit(64); }
