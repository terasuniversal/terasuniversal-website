// TEST-ONLY attacker simulation for the local evidence prototype. It edits a COPY of the evidence working tree to prove that
// every kind of tampering is caught by verify-chain. Never used outside run-evidence.sh; never touches a database.
//   node tamper-lab.mjs <dir> <env> edit-no-rehash <seq>             change a payload value, keep hash and signature
//   node tamper-lab.mjs <dir> <env> edit-rehash <seq>                change a payload value, fix the hash, keep the old signature
//   node tamper-lab.mjs <dir> <env> flip-signature <seq>             corrupt the signature only
//   node tamper-lab.mjs <dir> <env> drop <seq>                       delete a record file
//   node tamper-lab.mjs <dir> <env> dup <seq>                        copy a record file under a second name (same sequence)
//   node tamper-lab.mjs <dir> <env> append <keyfile> <keyid> <kind>  append a record signed with the given key (kind: anchor-conflict | rotation | verification)
//   node tamper-lab.mjs <dir> <env> rechain <seq> <keyfile> <keyid>  alter the anchor at <seq> and re-sign every record from there on
import { readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecord, canonical, sha256hex } from "./evidence-lib.mjs";

const [dir, env, op, ...args] = process.argv.slice(2);
const rdir = join(dir, "env", env, "records");
const file = (seq) => join(rdir, `${String(seq).padStart(8, "0")}.json`);
const load = (seq) => JSON.parse(readFileSync(file(seq), "utf8"));
const save = (rec) => writeFileSync(file(rec.evidence_seq), JSON.stringify(rec, null, 2) + "\n");
const seqs = () => readdirSync(rdir).filter((f) => /^\d{8}\.json$/.test(f)).map((f) => Number(f.slice(0, 8))).sort((a, b) => a - b);
const touch = (rec) => { if (rec.type === "anchor") rec.payload.anchor.ledger_rows += 1; else if (rec.type === "verification") rec.payload.ledger_rows += 1; else rec.payload.note = "x"; };

if (op === "edit-no-rehash") { const r = load(+args[0]); touch(r); save(r); }
else if (op === "edit-rehash") { const r = load(+args[0]); touch(r); const { record_hash, signature, ...body } = r; r.record_hash = sha256hex(canonical(body)); save(r); }
else if (op === "flip-signature") { const r = load(+args[0]); const b = Buffer.from(r.signature, "base64"); b[0] ^= 0xff; r.signature = b.toString("base64"); save(r); }
else if (op === "drop") { writeFileSync(file(+args[0]), ""); const { unlinkSync } = await import("node:fs"); unlinkSync(file(+args[0])); }
else if (op === "dup") { copyFileSync(file(+args[0]), join(rdir, `${String(+args[0]).padStart(8, "0")}b.json`)); }
else if (op === "append") {
  const [keyfile, keyid, kind] = args; const last = load(seqs().at(-1));
  const firstAnchor = seqs().map(load).find((r) => r.type === "anchor");
  let type; let payload;
  if (kind === "anchor-conflict") { type = "anchor"; payload = { ...firstAnchor.payload, anchor: { ...firstAnchor.payload.anchor, ledger_head: "e".repeat(64) } }; }
  else if (kind === "rotation") { type = "key_rotation"; payload = { retire: "worker-1", add: { key_id: "evil-1", role: "worker", public_pem: readFileSync(join(dir, "..", "k", "attacker.pub"), "utf8") } }; }
  else { type = "verification"; payload = { status: "ok", anchors_checked: 1, db_latest_anchor_seq: 1, external_guard_fingerprint: "a".repeat(64), ledger_rows: 1, findings: [] }; }
  save(buildRecord({ env, type, evidence_seq: last.evidence_seq + 1, prev_hash: last.record_hash, observed_at: new Date().toISOString(), key_id: keyid, worker_id: "attacker", payload }, readFileSync(keyfile, "utf8")));
}
else if (op === "rechain") {
  const [from, keyfile, keyid] = [+args[0], args[1], args[2]]; let prev = load(from - 1).record_hash;
  for (const s of seqs().filter((n) => n >= from)) {
    const r = load(s); if (s === from) touch(r);
    const { record_hash, signature, ...body } = r;
    save(buildRecord({ ...body, prev_hash: prev, key_id: keyid }, readFileSync(keyfile, "utf8")));
    prev = load(s).record_hash;
  }
}
else { console.error("unknown operation"); process.exit(64); }
