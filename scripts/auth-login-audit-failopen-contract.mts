import assert from "node:assert/strict";
import { writeLoginAudit } from "../lib/auth/loginAudit.ts";

let factoryCalls = 0;
let rpcCalls = 0;
const warnings: string[] = [];
const errors: string[] = [];

await writeLoginAudit({
  serviceRoleKey: "",
  userId: "user-absent",
  userEmail: "qa@example.test",
  fallbackEmail: "fallback@example.test",
  createServiceClient: () => {
    factoryCalls += 1;
    throw new Error("must not construct service client");
  },
  warn: (message) => warnings.push(message),
  error: (message) => errors.push(message),
});
assert.equal(factoryCalls, 0, "service client must not be constructed without a key");
assert.equal(warnings.length, 1, "missing service role should produce one safe warning");
assert.equal(errors.length, 0, "missing service role should not be treated as an audit exception");

await writeLoginAudit({
  serviceRoleKey: "configured",
  userId: "user-rpc-error",
  userEmail: "qa@example.test",
  fallbackEmail: "fallback@example.test",
  createServiceClient: () => ({
    rpc: async () => {
      rpcCalls += 1;
      return { error: new Error("simulated RPC failure") };
    },
  }),
  error: (message) => errors.push(message),
});
assert.equal(rpcCalls, 1, "configured service role should preserve the audit RPC");
assert.equal(errors.length, 1, "audit RPC failure should be captured without throwing");

await writeLoginAudit({
  serviceRoleKey: "configured",
  userId: "user-constructor-error",
  userEmail: "qa@example.test",
  fallbackEmail: "fallback@example.test",
  createServiceClient: () => {
    throw new Error("simulated constructor failure");
  },
  error: (message) => errors.push(message),
});
assert.equal(errors.length, 2, "service construction failure should remain non-blocking");

const loginAction = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../app/admin/login/actions.ts", import.meta.url), "utf8"));
assert.match(loginAction, /if \(profile\.must_change_password\) redirect\("\/admin\/account\/change-password"\)/);
assert.match(loginAction, /profile\?\.role === "trainer"\) redirect\("\/admin\/attendance"\)/);
assert.match(loginAction, /allowed\.length > 0 && !allowed\.includes\("dashboard"\)/);

console.log("Auth login audit fail-open contract checks passed");