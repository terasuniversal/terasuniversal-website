/**
 * W4-a remediation contract (owner-approved W4-a-G1, local only). Proves the named edits do exactly what was approved,
 * and that reverting them restores the files byte for byte to HEAD at the time of approval (5b8a77ad).
 * Run: node --experimental-strip-types scripts/w4a-remediation-contract.mts
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { revertW4a, W4A_CHANGED } from "./w4a-approved.mts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// SHA-256 (LF-normalised) of each changed file at the approved base, before W4-a.
const BEFORE: Record<string, string> = {
  "components/premium/header.module.css": "a92ea861098e795654332a0702dc51b04048f7f21a09017b3f1f91d2f2362a98",
};

check("only the approved files carry W4-a edits", () => {
  assert(JSON.stringify(W4A_CHANGED) === JSON.stringify(Object.keys(BEFORE).sort()), W4A_CHANGED.join(", "));
});
check("reverting the named edits restores each file exactly (nothing else changed)", () => {
  for (const [path, hash] of Object.entries(BEFORE)) assert(sha256(revertW4a(path, read(path))) === hash, path);
});

const header = read("components/premium/header.module.css").replace(/\r\n/g, "\n");
check("NE-1: one max-width 359px block, after the 590px block, only spacing and padding", () => {
  const block = header.match(/@media \(max-width: 359px\) \{([\s\S]*?)\n\}/);
  assert(block, "359px block missing");
  assert(header.indexOf("@media (max-width: 359px)") > header.indexOf("@media (max-width: 590px)"), "order");
  const decls = [...block![1].matchAll(/\{([^}]*)\}/g)].flatMap((m) => m[1].split(";").map((d) => d.trim().split(":")[0]).filter(Boolean));
  for (const prop of decls) assert(["gap", "padding-inline", "padding", "flex"].includes(prop), `unexpected property ${prop}`);
  assert(!/height|font-size|display/.test(block![1]), "no height, font-size or display change (44px targets, 54px logo)");
});
check("NE-1: the 54px mobile logo and the 44px menu button are unchanged", () => {
  assert(/@media \(max-width: 820px\) \{[\s\S]*?\.logo img \{ height: 54px; \}/.test(header), "54px logo");
  assert(/\.hdr :global\(\.menu-button\) \{ width: 44px; height: 44px;/.test(header), "44px menu button");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
