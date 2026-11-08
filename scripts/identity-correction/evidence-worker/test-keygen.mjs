// TEST-ONLY key generation for the local evidence prototype. Writes throw-away Ed25519 key pairs into the directory given as argv[2].
// These keys exist only for synthetic tests and are never used for anything real.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { genKeyPair } from "./evidence-lib.mjs";

const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
for (const name of ["owner", "worker", "worker2", "tsa", "attacker"]) {
  const k = genKeyPair();
  writeFileSync(join(dir, `${name}.key`), k.privatePem);
  writeFileSync(join(dir, `${name}.pub`), k.publicPem);
}
console.log("test keys written");
