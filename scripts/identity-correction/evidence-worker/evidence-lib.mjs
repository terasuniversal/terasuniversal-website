// External Audit Anchor -- evidence records (PROTOTYPE, test keys only, nothing here talks to a real service).
//
// A record is canonical JSON, hash-chained to the previous record and signed with Ed25519. The chain starts at a GENESIS record
// signed by the owner key, whose public key and genesis hash are PINNED out of band (the verifier is told them; it never learns them
// from the sink it is checking). Key rotation and restore declarations are owner-signed records. Records carry hashes, counters,
// timestamps and enumerated codes only: there is no free-text field, so personal data has nowhere to go.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { looksLikeIdentity } from "../../../lib/validation/identity-text.ts";

export const ZERO_HASH = "0".repeat(64);
// Domain separation: the signed message is this tag + the record hash, so a signature made here cannot be replayed as a
// signature over a bare 32-byte digest in any other protocol that uses the same key.
const SIGN_DOMAIN = "teras-idc-evidence-v1\n";
const strRe = (re) => ({ test: (v) => typeof v === "string" && re.test(v) });  // a non-string never matches, whatever it would coerce to
const HEX64 = strRe(/^[0-9a-f]{64}$/);
const HEAD = strRe(/^([0-9a-f]{64}|GENESIS)$/);
const ISO = strRe(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
const CODE = strRe(/^[A-Z][A-Z0-9_]{2,39}$/);
const KEY_ID = strRe(/^[a-z0-9-]{2,24}$/);
const WORKER_ID = strRe(/^[a-z0-9-]{2,40}$/);
const REASON = strRe(/^(PITR|BACKUP_RESTORE|MIGRATION_REBUILD)$/);

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
export const canonical = (v) => JSON.stringify(sortKeys(v));
export const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

export function genKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicPem: publicKey.export({ type: "spki", format: "pem" }), privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

// ---- building ---------------------------------------------------------------------------------------------------------
export function buildRecord(fields, privatePem) {
  const body = { v: 1, ...fields };
  const record_hash = sha256hex(canonical(body));
  const signature = sign(null, Buffer.from(SIGN_DOMAIN + record_hash, "utf8"), createPrivateKey(privatePem)).toString("base64");
  return { ...body, record_hash, signature };
}

// ---- strict allow-list shape (no unknown keys, no free text) -----------------------------------------------------------
const num = (x) => Number.isInteger(x) && x >= 0 && x <= Number.MAX_SAFE_INTEGER;
const keyEntry = (k) => k && Object.keys(k).sort().join() === "key_id,public_pem,role" && KEY_ID.test(k.key_id)
  && (k.role === "worker" || k.role === "owner" || k.role === "tsa") && typeof k.public_pem === "string" && k.public_pem.length < 400
  && k.public_pem.startsWith("-----BEGIN PUBLIC KEY-----");
const SHAPES = {
  genesis: (p) => Object.keys(p).sort().join() === "keys,note" && p.note === "genesis" && Array.isArray(p.keys) && p.keys.length >= 2 && p.keys.length <= 6 && p.keys.every(keyEntry),
  anchor: (p) => Object.keys(p).sort().join() === "anchor,epoch,external"
    && Object.keys(p.anchor).sort().join() === "created_at,guard_fingerprint_db,ledger_head,ledger_rows,seq"
    && num(p.anchor.seq) && num(p.anchor.ledger_rows) && HEAD.test(p.anchor.ledger_head) && HEX64.test(p.anchor.guard_fingerprint_db) && ISO.test(p.anchor.created_at)
    && num(p.epoch) && Object.keys(p.external).sort().join() === "guard_fingerprint,verified"
    && HEX64.test(p.external.guard_fingerprint) && typeof p.external.verified === "boolean",
  verification: (p) => Object.keys(p).sort().join() === "anchors_checked,db_latest_anchor_seq,external_guard_fingerprint,findings,ledger_rows,status"
    && (p.status === "ok" || p.status === "alert") && num(p.anchors_checked) && num(p.db_latest_anchor_seq) && num(p.ledger_rows)
    && HEX64.test(p.external_guard_fingerprint) && Array.isArray(p.findings) && p.findings.length <= 20 && p.findings.every((c) => CODE.test(c)),
  key_rotation: (p) => Object.keys(p).sort().join() === "add,retire" && KEY_ID.test(p.retire) && keyEntry(p.add),
  restore_declared: (p) => Object.keys(p).sort().join() === "db_ledger_head_after_restore,db_ledger_rows_after_restore,db_max_anchor_seq_after_restore,reason_code"
    && num(p.db_max_anchor_seq_after_restore) && num(p.db_ledger_rows_after_restore) && HEAD.test(p.db_ledger_head_after_restore) && REASON.test(p.reason_code),
};
const TOP = "env,evidence_seq,key_id,observed_at,payload,prev_hash,record_hash,signature,type,v,worker_id";
export function shapeProblem(rec) {
  if (!rec || typeof rec !== "object" || Object.keys(rec).sort().join() !== TOP) return "EVIDENCE_SHAPE_INVALID";
  if (rec.v !== 1 || !num(rec.evidence_seq) || rec.evidence_seq < 1 || !HEX64.test(rec.prev_hash) || !HEX64.test(rec.record_hash)
      || !ISO.test(rec.observed_at) || !KEY_ID.test(rec.key_id) || !WORKER_ID.test(rec.worker_id) || !KEY_ID.test(rec.env)
      || typeof rec.signature !== "string" || rec.signature.length > 100) return "EVIDENCE_SHAPE_INVALID";
  const shape = SHAPES[rec.type];
  if (!shape || !rec.payload || typeof rec.payload !== "object" || !shape(rec.payload)) return "EVIDENCE_SHAPE_INVALID";
  return null;
}

// Defence in depth on top of the allow-list: nothing outside hashes/PEM/timestamps may look like an identity number, and no
// caller-supplied canary (a synthetic name or identity number) may appear anywhere in the serialised record.
export function prohibitedData(rec, canaries = []) {
  const text = canonical(rec);
  for (const c of canaries) if (c && text.toLowerCase().includes(String(c).toLowerCase())) return "PROHIBITED_DATA_PRESENT";
  const strings = [];
  (function walk(v) { if (typeof v === "string") strings.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); })(rec);
  for (const s of strings) {
    if (HEX64.test(s) || ISO.test(s) || s.startsWith("-----BEGIN PUBLIC KEY-----") || /^[A-Za-z0-9+/=]{60,100}$/.test(s)) continue;
    if (looksLikeIdentity(s)) return "PROHIBITED_DATA_PRESENT";
  }
  return null;
}

// ---- verifying a whole chain -------------------------------------------------------------------------------------------
// opts: { pinnedGenesisHash, pinnedOwnerPem }. Returns { ok, findings, state }.
export function verifyChain(records, opts) {
  const findings = [];
  const state = { keys: new Map(), lastSeq: 0, lastHash: ZERO_HASH, epoch: 0, anchors: [], restores: [], verifications: [], head: null };
  const bad = (code) => { if (!findings.includes(code)) findings.push(code); };
  if (!opts.pinnedGenesisHash || !opts.pinnedOwnerPem) { bad("EVIDENCE_PIN_MISSING"); return { ok: false, findings, state }; }
  const sorted = [...records].sort((a, b) => a.evidence_seq - b.evidence_seq);
  for (const rec of sorted) {
    const sp = shapeProblem(rec);
    if (sp) { bad(sp); break; }
    if (rec.evidence_seq !== state.lastSeq + 1) { bad(rec.evidence_seq <= state.lastSeq ? "EVIDENCE_DUPLICATE_SEQ" : "EVIDENCE_GAP"); break; }
    if (rec.prev_hash !== state.lastHash) { bad("EVIDENCE_CHAIN_BROKEN"); break; }
    const { record_hash, signature, ...body } = rec;
    if (sha256hex(canonical(body)) !== record_hash) { bad("EVIDENCE_HASH_MISMATCH"); break; }
    let pem;
    if (rec.type === "genesis") {
      if (rec.evidence_seq !== 1) { bad("EVIDENCE_GENESIS_MISPLACED"); break; }
      if (opts.pinnedGenesisHash && record_hash !== opts.pinnedGenesisHash) { bad("EVIDENCE_GENESIS_NOT_PINNED"); break; }
      const owner = rec.payload.keys.find((k) => k.key_id === rec.key_id && k.role === "owner");
      if (!owner || owner.public_pem.trim() !== String(opts.pinnedOwnerPem ?? "").trim()) { bad("EVIDENCE_OWNER_KEY_NOT_PINNED"); break; }
      pem = owner.public_pem;
      for (const k of rec.payload.keys) state.keys.set(k.key_id, { role: k.role, pem: k.public_pem, active: true });
    } else {
      if (state.lastSeq === 0) { bad("EVIDENCE_GENESIS_MISSING"); break; }
      const k = state.keys.get(rec.key_id);
      if (!k || !k.active) { bad("EVIDENCE_SIGNER_UNKNOWN_OR_RETIRED"); break; }
      const needOwner = rec.type === "key_rotation" || rec.type === "restore_declared";
      if ((needOwner && k.role !== "owner") || (!needOwner && k.role !== "worker")) { bad("EVIDENCE_SIGNER_ROLE_WRONG"); break; }
      pem = k.pem;
    }
    let sigOk = false;
    try { sigOk = verify(null, Buffer.from(SIGN_DOMAIN + record_hash, "utf8"), createPublicKey(pem), Buffer.from(signature, "base64")); } catch { sigOk = false; }
    if (!sigOk) { bad("EVIDENCE_SIGNATURE_INVALID"); break; }
    // effects
    if (rec.type === "key_rotation") {
      const old = state.keys.get(rec.payload.retire);
      if (!old) { bad("EVIDENCE_ROTATION_UNKNOWN_KEY"); break; }
      old.active = false;
      state.keys.set(rec.payload.add.key_id, { role: rec.payload.add.role, pem: rec.payload.add.public_pem, active: true });
    } else if (rec.type === "restore_declared") {
      state.epoch += 1;
      state.restores.push({ evidence_seq: rec.evidence_seq, epoch: state.epoch, afterSeq: rec.payload.db_max_anchor_seq_after_restore,
        ledgerRows: rec.payload.db_ledger_rows_after_restore, ledgerHead: rec.payload.db_ledger_head_after_restore });
    } else if (rec.type === "anchor") {
      if (rec.payload.epoch !== state.epoch) { bad("EVIDENCE_EPOCH_MISMATCH"); break; }
      if (state.anchors.some((a) => a.epoch === state.epoch && a.anchor.seq === rec.payload.anchor.seq)) { bad("EVIDENCE_CONFLICT_SAME_ANCHOR"); break; }
      const prev = state.anchors.filter((a) => a.epoch === state.epoch).at(-1);
      if (prev && (rec.payload.anchor.seq <= prev.anchor.seq || rec.payload.anchor.ledger_rows < prev.anchor.ledger_rows)) { bad("EVIDENCE_ANCHOR_ORDER"); break; }
      state.anchors.push({ ...rec.payload, evidence_seq: rec.evidence_seq, record_hash });
    } else if (rec.type === "verification") {
      state.verifications.push({ evidence_seq: rec.evidence_seq, record_hash, observed_at: rec.observed_at, ...rec.payload });
    }
    state.lastSeq = rec.evidence_seq;
    state.lastHash = record_hash;
    state.head = { evidence_seq: rec.evidence_seq, record_hash };
  }
  return { ok: findings.length === 0, findings, state };
}

// An exported anchor still counts if it belongs to the current epoch, or to an older epoch and lies at or below every later restore point.
// Returns the covered anchors, one per sequence number (the newest epoch wins), ordered by sequence.
export function coveredAnchors(state) {
  const covered = (ev) => ev.epoch === state.epoch || ev.anchor.seq <= Math.min(...state.restores.filter((r) => r.epoch > ev.epoch).map((r) => r.afterSeq));
  const bySeq = new Map();
  for (const ev of state.anchors) if (covered(ev)) bySeq.set(ev.anchor.seq, ev);   // later records overwrite earlier ones
  return [...bySeq.values()].sort((a, b) => a.anchor.seq - b.anchor.seq);
}

// ---- comparing the evidence with what the database now shows ---------------------------------------------------------------
// snap: public.identity_evidence_snapshot(); externalFp: output of external-verify.sql. Returns { findings (critical), warnings, pending }.
export function compareWithDatabase(state, snap, externalFp) {
  const critical = [];
  const warnings = [];
  const add = (arr, c) => { if (!arr.includes(c)) arr.push(c); };
  const dbAnchors = new Map(snap.anchors.map((a) => [a.seq, a]));
  const dbMax = snap.anchors.length ? Math.max(...snap.anchors.map((a) => a.seq)) : 0;
  // the snapshot must carry the COMPLETE heartbeat history, otherwise an old forged row could sit outside the window
  if ((snap.verifications ?? []).length !== snap.verifications_total) add(critical, "HEARTBEAT_HISTORY_TRUNCATED");
  const chain = snap.ledger.chain;
  const currentEpoch = state.epoch;

  // 1. every previously exported anchor must still be there and unchanged (older epochs only up to the declared restore point)
  for (const ev of coveredAnchors(state)) {
    const a = dbAnchors.get(ev.anchor.seq);
    if (!a) { add(critical, ev.epoch === currentEpoch ? "ANCHOR_MISSING_IN_DATABASE" : "ANCHOR_MISSING_AFTER_RESTORE"); continue; }
    if (a.ledger_rows !== ev.anchor.ledger_rows || a.ledger_head !== ev.anchor.ledger_head || a.guard_fingerprint !== ev.anchor.guard_fingerprint_db) {
      add(critical, "ANCHOR_ALTERED_IN_DATABASE");
    }
  }
  // 1b. after a declared restore the ledger must still be the restored one (same row count at least, same head at that count)
  const lastRestore = state.restores.at(-1);
  if (lastRestore) {
    const atRestore = lastRestore.ledgerRows === 0 ? "GENESIS" : chain[lastRestore.ledgerRows - 1]?.row_hash;
    if (chain.length < lastRestore.ledgerRows || atRestore !== lastRestore.ledgerHead) add(critical, "RESTORE_STATE_MISMATCH");
  }
  // 2. rollback: the database knows fewer anchors than the evidence says existed
  const evMax = coveredAnchors(state).reduce((m, a) => Math.max(m, a.anchor.seq), 0);
  if (dbMax < evMax) add(critical, "DATABASE_ROLLBACK_DETECTED");
  // 3. ledger linkage and anchored heads (row content cannot be recomputed from outside: only linkage and heads can)
  let prev = "GENESIS";
  for (const row of chain) { if (row.prev_hash !== prev) { add(critical, "LEDGER_LINKAGE_BROKEN"); break; } prev = row.row_hash; }
  if (snap.ledger.rows !== chain.length) add(critical, "LEDGER_COUNT_INCONSISTENT");
  let lastRows = -1;
  for (const a of snap.anchors) {
    if (a.ledger_rows < lastRows) add(critical, "ANCHOR_LEDGER_ROWS_DECREASE");
    lastRows = a.ledger_rows;
    const expectedHead = a.ledger_rows === 0 ? "GENESIS" : chain[a.ledger_rows - 1]?.row_hash;
    if (a.ledger_rows > chain.length || (a.ledger_rows > 0 && a.ledger_head !== expectedHead)) add(critical, "ANCHOR_HEAD_MISMATCH");
  }
  const latest = snap.anchors.at(-1);
  if (latest && chain.length > latest.ledger_rows) add(critical, "UNANCHORED_LEDGER_ROWS");
  // 4. the independently recomputed guard fingerprint
  const lastVer = state.verifications.at(-1);
  if (latest) { if (externalFp !== latest.guard_fingerprint) add(critical, "FINGERPRINT_MISMATCH"); }
  else if (lastVer && externalFp !== lastVer.external_guard_fingerprint) add(critical, "FINGERPRINT_CHANGED_UNANCHORED");
  // 5. acknowledgements must point at the real records; a heartbeat cannot be ahead of the evidence
  for (const k of snap.acks) {
    const ev = coveredAnchors(state).find((a) => a.anchor.seq === k.anchor_seq);
    if (!ev || ev.evidence_seq !== k.evidence_seq || ev.record_hash !== k.evidence_hash) add(critical, "ACK_MISMATCH");
  }
  // every heartbeat the database holds must be a signed verification record, field for field (a forged or replayed 'ok' is caught)
  const sorted = (a) => canonical([...a].sort());
  for (const v of snap.verifications ?? []) {
    const ev = state.verifications.find((x) => x.evidence_seq === v.evidence_seq);
    if (!ev) { add(critical, v.evidence_seq > state.lastSeq ? "HEARTBEAT_AHEAD_OF_EVIDENCE" : "HEARTBEAT_NOT_IN_EVIDENCE"); continue; }
    if (ev.record_hash !== v.evidence_hash || ev.status !== v.status || ev.anchors_checked !== v.anchors_checked || sorted(ev.findings) !== sorted(v.findings)) add(critical, "HEARTBEAT_MISMATCH");
  }
  // 6. what still has to be delivered
  const pending = snap.anchors.filter((a) => !coveredAnchors(state).some((e) => e.anchor.seq === a.seq));
  if (pending.length > 1) add(warnings, "WARN_BACKLOG_UNVERIFIED_HISTORY");
  return { critical, warnings, pending };
}
