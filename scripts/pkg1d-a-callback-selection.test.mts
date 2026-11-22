import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ProviderOutcome, SelectableTransaction } from "../lib/payments/registrationCallbackSelection.ts";

// PKG-1d-A mocked-provider tests (P1-P12) for lib/payments/registrationCallbackSelection.ts, plus negative mutations
// M13-M15 of that module. The provider is a list of synthetic getBillTransactions rows: no network, no ToyyibPay, no
// database. Each mutation is applied to a temporary copy of the module and must make at least one P-test fail; a
// mutation whose target text is not found counts as a failure of this script, never as a pass.
const MODULE = new URL("../lib/payments/registrationCallbackSelection.ts", import.meta.url);
const BILL = "BILL-P";
type Row = SelectableTransaction & { label: string };
type Select = (rows: readonly Row[], billCode: string, refno: string | null) => ProviderOutcome<Row>;
const row = (label: string, status: Row["providerStatus"], txn: string | null, amount: string | null = "100.00", bill: string | null = BILL): Row =>
  ({ label, providerStatus: status, providerTransactionId: txn, amount, billCode: bill });
const chosen = (o: ProviderOutcome<Row>) => (o.kind === "success" ? o.transaction.label : `<${o.kind}>`);
const extras = (o: ProviderOutcome<Row>) => (o.kind === "success" ? o.additional.map((r) => r.label).sort() : []);
const permutations = <T,>(items: T[]): T[][] => (items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));

const CASES: { id: string; name: string; run: (select: Select) => void }[] = [
  { id: "P1", name: "[gagal, berjaya]: baris berjaya dipilih, bukan baris pertama", run: (s) => {
    assert.equal(chosen(s([row("f", "unsuccessful", "TP1"), row("ok", "successful", "TP2")], BILL, "TP1")), "ok");
  } },
  { id: "P2", name: "[berjaya, gagal]: baris berjaya dipilih (susunan tidak penting)", run: (s) => {
    assert.equal(chosen(s([row("ok", "successful", "TP2"), row("f", "unsuccessful", "TP1")], BILL, null)), "ok");
    for (const order of permutations([row("ok", "successful", "TP2"), row("f", "unsuccessful", "TP1"), row("p", "pending", "TP3")])) {
      assert.equal(chosen(s(order, BILL, null)), "ok", order.map((r) => r.label).join(","));
    }
  } },
  { id: "P3", name: "refno padan memilih baris berjaya yang sepadan", run: (s) => {
    const o = s([row("a", "successful", "TP1"), row("b", "successful", "TP2")], BILL, "TP2");
    assert.equal(chosen(o), "b");
    assert.deepEqual(extras(o), ["a"]);
    assert.equal(chosen(s([row("only", "successful", "TP9")], BILL, " TP9 ")), "only");
  } },
  { id: "P4", name: "refno tidak padan: baris berjaya penyedia tetap bukti (refno hanya pemilih)", run: (s) => {
    assert.equal(chosen(s([row("only", "successful", "TP1")], BILL, "FORGED-REFNO")), "only");
  } },
  { id: "P5", name: "dua baris berjaya: satu dipilih secara deterministik, satu lagi dilaporkan", run: (s) => {
    for (const order of permutations([row("b", "successful", "TP2"), row("a", "successful", "TP1")])) {
      const o = s(order, BILL, null);
      assert.equal(chosen(o), "a");
      assert.deepEqual(extras(o), ["b"]);
    }
    const dup = s([row("x", "successful", "TP1"), row("y", "successful", "TP1")], BILL, null);
    assert.equal(dup.kind, "success");
    assert.deepEqual(extras(dup), [], "the same transaction twice is one payment");
  } },
  { id: "P6", name: "txn sama berjaya dan gagal: provider_record_conflict, tiada perubahan", run: (s) => {
    const o = s([row("ok", "successful", "TP1"), row("f", "unsuccessful", "TP1"), row("ok2", "successful", "TP2")], BILL, "TP2");
    assert.equal(o.kind, "conflict");
    assert.deepEqual(o.kind === "conflict" ? o.transactionIds : [], ["TP1"]);
  } },
  { id: "P7", name: "pending sahaja: tiada tindakan", run: (s) => {
    assert.deepEqual(s([row("p", "pending", null, null)], BILL, null), { kind: "no_action", reason: "pending" });
  } },
  { id: "P8", name: "baris bil lain dibuang", run: (s) => {
    assert.deepEqual(s([row("other", "successful", "TP1", "100.00", "BILL-OTHER")], BILL, "TP1"), { kind: "none" });
    assert.deepEqual(s([row("nobill", "successful", "TP1", "100.00", null)], BILL, "TP1"), { kind: "none" });
    assert.equal(chosen(s([row("other", "unsuccessful", "TP1", "100.00", "BILL-OTHER"), row("ok", "successful", "TP2")], BILL, null)), "ok");
  } },
  { id: "P9", name: "tiada baris (\"No data found!\"): tiada tindakan", run: (s) => {
    assert.deepEqual(s([], BILL, "TP1"), { kind: "none" });
    assert.deepEqual(s([row("ok", "successful", "TP1")], "  ", "TP1"), { kind: "none" }, "an empty bill code never matches");
  } },
  { id: "P10", name: "berjaya tanpa txn atau amaun yang sah: invalid_success, tidak pernah success", run: (s) => {
    assert.equal(s([row("a", "successful", null)], BILL, null).kind, "invalid_success");
    assert.equal(s([row("a", "successful", "TP1", null)], BILL, "TP1").kind, "invalid_success");
    assert.equal(s([row("a", "successful", "TP1", "0")], BILL, "TP1").kind, "invalid_success");
    assert.equal(s([row("a", "successful", "TP1", "-5")], BILL, "TP1").kind, "invalid_success");
    assert.equal(s([row("a", "successful", "  ", "100")], BILL, null).kind, "invalid_success");
  } },
  { id: "P11", name: "status tidak dikenali: tiada tindakan", run: (s) => {
    assert.deepEqual(s([row("u", "unknown", "TP1")], BILL, "TP1"), { kind: "no_action", reason: "unknown" });
  } },
  { id: "P12", name: "callback menuntut berjaya tetapi penyedia gagal: failed, tidak pernah paid", run: (s) => {
    // The callback body (status=1, refno=TP1) is never an input: only the provider rows decide.
    assert.deepEqual(s([row("f", "unsuccessful", "TP1")], BILL, "TP1"), { kind: "failed" });
    assert.deepEqual(s([row("f", "unsuccessful", "TP1"), row("p", "pending", "TP2")], BILL, "TP2"), { kind: "failed" });
  } },
];

const runAll = (select: Select): string[] => {
  const failed: string[] = [];
  for (const c of CASES) {
    try { c.run(select); } catch (error) { failed.push(`${c.id}: ${(error as Error).message.split("\n")[0]}`); }
  }
  return failed;
};

let failures = 0;
const report = (ok: boolean, name: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "LULUS" : "GAGAL"} ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
};

const real = (await import(MODULE.href)).selectProviderOutcome as Select;
for (const c of CASES) {
  try { c.run(real); report(true, `${c.id} ${c.name}`); } catch (error) { report(false, `${c.id} ${c.name}`, (error as Error).message.split("\n")[0]); }
}

// Negative mutations of the selection module (M13-M15 of PKG1D-SPLIT-DESIGN.md).
const source = readFileSync(MODULE, "utf8").replace(/\r\n/g, "\n");
const MUTATIONS = [
  { id: "M13", name: "pemilih mengambil baris pertama sahaja", from: "  const successful = relevant.filter((row) => row.providerStatus === \"successful\");",
    to: "  const successful = relevant.slice(0, 1).filter((row) => row.providerStatus === \"successful\");" },
  { id: "M14", name: "pemilih mempercayai data callback (refno menjadikan baris sebagai bukti)", from: "  const valid = successful.filter(hasValidMoney);",
    to: "  const valid = relevant.filter((row) => hasValidMoney(row) && (row.providerStatus === \"successful\" || clean(row.providerTransactionId) === clean(callbackRefno)));" },
  { id: "M15", name: "pemilih mengabaikan konflik rekod penyedia", from: "  if (conflicting.length > 0) return { kind: \"conflict\", transactionIds: conflicting };", to: "" },
];
const dir = mkdtempSync(path.join(tmpdir(), "pkg1d-a-selection-"));
try {
  let caught = 0;
  for (const m of MUTATIONS) {
    if (!source.includes(m.from)) { report(false, `${m.id} ${m.name}: teks sasaran mutasi tidak ditemui (tidak dikira)`); continue; }
    const file = path.join(dir, `${m.id}.ts`);
    writeFileSync(file, source.replace(m.from, m.to));
    const mutated = (await import(pathToFileURL(file).href)).selectProviderOutcome as Select;
    const broken = runAll(mutated);
    if (broken.length > 0) caught += 1;
    report(broken.length > 0, `${m.id} ${m.name}: ditolak oleh ujian`, "tiada ujian P gagal");
    if (broken.length > 0) console.log(`      dikesan oleh: ${broken.slice(0, 2).join("; ")}`);
  }
  report(caught === MUTATIONS.length, `${caught}/${MUTATIONS.length} mutasi pemilih ditolak`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua ujian pemilih transaksi PKG-1d-A lulus");
process.exit(failures ? 1 : 0);
