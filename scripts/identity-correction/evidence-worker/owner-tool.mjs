#!/usr/bin/env node
// Owner-side tool (PROTOTYPE, test keys only). The OWNER key signs only three record types: genesis, key_rotation and
// restore_declared. In a real deployment this key stays offline (hardware token or an offline machine) and is used by hand.
//   owner-tool.mjs genesis <worker.pub> <tsa.pub>
//   owner-tool.mjs rotate  <retire-key-id> <new-key-id> <new-worker.pub>
//   owner-tool.mjs restore <PITR|BACKUP_RESTORE|MIGRATION_REBUILD> <db_max_anchor_seq_after_restore>
// Environment: OWNER_KEY_FILE, OWNER_KEY_ID (default owner-1), plus the sink variables used by the worker.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecord, ZERO_HASH } from "./evidence-lib.mjs";
import { atomicWrite, commitAll, ensureClone, loadCfg, nowIso, pad, pullSink, pushSink, recordsDir, sh, verifySink } from "./evidence-worker.mjs";

const cfg = loadCfg(process.argv[2] !== "genesis"); const ownerPem = readFileSync(process.env.OWNER_KEY_FILE, "utf8"); const ownerId = process.env.OWNER_KEY_ID || "owner-1";
ensureClone(cfg); try { pullSink(cfg); } catch { /* empty remote */ }
const [cmd, a, b, c] = process.argv.slice(2);
const sink = verifySink(cfg);
const state = sink.state;
if (cmd !== "genesis" && !sink.ok) { console.error("sink does not verify:", sink.findings.join(",")); process.exit(2); }
let payload; let type;
if (cmd === "genesis") {
  if (sink.records.length) { console.error("sink already has records"); process.exit(2); }
  type = "genesis";
  payload = { note: "genesis", keys: [
    { key_id: ownerId, role: "owner", public_pem: cfg.pinnedOwner.trim() + "\n" },
    { key_id: process.env.WORKER_KEY_ID || "worker-1", role: "worker", public_pem: readFileSync(a, "utf8") },
    { key_id: "tsa-1", role: "tsa", public_pem: readFileSync(b, "utf8") }] };
} else if (cmd === "rotate") {
  type = "key_rotation"; payload = { retire: a, add: { key_id: b, role: "worker", public_pem: readFileSync(c, "utf8") } };
} else if (cmd === "restore") {
  // Safety check: the declared restore point must match what the (read-only) database now shows, so a typing mistake cannot widen the void.
  const r = sh(process.env.PSQL_READER ?? "", "select public.identity_evidence_snapshot();\n");
  let dbMax = null; let rows = 0; let head = "GENESIS";
  try { const snap = JSON.parse(r.stdout.trim()); dbMax = snap.anchors.reduce((m, x) => Math.max(m, x.seq), 0); rows = snap.ledger.chain.length; head = rows ? snap.ledger.chain[rows - 1].row_hash : "GENESIS"; } catch { /* unreadable */ }
  if (dbMax === null || dbMax !== Number(b)) { console.error(`restore point does not match the database (database highest anchor: ${dbMax ?? "unreadable"})`); process.exit(2); }
  // The declaration also pins the restored LEDGER (row count and head), read from the database, not typed: it identifies which restored state was meant.
  type = "restore_declared"; payload = { reason_code: a, db_max_anchor_seq_after_restore: Number(b), db_ledger_rows_after_restore: rows, db_ledger_head_after_restore: head };
} else { console.error("usage: owner-tool.mjs genesis|rotate|restore ..."); process.exit(64); }
const rec = buildRecord({ env: cfg.env, type, evidence_seq: state.lastSeq + 1, prev_hash: state.lastHash ?? ZERO_HASH, observed_at: nowIso(), key_id: ownerId, worker_id: "owner-tool", payload }, ownerPem);
atomicWrite(join(recordsDir(cfg), `${pad(rec.evidence_seq)}.json`), JSON.stringify(rec, null, 2) + "\n");
commitAll(cfg, `evidence ${rec.evidence_seq} ${type}`);
pushSink(cfg);
console.log(JSON.stringify({ evidence_seq: rec.evidence_seq, record_hash: rec.record_hash }));
