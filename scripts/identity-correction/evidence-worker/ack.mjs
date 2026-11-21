#!/usr/bin/env node
// Acknowledgement step (PROTOTYPE) -- a SEPARATE program with a SEPARATE database credential (the "acker" role).
// It holds no sink write access and no signing key: it reads the sink, re-verifies the whole chain (pinned genesis, signatures),
// and only then writes two kinds of rows through the two minimal functions: public.identity_evidence_ack(...) and
// public.identity_evidence_heartbeat(...). The verification worker never holds this credential.
// Exit codes: 0 ok | 2 refused (sink does not verify, or the database rejected an acknowledgement).
import { join } from "node:path";
import { coveredAnchors } from "./evidence-lib.mjs";
import { ensureClone, git, loadCfg, pad, pullSink, roleScopeOk, sh, verifySink } from "./evidence-worker.mjs";

const cfg = loadCfg();
const out = { acked: [], heartbeat: null, errors: [] };
const finish = (code) => { console.log(JSON.stringify(out)); process.exit(code); };
const ackCmd = process.env.PSQL_ACKER;
if (!ackCmd) { console.error("missing configuration: PSQL_ACKER"); process.exit(64); }

if (!roleScopeOk(ackCmd, "idc_evidence_acker")) { out.errors.push("ACKER_ROLE_TOO_BROAD"); finish(2); }
try { ensureClone(cfg); pullSink(cfg); } catch (e) { out.errors.push(e.message); finish(2); }
const sink = verifySink(cfg);
if (!sink.ok) { out.errors.push(...sink.findings); finish(2); }

const run = (sql) => { const r = sh(ackCmd, sql + "\n"); if (r.status !== 0) throw new Error((r.stdout + r.stderr).split("\n").find((l) => /IDC_/.test(l))?.replace(/^.*?(IDC_[A-Z_]+).*$/, "$1") ?? "DATABASE_REJECTED"); };
const anchors = coveredAnchors(sink.state);   // every anchor still in force, including those exported before a declared restore
for (const a of anchors) {
  const file = join("env", cfg.env, "records", `${pad(a.evidence_seq)}.json`);
  const commit = git(cfg.sinkWork, ["log", "-1", "--format=%H", "--", file]).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) { out.errors.push("EVIDENCE_COMMIT_UNKNOWN"); finish(2); }
  try { run(`select public.identity_evidence_ack(${Number(a.anchor.seq)}, ${Number(a.evidence_seq)}, '${a.record_hash}', '${commit}');`); out.acked.push(a.anchor.seq); }
  catch (e) { out.errors.push(e.message); finish(2); }
}
const last = sink.state.verifications.at(-1);
if (last) {
  const arr = last.findings.length ? `array[${last.findings.map((c) => `'${c}'`).join(",")}]::text[]` : "'{}'::text[]";
  try { run(`select public.identity_evidence_heartbeat('${last.status}', ${Number(last.evidence_seq)}, '${last.record_hash}', ${Number(last.anchors_checked)}, ${arr});`); out.heartbeat = last.evidence_seq; }
  catch (e) { out.errors.push(e.message); finish(2); }
}
finish(0);
