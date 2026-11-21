// Test helper for run.sh (synthetic vectors only). Prints, for each vector, what the TypeScript detector says, or emits a
// psql script that asks the SQL detector the same questions, so the two implementations are compared on identical input.
//   node scripts/identity-correction/check-text-vectors.mts ts     -> "<index>|<expected>|<typescript verdict>" lines
//   node scripts/identity-correction/check-text-vectors.mts sql    -> SQL printing "<index>|<sql verdict>" lines
// Vector texts are never printed, only their index.
import { readFileSync } from "node:fs";
import { looksLikeIdentity } from "../../lib/validation/identity-text.ts";

const vectors: { text: string; identity: boolean; why: string }[] = JSON.parse(
  readFileSync(new URL("./identity-text-vectors.json", import.meta.url), "utf8"),
);

if (process.argv[2] === "sql") {
  console.log("select i || '|' || identity_audit.text_has_identity(t)::text from (values");
  console.log(vectors.map((v, i) => `  (${i}, $v${i}$${v.text}$v${i}$)`).join(",\n"));
  console.log(") as x(i, t) order by i;");
} else {
  vectors.forEach((v, i) => console.log(`${i}|${v.identity}|${looksLikeIdentity(v.text)}`));
}
